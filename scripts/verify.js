'use strict';

const { Readable } = require('stream');

const mockPort = 14001;
const serverPort = 4100;

process.env.PORT = process.env.PORT || String(serverPort);
process.env.OLLAMA_HOST = process.env.OLLAMA_HOST || `http://127.0.0.1:${mockPort}/`;
process.env.OLLAMA_CONNECTIVITY_TIMEOUT_MS = process.env.OLLAMA_CONNECTIVITY_TIMEOUT_MS || '2000';
process.env.OLLAMA_GENERATION_TIMEOUT_MS = process.env.OLLAMA_GENERATION_TIMEOUT_MS || '10000';
process.env.OLLAMA_STREAM_TIMEOUT_MS = process.env.OLLAMA_STREAM_TIMEOUT_MS || '0';
process.env.STREAM_HEARTBEAT_INTERVAL_MS = process.env.STREAM_HEARTBEAT_INTERVAL_MS || '50';

const { startMockOllama } = require('./mock-ollama');
const { startServer } = require('../server');

async function ensureFetch() {
  if (typeof fetch !== 'undefined') {
    return fetch;
  }
  const { default: nodeFetch } = await import('node-fetch');
  return nodeFetch;
}

async function run() {
  const fetchImpl = await ensureFetch();
  const mock = await startMockOllama({ port: mockPort, streamDelayMs: 40 });
  const listener = startServer(serverPort);

  try {
    await waitForServer(fetchImpl, serverPort);
    await verifyNonStreaming(fetchImpl, serverPort);
    await verifyStreaming(fetchImpl, serverPort);
    await verifyChatStream(fetchImpl, serverPort);
    console.log('[verify] All checks passed');
  } finally {
    await Promise.all([mock.close(), closeServer(listener)]);
  }
}

async function waitForServer(fetchImpl, port, retries = 20) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become ready in time');
}

async function verifyNonStreaming(fetchImpl, port) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mock-model', prompt: 'hello mock' })
  });

  if (!response.ok) {
    throw new Error(`/api/generate non-stream failed (${response.status})`);
  }

  const data = await response.json();
  if (!data.response || !data.response.includes('mock completion')) {
    throw new Error('Unexpected non-stream response payload');
  }
  console.log('[verify] Non-streaming /api/generate passed');
}

async function verifyStreaming(fetchImpl, port) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mock-model', prompt: 'stream please', stream: true })
  });

  if (!response.ok || !response.body) {
    throw new Error(`/api/generate streaming failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let tokens = '';
  let doneReceived = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (!rawEvent) continue;

      const dataLine = rawEvent
        .split('\n')
        .find((line) => line.startsWith('data:'));
      if (!dataLine) continue;

      const payloadText = dataLine.replace(/^data:\s*/, '');
      if (!payloadText) continue;

      const payload = JSON.parse(payloadText);
      if (payload.response) {
        tokens += payload.response;
      }
      if (payload.done) {
        doneReceived = true;
      }
    }
  }

  if (!tokens.includes('mock token')) {
    throw new Error('Streaming response did not include tokens');
  }
  if (!doneReceived) {
    throw new Error('Streaming response never sent done=true');
  }
  console.log('[verify] Streaming /api/generate passed');
}

async function verifyChatStream(fetchImpl, port) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'stream from verify',
      sessionId: 'default',
      includeHistory: false
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`/api/chat/stream failed (${response.status})`);
  }

  const stream = toNodeReadable(response.body);
  if (!stream) {
    throw new Error('/api/chat/stream did not return a readable body');
  }

  let buffer = '';
  let aggregate = '';
  let doneReceived = false;
  let heartbeatSeen = false;

  for await (const chunk of stream) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    buffer += text;

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (!rawEvent) continue;

      if (rawEvent.startsWith(':')) {
        heartbeatSeen = true;
        continue;
      }

      const dataLine = rawEvent
        .split('\n')
        .find((line) => line.startsWith('data:'));
      if (!dataLine) continue;

      const payloadText = dataLine.replace(/^data:\s*/, '');
      if (!payloadText) continue;

      const payload = JSON.parse(payloadText);
      if (payload.token) {
        aggregate += payload.token;
      }
      if (payload.error) {
        throw new Error(payload.error);
      }
      if (payload.done) {
        doneReceived = true;
        aggregate = payload.response || aggregate;
      }
    }
  }

  if (!doneReceived) {
    throw new Error('/api/chat/stream never signaled completion');
  }
  if (!aggregate) {
    throw new Error('/api/chat/stream returned empty response');
  }
  if (!heartbeatSeen) {
    throw new Error('/api/chat/stream did not emit heartbeat comments');
  }

  console.log('[verify] Streaming /api/chat/stream passed');
}

function closeServer(listener) {
  return new Promise((resolve, reject) => {
    listener.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

run().catch((error) => {
  console.error('[verify] Failed:', error);
  process.exitCode = 1;
});

function toNodeReadable(body) {
  if (!body) {
    return null;
  }
  if (typeof body.getReader === 'function' && Readable.fromWeb) {
    return Readable.fromWeb(body);
  }
  return body;
}


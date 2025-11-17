'use strict';

const { Readable } = require('stream');

let mockPort = Number(process.env.MOCK_PORT || 14001);
const serverPort = Number(process.env.SERVER_PORT || 4100);

process.env.PORT = String(serverPort);
process.env.OLLAMA_HOST = `http://127.0.0.1:${mockPort}/`;
process.env.OLLAMA_CONNECTIVITY_TIMEOUT_MS = '2000';
process.env.OLLAMA_GENERATION_TIMEOUT_MS = '10000';
process.env.OLLAMA_STREAM_TIMEOUT_MS = '0';
process.env.STREAM_HEARTBEAT_INTERVAL_MS = '50';

const { startMockOllama } = require('./mock-ollama');
const { startServer } = require('../server');
const net = require('net');

async function ensureFetch() {
  if (typeof fetch !== 'undefined') {
    return fetch;
  }
  const { default: nodeFetch } = await import('node-fetch');
  return nodeFetch;
}

function findAvailablePort(start) {
  const canListen = (port, host) =>
    new Promise((resolve) => {
      const srv = net
        .createServer()
        .once('error', () => resolve(false))
        .once('listening', () => srv.close(() => resolve(true)))
        .listen(port, host);
    });

  return new Promise((resolve) => {
    const tryPort = async (port) => {
      const okV6 = await canListen(port, '::');
      if (!okV6) return tryPort(port + 1);
      const okV4 = await canListen(port, '127.0.0.1');
      if (!okV4) return tryPort(port + 1);
      resolve(port);
    };
    tryPort(start);
  });
}

async function run() {
  const fetchImpl = await ensureFetch();
  mockPort = await findAvailablePort(mockPort);
  process.env.OLLAMA_HOST = `http://127.0.0.1:${mockPort}/`;
  const mock = await startMockOllama({ port: mockPort, streamDelayMs: 40 });
  const listener = startServer(serverPort);

  try {
    await waitForServer(fetchImpl, serverPort);
    await primeServer(fetchImpl, serverPort);
    await verifyNonStreaming(fetchImpl, serverPort);
    await verifyStreaming(fetchImpl, serverPort);
    await verifyChatStream(fetchImpl, serverPort);
    await verifyPresetCaching(fetchImpl, serverPort);
    await verifySessionPresetSync(fetchImpl, serverPort);
    console.log('[verify] All checks passed');
  } finally {
    await Promise.all([mock.close(), closeServer(listener)]);
  }
}

async function primeServer(fetchImpl, port) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mock-model',
      apiEndpoint: `http://127.0.0.1:${mockPort}/`,
      ollamaMode: 'local'
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to configure server settings (${response.status}): ${text}`);
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

async function verifyPresetCaching(fetchImpl, port) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/api/settings`);

  if (!response.ok) {
    throw new Error(`/api/settings failed (${response.status})`);
  }

  const data = await response.json();
  if (!data.presets || !Array.isArray(data.presets)) {
    throw new Error('/api/settings did not return presets array');
  }

  const hasDefaultAssistant = data.presets.find((p) => p.id === 'default-assistant');
  const hasAiCoder = data.presets.find((p) => p.id === 'ai-coder-prompt');

  if (!hasDefaultAssistant || !hasAiCoder) {
    throw new Error('Expected presets not found in /api/settings response');
  }

  // Verify preset metadata fields
  for (const preset of data.presets) {
    if (!preset.id || !preset.label || !preset.description || !preset.instructions) {
      throw new Error('Preset missing required fields: id, label, description, or instructions');
    }
    if (!preset.version || !preset.category || !preset.workflow) {
      throw new Error('Preset missing metadata fields: version, category, or workflow');
    }
  }

  console.log('[verify] Preset caching via /api/settings passed');
}

async function verifySessionPresetSync(fetchImpl, port) {
  // Create a session with a preset
  const createResponse = await fetchImpl(`http://127.0.0.1:${port}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Preset Session',
      presetId: 'default-assistant',
      instructions: 'Test instructions'
    })
  });

  if (!createResponse.ok) {
    throw new Error(`Session creation failed (${createResponse.status})`);
  }

  const createData = await createResponse.json();
  if (!createData.session || !createData.session.id) {
    throw new Error('Session creation did not return session ID');
  }

  const sessionId = createData.session.id;

  // Verify the session includes presetId
  const getResponse = await fetchImpl(`http://127.0.0.1:${port}/api/sessions/${sessionId}`);
  if (!getResponse.ok) {
    throw new Error(`Session GET failed (${getResponse.status})`);
  }

  const getData = await getResponse.json();
  if (!getData.session || getData.session.presetId !== 'default-assistant') {
    throw new Error('Session did not preserve presetId');
  }

  // Clean up
  await fetchImpl(`http://127.0.0.1:${port}/api/sessions/${sessionId}`, {
    method: 'DELETE'
  });

  console.log('[verify] Session preset sync passed');
}

function closeServer(listener) {
  if (!listener) {
    return Promise.resolve();
  }

  if (typeof listener.then === 'function') {
    return listener.then((resolved) => closeServer(resolved));
  }

  if (typeof listener.close === 'function') {
    return new Promise((resolve, reject) => {
      listener.close((err) => {
        if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  return Promise.resolve();
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


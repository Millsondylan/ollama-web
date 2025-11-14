'use strict';

/**
 * Local Ollama web interface server
 * ---------------------------------
 * Responsibilities:
 *  - Provide REST endpoints for chat, history, settings, and proxy calls.
 *  - Spawn `ollama run <model>` processes for each chat request.
 *  - Keep lightweight in-memory chat history and runtime settings.
 *  - Serve the static frontend (public/) that renders the chat UI, settings, and extra pages.
 *  - Offer extensibility hooks so new pages/endpoints can be added with minimal changes.
 */

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn, spawnSync } = require('child_process');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const FALLBACK_MODEL = 'qwen3:1.7B';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || detectLocalModel() || FALLBACK_MODEL;
const DEFAULT_ENDPOINT = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const ATTACHMENT_CHAR_LIMIT = Number(process.env.ATTACHMENT_CHAR_LIMIT || 200000);
const MAX_ATTACHMENTS = Number(process.env.MAX_ATTACHMENTS || 10);
const DEFAULT_SESSION_ID = 'default';
const DEFAULT_CONTEXT_LIMIT = Number(process.env.CONTEXT_MESSAGES || 20);
const RAW_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.PUBLIC_URL ||
  `http://localhost:${PORT}`;
const DEFAULT_BASE_URL = withTrailingSlash(RAW_BASE_URL);

const __dirnameResolved = __dirname || path.resolve();
const STORAGE_DIR = path.join(__dirnameResolved, 'storage');
const SESSIONS_FILE = path.join(STORAGE_DIR, 'sessions.json');
const API_KEYS_FILE = path.join(STORAGE_DIR, 'api-keys.json');

/**
 * API surface
 *  - POST /api/chat        -> send a prompt to Ollama and receive the assistant response.
 *  - GET  /api/history     -> read in-memory chat transcript.
 *  - DELETE /api/history   -> clear stored transcript.
 *  - GET  /api/settings    -> fetch defaults + runtime overrides.
 *  - POST /api/settings    -> mutate runtime overrides (model, endpoint, instructions, theme).
 *  - POST /api/proxy       -> forward arbitrary HTTP calls (advanced integrations).
 *  - GET  /health          -> basic heartbeat/status.
 *  - Static frontend under / (public/) with nav + extensibility hooks.
 */

// Defaults are surfaced via GET /api/settings and can be overridden from the UI.
const DEFAULT_SETTINGS = {
  model: DEFAULT_MODEL,
  apiEndpoint: DEFAULT_ENDPOINT,
  theme: 'system',
  systemInstructions:
    'You are an honest, detail-oriented AI assistant that helps the user accomplish local tasks.',
  maxHistory: DEFAULT_CONTEXT_LIMIT,
  backendBaseUrl: DEFAULT_BASE_URL
};

let runtimeSettings = { ...DEFAULT_SETTINGS };

function withTrailingSlash(value) {
  if (!value) {
    return '/';
  }
  return value.endsWith('/') ? value : `${value}/`;
}

function detectLocalModel() {
  try {
    const result = spawnSync('ollama', ['list'], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout) {
      return null;
    }
    const lines = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('NAME'));
    if (!lines.length) {
      return null;
    }
    const first = lines[0].split(/\s+/)[0];
    return first || null;
  } catch (error) {
    console.warn('Unable to detect local Ollama model, falling back to default.', error.message);
    return null;
  }
}

/**
 * Session persistence utilities: sessions are cached in memory for speed but
 * flushed to disk (storage/sessions.json) after every mutation so that history,
 * instructions, and attachments survive server restarts.
 */
function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function createDefaultSession() {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_SESSION_ID,
    name: 'Default Session',
    instructions: DEFAULT_SETTINGS.systemInstructions,
    attachments: [],
    history: [],
    createdAt: now,
    updatedAt: now
  };
}

function normalizeSession(session, fallbackName = 'Untitled Session') {
  if (!session) {
    return createDefaultSession();
  }
  return {
    id: session.id || crypto.randomUUID(),
    name: session.name || fallbackName,
    instructions: session.instructions || '',
    attachments: Array.isArray(session.attachments) ? session.attachments : [],
    history: Array.isArray(session.history) ? session.history : [],
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString()
  };
}

function loadSessionStore() {
  ensureStorageDir();
  if (!fs.existsSync(SESSIONS_FILE)) {
    const fallback = {
      activeSessionId: DEFAULT_SESSION_ID,
      sessions: { [DEFAULT_SESSION_ID]: createDefaultSession() }
    };
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }

  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const sessions = parsed.sessions || {};
    if (!sessions[DEFAULT_SESSION_ID]) {
      sessions[DEFAULT_SESSION_ID] = createDefaultSession();
    } else {
      sessions[DEFAULT_SESSION_ID] = normalizeSession(
        { ...sessions[DEFAULT_SESSION_ID], id: DEFAULT_SESSION_ID },
        'Default Session'
      );
    }
    return {
      activeSessionId: parsed.activeSessionId || DEFAULT_SESSION_ID,
      sessions
    };
  } catch (error) {
    console.error('Failed to parse sessions file; recreating.', error);
    const fallback = {
      activeSessionId: DEFAULT_SESSION_ID,
      sessions: { [DEFAULT_SESSION_ID]: createDefaultSession() }
    };
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

let sessionStore = loadSessionStore();

function loadApiKeyStore() {
  ensureStorageDir();
  if (!fs.existsSync(API_KEYS_FILE)) {
    const empty = { keys: {} };
    fs.writeFileSync(API_KEYS_FILE, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }
  try {
    return JSON.parse(fs.readFileSync(API_KEYS_FILE, 'utf8'));
  } catch (error) {
    console.error('Failed to parse API key store; regenerating.', error);
    const empty = { keys: {} };
    fs.writeFileSync(API_KEYS_FILE, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }
}

let apiKeyStore = loadApiKeyStore();

async function persistApiKeys() {
  ensureStorageDir();
  await fsp.writeFile(API_KEYS_FILE, JSON.stringify(apiKeyStore, null, 2), 'utf8');
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

async function createApiKey(name = '') {
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(24).toString('base64url');
  const label = name?.trim() || `Key ${Object.keys(apiKeyStore.keys).length + 1}`;
  apiKeyStore.keys[id] = {
    id,
    name: label,
    hash: hashSecret(secret),
    createdAt: new Date().toISOString(),
    lastUsedAt: null
  };
  await persistApiKeys();
  return { ...apiKeyStore.keys[id], secret };
}

async function deleteApiKey(id) {
  if (!apiKeyStore.keys[id]) {
    return;
  }
  delete apiKeyStore.keys[id];
  await persistApiKeys();
}

function maskApiKeys() {
  return Object.values(apiKeyStore.keys).map(({ hash, ...rest }) => rest);
}

function extractApiKey(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  if (req.headers['x-api-key']) {
    return req.headers['x-api-key'];
  }
  return null;
}

function verifyApiKey(secret) {
  if (!secret) return null;
  const hashed = hashSecret(secret);
  const match = Object.values(apiKeyStore.keys).find((entry) => entry.hash === hashed);
  return match || null;
}

async function recordApiKeyUsage(keyId) {
  if (!apiKeyStore.keys[keyId]) return;
  apiKeyStore.keys[keyId].lastUsedAt = new Date().toISOString();
  await persistApiKeys();
}

// Prevent runaway prompt sizes by trimming attachments count and length.
function sanitizeAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) {
    return [];
  }

  return rawAttachments
    .filter((att) => att && typeof att.content === 'string')
    .slice(0, MAX_ATTACHMENTS)
    .map((att) => ({
      id: att.id || crypto.randomUUID(),
      name: (att.name || 'Attachment').toString().slice(0, 120),
      type: att.type === 'file' ? 'file' : 'text',
      content: att.content.slice(0, ATTACHMENT_CHAR_LIMIT)
    }));
}

async function persistSessions() {
  ensureStorageDir();
  await fsp.writeFile(SESSIONS_FILE, JSON.stringify(sessionStore, null, 2), 'utf8');
}

function normalizeBaseUrlInput(url) {
  if (!url) {
    return undefined;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed, DEFAULT_BASE_URL);
    if (!/^https?:$/.test(parsed.protocol)) {
      return undefined;
    }
    return parsed.toString().endsWith('/') ? parsed.toString() : `${parsed.toString()}/`;
  } catch (error) {
    console.warn('Invalid backendBaseUrl provided, ignoring.', error.message);
    return undefined;
  }
}

function ensureSession(sessionId = DEFAULT_SESSION_ID) {
  const targetId = sessionId || DEFAULT_SESSION_ID;
  if (!sessionStore.sessions[targetId]) {
    const fallbackName =
      targetId === DEFAULT_SESSION_ID ? 'Default Session' : `Session ${Object.keys(sessionStore.sessions).length + 1}`;
    sessionStore.sessions[targetId] = normalizeSession({ id: targetId, name: fallbackName }, fallbackName);
  } else {
    sessionStore.sessions[targetId] = normalizeSession(
      { ...sessionStore.sessions[targetId], id: targetId },
      sessionStore.sessions[targetId].name
    );
  }
  return sessionStore.sessions[targetId];
}

function listSessions() {
  return Object.values(sessionStore.sessions).map((session) => ({
    id: session.id,
    name: session.name,
    instructions: session.instructions,
    attachments: session.attachments.map((att) => ({
      id: att.id,
      name: att.name,
      type: att.type
    })),
    historyLength: session.history.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  }));
}

function buildSessionPayload(body = {}) {
  const trimmedName = (body.name || '').trim();
  const normalizedName = trimmedName || `Session ${Object.keys(sessionStore.sessions).length}`;
  const slugBase = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const slug = slugBase || crypto.randomUUID();
  let id = body.id || slug;
  if (!body.id && sessionStore.sessions[id]) {
    id = `${slug}-${crypto.randomUUID().slice(0,8)}`;
  }

  return {
    id,
    name: normalizedName,
    instructions:
      typeof body.instructions === 'string' ? body.instructions : body.instructions ? String(body.instructions) : undefined,
    attachments: Array.isArray(body.attachments) ? sanitizeAttachments(body.attachments) : undefined,
    history: Array.isArray(body.history) ? body.history : undefined,
    createdAt: body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function createOrUpdateSession(payload) {
  const session = buildSessionPayload(payload);
  const existing = ensureSession(session.id);

  sessionStore.sessions[session.id] = {
    ...existing,
    id: session.id,
    name: session.name || existing?.name || 'Untitled Session',
    instructions:
      session.instructions !== undefined ? session.instructions : existing?.instructions || '',
    attachments:
      session.attachments !== undefined ? session.attachments : existing?.attachments || [],
    history: existing?.history || [],
    createdAt: existing?.createdAt || session.createdAt,
    updatedAt: new Date().toISOString()
  };

  await persistSessions();
  return sessionStore.sessions[session.id];
}

async function deleteSession(sessionId) {
  if (sessionId === DEFAULT_SESSION_ID) {
    throw new Error('Default session cannot be deleted');
  }
  if (!sessionStore.sessions[sessionId]) {
    return;
  }
  delete sessionStore.sessions[sessionId];
  if (sessionStore.activeSessionId === sessionId) {
    sessionStore.activeSessionId = DEFAULT_SESSION_ID;
  }
  await persistSessions();
}

async function pushHistory(sessionId, entry) {
  const session = ensureSession(sessionId);
  session.history.push(entry);
  session.updatedAt = entry.timestamp;
  await persistSessions();
}

const ensureFetch = () => {
  if (typeof fetch !== 'undefined') {
    return fetch;
  }

  return async (...args) => {
    const { default: nodeFetch } = await import('node-fetch');
    return nodeFetch(...args);
  };
};

const httpFetch = ensureFetch();

app.use(cors());
app.use(
  express.json({
    limit: '5mb'
  })
);
app.use(express.static(path.join(__dirnameResolved, 'public')));

function buildPrompt(message, systemInstructions, contextMessages = []) {
  const contextLines = contextMessages
    .map((entry) => {
      return `User: ${entry.user}\nAssistant: ${entry.assistant}`;
    })
    .join('\n');

  return `${systemInstructions}\n\n${contextLines ? `${contextLines}\n` : ''}User: ${message}\nAssistant:`;
}

function captureProcessOutput(child) {
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  return () => ({ stdout, stderr });
}

function runOllama({ prompt, model, apiEndpoint, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    const env = apiEndpoint
      ? { ...process.env, OLLAMA_HOST: apiEndpoint }
      : process.env;

    const child = spawn('ollama', ['run', model], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const getOutput = captureProcessOutput(child);
    let timeoutId;

    const handleError = (error) => {
      clearTimeout(timeoutId);
      child.kill('SIGTERM');
      reject(error);
    };

    timeoutId = setTimeout(() => {
      handleError(new Error('Ollama response timed out'));
    }, timeoutMs);

    child.on('error', (err) => {
      handleError(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      const { stdout, stderr } = getOutput();
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const message = stderr || `Ollama exited with code ${code}`;
        reject(new Error(message.trim()));
      }
    });

    child.stdin.write(`${prompt}\n`);
    child.stdin.end();
  });
}

app.post('/api/chat', async (req, res) => {
  const { message, model, instructions, apiEndpoint, includeHistory, sessionId } = req.body || {};

  const providedKey = extractApiKey(req);
  const keyRecord = providedKey ? verifyApiKey(providedKey) : null;
  if (providedKey && !keyRecord) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const selectedSessionId = sessionId || sessionStore.activeSessionId || DEFAULT_SESSION_ID;
  const session = ensureSession(selectedSessionId);
  sessionStore.activeSessionId = session.id;

  const modelToUse = model || runtimeSettings.model;
  const endpointToUse = apiEndpoint || runtimeSettings.apiEndpoint;
  const systemPrompt =
    instructions || session.instructions || runtimeSettings.systemInstructions;
  const ephemeralAttachments = Array.isArray(req.body?.attachments)
    ? sanitizeAttachments(req.body.attachments)
    : [];
  const attachmentContext = [...session.attachments, ...ephemeralAttachments]
    .map((att) => `Attachment (${att.name || att.id}):\n${att.content}`)
    .join('\n\n');
  const combinedInstructions = [systemPrompt, attachmentContext].filter(Boolean).join('\n\n');

  const contextLimit =
    includeHistory === false
      ? 0
      : Math.max(Number(runtimeSettings.maxHistory) || session.history.length || 0, 0);
  const contextSlice =
    includeHistory === false || !contextLimit
      ? []
      : session.history.slice(-1 * contextLimit);

  const prompt = buildPrompt(message, combinedInstructions, contextSlice);
  const startedAt = Date.now();

  try {
    const responseText = await runOllama({
      prompt,
      model: modelToUse,
      apiEndpoint: endpointToUse
    });

    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      user: message,
      assistant: responseText,
      model: modelToUse,
      endpoint: endpointToUse,
      sessionId: session.id
    };

    await pushHistory(session.id, entry);

    if (keyRecord) {
      await recordApiKeyUsage(keyRecord.id);
    }

    return res.json({
      thinking: false,
      response: responseText,
      history: ensureSession(session.id).history,
      durationMs: Date.now() - startedAt,
      sessionId: session.id
    });
  } catch (error) {
    return res.status(500).json({
      thinking: false,
      error: error.message || 'Failed to reach Ollama',
      history: ensureSession(session.id).history,
      sessionId: session.id
    });
  }
});

app.post('/api/chat/stream', async (req, res) => {
  const { message, model, instructions, apiEndpoint, includeHistory, sessionId } = req.body || {};

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const selectedSessionId = sessionId || sessionStore.activeSessionId || DEFAULT_SESSION_ID;
  const session = ensureSession(selectedSessionId);
  sessionStore.activeSessionId = session.id;

  const modelToUse = model || runtimeSettings.model;
  const endpointToUse = apiEndpoint || runtimeSettings.apiEndpoint;
  const systemPrompt = instructions || session.instructions || runtimeSettings.systemInstructions;
  const attachmentContext = session.attachments
    .map((att) => `Attachment (${att.name || att.id}):\n${att.content}`)
    .join('\n\n');
  const combinedInstructions = [systemPrompt, attachmentContext].filter(Boolean).join('\n\n');
  const contextLimit =
    includeHistory === false
      ? 0
      : Math.max(Number(runtimeSettings.maxHistory) || session.history.length || 0, 0);
  const contextSlice =
    includeHistory === false || !contextLimit
      ? []
      : session.history.slice(-1 * contextLimit);

  const prompt = buildPrompt(message, combinedInstructions, contextSlice);
  const startedAt = Date.now();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders?.();

  try {
    const endpoint = withTrailingSlash(endpointToUse);
    const upstream = await httpFetch(`${endpoint}api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelToUse,
        prompt,
        stream: true
      })
    });

    if (!upstream.ok || !upstream.body) {
      throw new Error('Failed to stream from Ollama');
    }

    let buffer = '';
    let aggregate = '';
    let doneStreaming = false;

    const handleLine = (line) => {
      if (!line) {
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        return;
      }
      if (parsed.response) {
        aggregate += parsed.response;
        res.write(`data: ${JSON.stringify({ token: parsed.response })}\n\n`);
        res.flush?.();
      }
      if (parsed.error) {
        throw new Error(parsed.error);
      }
      if (parsed.done) {
        doneStreaming = true;
      }
    };

    for await (const chunk of upstream.body) {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      buffer += text;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        handleLine(line);
      }
      if (doneStreaming) {
        break;
      }
    }

    if (!doneStreaming && buffer.trim()) {
      handleLine(buffer.trim());
    }

    if (!doneStreaming) {
      throw new Error('Stream ended unexpectedly');
    }

    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      user: message,
      assistant: aggregate,
      model: modelToUse,
      endpoint: endpointToUse,
      sessionId: session.id
    };

    await pushHistory(session.id, entry);

    res.write(
      `data: ${JSON.stringify({
        done: true,
        response: aggregate,
        history: ensureSession(session.id).history,
        durationMs: Date.now() - startedAt
      })}\n\n`
    );
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500);
    }
    res.write(`data: ${JSON.stringify({ error: error.message || 'Failed to stream response' })}\n\n`);
    res.end();
  }
});

app.get('/api/history', (req, res) => {
  const sessionId = req.query.sessionId || sessionStore.activeSessionId || DEFAULT_SESSION_ID;
  const session = ensureSession(sessionId);
  return res.json({ sessionId: session.id, history: session.history });
});

app.delete('/api/history', async (req, res) => {
  const sessionId = req.query.sessionId || sessionStore.activeSessionId || DEFAULT_SESSION_ID;
  const session = ensureSession(sessionId);
  session.history = [];
  session.updatedAt = new Date().toISOString();
  await persistSessions();
  return res.json({ sessionId: session.id, history: session.history });
});

app.get('/api/sessions', (req, res) => {
  return res.json({
    sessions: listSessions(),
    activeSessionId: sessionStore.activeSessionId || DEFAULT_SESSION_ID
  });
});

app.get('/api/sessions/:id', (req, res) => {
  const sessionId = req.params.id;
  const session = ensureSession(sessionId);
  return res.json({ session });
});

app.post('/api/sessions', async (req, res) => {
  try {
    const session = await createOrUpdateSession(req.body || {});
    return res.status(201).json({ session });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to create session' });
  }
});

app.put('/api/sessions/:id', async (req, res) => {
  try {
    const session = await createOrUpdateSession({ ...req.body, id: req.params.id });
    return res.json({ session });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to update session' });
  }
});

app.post('/api/sessions/:id/select', async (req, res) => {
  try {
    const session = ensureSession(req.params.id);
    sessionStore.activeSessionId = session.id;
    await persistSessions();
    return res.json({ activeSessionId: session.id });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to set active session' });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await deleteSession(req.params.id);
    return res.status(204).end();
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to delete session' });
  }
});

app.get('/api/settings', (req, res) => {
  return res.json({
    defaults: DEFAULT_SETTINGS,
    current: runtimeSettings
  });
});

app.post('/api/settings', (req, res) => {
  const { model, apiEndpoint, theme, systemInstructions, maxHistory, backendBaseUrl } =
    req.body || {};

  const sanitizedBaseUrl = normalizeBaseUrlInput(backendBaseUrl);

  const updates = {
    ...(model ? { model } : {}),
    ...(apiEndpoint ? { apiEndpoint } : {}),
    ...(theme ? { theme } : {}),
    ...(systemInstructions ? { systemInstructions } : {})
  };

  if (sanitizedBaseUrl) {
    updates.backendBaseUrl = sanitizedBaseUrl;
  }

  runtimeSettings = {
    ...runtimeSettings,
    ...updates
  };

  if (!runtimeSettings.backendBaseUrl) {
    runtimeSettings.backendBaseUrl = DEFAULT_BASE_URL;
  }

  if (typeof maxHistory !== 'undefined' && maxHistory !== null) {
    const parsed = Number(maxHistory);
    if (!Number.isNaN(parsed) && parsed > 0) {
      runtimeSettings.maxHistory = parsed;
    }
  }

  return res.json({ current: runtimeSettings });
});

app.post('/api/proxy', async (req, res) => {
  const { url, method = 'POST', payload, headers } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    const response = await httpFetch(url, {
      method,
      headers: headers || { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined
    });

    const data = await response.text();
    res
      .status(response.status)
      .set('Content-Type', response.headers.get('content-type') || 'text/plain');
    return res.send(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Proxy request failed' });
  }
});

app.get('/api/models', async (req, res) => {
  try {
    const endpoint = withTrailingSlash(runtimeSettings.apiEndpoint);
    const response = await httpFetch(`${endpoint}api/tags`);
    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to fetch models from Ollama' });
    }
    const data = await response.json();
    const models = (data.models || []).map((model) => ({
      name: model.name,
      size: model.size,
      digest: model.digest,
      modifiedAt: model.modified_at
    }));
    return res.json({ models });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to fetch models' });
  }
});

app.get('/health', (req, res) => {
  const summaries = listSessions();
  return res.json({
    status: 'ok',
    sessions: {
      count: summaries.length,
      active: sessionStore.activeSessionId || DEFAULT_SESSION_ID,
      histories: summaries.map((session) => ({
        id: session.id,
        name: session.name,
        historyLength: session.historyLength
      }))
    },
    settings: runtimeSettings,
    apiKeys: {
      total: Object.keys(apiKeyStore.keys).length
    }
  });
});

app.get('/api/keys', (req, res) => {
  return res.json({
    baseUrl: runtimeSettings.backendBaseUrl || DEFAULT_BASE_URL,
    keys: maskApiKeys()
  });
});

app.post('/api/keys', async (req, res) => {
  try {
    const { name } = req.body || {};
    const keyInfo = await createApiKey(name);
    return res.status(201).json({
      key: {
        id: keyInfo.id,
        name: keyInfo.name,
        createdAt: keyInfo.createdAt,
        lastUsedAt: keyInfo.lastUsedAt
      },
      secret: keyInfo.secret,
      baseUrl: runtimeSettings.backendBaseUrl || DEFAULT_BASE_URL
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to create API key' });
  }
});

app.delete('/api/keys/:id', async (req, res) => {
  try {
    await deleteApiKey(req.params.id);
    return res.status(204).end();
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to delete API key' });
  }
});

// Cloud sync endpoints for user data synchronization
app.get('/api/sync/data', async (req, res) => {
  // For local-only sync, return the local data
  // In a real cloud implementation, this would fetch from a cloud service
  const providedKey = extractApiKey(req);
  const keyRecord = providedKey ? verifyApiKey(providedKey) : null;
  if (providedKey && !keyRecord) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  try {
    // Return the session store data that should be synced
    const syncData = {
      sessions: sessionStore.sessions,
      activeSessionId: sessionStore.activeSessionId,
      settings: runtimeSettings,
      apiKeyStore: apiKeyStore,
      timestamp: new Date().toISOString()
    };

    return res.json(syncData);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to fetch sync data' });
  }
});

app.post('/api/sync/data', async (req, res) => {
  // For local-only sync, store the data locally
  // In a real cloud implementation, this would sync to a cloud service
  const providedKey = extractApiKey(req);
  const keyRecord = providedKey ? verifyApiKey(providedKey) : null;
  if (providedKey && !keyRecord) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const { sessions, activeSessionId, settings, apiKeyStore } = req.body || {};

  try {
    // Update the in-memory stores with the synced data
    if (sessions) {
      sessionStore.sessions = sessions;
    }
    if (activeSessionId) {
      sessionStore.activeSessionId = activeSessionId;
    }
    if (settings) {
      runtimeSettings = { ...runtimeSettings, ...settings };
    }
    if (req.body.apiKeyStore) {
      // Update the actual global apiKeyStore with synced data
      apiKeyStore.keys = { ...apiKeyStore.keys, ...(req.body.apiKeyStore.keys || {}) };
    }

    // Persist the changes to disk
    await persistSessions();

    // For API key changes, persist separately
    if (req.body.apiKeyStore) {
      ensureStorageDir();
      await fsp.writeFile(API_KEYS_FILE, JSON.stringify(apiKeyStore, null, 2), 'utf8');
    }

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      message: 'Sync completed successfully'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to sync data' });
  }
});

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirnameResolved, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


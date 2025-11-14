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
const { Readable } = require('stream');
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
const DEFAULT_FETCH_TIMEOUT_MS = Number(process.env.HTTP_FETCH_TIMEOUT_MS || 60000);
const OLLAMA_CONNECTIVITY_TIMEOUT_MS = Number(process.env.OLLAMA_CONNECTIVITY_TIMEOUT_MS || 10000);
const OLLAMA_GENERATION_TIMEOUT_MS = Number(process.env.OLLAMA_GENERATION_TIMEOUT_MS || 600000);
const OLLAMA_STREAM_TIMEOUT_MS =
  process.env.OLLAMA_STREAM_TIMEOUT_MS !== undefined
    ? Math.max(Number(process.env.OLLAMA_STREAM_TIMEOUT_MS) || 0, 0)
    : 0;
const OLLAMA_UNAVAILABLE_MESSAGE = 'Cannot connect to Ollama service. Is the Ollama service running?';
const MAX_GENERATE_IMAGES = Number(process.env.MAX_GENERATE_IMAGES || 4);
const STREAM_HEARTBEAT_INTERVAL_MS = Number(process.env.STREAM_HEARTBEAT_INTERVAL_MS || 15000);

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
const DEFAULT_SYSTEM_INSTRUCTIONS = `<role>
You are an honest, detail-oriented AI assistant that helps the user accomplish local tasks with precision and clarity.
</role>

<interaction_rules>
  <rule>Always provide complete, actionable responses without asking for confirmation unless critical information is missing.</rule>
  <rule>When given a task, execute it fully and report results rather than suggesting next steps.</rule>
  <rule>Use structured thinking: analyze the request, plan your approach, execute, and verify.</rule>
  <rule>If you encounter errors or blockers, attempt reasonable solutions before escalating to the user.</rule>
</interaction_rules>

<workflow>
  <step name="understand">Parse the user's request carefully, identifying explicit and implicit requirements.</step>
  <step name="plan">Outline the approach mentally before responding, considering edge cases.</step>
  <step name="execute">Provide complete solutions, examples, or explanations as needed.</step>
  <step name="verify">Double-check your response for accuracy and completeness.</step>
</workflow>

<output_style>
  <guideline>Be concise but thorough; avoid unnecessary verbosity.</guideline>
  <guideline>Use code blocks, lists, or structured formats when they improve clarity.</guideline>
  <guideline>Prefer showing over telling: provide working examples rather than abstract descriptions.</guideline>
</output_style>

<finish_criteria>
Complete tasks fully before responding. Do not end responses with "Would you like me to..." or "Let me know if..." unless genuinely awaiting critical user input.
</finish_criteria>`;

const DEFAULT_SETTINGS = {
  model: DEFAULT_MODEL,
  apiEndpoint: DEFAULT_ENDPOINT,
  theme: 'system',
  systemInstructions: DEFAULT_SYSTEM_INSTRUCTIONS,
  maxHistory: DEFAULT_CONTEXT_LIMIT,
  backendBaseUrl: DEFAULT_BASE_URL
};

const AI_CODER_PROMPT_PRESET = `<prompt>
  <metadata>
    <version>2.0</version>
    <updated>2025-01-14</updated>
    <purpose>Generate complete, autonomous coding agent prompts with strict workflow enforcement</purpose>
  </metadata>

  <role>You are a prompt concierge for autonomous AI coders who work inside existing repositories.</role>

  <interaction_rules>
    <rule>Determine whether the user needs an actual response or a prompt for their coding agent. If the user appears to ask for a prompt, output only the prompt, nothing else.</rule>
    <rule>You never write code or run commands yourself; you only produce perfect prompts or concise guidance.</rule>
    <rule>Assume zero prior knowledge of the project. Always instruct the coding agent to begin with discovery, then implementation, continuing until every requested change is fully delivered.</rule>
    <rule>Assume the work happens inside the current working directory and against an existing codebase, not a greenfield project.</rule>
    <rule>Every transformed prompt must include a professional TODO list that begins with "Search existing files" and drives the agent through discovery → implementation → verification without pausing for user feedback.</rule>
    <rule>Keep prompts compact but fully operational: no placeholders, no mock data, no shortcuts, no denials—only concrete, actionable instructions that ensure full completion.</rule>
    <rule>Explicitly command the AI coder to finish the entire task autonomously; never ask the user for clarification once the prompt is generated.</rule>
    <rule>CRITICAL: Every prompt MUST include explicit finish criteria: "Complete all tasks. Do not ask the user for next steps. Finish without requesting confirmation."</rule>
  </interaction_rules>
  <model_preferences>
    <option name="Claude Sonnet 4.5">Use for most sessions; strongest long-horizon reasoning and coding.</option>
    <option name="Claude Opus 4.1">Use when specialized reasoning depth is required.</option>
    <option name="Claude Sonnet 4 (1M ctx beta)">Prefer when extremely long context is needed.</option>
    <command>Model changes happen via: forge model set &lt;model&gt;</command>
  </model_preferences>
  <formatting>
    <instruction>All prompts must use XML tags to separate role, objective, instructions, context, tests, and output expectations.</instruction>
    <instruction>Use nested tags to express hierarchy, keep tags consistent, and wrap any code, configs, or data inside dedicated tags (e.g., &lt;codebase&gt;).</instruction>
    <instruction>Request chain-of-thought using tags like &lt;thinking&gt; and &lt;response&gt; so reasoning stays separated from final output.</instruction>
  </formatting>
  <workflow>
    <phase name="discovery">Map files, configs, dependencies; summarize findings before edits.</phase>
    <phase name="todo_creation">Create at least 20 ordered TODOs labeled core/support/verify; persist them.</phase>
    <phase name="execution">Work TODOs sequentially, verifying each before continuing. If a step fails, debug, retry, and log.</phase>
    <phase name="verification">Perform logical + empirical verification twice (tests, CLIs, or inspections). Fix code, not tests, when failures appear.</phase>
    <phase name="documentation">Update README/logs only when requested. Summaries must be truthful and list errors if any remain.</phase>
  </workflow>
  <tests>
    <rule>Lead with test requirements whenever possible; treat tests as the contract.</rule>
    <rule>Instruct agents to avoid hard-coded outputs meant only to satisfy tests; implement real logic.</rule>
  </tests>
  <agentic_guidance>
    <rule>Explicitly direct the coding agent to take action (edit files, run commands, commit) rather than suggesting ideas.</rule>
    <rule>Never allow speculation. Require the agent to read relevant files before answering questions about them.</rule>
    <rule>Emphasize incremental progress, state tracking, and truthful logging of every command or tool call.</rule>
  </agentic_guidance>
  <prompt_structure>
    <section order="1">&lt;role&gt;Define persona, e.g., "You are a senior full-stack engineer...".&lt;/role&gt;</section>
    <section order="2">&lt;objective&gt;State the main goal with a strong action verb.&lt;/objective&gt;</section>
    <section order="3">&lt;instructions&gt;Detail requirements, constraints, and style guides.&lt;/instructions&gt;</section>
    <section order="4">&lt;context&gt;Provide repo paths, existing code snippets, configs, or logs.&lt;/context&gt;</section>
    <section order="5">&lt;examples&gt;Optional few-shot patterns.&lt;/examples&gt;</section>
    <section order="6">&lt;output_format&gt;Define the desired response schema, reiterating critical rules.&lt;/output_format&gt;</section>
  </prompt_structure>
  <thinking>
    <instruction>Encourage step-by-step reasoning inside &lt;thinking&gt; tags before producing the final &lt;response&gt;.</instruction>
    <instruction>After tool output, include a reflection step deciding the best next action.</instruction>
  </thinking>
  <directory_policy>
    <rule>Assume the agent works inside the repository root and must keep changes scoped to existing files unless told otherwise.</rule>
    <rule>Stress that the agent must keep running until every task is fully implemented and verified.</rule>
  </directory_policy>
  <knowledge_sources>
    <readme>
      Content is reproduced exactly as provided:

      This file contains a full guide on effective prompt engineering, covering:

      Prompt hierarchy

      Role definition

      Objective → Instructions → Requirements → Context → Examples → Output specification

      Chain-of-thought prompting

      Task decomposition

      Test-driven prompting

      Codebase context handling

      Implementation strategies

      Multi-step workflows

      Documentation practices

      Model configuration

      Use of variables

      (Everything above is directly from your uploaded Read.md.)
    </readme>
    <rea2d>
      Content is reproduced exactly as provided:

      This file contains:

      Detailed explanation of XML-tag–structured prompting

      Why XML reduces instruction bleed

      How to segment instructions, data, examples, and reasoning

      How to force structured outputs

      How to wrap chain-of-thought in &lt;thinking&gt; and final answer in &lt;answer&gt;

      Tagging best practices

      When to use XML vs JSON

      (Everything above is directly from your uploaded rea2d.md.)
    </rea2d>
  </knowledge_sources>
</prompt>`;

const INSTRUCTION_PRESETS = [
  {
    id: 'default-assistant',
    label: 'Honest local assistant',
    description: 'General-purpose helper for local tasks with balanced behavior.',
    instructions: DEFAULT_SYSTEM_INSTRUCTIONS,
    version: '2.0',
    category: 'general',
    workflow: {
      requiresDiscovery: false,
      autoComplete: true,
      strictXML: true
    },
    updatedAt: '2025-01-14T00:00:00Z'
  },
  {
    id: 'ai-coder-prompt',
    label: 'AI coder prompt concierge',
    description: 'Produces XML prompts for autonomous Claude-based coding agents with discovery-first workflow.',
    instructions: AI_CODER_PROMPT_PRESET,
    version: '2.0',
    category: 'coding',
    workflow: {
      requiresDiscovery: true,
      autoComplete: true,
      strictXML: true,
      phases: ['discovery', 'planning', 'implementation', 'verification']
    },
    updatedAt: '2025-01-14T00:00:00Z'
  }
];

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
    presetId: 'default-assistant',
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
    presetId: session.presetId || null,
    attachments: Array.isArray(session.attachments) ? session.attachments : [],
    history: Array.isArray(session.history) ? session.history : [],
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString()
  };
}

function normalizeSessionCollection(input) {
  const collection = {};
  if (Array.isArray(input)) {
    input.forEach((session) => {
      if (!session) return;
      const normalized = normalizeSession(session, session.name || 'Session');
      collection[normalized.id] = normalized;
    });
    return collection;
  }
  if (input && typeof input === 'object') {
    Object.values(input).forEach((session) => {
      if (!session) return;
      const normalized = normalizeSession(session, session.name || 'Session');
      collection[normalized.id] = normalized;
    });
    return collection;
  }
  return { [DEFAULT_SESSION_ID]: createDefaultSession() };
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
    const sessions = normalizeSessionCollection(parsed.sessions || {});
    if (!sessions[DEFAULT_SESSION_ID]) {
      sessions[DEFAULT_SESSION_ID] = createDefaultSession();
    }
    return {
      activeSessionId: sessions[parsed.activeSessionId] ? parsed.activeSessionId : DEFAULT_SESSION_ID,
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
  sessionStore.sessions = normalizeSessionCollection(sessionStore.sessions);
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
  return Object.values(sessionStore.sessions).map((session) => {
    const attachments = Array.isArray(session.attachments) ? session.attachments : [];
    const history = Array.isArray(session.history) ? session.history : [];
    return {
    id: session.id,
    name: session.name,
    instructions: session.instructions,
    presetId: session.presetId || null,
    attachments: attachments.map((att) => ({
      id: att.id,
      name: att.name,
      type: att.type
    })),
    historyLength: history.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
    };
  });
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
    presetId: typeof body.presetId === 'string' ? body.presetId : undefined,
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
    presetId:
      session.presetId !== undefined ? session.presetId : existing?.presetId || null,
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

function bindAbortOnClientDisconnect(req, controller) {
  if (!req || !controller) {
    return () => {};
  }

  const cancel = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  req.on('aborted', cancel);

  return () => {
    if (typeof req.off === 'function') {
      req.off('aborted', cancel);
    } else {
      req.removeListener('aborted', cancel);
    }
  };
}

function applyStreamingGuards(req, res, label = 'stream') {
  if (req?.setTimeout) {
    req.setTimeout(0);
  }
  if (res?.setTimeout) {
    res.setTimeout(0);
  }
  if (res?.socket?.setTimeout) {
    res.socket.setTimeout(0);
  }
  if (res?.socket?.setKeepAlive) {
    res.socket.setKeepAlive(true);
  }

  if (!req) {
    return () => {};
  }

  const onAbort = () => {
    console.warn(`[${label}] client aborted connection`);
  };

  req.on('aborted', onAbort);

  return () => {
    if (typeof req.off === 'function') {
      req.off('aborted', onAbort);
    } else {
      req.removeListener('aborted', onAbort);
    }
  };
}

function startSseHeartbeat(res, label = 'stream', metadata = {}) {
  if (!STREAM_HEARTBEAT_INTERVAL_MS || STREAM_HEARTBEAT_INTERVAL_MS <= 0) {
    return () => {};
  }

  const presetInfo = metadata.presetId ? ` preset=${metadata.presetId}` : '';
  const sessionInfo = metadata.sessionId ? ` session=${metadata.sessionId}` : '';

  const timer = setInterval(() => {
    try {
      res.write(`:heartbeat ${Date.now()}\n\n`);
      res.flush?.();
    } catch (error) {
      console.warn(`[${label}${sessionInfo}${presetInfo}] heartbeat failed: ${error.message}`);
    }
  }, STREAM_HEARTBEAT_INTERVAL_MS);

  timer.unref?.();

  return () => {
    clearInterval(timer);
  };
}

function toNodeReadable(body) {
  if (!body) {
    return null;
  }
  if (typeof body.getReader === 'function' && typeof Readable.fromWeb === 'function') {
    return Readable.fromWeb(body);
  }
  return body;
}

async function ensureOllamaReachable(endpoint) {
  try {
    const response = await httpFetch(`${endpoint}api/tags`, {
      method: 'GET',
      timeout: OLLAMA_CONNECTIVITY_TIMEOUT_MS
    });

    if (!response.ok) {
      throw new Error(OLLAMA_UNAVAILABLE_MESSAGE);
    }
  } catch (error) {
    console.error('Ollama connectivity check failed:', error.message);
    throw new Error(OLLAMA_UNAVAILABLE_MESSAGE);
  }
}

function normalizeGenerateInputs(body = {}) {
  const normalizedModel =
    typeof body.model === 'string' && body.model.trim().length ? body.model.trim() : body.model;
  const safePrompt = typeof body.prompt === 'string' ? body.prompt : '';
  const normalized = {
    model: normalizedModel,
    prompt: safePrompt.trim(),
    stream: Boolean(body.stream),
    system: typeof body.system === 'string' && body.system.trim().length ? body.system : undefined,
    template: typeof body.template === 'string' && body.template.trim().length ? body.template : undefined,
    options:
      body.options && typeof body.options === 'object' && !Array.isArray(body.options) ? body.options : undefined,
    images: Array.isArray(body.images) && body.images.length ? body.images.slice(0, MAX_GENERATE_IMAGES) : undefined
  };

  return normalized;
}

function summarizeGenerateRequest(payload) {
  return {
    model: payload.model,
    stream: Boolean(payload.stream),
    promptChars: payload.prompt?.length || 0,
    hasSystem: Boolean(payload.system),
    hasTemplate: Boolean(payload.template),
    imageCount: payload.images?.length || 0,
    hasOptions: Boolean(payload.options)
  };
}

const ensureFetch = () => {
  if (typeof fetch !== 'undefined') {
    return async (url, options = {}) => {
      const { timeout = DEFAULT_FETCH_TIMEOUT_MS, signal } = options;
      delete options.timeout;
      delete options.signal;

      const controller = new AbortController();
      let timeoutId = null;
      let abortListener;
      const shouldTimeout = Number.isFinite(timeout) && timeout > 0;
      if (shouldTimeout) {
        timeoutId = setTimeout(() => controller.abort(new Error('Request timeout')), timeout);
      }

      if (signal) {
        if (signal.aborted) {
          controller.abort(signal.reason);
        } else {
          abortListener = () => controller.abort(signal.reason);
          signal.addEventListener('abort', abortListener, { once: true });
        }
      }

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });
        if (timeoutId) clearTimeout(timeoutId);
        if (abortListener && signal) {
          signal.removeEventListener('abort', abortListener);
        }
        return response;
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        if (abortListener && signal) {
          signal.removeEventListener('abort', abortListener);
        }
        if (error.name === 'AbortError' && !controller.signal.aborted) {
          throw new Error('Request timeout');
        }
        throw error;
      }
    };
  }

  return async (url, options = {}) => {
    const { default: nodeFetch } = await import('node-fetch');
    const { timeout = DEFAULT_FETCH_TIMEOUT_MS, signal } = options;
    delete options.timeout;
    delete options.signal;

    const controller = new AbortController();
    let timeoutId = null;
    let abortListener;
    const shouldTimeout = Number.isFinite(timeout) && timeout > 0;
    if (shouldTimeout) {
      timeoutId = setTimeout(() => controller.abort(new Error('Request timeout')), timeout);
    }

    if (signal) {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        abortListener = () => controller.abort(signal.reason);
        signal.addEventListener('abort', abortListener, { once: true });
      }
    }

    try {
      const response = await nodeFetch(url, {
        ...options,
        signal: controller.signal
      });
      if (timeoutId) clearTimeout(timeoutId);
      if (abortListener && signal) {
        signal.removeEventListener('abort', abortListener);
      }
      return response;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      if (abortListener && signal) {
        signal.removeEventListener('abort', abortListener);
      }
      if (error.name === 'AbortError' && !controller.signal.aborted) {
        throw new Error('Request timeout');
      }
      throw error;
    }
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

    // Check if ollama command is available
    const whichResult = spawnSync('which', ['ollama']);
    if (whichResult.status !== 0) {
      reject(new Error('Ollama command not found. Please ensure Ollama is installed and in your PATH.'));
      return;
    }

    const child = spawn('ollama', ['run', model], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const getOutput = captureProcessOutput(child);
    let timeoutId;

    const handleError = (error) => {
      clearTimeout(timeoutId);
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
      reject(error);
    };

    timeoutId = setTimeout(() => {
      handleError(new Error('Ollama response timed out'));
    }, timeoutMs);

    child.on('error', (err) => {
      console.error('Ollama process error:', err.message);
      handleError(new Error(`Failed to communicate with Ollama: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      const { stdout, stderr } = getOutput();
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        // Handle specific error codes
        if (code === 127) { // Command not found
          reject(new Error('Ollama command not found. Please ensure Ollama is installed and in your PATH.'));
        } else {
          const message = stderr || `Ollama exited with code ${code}`;
          if (message.includes('connection refused') || message.includes('ECONNREFUSED')) {
            reject(new Error(OLLAMA_UNAVAILABLE_MESSAGE));
          } else if (message.includes('not found') || message.includes('No Modelfile')) {
            reject(new Error(`Model '${model}' not found. Please pull the model with 'ollama pull ${model}'`));
          } else {
            reject(new Error(message.trim()));
          }
        }
      }
    });

    // Check if child process is running before sending input
    setTimeout(() => {
      if (child.killed) {
        reject(new Error('Ollama process was terminated before input could be sent'));
        return;
      }
      child.stdin.write(`${prompt}\n`);
      child.stdin.end();
    }, 10);
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
    const endpoint = withTrailingSlash(endpointToUse);

    await ensureOllamaReachable(endpoint);

    const upstream = await httpFetch(`${endpoint}api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: OLLAMA_GENERATION_TIMEOUT_MS,
      body: JSON.stringify({
        model: modelToUse,
        prompt,
        stream: false  // Non-streaming request
      })
    });

    if (!upstream.ok) {
      const statusMessage = upstream.status === 404
        ? `Model '${modelToUse}' not found. Please pull the model with 'ollama pull ${modelToUse}'`
        : `Failed to get response from Ollama (status: ${upstream.status})`;
      throw new Error(statusMessage);
    }

    const result = await upstream.json();

    // Handle the response from the API
    if (!result.response) {
      if (result.error) {
        throw new Error(result.error);
      } else {
        throw new Error('No response received from Ollama');
      }
    }

    const responseText = result.response;

    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      user: message,
      assistant: responseText,
      model: modelToUse,
      endpoint: endpointToUse,
      sessionId: session.id,
      presetId: session.presetId || null,
      instructions: systemPrompt ? systemPrompt.slice(0, 200) : null
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
    console.error('Chat API error:', error.message);
    const errorMessage = error.message.includes('ECONNREFUSED') || error.message.includes('connect ETIMEDOUT')
      ? OLLAMA_UNAVAILABLE_MESSAGE
      : error.message || 'Failed to reach Ollama';
    return res.status(500).json({
      thinking: false,
      error: errorMessage,
      history: ensureSession(session.id).history,
      sessionId: session.id
    });
  }
});

// Direct endpoint for Ollama API generate calls
app.post('/api/generate', async (req, res) => {
  const normalizedPayload = normalizeGenerateInputs(req.body || {});

  if (!normalizedPayload.model) {
    console.warn('[generate] Rejected request: missing model');
    return res.status(400).json({ error: 'Model is required' });
  }

  if (!normalizedPayload.prompt && !(normalizedPayload.images && normalizedPayload.images.length)) {
    console.warn('[generate] Rejected request: missing prompt or images');
    return res.status(400).json({ error: 'Either prompt or images are required' });
  }

  const endpoint = withTrailingSlash(runtimeSettings.apiEndpoint);

  try {
    await ensureOllamaReachable(endpoint);
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }

  console.info('[generate] Forwarding request', summarizeGenerateRequest(normalizedPayload));

  const upstreamController = new AbortController();
  const releaseClientAbort = bindAbortOnClientDisconnect(req, upstreamController);
  let stopHeartbeat = () => {};
  let releaseStreamingGuards = () => {};

  try {
    const upstream = await httpFetch(`${endpoint}api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: normalizedPayload.stream ? OLLAMA_STREAM_TIMEOUT_MS : OLLAMA_GENERATION_TIMEOUT_MS,
      signal: upstreamController.signal,
      body: JSON.stringify(normalizedPayload)
    });

    if (!upstream.ok) {
      const errorBody = await upstream.text();
      const statusMessage = upstream.status === 404
        ? `Model '${normalizedPayload.model}' not found. Please pull the model with 'ollama pull ${normalizedPayload.model}'`
        : errorBody || `Failed to get response from Ollama (status: ${upstream.status})`;
      throw new Error(statusMessage);
    }

    if (normalizedPayload.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders?.();
      releaseStreamingGuards = applyStreamingGuards(req, res, 'api-generate');
      stopHeartbeat = startSseHeartbeat(res, 'api-generate', {
        model: normalizedPayload.model
      });

      const upstreamStream = toNodeReadable(upstream.body);
      if (!upstreamStream) {
        throw new Error('Ollama did not return a stream body');
      }

      const emit = (payload) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        res.flush?.();
      };

      let buffer = '';

      try {
        for await (const chunk of upstreamStream) {
          const textChunk = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
          buffer += textChunk;

          let boundary;
          while ((boundary = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 1);

            if (!line) continue;

            let parsed;
            try {
              parsed = JSON.parse(line);
            } catch (parseError) {
              continue;
            }

            if (parsed.error) {
              console.error('Ollama streaming error:', parsed.error);
              emit({ error: parsed.error });
              continue;
            }

            emit(parsed);

            if (parsed.done) {
              buffer = '';
              break;
            }
          }
        }

        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer.trim());
            emit(parsed);
          } catch {
            // ignore trailing partial chunk
          }
        }
      } catch (streamError) {
        console.error('Streaming error:', streamError);
        emit({ error: streamError.message });
      } finally {
        res.end();
      }
      return;
    }

    const raw = await upstream.text();
    let result = {};
    if (raw) {
      try {
        result = JSON.parse(raw);
      } catch (parseError) {
        console.error('Failed to parse Ollama response:', parseError);
        throw new Error('Ollama returned invalid JSON');
      }
    }

    return res.json(result);
  } catch (error) {
    console.error('Generate API error:', error.message);
    const errorMessage = error.message.includes('ECONNREFUSED') || error.message.includes('connect ETIMEDOUT')
      ? OLLAMA_UNAVAILABLE_MESSAGE
      : error.message || 'Failed to reach Ollama';
    return res.status(500).json({
      error: errorMessage
    });
  } finally {
    stopHeartbeat?.();
    releaseStreamingGuards?.();
    releaseClientAbort?.();
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
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  const upstreamController = new AbortController();
  const releaseClientAbort = bindAbortOnClientDisconnect(req, upstreamController);
  let stopHeartbeat = () => {};
  let releaseStreamingGuards = () => {};

  try {
    releaseStreamingGuards = applyStreamingGuards(req, res, 'chat-stream');
    stopHeartbeat = startSseHeartbeat(res, 'chat-stream', {
      sessionId: session.id,
      presetId: session.presetId,
      model: modelToUse
    });
    const endpoint = withTrailingSlash(endpointToUse);
    await ensureOllamaReachable(endpoint);

    const upstream = await httpFetch(`${endpoint}api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: OLLAMA_STREAM_TIMEOUT_MS,
      signal: upstreamController.signal,
      body: JSON.stringify({
        model: modelToUse,
        prompt,
        stream: true
      })
    });

    if (!upstream.ok) {
      const errorMessage = upstream.status === 404
        ? `Model '${modelToUse}' not found. Please pull the model with 'ollama pull ${modelToUse}'`
        : `Failed to stream from Ollama (status: ${upstream.status})`;
      throw new Error(errorMessage);
    }

    const upstreamStream = toNodeReadable(upstream.body);
    if (!upstreamStream) {
      throw new Error('Ollama did not return a stream body');
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
        console.error('Ollama streaming error:', parsed.error);
        throw new Error(parsed.error);
      }
      if (parsed.done) {
        doneStreaming = true;
      }
    };

    for await (const chunk of upstreamStream) {
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
      sessionId: session.id,
      presetId: session.presetId || null,
      instructions: combinedInstructions ? combinedInstructions.slice(0, 200) : null
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
    console.error('Streaming error:', error.message);
    if (!res.headersSent) {
      res.status(500);
    }
    const errorMessage = error.message.includes('ECONNREFUSED') || error.message.includes('connect ETIMEDOUT')
      ? OLLAMA_UNAVAILABLE_MESSAGE
      : error.message || 'Failed to stream response';
    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    res.end();
  } finally {
    stopHeartbeat?.();
    releaseStreamingGuards?.();
    releaseClientAbort?.();
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

app.post('/api/history/entry', async (req, res) => {
  const { sessionId = sessionStore.activeSessionId || DEFAULT_SESSION_ID, user, assistant, model, endpoint } =
    req.body || {};
  if (!sessionId || !user || !assistant) {
    return res.status(400).json({ error: 'sessionId, user, and assistant fields are required' });
  }

  try {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      user,
      assistant,
      model: model || 'prompt-concierge',
      endpoint: endpoint || 'prompt-concierge',
      sessionId
    };
    await pushHistory(sessionId, entry);
    return res.json({ sessionId, history: ensureSession(sessionId).history });
  } catch (error) {
    console.error('Failed to persist custom history entry', error);
    return res.status(500).json({ error: error.message || 'Unable to persist history entry' });
  }
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
    current: runtimeSettings,
    presets: INSTRUCTION_PRESETS
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
      timeout: 30000, // 30 second timeout for proxy requests
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
    await ensureOllamaReachable(endpoint);

    const response = await httpFetch(`${endpoint}api/tags`, {
      timeout: 30000 // 30 second timeout for tags request
    });
    if (!response.ok) {
      const statusMessage = response.status === 404
        ? 'Ollama API endpoint not found. Is the Ollama service running?'
        : `Failed to fetch models from Ollama (status: ${response.status})`;
      return res.status(500).json({ error: statusMessage });
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
    console.error('Error fetching models:', error.message);
    const errorMessage = error.message.includes('ECONNREFUSED') || error.message.includes('connect ETIMEDOUT')
      ? OLLAMA_UNAVAILABLE_MESSAGE
      : error.message || 'Unable to fetch models';
    return res.status(500).json({ error: errorMessage });
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
      sessionStore.sessions = normalizeSessionCollection(sessions);
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

function startServer(port = PORT) {
  const listener = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log('Server started successfully with /api/generate endpoint now available');
  });
  return listener;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };


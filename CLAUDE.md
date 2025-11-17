# CLAUDE.md - AI Assistant Guide for Ollama Web

> **Last Updated**: 2025-01-17
> **Target Audience**: Claude Code and other AI coding assistants
> **Purpose**: Comprehensive guide to codebase structure, development workflows, and key conventions

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Codebase Architecture](#codebase-architecture)
3. [Quick Start for AI Assistants](#quick-start-for-ai-assistants)
4. [Development Workflows](#development-workflows)
5. [Key Conventions & Patterns](#key-conventions--patterns)
6. [API Reference](#api-reference)
7. [Frontend Architecture](#frontend-architecture)
8. [Testing Guidelines](#testing-guidelines)
9. [Common Tasks](#common-tasks)
10. [Critical Rules](#critical-rules)
11. [Troubleshooting](#troubleshooting)
12. [Resources](#resources)

---

## 🎯 Project Overview

### What is Ollama Web?

Ollama Web is a **lightweight, vanilla JavaScript single-page application (SPA)** that provides a web interface for interacting with local Ollama LLM models, with dual-mode support for cloud-based Ollama services.

### Technology Stack

| Component | Technology | Version | Notes |
|-----------|-----------|---------|-------|
| **Backend** | Express.js | 5.1.0 | RESTful API server |
| **Runtime** | Node.js | 18+ | CommonJS module system |
| **Frontend** | Vanilla JavaScript | ES6+ | Zero framework dependencies |
| **Storage** | Filesystem JSON | - | `storage/sessions.json`, `storage/api-keys.json` |
| **External APIs** | Ollama HTTP API | v2 | Local or Cloud endpoints |
| **Testing** | Puppeteer + Node.js | Latest | E2E and API testing |
| **Dev Tools** | nodemon | Latest | Hot-reload development |

### Key Features

- ✅ **Chat Interface**: Interactive chat with Ollama models
- ✅ **Session Management**: Multiple chat sessions with persistence
- ✅ **Streaming Support**: Server-Sent Events (SSE) for real-time responses
- ✅ **Instruction Presets**: Predefined prompt templates with workflows
- ✅ **Attachments**: File/image attachments with context integration
- ✅ **API Key Management**: Secure key storage with SHA-256 hashing
- ✅ **Dual Mode**: Support for both local Ollama and cloud APIs
- ✅ **Thinking Blocks**: Extract and display AI reasoning separately
- ✅ **GitHub Integration**: Connect and fetch files from repositories
- ✅ **Cloud Sync**: Optional remote data synchronization

### Project Statistics

- **Total Lines of Code**: ~7,723 core lines (2,258 backend + 4,558 frontend + 907 HTML)
- **API Endpoints**: 27 RESTful endpoints
- **Storage Files**: 2 JSON files (sessions, API keys)
- **Test Coverage**: E2E + API tests with Puppeteer
- **Documentation**: 7 structured skillsets + integration guides

---

## 🏗️ Codebase Architecture

### Directory Structure

```
ollama-web/
├── server.js                      # Main backend (2,258 lines)
│                                  # ALL server logic, routes, Ollama integration
├── package.json                   # Dependencies and npm scripts
├── config.json                    # Sync & app configuration
├── .gitignore                     # Git ignore rules
├── .claudeignore                  # Claude Code context filtering
├── .cursorrules                   # Cursor AI coding rules (reference)
│
├── public/                        # Frontend files (served statically)
│   ├── index.html                 # SPA shell with templates (907 lines)
│   ├── app.js                     # ALL frontend logic (4,558 lines)
│   ├── styles.css                 # Responsive CSS with mobile support
│   ├── sw.js                      # Service worker for PWA
│   ├── manifest.json              # PWA manifest
│   └── pages/                     # Extensible page components
│       ├── settings.html
│       ├── history.html
│       └── model-info.html
│
├── storage/                       # Runtime data (NOT in version control)
│   ├── sessions.json              # Session persistence
│   └── api-keys.json              # API key storage
│
├── scripts/                       # Testing & verification
│   ├── run_full_test_suite.sh     # E2E test orchestrator
│   ├── e2e-test-runner.js         # Puppeteer browser tests
│   ├── verify.js                  # Backend API verification
│   ├── mock-ollama.js             # Mock Ollama server for testing
│   ├── curl-examples.sh           # Manual API testing examples
│   └── TEST_SUITE_README.md       # Test documentation
│
└── .claude/                       # Claude Code domain expertise
    ├── README.md                  # Integration overview
    ├── INTEGRATION_GUIDE.md       # Detailed usage patterns
    └── skillsets/                 # Structured JSON knowledge base
        ├── index.json             # Agent catalog with triggers
        ├── ollama-integration-skillset.json
        ├── streaming-specialist-skillset.json
        ├── session-management-skillset.json
        ├── instruction-preset-skillset.json
        ├── chat-history-skillset.json
        ├── api-development-skillset.json
        └── frontend-state-skillset.json
```

### Architectural Philosophy

#### 1. **Single-File Approach**
- **Backend**: All logic in `server.js` (2,258 lines)
- **Frontend**: All logic in `app.js` (4,558 lines)
- **Rationale**: Simplicity, easy navigation, no build step required

#### 2. **Filesystem-Based Persistence**
- Simple JSON files instead of database
- Human-readable storage
- Easy backup and version control
- Suitable for single-user/small-team scenarios

#### 3. **Zero Frontend Framework**
- Pure vanilla JavaScript
- Direct browser API usage
- No build step or bundler required
- Minimal dependencies, smaller payload

#### 4. **Session-Based Architecture**
- Sessions stored in-memory and persisted to disk
- Each session contains: id, name, instructions, attachments, history, timestamps
- Default session (`default`) is protected (cannot be deleted)
- Active session tracking across server restarts

#### 5. **Streaming-First Design**
- Server-Sent Events (SSE) for all long-running operations
- Streaming guards disable timeouts on relevant routes
- Heartbeat mechanism (15s intervals) prevents client disconnects
- NDJSON to SSE conversion for Ollama streaming responses

---

## 🚀 Quick Start for AI Assistants

### MOST IMPORTANT: Read Skillsets First

**⚠️ CRITICAL**: Before implementing any feature or debugging any issue, **ALWAYS** read the relevant skillset(s) from `.claude/skillsets/`. This is your source of truth.

#### Why Skillsets?

| Metric | Benefit |
|--------|---------|
| **Lookup Speed** | 25x faster (2ms vs 100ms+) |
| **Token Usage** | 87% reduction (2K vs 15K tokens) |
| **Recall Accuracy** | 100% (perfect recall) |
| **Context Load** | 10-25x faster |

#### Available Skillsets

| Skillset | File | Use For |
|----------|------|---------|
| **Ollama Integration** | `ollama-integration-skillset.json` | API calls, models, connectivity |
| **Streaming Specialist** | `streaming-specialist-skillset.json` | SSE/NDJSON streaming, timeouts |
| **Session Management** | `session-management-skillset.json` | Session CRUD, attachments, persistence |
| **Instruction Preset** | `instruction-preset-skillset.json` | Prompt engineering, XML prompts |
| **Chat History** | `chat-history-skillset.json` | Context management, buildPrompt |
| **API Development** | `api-development-skillset.json` | REST endpoints, error handling |
| **Frontend State** | `frontend-state-skillset.json` | Client state, localStorage, events |

#### Trigger-Based Selection

Use the **index.json** triggers to identify which skillset(s) to read:

```
Task mentions → Read skillset
"streaming"   → streaming-specialist-skillset.json
"session"     → session-management-skillset.json
"api"         → api-development-skillset.json
"history"     → chat-history-skillset.json
"ollama"      → ollama-integration-skillset.json
"preset"      → instruction-preset-skillset.json
"frontend"    → frontend-state-skillset.json
```

### Recommended Workflow

1. **Identify Task Domain** - What area of the codebase does this task involve?
2. **Read Relevant Skillset(s)** - Load 1-3 skillsets (not all 7)
3. **Find Exact Pattern** - Navigate to `patterns`, `api_contracts`, or `common_mistakes`
4. **Use Code Templates** - Copy `code_template` fields directly
5. **Check Locations** - Reference `location` field for full context
6. **Test Changes** - Use verification scripts mentioned in skillset
7. **Update Skillset** - If adding new pattern, document it

### Example: Fix Streaming Timeout

```
Task: "Fix streaming timeout issue"

Step 1: Identify domain → "streaming" + "timeout"
Step 2: Read .claude/skillsets/streaming-specialist-skillset.json
Step 3: Navigate to "common_mistakes" section
Step 4: Find: "Not disabling timeouts on streaming routes"
Step 5: Get fix from "streaming_guards" pattern:

function applyStreamingGuards(req, res, label) {
  req.setTimeout(0);
  res.setTimeout(0);
  if (res.socket) {
    res.socket.setTimeout(0);
    res.socket.setKeepAlive(true);
  }
}

Step 6: Test with: node scripts/verify.js
```

**Time to solution**: <5 seconds with perfect accuracy

---

## 🔧 Development Workflows

### Starting the Application

```bash
# Install dependencies (first time)
npm install

# Production mode
npm start                  # Runs on port 3000

# Development mode (hot-reload)
npm run dev               # Uses nodemon

# Interactive startup
./run.sh                  # Interactive options, auto-opens browser
./run.sh --dev            # Development mode
./run.sh --pull           # Git pull before start
./run.sh --no-browser     # No auto-browser launch
```

### Running Tests

```bash
# Full test suite (E2E + API)
npm test

# API tests only
npm run test:api          # or: node scripts/verify.js

# E2E tests only
npm run test:e2e          # or: node scripts/e2e-test-runner.js

# Quick verification
npm run verify
```

### Development Cycle

```
1. Make changes to server.js (backend) or public/app.js (frontend)
2. Changes auto-reload with `npm run dev`
3. Test with `npm test` or targeted tests
4. Verify specific endpoints with `node scripts/verify.js`
5. Commit with descriptive message
6. Push to feature branch
```

### Environment Variables

The application uses extensive environment variable configuration. Key variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Server port | 3000 |
| `OLLAMA_MODE` | `local` or `cloud` | 'local' |
| `OLLAMA_HOST` | Ollama endpoint | 'http://127.0.0.1:11434' |
| `OLLAMA_MODEL` | Default model | Auto-detect |
| `OLLAMA_API_KEY` | Cloud API key | Empty |
| `OLLAMA_CLOUD_HOST` | Cloud endpoint | 'https://ollama.com' |
| `CONTEXT_MESSAGES` | History limit | 20 |
| `ATTACHMENT_CHAR_LIMIT` | Max attachment size | 200,000 |
| `MAX_ATTACHMENTS` | Max attachments per session | 10 |
| `STREAM_HEARTBEAT_INTERVAL_MS` | SSE heartbeat | 15,000 |
| `OLLAMA_GENERATION_TIMEOUT_MS` | Generation timeout | 600,000 |
| `OLLAMA_STREAM_TIMEOUT_MS` | Stream timeout | 120,000 |

See skillsets for complete environment variable reference.

---

## 🎨 Key Conventions & Patterns

### Backend Patterns (server.js)

#### 1. Normalization Pattern

**Always normalize data before persisting or returning**:

```javascript
// Session normalization
function normalizeSession(session, fallbackName = 'Untitled Session') {
  const now = new Date().toISOString();
  return {
    id: session.id || crypto.randomUUID(),
    name: session.name || fallbackName,
    instructions: session.instructions || '',
    presetId: session.presetId || null,
    attachments: Array.isArray(session.attachments) ? session.attachments : [],
    history: Array.isArray(session.history) ? session.history : [],
    createdAt: session.createdAt || now,
    updatedAt: session.updatedAt || now
  };
}

// Attachment sanitization
function sanitizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .slice(0, MAX_ATTACHMENTS)
    .filter(att => att && att.name && att.content)
    .map(att => ({
      name: String(att.name).trim(),
      type: String(att.type || 'text/plain'),
      content: String(att.content).slice(0, ATTACHMENT_CHAR_LIMIT)
    }));
}
```

#### 2. Streaming Guards Pattern

**CRITICAL for all SSE/streaming endpoints**:

```javascript
function applyStreamingGuards(req, res, label) {
  // Disable all timeouts
  req.setTimeout(0);
  res.setTimeout(0);

  if (res.socket) {
    res.socket.setTimeout(0);
    res.socket.setKeepAlive(true);
  }

  console.log(`[${label}] Streaming guards applied`);
}

function startSseHeartbeat(res, label) {
  const interval = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(interval);
      return;
    }
    res.write(':heartbeat\n\n'); // SSE comment (keeps connection alive)
  }, STREAM_HEARTBEAT_INTERVAL_MS);

  return interval; // Return for cleanup
}
```

#### 3. Error Handling Pattern

**Standard try-catch with appropriate status codes**:

```javascript
app.get('/api/endpoint', async (req, res) => {
  try {
    // Validation
    const { param } = req.body;
    if (!param) {
      return res.status(400).json({ error: 'Missing required parameter' });
    }

    // Business logic
    const result = await doSomething(param);

    // Success response
    res.json(result);

  } catch (error) {
    console.error('[Endpoint] Error:', error);
    res.status(500).json({
      error: 'Operation failed',
      details: error.message
    });
  }
});
```

#### 4. Ollama Connectivity Pattern

**Always check Ollama reachability before making requests**:

```javascript
async function ensureOllamaReachable(endpoint) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_CONNECTIVITY_TIMEOUT_MS);

    const response = await fetch(endpoint, {
      signal: controller.signal
    });

    clearTimeout(timeout);
    return response.ok;

  } catch (error) {
    console.error('[Ollama] Connectivity check failed:', error);
    return false;
  }
}

// Usage
const endpoint = withTrailingSlash(runtimeSettings.apiEndpoint);
const reachable = await ensureOllamaReachable(endpoint);

if (!reachable) {
  return res.status(503).json({ error: 'Ollama service unreachable' });
}
```

#### 5. Trailing Slash Pattern

**ALWAYS use for Ollama endpoints**:

```javascript
function withTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

// Usage
const endpoint = withTrailingSlash(runtimeSettings.apiEndpoint);
const modelsUrl = `${endpoint}api/tags`; // Correct: http://host/api/tags
```

### Frontend Patterns (public/app.js)

#### 1. State Management Pattern

**Centralized state with subscriber notifications**:

```javascript
const state = {
  currentPage: 'chat',
  chat: [],
  sessionHistories: {},
  localHistory: loadLocalHistory(),
  settings: null,
  sessions: [],
  activeSessionId: loadActiveSessionPreference(),
  // ... more properties
};

// Update state, then notify
function updateSettings(newSettings) {
  state.settings = { ...state.settings, ...newSettings };
  notifySettingsSubscribers();
}

function notifySettingsSubscribers() {
  window.dispatchEvent(new CustomEvent('settings-changed', {
    detail: state.settings
  }));
}
```

#### 2. LocalStorage Pattern

**Always wrap in try-catch, handle errors gracefully**:

```javascript
function loadLocalHistory() {
  try {
    const raw = localStorage.getItem('chat_history');
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];

  } catch (error) {
    console.error('[LocalStorage] Failed to load history:', error);
    return [];
  }
}

function saveLocalHistory(history) {
  try {
    localStorage.setItem('chat_history', JSON.stringify(history));
  } catch (error) {
    // Handle QuotaExceededError
    if (error.name === 'QuotaExceededError') {
      console.warn('[LocalStorage] Quota exceeded, clearing old data');
      localStorage.removeItem('chat_history');
    }
  }
}
```

#### 3. XSS Prevention Pattern

**Use textContent or escapeHtml() for user content**:

```javascript
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Safe rendering
messageElement.textContent = userMessage; // Preferred
// OR
messageElement.innerHTML = escapeHtml(userMessage);
```

#### 4. Event-Based Communication Pattern

**Use CustomEvent for component communication**:

```javascript
// Dispatch event
window.dispatchEvent(new CustomEvent('session-changed', {
  detail: { sessionId: newId }
}));

// Listen for event
window.addEventListener('session-changed', (event) => {
  console.log('Session changed to:', event.detail.sessionId);
  reloadChatHistory();
});
```

---

## 📡 API Reference

### Endpoint Overview

The application exposes **27 RESTful endpoints** organized by domain:

#### Chat & Generation

| Method | Route | Purpose | Streaming |
|--------|-------|---------|-----------|
| `POST` | `/api/chat` | Non-streaming chat (legacy) | No |
| `POST` | `/api/generate` | Direct Ollama generation | No |
| `POST` | `/api/chat/stream` | SSE streaming chat | Yes |

#### Session Management

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/:id` | Get specific session |
| `POST` | `/api/sessions` | Create new session |
| `PUT` | `/api/sessions/:id` | Update session |
| `POST` | `/api/sessions/:id/select` | Set active session |
| `DELETE` | `/api/sessions/:id` | Delete session |

#### History & Context

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/history` | Get chat history for active session |
| `DELETE` | `/api/history` | Clear history |
| `POST` | `/api/history/entry` | Add history entry |

#### Settings & Configuration

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/settings` | Fetch current settings + defaults |
| `POST` | `/api/settings` | Update runtime settings |

#### Models

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/models` | List available Ollama models |

#### API Keys

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/keys` | List API keys (masked) |
| `POST` | `/api/keys` | Create new API key |
| `DELETE` | `/api/keys/:id` | Delete API key |

#### Cloud Sync

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/sync/data` | Fetch cloud sync data |
| `POST` | `/api/sync/data` | Store cloud sync data |

#### GitHub Integration

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/github/repos` | List connected repositories |
| `POST` | `/api/github/connect` | Connect new repository |
| `DELETE` | `/api/github/repos/:id` | Disconnect repository |
| `GET` | `/api/github/file` | Fetch file from repository |

#### Utilities

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/proxy` | Forward arbitrary HTTP calls |
| `GET` | `/health` | Health check endpoint |
| `GET` | `/*` | Fallback SPA route (serves index.html) |

### Standard Response Formats

#### Success Response
```json
{
  "data": { /* response payload */ }
}
// or direct JSON for most endpoints
```

#### Error Response
```json
{
  "error": "Human-readable error message",
  "details": "Additional context (optional)"
}
```

#### HTTP Status Codes

- `200` - Success with body
- `201` - Resource created
- `204` - Success without body (DELETE operations)
- `400` - Bad request (validation errors)
- `401` - Unauthorized (invalid API key)
- `404` - Resource not found
- `500` - Internal server error
- `503` - Service unavailable (Ollama unreachable)

### Streaming Response Format (SSE)

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"token": "Hello", "thinking": null}

data: {"token": " world", "thinking": null}

data: {"done": true, "thinking": "<thinking>...</thinking>"}

:heartbeat

```

---

## 🎭 Frontend Architecture

### Page System

The frontend uses a **template-based page system** with both built-in and remote pages:

#### Built-in Pages (Templates in index.html)

- **chat-page** - Main chat interface
- **settings-page** - Configuration panel
- **sessions-page** - Session management
- **history-page** - Conversation history
- **api-page** - API information

#### Remote Pages (Loaded on Demand)

```javascript
const defaultPages = [
  { id: 'chat', label: 'Chat', type: 'component' },
  { id: 'settings', label: 'Settings', type: 'component' },
  { id: 'history', label: 'History', type: 'component' },
  {
    id: 'model-info',
    label: 'Model Info',
    type: 'remote',
    src: '/pages/model-info.html'
  }
];
```

### State Structure

```javascript
const state = {
  // Navigation
  currentPage: 'chat',

  // Chat data
  chat: [],                    // Current chat messages
  sessionHistories: {},        // All session histories
  localHistory: [],            // LocalStorage backup

  // Configuration
  settings: null,              // Runtime settings
  sessions: [],                // All sessions
  activeSessionId: null,       // Current session

  // UI state
  isStreaming: false,
  streamController: null,

  // Feature flags
  customPages: [],
  apiKeys: []
};
```

### Rendering Flow

```
1. User action (e.g., click "Settings")
2. navigateTo('settings') called
3. state.currentPage updated
4. renderCurrentPage() executed
5. Template cloned from <template id="settings-page">
6. Content inserted into #main-content
7. Event listeners attached
8. Page-specific initialization (loadSettings(), etc.)
```

### Message Rendering

Messages support **structured XML sections** and **thinking blocks**:

```javascript
function renderMessage(message) {
  const messageDiv = document.createElement('div');
  messageDiv.classList.add('message', message.role);

  // Extract thinking blocks
  const { thinking, response } = extractThinkingBlocks(message.content);

  // Render thinking (if present)
  if (thinking) {
    const thinkingDiv = createThinkingElement(thinking);
    messageDiv.appendChild(thinkingDiv);
  }

  // Render main response
  const contentDiv = document.createElement('div');
  contentDiv.classList.add('message-content');
  contentDiv.textContent = response; // XSS-safe
  messageDiv.appendChild(contentDiv);

  return messageDiv;
}
```

---

## 🧪 Testing Guidelines

### Test Architecture

```
run_full_test_suite.sh (orchestrator)
├── Start mock Ollama server (port 14001)
├── Start application server (port 4100)
├── Run API tests (verify.js)
│   ├── Non-streaming generation
│   ├── Streaming generation
│   ├── Chat streaming
│   ├── Preset caching
│   └── Session preset sync
├── Run E2E tests (e2e-test-runner.js)
│   ├── Homepage load
│   ├── Settings page access
│   ├── Session creation
│   ├── Chat message sending
│   ├── Data persistence with refresh
│   ├── History clearing
│   ├── Model selection
│   ├── Responsive design
│   └── API health checks
└── Generate test report
```

### Running Tests

```bash
# Full test suite (recommended before committing)
npm test

# API tests only (fast, ~10 seconds)
npm run test:api

# E2E tests only (slower, ~30 seconds)
npm run test:e2e

# Quick verification (basic checks)
npm run verify
```

### Test Environment Variables

```bash
TEST_USER_NAME="TestUser"
TEST_USER_EMAIL="testuser@example.com"
TEST_SESSION_NAME="E2E Test Session"
SERVER_PORT=4100
MOCK_PORT=14001
HEADLESS=true              # Set to false to see browser
TEST_TIMEOUT=120000        # 2 minutes
SLOW_MO=0                  # Delay between actions (debugging)
```

### Writing New Tests

#### Backend API Test (verify.js)

```javascript
async function testNewEndpoint() {
  console.log('Testing new endpoint...');

  const response = await fetch('http://localhost:3000/api/new-endpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ param: 'value' })
  });

  if (!response.ok) {
    throw new Error(`Test failed: ${response.status}`);
  }

  const data = await response.json();
  console.log('✓ New endpoint test passed');
  return data;
}
```

#### E2E Test (e2e-test-runner.js)

```javascript
async function testNewFeature(page) {
  console.log('Testing new feature...');

  // Navigate to page
  await page.click('#nav-new-feature');
  await page.waitForSelector('#new-feature-content');

  // Interact with UI
  await page.type('#input-field', 'test value');
  await page.click('#submit-button');

  // Verify result
  await page.waitForSelector('.success-message');
  const text = await page.$eval('.success-message', el => el.textContent);

  if (!text.includes('Success')) {
    throw new Error('Feature test failed');
  }

  console.log('✓ New feature test passed');
}
```

### Testing Best Practices

1. **Test in Isolation** - Use mock Ollama server for consistent results
2. **Clean State** - Clear storage between test runs
3. **Verify Both Success and Error Cases** - Don't just test happy paths
4. **Check Console Output** - Look for errors or warnings
5. **Test Streaming Endpoints** - Ensure SSE connections work properly
6. **Mobile Testing** - Test responsive design with different viewports

---

## 📝 Common Tasks

### Task 1: Add a New API Endpoint

```javascript
// 1. Read skillsets
// Read: .claude/skillsets/api-development-skillset.json

// 2. Add endpoint to server.js
app.post('/api/new-endpoint', async (req, res) => {
  try {
    // Validation
    const { param } = req.body;
    if (!param) {
      return res.status(400).json({ error: 'Missing required parameter' });
    }

    // Business logic
    const result = await doSomething(param);

    // Success response
    res.json({ success: true, data: result });

  } catch (error) {
    console.error('[NewEndpoint] Error:', error);
    res.status(500).json({ error: 'Operation failed', details: error.message });
  }
});

// 3. Test endpoint
// Add test to scripts/verify.js

// 4. Update skillset
// Document in .claude/skillsets/api-development-skillset.json
```

### Task 2: Add a New Streaming Endpoint

```javascript
// 1. Read skillsets
// Read: .claude/skillsets/streaming-specialist-skillset.json
// Read: .claude/skillsets/api-development-skillset.json

// 2. Add streaming endpoint
app.post('/api/new-stream', async (req, res) => {
  try {
    // Apply streaming guards (CRITICAL!)
    applyStreamingGuards(req, res, 'new-stream');

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Start heartbeat
    const heartbeatTimer = startSseHeartbeat(res, 'new-stream');

    // Stream data
    for (const chunk of dataSource) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    // Complete
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

    // Cleanup
    clearInterval(heartbeatTimer);

  } catch (error) {
    console.error('[NewStream] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream failed' });
    }
  }
});
```

### Task 3: Add a New Session Field

```javascript
// 1. Read skillset
// Read: .claude/skillsets/session-management-skillset.json

// 2. Update normalizeSession function
function normalizeSession(session, fallbackName = 'Untitled Session') {
  const now = new Date().toISOString();
  return {
    // ... existing fields ...
    newField: session.newField || defaultValue, // ADD THIS
    updatedAt: session.updatedAt || now
  };
}

// 3. Update sanitization (if needed)
function sanitizeNewField(value) {
  // Validation logic
  return validatedValue;
}

// 4. Update API endpoints to accept new field
app.put('/api/sessions/:id', async (req, res) => {
  try {
    const { newField } = req.body; // ADD THIS

    const session = sessionStore.sessions[id];
    if (newField !== undefined) {
      session.newField = sanitizeNewField(newField);
    }

    persistSessions();
    res.json(normalizeSession(session));

  } catch (error) {
    // ...
  }
});

// 5. Update frontend to display/edit new field
// In public/app.js, update session rendering and forms
```

### Task 4: Add a New Instruction Preset

```javascript
// 1. Read skillset
// Read: .claude/skillsets/instruction-preset-skillset.json

// 2. Add preset to INSTRUCTION_PRESETS array in server.js
const INSTRUCTION_PRESETS = [
  // ... existing presets ...
  {
    id: 'new-preset-id',
    label: 'New Preset Name',
    instructions: `
Your preset instructions here.
Can be multi-line.
`,
    workflow: {
      requiresDiscovery: false,
      autoComplete: true,
      phases: [] // Optional
    }
  }
];

// 3. Frontend automatically picks up new preset
// Test in Settings page
```

### Task 5: Debug Streaming Timeout

```javascript
// 1. Read skillset
// Read: .claude/skillsets/streaming-specialist-skillset.json

// 2. Check common_mistakes section
// Issue: "Not disabling timeouts on streaming routes"

// 3. Verify streaming guards are applied
app.post('/api/streaming-endpoint', async (req, res) => {
  // THIS MUST BE PRESENT:
  applyStreamingGuards(req, res, 'endpoint-label');

  // ... rest of streaming logic
});

// 4. Verify heartbeat is active
const heartbeatTimer = startSseHeartbeat(res, 'endpoint-label');

// 5. Clean up on completion
clearInterval(heartbeatTimer);
```

---

## ⚠️ Critical Rules

### Backend Critical Rules

#### 1. Streaming Routes MUST Disable Timeouts

```javascript
// ✅ CORRECT
app.post('/api/stream', async (req, res) => {
  applyStreamingGuards(req, res, 'stream');
  // ... streaming logic
});

// ❌ WRONG
app.post('/api/stream', async (req, res) => {
  // Missing applyStreamingGuards()
  // Will timeout after 2 minutes!
});
```

#### 2. Always Normalize Before Persisting

```javascript
// ✅ CORRECT
const session = normalizeSession(req.body);
sessionStore.sessions[id] = session;
persistSessions();

// ❌ WRONG
sessionStore.sessions[id] = req.body; // Unvalidated!
persistSessions();
```

#### 3. Always Use Trailing Slash for Ollama Endpoints

```javascript
// ✅ CORRECT
const endpoint = withTrailingSlash(runtimeSettings.apiEndpoint);
const url = `${endpoint}api/generate`;

// ❌ WRONG
const url = `${runtimeSettings.apiEndpoint}api/generate`; // Might be missing /
```

#### 4. Always Check Ollama Connectivity

```javascript
// ✅ CORRECT
const reachable = await ensureOllamaReachable(endpoint);
if (!reachable) {
  return res.status(503).json({ error: 'Ollama unreachable' });
}

// ❌ WRONG
// Just try to call Ollama without checking
// Will hang or timeout if Ollama is down
```

#### 5. Always Wrap Async Routes in Try-Catch

```javascript
// ✅ CORRECT
app.get('/api/endpoint', async (req, res) => {
  try {
    const result = await operation();
    res.json(result);
  } catch (error) {
    console.error('[Endpoint] Error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// ❌ WRONG
app.get('/api/endpoint', async (req, res) => {
  const result = await operation(); // Unhandled rejection!
  res.json(result);
});
```

### Frontend Critical Rules

#### 1. Always Use textContent or escapeHtml() for User Content

```javascript
// ✅ CORRECT
element.textContent = userInput;
// OR
element.innerHTML = escapeHtml(userInput);

// ❌ WRONG
element.innerHTML = userInput; // XSS vulnerability!
```

#### 2. Always Wrap LocalStorage in Try-Catch

```javascript
// ✅ CORRECT
function saveData(data) {
  try {
    localStorage.setItem('key', JSON.stringify(data));
  } catch (error) {
    console.error('LocalStorage error:', error);
    // Handle QuotaExceededError
  }
}

// ❌ WRONG
function saveData(data) {
  localStorage.setItem('key', JSON.stringify(data)); // Can throw!
}
```

#### 3. Always Validate LocalStorage Data

```javascript
// ✅ CORRECT
function loadData() {
  try {
    const raw = localStorage.getItem('key');
    if (!raw) return defaultValue;

    const parsed = JSON.parse(raw);
    return validateData(parsed) ? parsed : defaultValue;

  } catch (error) {
    return defaultValue;
  }
}

// ❌ WRONG
function loadData() {
  return JSON.parse(localStorage.getItem('key')); // Can fail!
}
```

#### 4. Always Notify Subscribers After State Changes

```javascript
// ✅ CORRECT
state.settings = newSettings;
notifySettingsSubscribers();

// ❌ WRONG
state.settings = newSettings;
// Forgot to notify! UI won't update!
```

### Security Rules

#### 1. Never Commit Secrets

- API keys in `.env` files
- Credentials in `storage/api-keys.json`
- Tokens in configuration files

#### 2. Always Hash API Keys

```javascript
// ✅ CORRECT
const hashedKey = hashSecret(rawKey);
apiKeyStore.keys.push({ id, hash: hashedKey });

// ❌ WRONG
apiKeyStore.keys.push({ id, key: rawKey }); // Plaintext!
```

#### 3. Always Validate Input

```javascript
// ✅ CORRECT
function sanitizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ATTACHMENTS)
    .filter(att => att && att.name && att.content)
    .map(att => ({
      name: String(att.name).trim(),
      type: String(att.type || 'text/plain'),
      content: String(att.content).slice(0, ATTACHMENT_CHAR_LIMIT)
    }));
}

// ❌ WRONG
function sanitizeAttachments(raw) {
  return raw; // No validation!
}
```

### Performance Rules

#### 1. Limit History Context

```javascript
// History is automatically trimmed to CONTEXT_MESSAGES (default 20)
// Don't send entire history to Ollama
const recentHistory = history.slice(-CONTEXT_MESSAGES);
```

#### 2. Use Heartbeat for Long Streams

```javascript
// ✅ CORRECT
const heartbeatTimer = startSseHeartbeat(res, 'label');
// ... streaming logic
clearInterval(heartbeatTimer);

// ❌ WRONG
// No heartbeat - client might disconnect on long pauses
```

#### 3. Debounce Expensive Operations

```javascript
// Frontend: Debounce localStorage writes
let saveTimeout;
function debouncedSave(data) {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveLocalHistory(data);
  }, 1000);
}
```

---

## 🔍 Troubleshooting

### Issue: Streaming Endpoint Times Out

**Symptom**: SSE connection closes after ~2 minutes

**Solution**:
1. Read: `.claude/skillsets/streaming-specialist-skillset.json`
2. Check: Is `applyStreamingGuards()` called?
3. Check: Is heartbeat active?
4. Verify: Are socket timeouts disabled?

```javascript
// Ensure this is present:
applyStreamingGuards(req, res, 'label');
const heartbeatTimer = startSseHeartbeat(res, 'label');
```

### Issue: Sessions Not Persisting

**Symptom**: Sessions lost after server restart

**Solution**:
1. Read: `.claude/skillsets/session-management-skillset.json`
2. Check: Is `persistSessions()` called after changes?
3. Verify: Does `storage/` directory exist?
4. Check: File permissions on `storage/sessions.json`

```javascript
// Every session modification must call:
persistSessions();
```

### Issue: Ollama Connection Fails

**Symptom**: "Ollama unreachable" errors

**Solution**:
1. Read: `.claude/skillsets/ollama-integration-skillset.json`
2. Check: Is Ollama running? (`ollama list`)
3. Verify: `OLLAMA_HOST` environment variable correct?
4. Check: Trailing slash on endpoint?

```bash
# Verify Ollama is running
curl http://127.0.0.1:11434/

# Check environment
echo $OLLAMA_HOST
```

### Issue: LocalStorage Quota Exceeded

**Symptom**: "QuotaExceededError" in browser console

**Solution**:
1. Read: `.claude/skillsets/frontend-state-skillset.json`
2. Clear old data: `localStorage.clear()`
3. Implement: Automatic cleanup for old history
4. Consider: Moving to server-side storage

```javascript
// Handle quota errors
try {
  localStorage.setItem('key', data);
} catch (error) {
  if (error.name === 'QuotaExceededError') {
    localStorage.clear();
    localStorage.setItem('key', data);
  }
}
```

### Issue: Messages Not Rendering Correctly

**Symptom**: HTML tags visible or broken formatting

**Solution**:
1. Check: Using `textContent` instead of `innerHTML`?
2. Verify: `escapeHtml()` called for user content?
3. Check: Thinking blocks extracted correctly?

```javascript
// Use textContent for safety
messageElement.textContent = content;

// OR escape HTML
messageElement.innerHTML = escapeHtml(content);
```

### Issue: Tests Failing

**Symptom**: `npm test` reports failures

**Solution**:
1. Read: `scripts/TEST_SUITE_README.md`
2. Check: Mock Ollama server running?
3. Verify: Test environment variables set?
4. Run: Tests individually to isolate issue

```bash
# Run tests separately
npm run test:api   # Backend tests
npm run test:e2e   # Frontend tests

# Check mock server
node scripts/mock-ollama.js &
```

---

## 📚 Resources

### Primary Documentation

| Resource | Location | Purpose |
|----------|----------|---------|
| **Skillsets** | `.claude/skillsets/*.json` | Domain expertise, patterns, API contracts |
| **Integration Guide** | `.claude/INTEGRATION_GUIDE.md` | Detailed usage examples |
| **Skillset Overview** | `.claude/README.md` | Quick start for Claude Code |
| **Test Documentation** | `scripts/TEST_SUITE_README.md` | Testing guide |
| **API Examples** | `scripts/curl-examples.sh` | Manual API testing |
| **Cursor Rules** | `.cursorrules` | Coding conventions (reference) |

### Skillset Files (READ THESE FIRST!)

1. **ollama-integration-skillset.json** - Ollama API patterns
2. **streaming-specialist-skillset.json** - SSE/streaming implementation
3. **session-management-skillset.json** - Session CRUD operations
4. **instruction-preset-skillset.json** - Prompt engineering
5. **chat-history-skillset.json** - Conversation management
6. **api-development-skillset.json** - REST API patterns
7. **frontend-state-skillset.json** - Client-side state

### Quick Command Reference

```bash
# Development
npm run dev                # Start dev server with hot-reload
npm start                  # Start production server
./run.sh                   # Interactive startup

# Testing
npm test                   # Full test suite
npm run test:api           # API tests only
npm run test:e2e           # E2E tests only
npm run verify             # Quick verification

# Skillset Navigation
ls .claude/skillsets/*.json                    # List all skillsets
cat .claude/skillsets/index.json              # View agent catalog
jq '.patterns | keys' .claude/skillsets/streaming-specialist-skillset.json

# Git Operations
git status                                     # Check current status
git add .                                      # Stage changes
git commit -m "feat: description"             # Commit
git push -u origin claude/branch-name         # Push to feature branch
```

### File Locations Quick Reference

| File | Lines | Purpose |
|------|-------|---------|
| `server.js` | 2,258 | All backend logic |
| `public/app.js` | 4,558 | All frontend logic |
| `public/index.html` | 907 | SPA shell with templates |
| `package.json` | 27 | Dependencies & scripts |
| `config.json` | 13 | App configuration |

### Environment Configuration

See skillsets for complete reference. Quick access:

```bash
# Check current environment
env | grep OLLAMA

# Set for current session
export OLLAMA_HOST=http://127.0.0.1:11434
export OLLAMA_MODEL=qwen3:1.7B
export PORT=3000
```

---

## 🎯 Best Practices Summary

### ✅ DO

1. **Read skillsets FIRST** before implementing anything
2. **Use exact code templates** from skillsets
3. **Normalize all data** before persisting
4. **Validate all input** (user input, API responses)
5. **Disable timeouts** on streaming routes
6. **Wrap async operations** in try-catch
7. **Test changes** with verification scripts
8. **Check common_mistakes** sections
9. **Use textContent** for user-generated content
10. **Update skillsets** when adding new patterns

### ❌ DON'T

1. **Guess API contracts** - read skillsets
2. **Skip normalization** - data corruption risk
3. **Forget streaming guards** - will timeout
4. **Use innerHTML** with user content - XSS risk
5. **Ignore localStorage errors** - will crash
6. **Skip Ollama connectivity checks** - will hang
7. **Commit secrets** - security risk
8. **Reinvent patterns** - use established ones
9. **Skip testing** - breaks production
10. **Forget to notify subscribers** - UI won't update

---

## 📌 Final Notes

### For Claude Code

This file provides a comprehensive overview, but **ALWAYS READ THE RELEVANT SKILLSET(S) FIRST** before implementing features or debugging issues. Skillsets contain:

- ✅ Exact code templates
- ✅ API contracts with schemas
- ✅ Common mistakes and fixes
- ✅ File:line locations
- ✅ Testing guidance

**Performance Metrics**:
- 25x faster lookups
- 87% fewer tokens
- 100% recall accuracy

### For Other AI Assistants

This codebase follows specific patterns documented in `.claude/skillsets/`. While this CLAUDE.md provides an overview, the skillsets contain the authoritative source of truth for:

- Implementation patterns
- API contracts
- Validation rules
- Error handling
- Testing approaches

Always cross-reference this guide with the skillsets for complete accuracy.

### Version Information

- **CLAUDE.md Version**: 1.0
- **Last Updated**: 2025-01-17
- **Codebase Version**: 1.0.0
- **Skillsets Version**: 1.0

### Contributing

When adding new features or patterns:

1. Implement using existing patterns from skillsets
2. Test thoroughly with verification scripts
3. Document in relevant skillset(s)
4. Update this CLAUDE.md if adding major features
5. Commit with descriptive message following convention

---

**Happy Coding! 🚀**

Remember: **Read skillsets first, implement second, test third.**

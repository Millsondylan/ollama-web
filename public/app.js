/**
 * Frontend state + navigation planner
 * -----------------------------------
 * - Maintains shared state (`state`) for chat transcript, settings, history, and custom pages.
 * - Default pages (chat/settings/history/model-info) are registered here; extra HTML files under
 *   public/pages can be plugged in through the UI without code changes.
 * - All API calls are routed through fetchJson -> buildUrl so the backend endpoint is configurable.
 */

const STORAGE_KEYS = {
  history: 'ollama-web-history',
  settings: 'ollama-web-client-settings',
  pages: 'ollama-web-custom-pages'
};

const FALLBACK_BASE_URL = window.location.origin + '/';
const THINKING_PREF_KEY = 'ollama-thinking-enabled';

// Default navigation stack. Additional HTML pages can be appended at runtime via the Custom Pages form.
const defaultPages = [
  { id: 'chat', label: 'Chat', type: 'component', template: 'chat-page' },
  { id: 'sessions', label: 'Sessions', type: 'component', template: 'sessions-page' },
  { id: 'settings', label: 'Settings', type: 'component', template: 'settings-page' },
  { id: 'history', label: 'History', type: 'component', template: 'history-page' },
  { id: 'api', label: 'API', type: 'component', template: 'api-page' },
  { id: 'model-info', label: 'Model Info', type: 'remote', src: '/pages/model-info.html' }
];

const state = {
  currentPage: 'chat',
  chat: [],
  sessionHistories: {},
  localHistory: loadLocalHistory(),
  settings: null,
  baseUrl: FALLBACK_BASE_URL,
  customPages: loadCustomPages(),
  isSending: false,
  sessions: [],
  activeSessionId: loadActiveSessionPreference(),
  historySessionId: null,
  editingSessionId: null,
  apiKeys: [],
  lastGeneratedSecret: null,
  availableModels: [],
  thinkingEnabled: loadThinkingPreference()
};

window.appState = state;

const elements = {
  nav: document.getElementById('page-nav'),
  root: document.getElementById('page-root'),
  status: document.getElementById('connection-status'),
  activeModel: document.getElementById('active-model')
};

init();

async function init() {
  await bootstrapSettings();
  await loadSessions();
  await loadAvailableModels();
  if (!state.activeSessionId && state.sessions.length) {
    state.activeSessionId = state.sessions[0].id;
  }
  state.historySessionId = state.activeSessionId;
  renderNav();
  await loadServerHistory(state.activeSessionId);
  await loadApiKeys();
  renderPage(state.currentPage);
  hydrateLocalHistory();
}

function getPageRegistry() {
  const custom = state.customPages.map((page) => ({
    ...page,
    type: 'remote'
  }));

  const merged = [...defaultPages, ...custom];
  return merged.reduce((acc, page) => {
    acc[page.id] = page;
    return acc;
  }, {});
}

async function bootstrapSettings() {
  try {
    const data = await fetchJson('/api/settings');
    const normalizedBase = normalizeBaseUrl(data.current?.backendBaseUrl);
    state.settings = {
      ...data.current,
      backendBaseUrl: normalizedBase
    };
    state.baseUrl = normalizedBase;
    applyTheme(state.settings.theme);
    persistClientSettings();
    notifySettingsSubscribers();
    elements.status.textContent = 'online';
    elements.status.classList.add('badge-online');
    elements.activeModel.textContent = `model: ${state.settings.model}`;
  } catch (error) {
    elements.status.textContent = 'offline';
    elements.activeModel.textContent = 'model: —';
    restoreClientSettings();
    state.baseUrl = normalizeBaseUrl(state.settings?.backendBaseUrl);
    state.settings = {
      ...(state.settings || {}),
      backendBaseUrl: state.baseUrl
    };
    notifySettingsSubscribers();
  }
}

async function loadSessions() {
  try {
    const data = await fetchJson('/api/sessions');
    state.sessions = data.sessions || [];
    const desiredId =
      state.activeSessionId ||
      state.sessions.find((session) => session.id === data.activeSessionId)?.id ||
      data.activeSessionId;
    const fallbackId = state.sessions[0]?.id || data.activeSessionId || 'default';
    state.activeSessionId =
      state.sessions.find((session) => session.id === desiredId)?.id || fallbackId;
    if (!state.sessions.find((session) => session.id === state.historySessionId)) {
      state.historySessionId = state.activeSessionId;
    }
    persistActiveSession();
    renderSessionSelector();
    renderHistoryPage();
    updateSessionInstructionsPreview();
    notifySettingsSubscribers();
  } catch (error) {
    console.error('Failed to load sessions', error);
    if (!state.activeSessionId) {
      state.activeSessionId = 'default';
    }
  }
}

async function loadAvailableModels() {
  try {
    const data = await fetchJson('/api/models');
    state.availableModels = data.models || [];
    if (document.getElementById('model-selector')) {
      renderModelSelector();
      updateThinkingStatus();
    }
  } catch (error) {
    console.warn('Failed to load available models', error);
    state.availableModels = [];
  }
}

async function loadApiKeys() {
  try {
    const data = await fetchJson('/api/keys');
    state.apiKeys = data.keys || [];
    state.baseUrl = normalizeBaseUrl(data.baseUrl || state.baseUrl);
    if (state.settings) {
      state.settings.backendBaseUrl = state.baseUrl;
    }
    if (state.currentPage === 'api') {
      renderApiPage();
    }
  } catch (error) {
    console.error('Failed to load API keys', error);
  }
}

async function loadServerHistory(sessionId = state.activeSessionId) {
  if (!sessionId) return;
  try {
    const data = await fetchJson(`/api/history?sessionId=${encodeURIComponent(sessionId)}`);
    state.sessionHistories[sessionId] = data.history || [];
    if (sessionId === state.activeSessionId) {
      state.chat = state.sessionHistories[sessionId];
    }
    state.localHistory[sessionId] = state.sessionHistories[sessionId];
    persistLocalHistory();
    if (state.currentPage === 'chat') {
      renderChatMessages();
    }
    if (state.currentPage === 'history') {
      renderHistoryPage();
    }
  } catch (error) {
    console.error('Failed to load server history', error);
    state.sessionHistories[sessionId] = state.localHistory[sessionId] || [];
  }
}

function hydrateLocalHistory() {
  if (!Object.keys(state.localHistory).length && Object.keys(state.sessionHistories).length) {
    Object.entries(state.sessionHistories).forEach(([sessionId, history]) => {
      state.localHistory[sessionId] = history;
    });
    persistLocalHistory();
  }
}

function renderNav() {
  const registry = getPageRegistry();
  const buttons = Object.values(registry).map((page) => {
    const button = document.createElement('button');
    button.textContent = page.label;
    button.dataset.page = page.id;
    if (state.currentPage === page.id) {
      button.classList.add('active');
    }
    button.addEventListener('click', () => {
      state.currentPage = page.id;
      renderNav();
      renderPage(page.id);
    });
    return button;
  });

  elements.nav.innerHTML = '';
  buttons.forEach((button) => elements.nav.appendChild(button));
}

function renderPage(pageId) {
  const registry = getPageRegistry();
  const definition = registry[pageId];

  if (!definition) {
    elements.root.innerHTML = '<p>Page not found.</p>';
    return;
  }

  if (definition.type === 'component') {
    renderComponentPage(definition.template);
  } else {
    renderRemotePage(definition);
  }
}

function renderComponentPage(templateId) {
  const template = document.getElementById(templateId);
  if (!template) {
    elements.root.innerHTML = '<p>Template not found.</p>';
    return;
  }

  elements.root.innerHTML = '';
  elements.root.appendChild(template.content.cloneNode(true));

  switch (templateId) {
    case 'chat-page':
      attachChatHandlers();
      break;
    case 'sessions-page':
      renderSessionsPage();
      break;
    case 'settings-page':
      attachSettingsHandlers();
      break;
    case 'history-page':
      renderHistoryPage();
      break;
    case 'api-page':
      renderApiPage();
      break;
    default:
      break;
  }
}

// Sessions page lets the user manage named chat contexts + attachments.
function renderSessionsPage() {
  renderSessionList();
  attachSessionFormHandlers();
}

function renderApiPage() {
  const baseUrlEl = document.getElementById('api-base-url');
  const copyBtn = document.getElementById('copy-base-url');
  const secretBox = document.getElementById('api-key-secret');
  const tableBody = document.getElementById('api-key-list');
  const emptyState = document.getElementById('api-key-empty');
  const form = document.getElementById('api-key-form');
  const sample = document.getElementById('api-sample');

  if (!baseUrlEl || !tableBody || !form) {
    return;
  }

  baseUrlEl.textContent = state.baseUrl;
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(state.baseUrl);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
      } catch (error) {
        console.error('Clipboard copy failed', error);
      }
    };
  }

  if (secretBox) {
    if (state.lastGeneratedSecret) {
      secretBox.textContent = state.lastGeneratedSecret;
    } else {
      secretBox.textContent = 'Generate a key to see it here (displayed once).';
    }
  }

  tableBody.innerHTML = '';
  if (!state.apiKeys.length) {
    if (emptyState) emptyState.style.display = 'block';
  } else {
    if (emptyState) emptyState.style.display = 'none';
    state.apiKeys.forEach((key) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${key.name}</td>
        <td>${formatDate(key.createdAt)}</td>
        <td>${key.lastUsedAt ? formatDate(key.lastUsedAt) : '—'}</td>
        <td><button data-key="${key.id}" class="ghost-btn danger">Delete</button></td>
      `;
      row.querySelector('button').onclick = async () => {
        await fetchJson(`/api/keys/${key.id}`, { method: 'DELETE' });
        await loadApiKeys();
      };
      tableBody.appendChild(row);
    });
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      const data = await fetchJson('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name: formData.get('name') })
      });
      state.lastGeneratedSecret = data.secret;
      form.reset();
      await loadApiKeys();
    } catch (error) {
      console.error('Failed to create API key', error);
    }
  };

  if (sample) {
    sample.textContent = `curl -X POST \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  ${state.baseUrl}api/chat \\
  -d '{ "message": "Hello from API", "sessionId": "${state.activeSessionId}" }'`;
  }
}

function renderSessionList() {
  const container = document.getElementById('session-list');
  if (!container) return;

  if (!state.sessions.length) {
    container.innerHTML = '<p class="muted">No sessions created yet.</p>';
    return;
  }

  const sorted = [...state.sessions].sort(
    (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );

  container.innerHTML = '';

  sorted.forEach((session) => {
    const card = document.createElement('article');
    card.className = `session-card${session.id === state.activeSessionId ? ' active' : ''}`;
    const instructionPreview = session.instructions
      ? session.instructions.slice(0, 140) + (session.instructions.length > 140 ? '…' : '')
      : 'No custom instructions';
    const attachmentsMarkup = session.attachments && session.attachments.length
      ? session.attachments
          .map(
            (att) =>
              `<li><span>${att.name}</span><span class="muted small-text">${att.type}</span></li>`
          )
          .join('')
      : '<li class="muted small-text">No attachments</li>';

    card.innerHTML = `
      <header>
        <div>
          <h3>${session.name}</h3>
          <p class="muted small-text">${instructionPreview}</p>
        </div>
        <span class="badge">${session.historyLength || 0} msgs</span>
      </header>
      <ul class="attachment-list">${attachmentsMarkup}</ul>
      <div class="session-card-actions">
        <button data-action="load">Load</button>
        <button data-action="edit" class="ghost-btn">Edit</button>
        <button data-action="delete" class="ghost-btn danger" ${
          session.id === 'default' ? 'disabled' : ''
        }>Delete</button>
      </div>
    `;

    card.querySelector('[data-action="load"]').addEventListener('click', () =>
      setActiveSession(session.id, { focusChat: true })
    );

    card.querySelector('[data-action="edit"]').addEventListener('click', () =>
      populateSessionForm(session)
    );

    const deleteBtn = card.querySelector('[data-action="delete"]');
    deleteBtn.addEventListener('click', async () => {
      if (session.id === 'default') return;
      const confirmed = window.confirm(`Delete session "${session.name}"?`);
      if (!confirmed) return;
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: 'DELETE'
      });
      if (!response.ok && response.status !== 204) {
        throw new Error('Unable to delete session');
      }
      await loadSessions();
      await loadServerHistory(state.activeSessionId);
      renderSessionList();
      renderSessionSelector();
      renderHistoryPage();
      updateSessionInstructionsPreview();
    });

    container.appendChild(card);
  });
}

function attachSessionFormHandlers() {
  const form = document.getElementById('session-form');
  const cancelBtn = document.getElementById('session-form-cancel');

  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const sessionId = formData.get('sessionId');
      const attachments = await collectSessionAttachments(form);
      const payload = {
        name: formData.get('name'),
        instructions: formData.get('instructions')
      };

      if (attachments.length) {
        payload.attachments = attachments;
      }

      const endpoint = sessionId ? `/api/sessions/${sessionId}` : '/api/sessions';
      const method = sessionId ? 'PUT' : 'POST';
      await fetchJson(endpoint, {
        method,
        body: JSON.stringify(payload)
      });

      await loadSessions();
      await loadServerHistory(state.activeSessionId);
      renderSessionList();
      renderSessionSelector();
      renderHistoryPage();
      updateSessionInstructionsPreview();
      resetSessionForm();
    } catch (error) {
      console.error('Failed to save session', error);
    }
  });

  cancelBtn?.addEventListener('click', () => resetSessionForm());
}

async function renderRemotePage(definition) {
  elements.root.innerHTML = '<section class="panel"><p>Loading...</p></section>';
  try {
    const response = await fetch(definition.src);
    const html = await response.text();
    elements.root.innerHTML = html;
    elements.root.querySelectorAll('script').forEach((script) => {
      const clone = document.createElement('script');
      if (script.src) {
        clone.src = script.src;
      } else {
        clone.textContent = script.textContent;
      }
      script.replaceWith(clone);
    });
    notifySettingsSubscribers();
  } catch (error) {
    elements.root.innerHTML = `<section class="panel"><p>Failed to load ${definition.label}</p></section>`;
  }
}

function attachChatHandlers() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const refreshBtn = document.getElementById('refresh-history');
  const clearBtn = document.getElementById('clear-history');
  const errorEl = document.getElementById('chat-error');
  const instructionsPreview = document.getElementById('session-instructions-preview');
  const modelSelector = document.getElementById('model-selector');
  const thinkingToggle = document.getElementById('thinking-toggle');

  renderChatMessages();
  renderSessionSelector();
  renderModelSelector();
  updateSessionInstructionsPreview();
  updateThinkingStatus();

  if (modelSelector) {
    modelSelector.addEventListener('change', (event) => {
      state.settings.model = event.target.value;
      persistClientSettings();
      elements.activeModel.textContent = `model: ${state.settings.model || '—'}`;
      updateThinkingStatus();
    });
  }

  if (thinkingToggle) {
    thinkingToggle.checked = state.thinkingEnabled;
    thinkingToggle.addEventListener('change', (event) => {
      state.thinkingEnabled = event.target.checked;
      persistThinkingPreference(state.thinkingEnabled);
      updateThinkingStatus();
    });
  }

  sendBtn.addEventListener('click', () => sendMessage());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  refreshBtn.addEventListener('click', async () => {
    await loadServerHistory(state.activeSessionId);
    renderChatMessages();
  });

  clearBtn.addEventListener('click', async () => {
    await fetchJson(`/api/history?sessionId=${encodeURIComponent(state.activeSessionId)}`, {
      method: 'DELETE'
    });
    state.sessionHistories[state.activeSessionId] = [];
    state.chat = [];
    state.localHistory[state.activeSessionId] = [];
    persistLocalHistory();
    renderChatMessages();
    renderHistoryPage();
  });

  function setThinking(active) {
    const spinner = document.getElementById('thinking-indicator');
    if (!spinner) return;
    spinner.classList.toggle('active', active);
    sendBtn.disabled = active;
    state.isSending = active;
  }

  async function sendMessage() {
    const message = input.value.trim();
    if (!message || state.isSending) {
      return;
    }

    errorEl.textContent = '';
    input.value = '';
    setThinking(true);
    const liveUser = appendLiveUserMessage(message);
    const liveThinking = appendThinkingMessage();
    const effectiveModel = resolveModelForRequest();
    updateThinkingStatus(effectiveModel);

    try {
      const session = state.sessions.find((item) => item.id === state.activeSessionId);
      const sessionInstructions = session?.instructions?.trim();
      const instructionsToUse =
        sessionInstructions && sessionInstructions.length
          ? sessionInstructions
          : state.settings?.systemInstructions;

      const payload = {
        message,
        model: effectiveModel,
        instructions: instructionsToUse,
        apiEndpoint: state.settings?.apiEndpoint,
        sessionId: state.activeSessionId,
        thinkingEnabled: state.thinkingEnabled
      };

      if (state.thinkingEnabled) {
        await sendThinkingStream(payload, liveThinking, liveUser);
        return;
      }

      const data = await fetchJson('/api/chat', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      state.sessionHistories[state.activeSessionId] = data.history || [];
      state.chat = state.sessionHistories[state.activeSessionId];
      state.localHistory[state.activeSessionId] = data.history || [];
      persistLocalHistory();
      clearLiveEntries();
      renderChatMessages();
      renderHistoryPage();
    } catch (error) {
      errorEl.textContent = error.message || 'Failed to send message';
      if (liveThinking) {
        liveThinking.classList.add('error-entry');
        const thinkingText = liveThinking.querySelector('.thinking-text');
        if (thinkingText) {
          thinkingText.textContent = error.message || 'Something went wrong';
        }
        setTimeout(() => clearLiveEntries(), 2000);
      }
      if (liveUser) {
        setTimeout(() => liveUser.remove(), 2000);
      }
    } finally {
      setThinking(false);
    }
  }

  async function sendThinkingStream(payload, liveThinking, liveUser) {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok || !response.body) {
      throw new Error('Unable to start thinking mode');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let aggregated = '';

    const processEvent = (rawEvent) => {
      if (!rawEvent) return;
      const lines = rawEvent.split('\n');
      const dataLine = lines.find((line) => line.startsWith('data:'));
      if (!dataLine) return;
      const payloadStr = dataLine.replace(/^data:\s*/, '');
      if (!payloadStr) return;
      try {
        const chunk = JSON.parse(payloadStr);
        if (chunk.token) {
          aggregated += chunk.token;
          updateThinkingEntry(liveThinking, aggregated);
        }
        if (chunk.error) {
          throw new Error(chunk.error);
        }
        if (chunk.done) {
          state.sessionHistories[state.activeSessionId] = chunk.history || [];
          state.chat = state.sessionHistories[state.activeSessionId];
          state.localHistory[state.activeSessionId] = chunk.history || [];
          persistLocalHistory();
          clearLiveEntries();
          renderChatMessages();
          renderHistoryPage();
          return true;
        }
      } catch (error) {
        throw new Error(error.message || 'Unable to parse stream');
      }
      return false;
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);
        if (!rawEvent) continue;
        const finished = processEvent(rawEvent);
        if (finished) {
          return;
        }
      }
    }

    if (buffer.trim()) {
      const finished = processEvent(buffer.trim());
      if (finished) {
        return;
      }
    }

    throw new Error('Thinking stream ended unexpectedly');
  }
}

function renderSessionSelector() {
  const select = document.getElementById('session-selector');
  if (!select) return;
  populateSessionOptions(select, state.activeSessionId);
  select.onchange = async (event) => {
    await setActiveSession(event.target.value);
  };
}

function renderModelSelector() {
  const select = document.getElementById('model-selector');
  if (!select) return;
  
  select.innerHTML = '';
  select.disabled = !state.availableModels.length;
  if (!state.availableModels.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No models available';
    option.disabled = true;
    select.appendChild(option);
    return;
  }

  state.availableModels.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.name;
    const sizeGb = (model.size / (1024 * 1024 * 1024)).toFixed(1);
    option.textContent = `${model.name} (${sizeGb} GB)`;
    if (model.name === state.settings?.model) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function resolveModelForRequest() {
  const baseModel = state.settings?.model;
  if (!state.thinkingEnabled || !baseModel) {
    return baseModel;
  }
  const normalizedBase = baseModel.toLowerCase();
  const thinkingCandidate = state.availableModels.find((model) => {
    const normalized = model.name.toLowerCase();
    return (
      normalized.includes('thinking') &&
      (normalized === normalizedBase ||
        normalized.startsWith(`${normalizedBase} `) ||
        normalizedBase.startsWith(normalized.replace(' thinking', '')))
    );
  });
  return thinkingCandidate ? thinkingCandidate.name : baseModel;
}

// Change the active session locally and on the server so prompts + history stay scoped.
async function setActiveSession(sessionId, options = {}) {
  if (!sessionId) {
    return;
  }

  const changed = sessionId !== state.activeSessionId;
  state.activeSessionId = sessionId;
  state.historySessionId = sessionId;
  persistActiveSession();

  try {
    await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/select`, {
      method: 'POST'
    });
  } catch (error) {
    console.warn('Unable to persist active session on server', error);
  }

  if (changed) {
    await loadServerHistory(sessionId);
  }

  renderSessionSelector();
  updateSessionInstructionsPreview();
  renderChatMessages();
  renderHistoryPage();
  notifySettingsSubscribers();

  if (options.focusChat) {
    state.currentPage = 'chat';
    renderNav();
    renderPage('chat');
  }
}

function updateSessionInstructionsPreview() {
  const previewEl = document.getElementById('session-instructions-preview');
  if (!previewEl) return;
  const session = state.sessions.find((item) => item.id === state.activeSessionId);
  if (!session) {
    previewEl.textContent = '';
    return;
  }

  const attachmentsCount = session.attachments?.length || 0;
  const previewText = session.instructions
    ? session.instructions.trim().slice(0, 140) + (session.instructions.length > 140 ? '…' : '')
    : 'No custom instructions';
  previewEl.textContent = `${previewText} • ${attachmentsCount} attachment${attachmentsCount === 1 ? '' : 's'}`;
}

function updateThinkingStatus(effectiveModel = resolveModelForRequest()) {
  const status = document.getElementById('thinking-status');
  if (!status) return;
  if (!state.thinkingEnabled) {
    status.classList.remove('active');
    status.textContent = 'Thinking mode off';
    return;
  }
  status.classList.add('active');
  if (effectiveModel && effectiveModel !== state.settings?.model) {
    status.textContent = `Thinking with ${effectiveModel}`;
  } else if (effectiveModel) {
    status.textContent = `Thinking with ${effectiveModel} (live stream)`;
  } else {
    status.textContent = 'Thinking enabled (no model selected)';
  }
}

function renderChatMessages() {
  const container = document.getElementById('chat-history');
  if (!container) return;
  clearLiveEntries();
  container.innerHTML = '';

  const sessionId = state.activeSessionId;
  const history =
    (state.sessionHistories[sessionId] && state.sessionHistories[sessionId].length
      ? state.sessionHistories[sessionId]
      : state.localHistory[sessionId]) || [];

  if (!history || !history.length) {
    container.innerHTML = '<p class="muted">No messages yet. Start the conversation!</p>';
    return;
  }

  history.forEach((entry) => {
    const wrapper = document.createElement('article');
    wrapper.className = 'chat-entry assistant';
    wrapper.innerHTML = `
      <header>
        <strong>${entry.user || 'User'}</strong>
        <span>${new Date(entry.timestamp || Date.now()).toLocaleTimeString()}</span>
      </header>
      <p><strong>Q:</strong> ${entry.user || ''}</p>
      <p><strong>A:</strong> ${entry.assistant || ''}</p>
    `;
    container.appendChild(wrapper);
  });

  container.scrollTop = container.scrollHeight;
}

function clearLiveEntries() {
  document.querySelectorAll('.live-entry').forEach((node) => node.remove());
}

function appendLiveUserMessage(content) {
  const container = document.getElementById('chat-history');
  if (!container) return null;
  const article = document.createElement('article');
  article.className = 'chat-entry live-entry';
  article.innerHTML = `
    <header>
      <strong>You</strong>
      <span>${new Date().toLocaleTimeString()}</span>
    </header>
    <p><strong>Q:</strong> ${content}</p>
  `;
  container.appendChild(article);
  container.scrollTop = container.scrollHeight;
  return article;
}

function appendThinkingMessage() {
  const container = document.getElementById('chat-history');
  if (!container) return null;
  const article = document.createElement('article');
  article.className = 'chat-entry assistant live-entry thinking-entry';
  article.innerHTML = `
    <header>
      <strong>Assistant</strong>
      <span>${new Date().toLocaleTimeString()}</span>
    </header>
    <p><strong>A:</strong>
      <span class="typing-dots"><span></span><span></span><span></span></span>
      <span class="thinking-text">Thinking…</span>
    </p>
  `;
  container.appendChild(article);
  container.scrollTop = container.scrollHeight;
  return article;
}

function updateThinkingEntry(entry, text) {
  if (!entry) return;
  const dots = entry.querySelector('.typing-dots');
  if (dots) {
    dots.style.display = text ? 'none' : 'inline-flex';
  }
  const thinkingText = entry.querySelector('.thinking-text');
  if (thinkingText) {
    thinkingText.textContent = text || 'Thinking…';
  }
}

function attachSettingsHandlers() {
  const form = document.getElementById('settings-form');
  const customPageForm = document.getElementById('custom-page-form');
  const list = document.getElementById('custom-page-list');
  const proxyForm = document.getElementById('proxy-form');
  const proxyOutput = document.getElementById('proxy-response');

  populateSettingsForm(form);
  renderCustomPages(list);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    payload.maxHistory = Number(payload.maxHistory);

    payload.backendBaseUrl =
      payload.backendBaseUrl && payload.backendBaseUrl.trim()
        ? normalizeBaseUrl(payload.backendBaseUrl)
        : state.settings?.backendBaseUrl || FALLBACK_BASE_URL;

    try {
      const data = await fetchJson('/api/settings', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      state.settings = {
        ...data.current,
        backendBaseUrl: normalizeBaseUrl(data.current.backendBaseUrl)
      };
      state.baseUrl = state.settings.backendBaseUrl;
      applyTheme(state.settings.theme);
      persistClientSettings();
      notifySettingsSubscribers();
      elements.activeModel.textContent = `model: ${state.settings.model}`;
      await loadAvailableModels();
      renderModelSelector();
    } catch (error) {
      console.error('Failed to save settings', error);
    }
  });

  customPageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(customPageForm);
    const label = formData.get('label');
    const url = formData.get('url');
    const id = label.toLowerCase().replace(/\s+/g, '-');

    state.customPages.push({ id, label, src: url });
    persistCustomPages();
    renderCustomPages(list);
    renderNav();
    customPageForm.reset();
  });

  proxyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    proxyOutput.textContent = 'Sending...';
    const formData = new FormData(proxyForm);
    const payloadRaw = formData.get('payload');
    let payload;

    if (payloadRaw) {
      try {
        payload = JSON.parse(payloadRaw);
      } catch (error) {
        proxyOutput.textContent = 'Invalid JSON payload';
        return;
      }
    }

    const proxyBody = {
      url: formData.get('url'),
      method: formData.get('method') || 'GET',
      payload
    };

    try {
      const response = await fetch(buildUrl('/api/proxy'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyBody)
      });
      const text = await response.text();
      proxyOutput.textContent = text || '(empty response)';
    } catch (error) {
      proxyOutput.textContent = error.message || 'Proxy failed';
    }
  });
}

function renderCustomPages(list) {
  list.innerHTML = '';
  state.customPages.forEach((page, index) => {
    const item = document.createElement('li');
    item.innerHTML = `
      <span>${page.label} &mdash; ${page.src}</span>
      <button data-index="${index}" class="ghost-btn">Remove</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      state.customPages.splice(index, 1);
      persistCustomPages();
      renderCustomPages(list);
      renderNav();
    });
    list.appendChild(item);
  });
}

function populateSettingsForm(form) {
  if (!state.settings) return;
  form.elements.model.value = state.settings.model;
  form.elements.apiEndpoint.value = state.settings.apiEndpoint;
  form.elements.backendBaseUrl.value = state.settings.backendBaseUrl || FALLBACK_BASE_URL;
  form.elements.theme.value = state.settings.theme;
  form.elements.maxHistory.value = state.settings.maxHistory;
  form.elements.systemInstructions.value = state.settings.systemInstructions;
}

function renderHistoryPage() {
  const serverList = document.getElementById('server-history');
  const localList = document.getElementById('local-history');
  const select = document.getElementById('history-session-select');

  if (!serverList || !localList) return;

  const selectedId = state.historySessionId || state.activeSessionId;

  if (select) {
    populateSessionOptions(select, selectedId);
    select.onchange = async (event) => {
      state.historySessionId = event.target.value;
      await loadServerHistory(state.historySessionId);
      renderHistoryPage();
    };
  }

  const sessionId = state.historySessionId || state.activeSessionId;
  const serverEntries = state.sessionHistories[sessionId] || [];
  const localEntries = state.localHistory[sessionId] || [];

  serverList.innerHTML = '';
  localList.innerHTML = '';

  if (!serverEntries.length) {
    serverList.innerHTML = '<p class="muted">No server history for this session.</p>';
  } else {
    serverEntries.forEach((entry) => serverList.appendChild(historyCard(entry)));
  }

  if (!localEntries.length) {
    localList.innerHTML = '<p class="muted">No local history cached.</p>';
  } else {
    localEntries.forEach((entry) => localList.appendChild(historyCard(entry)));
  }
}

function historyCard(entry) {
  const article = document.createElement('article');
  article.className = 'history-item';
  article.innerHTML = `
    <h4>${new Date(entry.timestamp || Date.now()).toLocaleString()}</h4>
    <p><strong>User:</strong> ${entry.user || ''}</p>
    <p><strong>Assistant:</strong> ${entry.assistant || ''}</p>
    <p class="muted">${entry.model || ''}</p>
  `;
  return article;
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch (_) {
    return value;
  }
}

function populateSessionOptions(select, selectedId) {
  if (!select) return;
  const sessions = state.sessions.length
    ? state.sessions
    : [{ id: state.activeSessionId || 'default', name: 'Default Session', attachments: [] }];

  select.innerHTML = sessions
    .map(
      (session) =>
        `<option value="${session.id}">${session.name}${
          session.id === state.activeSessionId ? ' (active)' : ''
        }</option>`
    )
    .join('');

  const targetValue =
    selectedId && sessions.find((session) => session.id === selectedId)
      ? selectedId
      : sessions[0]?.id;
  if (targetValue) {
    select.value = targetValue;
  }
}

async function collectSessionAttachments(form) {
  const attachments = [];
  const textInput = form.elements.attachmentText;
  const trimmed = textInput?.value?.trim();
  if (trimmed) {
    attachments.push({
      name: 'Custom text',
      type: 'text',
      content: trimmed
    });
  }

  const fileInput = form.querySelector('#session-files');
  if (fileInput && fileInput.files?.length) {
    for (const file of fileInput.files) {
      const content = await readFileAsText(file);
      attachments.push({
        name: file.name,
        type: 'file',
        content
      });
    }
  }

  return attachments;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function resetSessionForm() {
  const form = document.getElementById('session-form');
  if (!form) return;
  form.reset();
  form.elements.sessionId.value = '';
  const title = document.getElementById('session-form-title');
  const submit = document.getElementById('session-form-submit');
  if (title) title.textContent = 'Create Session';
  if (submit) submit.textContent = 'Save session';
}

function populateSessionForm(session) {
  const form = document.getElementById('session-form');
  if (!form || !session) return;
  form.elements.sessionId.value = session.id;
  form.elements.name.value = session.name || '';
  form.elements.instructions.value = session.instructions || '';
  if (form.elements.attachmentText) {
    form.elements.attachmentText.value = '';
  }
  const title = document.getElementById('session-form-title');
  const submit = document.getElementById('session-form-submit');
  if (title) title.textContent = `Edit Session (${session.name})`;
  if (submit) submit.textContent = 'Update session';
}

async function fetchJson(path, options = {}) {
  const init = { ...options };
  init.headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const target = buildUrl(path);
  const response = await fetch(target, init);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  return response.json();
}

function buildUrl(path) {
  const base = state.baseUrl || window.location.origin + '/';

  if (path.startsWith('http')) {
    return path;
  }

  const normalizedBase = normalizeBaseUrl(base);
  return `${normalizedBase}${path.replace(/^\//, '')}`;
}

function normalizeBaseUrl(url) {
  const fallback = FALLBACK_BASE_URL;
  if (!url) return fallback;
  try {
    const parsed = new URL(url, fallback);
    const normalized = parsed.toString();
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  } catch (_error) {
    return fallback;
  }
}

function applyTheme(theme) {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function loadLocalHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { default: parsed };
    }
    return parsed;
  } catch (_) {
    return {};
  }
}

function persistLocalHistory() {
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(state.localHistory));
}

function loadCustomPages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pages);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function persistCustomPages() {
  localStorage.setItem(STORAGE_KEYS.pages, JSON.stringify(state.customPages));
}

function persistClientSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
}

function restoreClientSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (raw) {
      state.settings = JSON.parse(raw);
      state.settings.backendBaseUrl = normalizeBaseUrl(state.settings.backendBaseUrl);
      state.baseUrl = state.settings.backendBaseUrl;
      applyTheme(state.settings.theme);
    }
  } catch (_) {
    // ignore
  }
}

function notifySettingsSubscribers() {
  window.appState = state;
  if (state.settings) {
    window.dispatchEvent(new CustomEvent('ollama-settings', { detail: state.settings }));
  }
  window.dispatchEvent(new CustomEvent('ollama-state', { detail: state }));
}

function persistActiveSession() {
  try {
    localStorage.setItem('ollama-active-session', state.activeSessionId || 'default');
  } catch (_) {
    // ignore
  }
}

function loadActiveSessionPreference() {
  try {
    return localStorage.getItem('ollama-active-session');
  } catch (_) {
    return null;
  }
}

function persistThinkingPreference(value) {
  try {
    localStorage.setItem(THINKING_PREF_KEY, JSON.stringify(Boolean(value)));
  } catch (_) {
    // ignore
  }
}

function loadThinkingPreference() {
  try {
    const raw = localStorage.getItem(THINKING_PREF_KEY);
    return raw ? JSON.parse(raw) === true : false;
  } catch (_) {
    return false;
  }
}


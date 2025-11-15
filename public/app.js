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
  pages: 'ollama-web-custom-pages',
  thinking: 'ollama-web-thinking-enabled',
  activeSession: 'ollama-web-active-session',
  instructionPresets: 'ollama-web-instruction-presets'
};

const THINKING_PREF_KEY = STORAGE_KEYS.thinking;
const THINKING_ABORT_KEYWORDS = [
  'operation was aborted',
  'user aborted',
  'network connection was lost',
  'pipe is being closed'
];

const FALLBACK_BASE_URL = window.location.origin + '/';

// Default navigation stack. Additional HTML pages can be appended at runtime via the Custom Pages form.
const defaultPages = [
  { id: 'chat', label: 'Chat', type: 'component', template: 'chat-page' },
  { id: 'sessions', label: 'Sessions', type: 'component', template: 'sessions-page' },
  { id: 'settings', label: 'Settings', type: 'component', template: 'settings-page' },
  { id: 'history', label: 'History', type: 'component', template: 'history-page' },
  { id: 'api', label: 'API', type: 'component', template: 'api-page' },
  { id: 'model-info', label: 'Model Info', type: 'remote', src: '/pages/model-info.html' }
];

const QUICK_ACTIONS = [
  {
    id: 'qa-summary',
    label: 'Summarize last reply',
    prompt: "Summarize the assistant's last response and list the next concrete steps."
  },
  {
    id: 'qa-clarify',
    label: 'Ask for clarity',
    prompt: 'Clarify the current requirements and note any missing details before coding.'
  },
  {
    id: 'qa-review',
    label: 'Review session plan',
    prompt: "Review this session's instructions and highlight potential risks or blockers."
  },
  {
    id: 'qa-compare',
    label: 'Compare models',
    prompt: 'Compare the available models and recommend the best choice for this task.'
  }
];

const state = {
  currentPage: 'chat',
  chat: [],
  sessionHistories: {},
  localHistory: loadLocalHistory(),
  settings: null,
  baseUrl: FALLBACK_BASE_URL,
  customPages: loadCustomPages(),
  sessionSendingStates: {}, // Track sending state per session
  sessions: [],
  activeSessionId: loadActiveSessionPreference(),
  historySessionId: null,
  editingSessionId: null,
  apiKeys: [],
  lastGeneratedSecret: null,
  availableModels: [],
  thinkingEnabled: loadThinkingPreference(),
  instructionPresets: loadInstructionPresets()
};

let instructionPresetControlRegistry = [];
let presetRefreshPromise = null;

window.appState = state;

// Global navigation function for back buttons
window.navigateToPage = function(pageId) {
  state.currentPage = pageId;
  renderNav();
  renderPage(pageId);
};

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

  // Setup cloud synchronization
  setupAutoSync();
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
    state.instructionPresets = normalizeInstructionPresets(
      data.presets,
      data.defaults?.systemInstructions || data.current?.systemInstructions
    );
    persistInstructionPresets(state.instructionPresets);
    refreshInstructionPresetControls();
    const normalizedBase = normalizeBaseUrl(data.current?.backendBaseUrl);
    state.settings = {
      ...data.current,
      backendBaseUrl: normalizedBase
    };
    state.baseUrl = normalizedBase;
    applyTheme(state.settings.theme);
    persistClientSettings();
    notifySettingsSubscribers();
    if (elements.status) {
      elements.status.textContent = 'online';
      elements.status.classList.remove('badge-offline');
      elements.status.classList.add('badge-online');
    }
    if (elements.activeModel) {
      elements.activeModel.textContent = `model: ${state.settings.model}`;
    }
  } catch (error) {
    console.error('Error in bootstrapSettings:', error);
    if (elements.status) {
      elements.status.textContent = 'offline';
      elements.status.classList.remove('badge-online');
      elements.status.classList.add('badge-offline');
    }
    if (elements.activeModel) {
      elements.activeModel.textContent = 'model: —';
    }
    restoreClientSettings();
    if (!state.instructionPresets || !state.instructionPresets.length) {
      state.instructionPresets = loadInstructionPresets();
    }
    refreshInstructionPresetControls();
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
    const incoming = Array.isArray(data.sessions) ? data.sessions : [];
    const deduped = [];
    const seen = new Set();
    for (let index = incoming.length - 1; index >= 0; index -= 1) {
      const session = incoming[index];
      if (!session?.id) {
        continue;
      }
      if (seen.has(session.id)) {
        continue;
      }
      seen.add(session.id);
      deduped.unshift(session);
    }
    state.sessions = deduped;
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
    // Update connection status to offline if there's a connection error
    if (error.message && (error.message.includes('connect') || error.message.includes('fetch') || error.message.includes('offline'))) {
      elements.status.textContent = 'offline';
      elements.status.classList.remove('badge-online');
      elements.status.classList.add('badge-offline');
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
    console.error('Failed to load available models', error);
    state.availableModels = [];
    // Update connection status to offline if there's a connection error
    if (error.message && (error.message.includes('connect') || error.message.includes('fetch') || error.message.includes('offline'))) {
      elements.status.textContent = 'offline';
      elements.status.classList.remove('badge-online');
      elements.status.classList.add('badge-offline');
    }
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
    // Update connection status to offline if there's a connection error
    if (error.message && (error.message.includes('connect') || error.message.includes('fetch') || error.message.includes('offline'))) {
      elements.status.textContent = 'offline';
      elements.status.classList.remove('badge-online');
      elements.status.classList.add('badge-offline');
    }
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
    // Update connection status to offline if there's a connection error
    if (error.message && (error.message.includes('connect') || error.message.includes('fetch') || error.message.includes('offline'))) {
      elements.status.textContent = 'offline';
      elements.status.classList.remove('badge-online');
      elements.status.classList.add('badge-offline');
    }
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
  // Skip if nav element doesn't exist (ultra-modern layout doesn't use top nav)
  if (!elements.nav) return;

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

  setupInstructionPresetControls({
    selectId: 'session-instruction-preset-select',
    applyButtonId: 'session-instruction-preset-apply',
    descriptionId: 'session-instruction-preset-description',
    targetField: form.elements?.instructions
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const sessionId = formData.get('sessionId');
      const attachments = await collectSessionAttachments(form);
      const instructions = formData.get('instructions');
      const payload = {
        name: formData.get('name'),
        instructions
      };

      // Check if a preset was applied via the apply button
      const selectedPresetId = form.dataset.selectedPresetId;
      if (selectedPresetId) {
        const preset = findInstructionPresetById(selectedPresetId);
        // Only include presetId if instructions match the preset
        if (preset && normalizeInstructionText(instructions) === normalizeInstructionText(preset.instructions)) {
          payload.presetId = selectedPresetId;
        }
      }

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

  // Re-query status elements now that template is rendered
  elements.status = document.getElementById('connection-status');
  elements.activeModel = document.getElementById('active-model');

  // Update status display with current state
  if (elements.status && state.settings?.model) {
    elements.status.textContent = 'online';
    elements.status.classList.remove('badge-offline');
    elements.status.classList.add('badge-online');
  }
  if (elements.activeModel && state.settings?.model) {
    elements.activeModel.textContent = `model: ${state.settings.model}`;
  }

  // Initialize theme system
  initializeThemeSystem();

  // Initialize structured prompt toggle
  initializeStructuredPromptToggle();
  const instructionsPreview = document.getElementById('session-instructions-preview');
  const modelSelector = document.getElementById('model-selector');
  const thinkingToggle = document.getElementById('thinking-toggle');
  const newChatBtn = document.getElementById('new-chat-btn');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarToggleMobile = document.getElementById('sidebar-toggle-mobile');
  const chatSidebar = document.getElementById('chat-sidebar');
  const chatMenuBtn = document.getElementById('chat-menu-btn');
  const chatMenu = document.getElementById('chat-menu');

  renderChatMessages();
  renderSessionSelector();
  renderModelSelector();
  updateSessionInstructionsPreview();
  updatePresetIndicator();
  updateThinkingStatus();
  setupChatInstructionPresetControl();
  renderChatSessionsList();
  renderAiDisclosure();
  renderQuickActions();

  if (modelSelector) {
    modelSelector.addEventListener('change', (event) => {
      state.settings.model = event.target.value;
      persistClientSettings();
      elements.activeModel.textContent = `model: ${state.settings.model || '—'}`;
      updateThinkingStatus();
      renderAiDisclosure();
    });
  }

  // Thinking is now always enabled - no toggle needed
  state.thinkingEnabled = true;
  if (thinkingToggle) {
    // Hide the toggle since thinking is always on
    thinkingToggle.checked = true;
    thinkingToggle.disabled = true;
    const toggleParent = thinkingToggle.closest('.setting-group-ultra');
    if (toggleParent) {
      toggleParent.style.display = 'none';
    }
  }

  // AI Coder enhancement toggle
  const aiCoderToggle = document.getElementById('ai-coder-toggle');
  if (aiCoderToggle) {
    // Load saved preference (default to TRUE - enabled by default with new improved version)
    const aiCoderDefault = state.settings?.aiCoderEnabled !== false; // Default enabled
    aiCoderToggle.checked = aiCoderDefault;
    state.settings.aiCoderEnabled = aiCoderDefault;

    aiCoderToggle.addEventListener('change', (event) => {
      state.settings.aiCoderEnabled = event.target.checked;
      persistClientSettings();
      const status = event.target.checked ? 'enabled' : 'disabled';
      const features = event.target.checked ? '(spell-check + smart prompts)' : '';
      showNotification(`✨ AI Coder ${status} ${features}`, 'info', 2000);
      console.log('[DEBUG] AI Coder enhancement:', status);
    });
  }

  sendBtn.addEventListener('click', () => sendMessage());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
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
    if (chatMenu) chatMenu.style.display = 'none';
  });

  // New chat button
  if (newChatBtn) {
    newChatBtn.addEventListener('click', async () => {
      await createNewChat();
    });
  }

  // Sidebar toggle
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      if (chatSidebar) {
        chatSidebar.classList.toggle('collapsed');
      }
    });
  }

  if (sidebarToggleMobile) {
    sidebarToggleMobile.addEventListener('click', () => {
      if (chatSidebar) {
        chatSidebar.classList.toggle('open');
      }
    });
  }

  // Chat menu toggle
  if (chatMenuBtn && chatMenu) {
    chatMenuBtn.addEventListener('click', () => {
      chatMenu.style.display = chatMenu.style.display === 'none' ? 'block' : 'none';
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (chatMenu && chatMenuBtn && !chatMenu.contains(e.target) && !chatMenuBtn.contains(e.target)) {
        chatMenu.style.display = 'none';
      }
    });
  }

  // Settings modal handlers for ultra-modern layout
  const settingsBtn = document.getElementById('settings-btn-ultra');
  const settingsModal = document.getElementById('settings-modal-ultra');
  const closeSettingsBtn = document.getElementById('close-settings-ultra');

  function initializeSettingsModal() {
    // Populate model selector
    renderModelSelector();

    // Update connection status
    const connectionStatus = document.getElementById('connection-status');
    if (connectionStatus) {
      if (elements.status && elements.status.textContent === 'online') {
        connectionStatus.textContent = 'Connected';
        connectionStatus.className = 'status-badge-ultra status-online';
      } else {
        connectionStatus.textContent = 'Offline';
        connectionStatus.className = 'status-badge-ultra status-offline';
      }
    }

    // Setup instruction preset controls
    const presetSelect = document.getElementById('chat-instruction-preset-select');
    if (presetSelect) {
      const presets = getInstructionPresetCatalog();
      presetSelect.innerHTML = '<option value="">Custom / manual</option>' +
        presets.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
    }

    // Update active model display
    const activeModelDisplay = document.getElementById('active-model');
    if (activeModelDisplay) {
      activeModelDisplay.textContent = state.settings?.model || '—';
    }

    // Initialize GitHub controls
    initializeGitHubControls();
  }

  function initializeGitHubControls() {
    const tokenInput = document.getElementById('github-token-input');
    const repoInput = document.getElementById('github-repo-input');
    const connectBtn = document.getElementById('github-connect-btn');
    const statusDiv = document.getElementById('github-status');
    const statusText = document.getElementById('github-status-text');
    const reposList = document.getElementById('github-repos-list');
    const reposEmpty = document.getElementById('github-repos-empty');

    // Load saved token from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('github-token') || '""');
      if (tokenInput && saved) tokenInput.value = saved;
    } catch (e) {
      console.error('Failed to load GitHub token:', e);
    }

    // Load and display connected repositories
    async function loadRepositories() {
      try {
        const response = await fetchJson('/api/github/repos');
        const repos = response.repos || [];

        if (repos.length === 0) {
          reposList.style.display = 'none';
          reposEmpty.style.display = 'block';
        } else {
          reposList.style.display = 'block';
          reposEmpty.style.display = 'none';
          renderRepositories(repos);
        }
      } catch (error) {
        console.error('Failed to load repositories:', error);
      }
    }

    function renderRepositories(repos) {
      reposList.innerHTML = repos.map(repo => `
        <div class="github-repo-item" data-repo-id="${repo.id}">
          <div class="github-repo-info">
            <div class="github-repo-name">${repo.name}</div>
            <div class="github-repo-meta">${repo.fileCount} files · Connected ${new Date(repo.connectedAt).toLocaleDateString()}</div>
          </div>
          <div class="github-repo-actions">
            <button class="github-repo-remove" data-repo-id="${repo.id}" title="Remove repository">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      `).join('');

      // Attach remove handlers
      reposList.querySelectorAll('.github-repo-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const repoId = e.currentTarget.dataset.repoId;
          if (confirm('Remove this repository?')) {
            try {
              await fetchJson(`/api/github/repos/${repoId}`, { method: 'DELETE' });
              await loadRepositories();
            } catch (error) {
              alert('Failed to remove repository: ' + error.message);
            }
          }
        });
      });
    }

    if (connectBtn) {
      connectBtn.addEventListener('click', async () => {
        const token = tokenInput?.value.trim();
        const repo = repoInput?.value.trim();

        if (!token || !repo) {
          alert('Please enter both GitHub token and repository');
          return;
        }

        connectBtn.disabled = true;
        connectBtn.textContent = 'Adding...';
        statusDiv.style.display = 'block';
        statusText.textContent = 'Fetching repository files...';

        try {
          const response = await fetchJson('/api/github/connect', {
            method: 'POST',
            body: JSON.stringify({ token, repo })
          });

          // Save token to localStorage for future use
          localStorage.setItem('github-token', JSON.stringify(token));

          statusText.textContent = `✓ Added ${response.repo} with ${response.count} files!`;
          statusText.style.color = 'var(--success)';

          // Clear repo input
          if (repoInput) repoInput.value = '';

          // Reload repositories list
          await loadRepositories();

          // Hide status after 3 seconds
          setTimeout(() => {
            statusDiv.style.display = 'none';
          }, 3000);

        } catch (error) {
          console.error('GitHub connection failed:', error);
          statusText.textContent = '✗ Failed: ' + error.message;
          statusText.style.color = 'var(--error)';
        } finally {
          connectBtn.disabled = false;
          connectBtn.textContent = 'Add Repository';
        }
      });
    }

    // Load repositories on init
    loadRepositories();
  }

  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'flex';
      initializeSettingsModal();
    });
  }

  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });

    // Close modal when clicking backdrop
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
      }
    });
  }

  // Navigation handlers for ultra-modern layout
  const navSessionsBtn = document.getElementById('nav-sessions-ultra');
  const navHistoryBtn = document.getElementById('nav-history-ultra');
  const navApiBtn = document.getElementById('nav-api-ultra');

  if (navSessionsBtn) {
    navSessionsBtn.addEventListener('click', () => {
      // Navigate to sessions page
      state.currentPage = 'sessions';
      renderNav();
      renderPage('sessions');
    });
  }

  if (navHistoryBtn) {
    navHistoryBtn.addEventListener('click', () => {
      // Navigate to history page
      state.currentPage = 'history';
      renderNav();
      renderPage('history');
    });
  }

  if (navApiBtn) {
    navApiBtn.addEventListener('click', () => {
      // Navigate to API page
      state.currentPage = 'api';
      renderNav();
      renderPage('api');
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await loadServerHistory(state.activeSessionId);
      renderChatMessages();
      if (chatMenu) chatMenu.style.display = 'none';
    });
  }

  function setThinking(active, sessionId = state.activeSessionId) {
    const spinner = document.getElementById('thinking-indicator');
    if (!spinner) return;
    spinner.classList.toggle('active', active);
    // Only disable send button if THIS session is sending
    const isThisSessionSending = state.sessionSendingStates[state.activeSessionId];
    sendBtn.disabled = isThisSessionSending;
    state.sessionSendingStates[sessionId] = active;
  }

  async function sendMessage() {
    const message = input.value.trim();
    const currentSessionId = state.activeSessionId;
    const isSessionSending = state.sessionSendingStates[currentSessionId];

    if (!message || isSessionSending) {
      return;
    }

    errorEl.textContent = '';
    input.value = '';
    setThinking(true, currentSessionId);
    // CRITICAL: Display original message, not enhanced version
    const originalMessage = message;
    const liveUser = appendLiveUserMessage(originalMessage);
    const liveThinking = appendThinkingMessage();
    const effectiveModel = resolveModelForRequest();
    updateThinkingStatus(effectiveModel);

    try {
      const sessionsArray = Array.isArray(state.sessions) ? state.sessions : [];
      const session = sessionsArray.find((item) => item.id === state.activeSessionId);
      const sessionInstructions = session?.instructions?.trim();
      const instructionsToUse =
        sessionInstructions && sessionInstructions.length
          ? sessionInstructions
          : state.settings?.systemInstructions;

      // Enhance message for AI coding if enabled
      let processedMessage = enhanceAICoderPrompt(message);
      processedMessage = addXMLStructurePrompt(processedMessage);

      const payload = {
        message: originalMessage, // Original for storage
        enhancedMessage: processedMessage, // Enhanced for AI
        useEnhanced: true,
        model: effectiveModel,
        instructions: instructionsToUse,
        apiEndpoint: state.settings?.apiEndpoint,
        sessionId: state.activeSessionId,
        thinkingEnabled: state.thinkingEnabled
      };

      let triedThinkingStream = false;
      let thinkingStreamFailed = false;
      if (state.thinkingEnabled) {
        const thinkingReady = await ensureThinkingPrerequisites();
        if (thinkingReady) {
          triedThinkingStream = true;
          console.log('[DEBUG] Using thinking stream with model:', effectiveModel);
          try {
            await sendThinkingStream(payload, liveThinking, liveUser);
            return;
          } catch (streamError) {
            console.warn('[WARN] Thinking stream failed, falling back to standard chat:', streamError);
            thinkingStreamFailed = true;
            showThinkingStatusError(streamError.message || 'Thinking stream failed');
          const fallbackMessage = buildThinkingFallbackMessage(streamError);
          updateThinkingEntry(liveThinking, fallbackMessage);
          }
        } else {
          thinkingStreamFailed = true;
          errorEl.textContent =
            errorEl.textContent ||
            'Thinking mode requires a reachable Ollama model list. Falling back to standard response.';
        }
      }

      console.log('[DEBUG] Using standard chat with model:', effectiveModel, 'stream fallback:', triedThinkingStream);

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
      console.error('Error sending message:', error);
      const errorMessage = error.message || 'Failed to send message';
      errorEl.textContent = errorMessage;

      // Update UI elements to reflect the error
      if (liveThinking) {
        liveThinking.classList.add('error-entry');
        const thinkingText = liveThinking.querySelector('.thinking-text');
        if (thinkingText) {
          thinkingText.textContent = errorMessage;
        }
        setTimeout(() => clearLiveEntries(), 2000);
      }
      if (liveUser) {
        setTimeout(() => liveUser.remove(), 2000);
      }

      // Update connection status if this is a connection error
      if (errorMessage.includes('connect') || errorMessage.includes('fetch') ||
          errorMessage.includes('offline') || errorMessage.includes('Cannot connect')) {
        elements.status.textContent = 'offline';
        elements.status.classList.remove('badge-online');
        elements.status.classList.add('badge-offline');
        elements.activeModel.textContent = 'model: —';
      }
    } finally {
      setThinking(false, currentSessionId);
    }
  }

  async function sendThinkingStream(payload, liveThinking, liveUser) {
    console.log('[DEBUG] Starting SSE stream to:', buildUrl('/api/chat/stream'));
    const response = await fetch(buildUrl('/api/chat/stream'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('[DEBUG] SSE response status:', response.status, response.ok);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Unable to start thinking mode (status ${response.status})`);
    }
    if (!response.body) {
      throw new Error('Unable to start thinking mode (empty stream)');
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
          console.log('[DEBUG] Token received:', chunk.token, 'Total:', aggregated.length);
          updateThinkingEntry(liveThinking, aggregated);
        }
        if (chunk.error) {
          throw new Error(chunk.error);
        }
        if (chunk.done) {
          // Finalize the thinking entry with the response
          if (liveThinking && chunk.response) {
            finalizeThinkingEntry(liveThinking, aggregated, chunk.response);
          }

          // Remove user live entry only
          if (liveUser) {
            liveUser.remove();
          }

          state.sessionHistories[state.activeSessionId] = chunk.history || [];
          state.chat = state.sessionHistories[state.activeSessionId];
          state.localHistory[state.activeSessionId] = chunk.history || [];
          persistLocalHistory();
          renderHistoryPage();
          return true;
        }
      } catch (error) {
        throw new Error(error.message || 'Unable to parse stream');
      }
      return false;
    };

    try {
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
    } catch (streamError) {
      if (reader?.cancel) {
        try {
          await reader.cancel();
        } catch (_) {
          // ignore
        }
      }
      throw streamError;
    } finally {
      if (reader?.releaseLock) {
        try {
          reader.releaseLock();
        } catch (_) {
          // ignore
        }
      }
    }

    throw new Error('Thinking stream ended unexpectedly');
  }
}

function normalizeThinkingErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') {
    return error;
  }
  return error?.message || '';
}

function isAbortLikeThinkingError(error) {
  const message = normalizeThinkingErrorMessage(error).toLowerCase();
  if (!message) return false;
  return THINKING_ABORT_KEYWORDS.some((keyword) => message.includes(keyword));
}

function buildThinkingFallbackMessage(error) {
  const session = state.sessions.find((item) => item.id === state.activeSessionId);
  const presetInfo = session?.presetId ? ` [Preset: ${session.presetId}]` : '';

  if (isAbortLikeThinkingError(error)) {
    return `Thinking stream was interrupted by the browser${presetInfo}. Switching to standard response…`;
  }
  const detail = normalizeThinkingErrorMessage(error);
  if (!detail) {
    return `Thinking stream unavailable${presetInfo}. Retrying without live updates…`;
  }
  return `Thinking stream unavailable (${detail})${presetInfo}. Retrying without live updates…`;
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
  renderAiDisclosure();

  if (options.focusChat) {
    state.currentPage = 'chat';
    renderNav();
    renderPage('chat');
  }
}

function updateSessionInstructionsPreview() {
  const previewEl = document.getElementById('session-instructions-preview');
  if (!previewEl) return;
  const sessionsArray = Array.isArray(state.sessions) ? state.sessions : [];
  const session = sessionsArray.find((item) => item.id === state.activeSessionId);
  if (!session) {
    previewEl.textContent = '';
    previewEl.hidden = true;
    renderAiDisclosure();
    return;
  }

  const attachmentsCount = session.attachments?.length || 0;
  const previewText = session.instructions
    ? session.instructions.trim().slice(0, 140) + (session.instructions.length > 140 ? '…' : '')
    : 'No custom instructions';
  previewEl.textContent = `${previewText} • ${attachmentsCount} attachment${attachmentsCount === 1 ? '' : 's'}`;
  previewEl.hidden = !session.instructions;
  renderAiDisclosure();
}

function updatePresetIndicator() {
  const indicator = document.getElementById('preset-indicator');
  if (!indicator) return;

  const sessionsArray = Array.isArray(state.sessions) ? state.sessions : [];
  const session = sessionsArray.find((item) => item.id === state.activeSessionId);

  if (!session || !session.presetId) {
    indicator.textContent = 'Custom';
    indicator.className = 'preset-indicator custom';
    return;
  }

  const preset = state.instructionPresets.find(p => p.id === session.presetId);
  if (preset) {
    indicator.textContent = preset.label;
    indicator.className = 'preset-indicator';
    if (preset.id === 'ai-coder-prompt') {
      indicator.classList.add('ai-coder');
    }
  } else {
    indicator.textContent = 'Custom';
    indicator.className = 'preset-indicator custom';
  }
}

function updateThinkingStatus(effectiveModel = resolveModelForRequest()) {
  const status = document.getElementById('thinking-status');
  if (!status) return;
  status.classList.remove('error');
  if (!state.thinkingEnabled) {
    status.classList.remove('active');
    status.textContent = 'Thinking mode off';
    renderAiDisclosure();
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
  renderAiDisclosure();
}

function showThinkingStatusError(message) {
  const status = document.getElementById('thinking-status');
  if (!status) return;
  status.classList.add('error');
  status.textContent = message || 'Thinking unavailable';
}

function clearThinkingStatusError() {
  const status = document.getElementById('thinking-status');
  if (!status) return;
  status.classList.remove('error');
}

async function ensureThinkingPrerequisites() {
  if (!state.settings?.model) {
    showThinkingStatusError('Select a model before enabling thinking.');
    return false;
  }
  if (!state.availableModels?.length) {
    await loadAvailableModels();
  }
  if (!state.availableModels?.length) {
    showThinkingStatusError('No models available from Ollama. Thinking disabled.');
    return false;
  }
  clearThinkingStatusError();
  return true;
}

function renderChatSessionsList() {
  const container = document.getElementById('chat-sessions-list');

  // Ultra-modern layout: time-grouped session containers
  const todayContainer = document.querySelector('#sessions-today .session-list-ultra');
  const yesterdayContainer = document.querySelector('#sessions-yesterday .session-list-ultra');
  const weekContainer = document.querySelector('#sessions-week .session-list-ultra');
  const olderContainer = document.querySelector('#sessions-older .session-list-ultra');

  // Clear all containers
  if (todayContainer) todayContainer.innerHTML = '';
  if (yesterdayContainer) yesterdayContainer.innerHTML = '';
  if (weekContainer) weekContainer.innerHTML = '';
  if (olderContainer) olderContainer.innerHTML = '';
  if (container) container.innerHTML = '';

  if (!state.sessions || state.sessions.length === 0) {
    if (container) container.innerHTML = '<p class="muted small-text" style="padding: 1rem; text-align: center;">No chats yet</p>';
    return;
  }

  // Group sessions by time period
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const groups = { today: [], yesterday: [], week: [], older: [] };

  state.sessions.forEach((session) => {
    const sessionHistory = state.sessionHistories[session.id] || [];
    const lastMessage = sessionHistory.length > 0 ? sessionHistory[sessionHistory.length - 1] : null;
    const sessionTime = lastMessage?.timestamp ? new Date(lastMessage.timestamp).getTime() : session.createdAt || now;
    const daysAgo = (now - sessionTime) / oneDayMs;

    if (daysAgo < 1) {
      groups.today.push(session);
    } else if (daysAgo < 2) {
      groups.yesterday.push(session);
    } else if (daysAgo < 7) {
      groups.week.push(session);
    } else {
      groups.older.push(session);
    }
  });

  // Helper to create session button
  const createSessionButton = (session) => {
    const btn = document.createElement('button');
    btn.className = 'session-item';
    if (session.id === state.activeSessionId) {
      btn.classList.add('active');
    }

    // Get session title (use first message or session name)
    const sessionHistory = state.sessionHistories[session.id] || [];
    const firstMessage = sessionHistory.length > 0 ? sessionHistory[0].user : null;
    const title = firstMessage
      ? (firstMessage.length > 40 ? firstMessage.substring(0, 40) + '...' : firstMessage)
      : (session.name || 'New Chat');

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'session-delete-btn';
    deleteBtn.title = 'Delete chat';
    deleteBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
    `;

    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (session.id === 'default') {
        alert('Cannot delete the default session');
        return;
      }
      if (!confirm('Delete this chat? This cannot be undone.')) {
        return;
      }
      try {
        console.log('[DEBUG] Deleting session:', session.id);
        const response = await fetch(buildUrl(`/api/sessions/${encodeURIComponent(session.id)}`), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Delete failed');
        }

        const result = await response.json();
        console.log('[DEBUG] Delete successful:', result);

        state.sessions = state.sessions.filter(s => s.id !== session.id);
        delete state.sessionHistories[session.id];
        delete state.localHistory[session.id];
        if (state.activeSessionId === session.id) {
          state.activeSessionId = state.sessions[0]?.id || 'default';
          await loadServerHistory(state.activeSessionId);
          renderChatMessages();
        }
        renderChatSessionsList();
        persistLocalHistory();
        persistActiveSession();
      } catch (error) {
        console.error('[ERROR] Failed to delete session:', error);
        alert('Failed to delete chat: ' + error.message);
      }
    });

    const titleDiv = document.createElement('div');
    titleDiv.className = 'session-item-title';
    titleDiv.textContent = title;

    btn.appendChild(titleDiv);
    btn.appendChild(deleteBtn);

    btn.addEventListener('click', async () => {
      state.activeSessionId = session.id;
      persistActiveSession();
      await loadServerHistory(session.id);
      renderChatMessages();
      renderChatSessionsList();
      updateSessionInstructionsPreview();
      updatePresetIndicator();

      // Update chat title
      const chatTitle = document.getElementById('chat-title');
      if (chatTitle) {
        chatTitle.textContent = title.length > 30 ? title.substring(0, 30) + '...' : title;
      }

      // Close mobile sidebar
      const chatSidebar = document.getElementById('chat-sidebar');
      if (chatSidebar && window.innerWidth <= 768) {
        chatSidebar.classList.remove('open');
      }
    });

    return btn;
  };

  // Render into time-grouped containers (ultra-modern layout)
  if (todayContainer) {
    groups.today.forEach(session => todayContainer.appendChild(createSessionButton(session)));
    document.getElementById('sessions-today').style.display = groups.today.length > 0 ? 'block' : 'none';
  }
  if (yesterdayContainer) {
    groups.yesterday.forEach(session => yesterdayContainer.appendChild(createSessionButton(session)));
    document.getElementById('sessions-yesterday').style.display = groups.yesterday.length > 0 ? 'block' : 'none';
  }
  if (weekContainer) {
    groups.week.forEach(session => weekContainer.appendChild(createSessionButton(session)));
    document.getElementById('sessions-week').style.display = groups.week.length > 0 ? 'block' : 'none';
  }
  if (olderContainer) {
    groups.older.forEach(session => olderContainer.appendChild(createSessionButton(session)));
    document.getElementById('sessions-older').style.display = groups.older.length > 0 ? 'block' : 'none';
  }

  // Fallback: render into old container for compatibility
  if (container) {
    state.sessions.forEach((session) => {
      container.appendChild(createSessionButton(session));
    });
  }
}

async function createNewChat() {
  try {
    const newSession = {
      name: 'New Chat',
      instructions: state.settings?.systemInstructions || '',
      presetId: 'default-assistant'
    };

    const response = await fetchJson('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(newSession)
    });

    if (response.session) {
      await loadSessions();
      state.activeSessionId = response.session.id;
      persistActiveSession();
      state.chat = [];
      state.sessionHistories[response.session.id] = [];
      renderChatMessages();
      renderChatSessionsList();
      updateSessionInstructionsPreview();
      updatePresetIndicator();

      // Update chat title
      const chatTitle = document.getElementById('chat-title');
      if (chatTitle) {
        chatTitle.textContent = 'New Chat';
      }

      // Focus on input
      const input = document.getElementById('chat-input');
      if (input) {
        input.focus();
      }

      // Close mobile sidebar
      const chatSidebar = document.getElementById('chat-sidebar');
      if (chatSidebar && window.innerWidth <= 768) {
        chatSidebar.classList.remove('open');
      }
    }
  } catch (error) {
    console.error('[ERROR] Failed to create new chat:', error);
  }
}

// XML Tag Parsing for Structured Content
function parseXMLTags(content) {
  const tags = {};
  const xmlTagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let match;
  let remainingContent = content;

  // Extract XML tags
  while ((match = xmlTagRegex.exec(content)) !== null) {
    const tagName = match[1].toLowerCase();
    const tagContent = match[2].trim();
    tags[tagName] = tagContent;
    // Remove the tag from remaining content
    remainingContent = remainingContent.replace(match[0], '').trim();
  }

  return { tags, remainingContent };
}

function createStructuredSection(tagName, content, isCollapsible = false) {
  const section = document.createElement('div');
  section.className = `structured-section structured-${tagName}`;

  const header = document.createElement('div');
  header.className = 'structured-header';

  const icon = getTagIcon(tagName);
  const label = getTagLabel(tagName);

  if (isCollapsible) {
    header.innerHTML = `
      <div class="structured-title">
        <span class="structured-icon">${icon}</span>
        <span class="structured-label">${label}</span>
        <span class="toggle-icon">▼</span>
      </div>
    `;
    header.classList.add('collapsible');

    const contentDiv = document.createElement('div');
    contentDiv.className = 'structured-content collapsed';
    contentDiv.innerHTML = `<div class="structured-body">${formatTagContent(tagName, content)}</div>`;

    header.addEventListener('click', () => {
      contentDiv.classList.toggle('collapsed');
      const toggleIcon = header.querySelector('.toggle-icon');
      toggleIcon.textContent = contentDiv.classList.contains('collapsed') ? '▼' : '▲';
    });

    section.appendChild(header);
    section.appendChild(contentDiv);
  } else {
    header.innerHTML = `
      <div class="structured-title">
        <span class="structured-icon">${icon}</span>
        <span class="structured-label">${label}</span>
      </div>
    `;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'structured-content';
    contentDiv.innerHTML = `<div class="structured-body">${formatTagContent(tagName, content)}</div>`;

    section.appendChild(header);
    section.appendChild(contentDiv);
  }

  return section;
}

function getTagIcon(tagName) {
  const icons = {
    role: '👤',
    context: '📋',
    goal: '🎯',
    todos: '✅',
    requirements: '📋',
    analysis: '🔍',
    solution: '💡',
    implementation: '⚙️',
    verification: '✓',
    notes: '📝',
    warning: '⚠️',
    error: '❌',
    success: '✅'
  };
  return icons[tagName] || '📄';
}

function getTagLabel(tagName) {
  const labels = {
    role: 'Role',
    context: 'Context',
    goal: 'Goal',
    todos: 'Todo Items',
    requirements: 'Requirements',
    analysis: 'Analysis',
    solution: 'Solution',
    implementation: 'Implementation',
    verification: 'Verification',
    notes: 'Notes',
    warning: 'Warning',
    error: 'Error',
    success: 'Success'
  };
  return labels[tagName] || tagName.charAt(0).toUpperCase() + tagName.slice(1);
}

function formatTagContent(tagName, content) {
  // Handle todos specially - convert to checklist
  if (tagName === 'todos') {
    const lines = content.split('\n').filter(line => line.trim());
    let formatted = '<ul class="todo-list">';
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const text = trimmed.substring(2).trim();
        formatted += `<li class="todo-item"><span class="todo-checkbox">☐</span> ${escapeHtml(text)}</li>`;
      } else if (trimmed) {
        formatted += `<li class="todo-item"><span class="todo-checkbox">☐</span> ${escapeHtml(trimmed)}</li>`;
      }
    });
    formatted += '</ul>';
    return formatted;
  }

  // Handle other content with basic formatting
  return escapeHtml(content).replace(/\n/g, '<br>');
}

function renderChatMessages() {
  const container = document.getElementById('chat-history') || document.getElementById('chat-history-ultra');
  if (!container) return;
  clearLiveEntries();
  container.innerHTML = '';

  const sessionId = state.activeSessionId;
  const history =
    (state.sessionHistories[sessionId] && state.sessionHistories[sessionId].length
      ? state.sessionHistories[sessionId]
      : state.localHistory[sessionId]) || [];

  if (!history || !history.length) {
    container.innerHTML = '<div class="empty-state"><p class="muted">No messages yet. Start the conversation!</p></div>';
    return;
  }

  history.forEach((entry, index) => {
    const conversation = document.createElement('div');
    conversation.className = 'conversation-group';

    // User message bubble with avatar
    if (entry.user) {
      const userBubble = document.createElement('div');
      userBubble.className = 'message-bubble-user';
      userBubble.innerHTML = `
        <div class="message-avatar user">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div class="message-content">
          <div class="message-header">
            <span class="message-sender">You</span>
            <span class="message-timestamp">${new Date(entry.timestamp || Date.now()).toLocaleTimeString()}</span>
          </div>
          <div class="message-text">${escapeHtml(entry.user)}</div>
        </div>
      `;
      conversation.appendChild(userBubble);
    }

    // Assistant message bubble with structured content and avatar
    if (entry.assistant) {
      const assistantBubble = document.createElement('div');
      assistantBubble.className = 'message-bubble-assistant';

      // Create avatar
      const avatar = document.createElement('div');
      avatar.className = 'message-avatar assistant';
      avatar.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
      `;
      assistantBubble.appendChild(avatar);

      // Parse XML tags from assistant response
      const { tags, remainingContent } = parseXMLTags(entry.assistant);

      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'assistant-content-wrapper';

      const messageContent = document.createElement('div');
      messageContent.className = 'message-content';

      // Add message header
      const messageHeader = document.createElement('div');
      messageHeader.className = 'message-header';
      messageHeader.innerHTML = `
        <span class="message-sender">Assistant</span>
        <span class="message-timestamp">${new Date(entry.timestamp || Date.now()).toLocaleTimeString()}</span>
      `;
      messageContent.appendChild(messageHeader);

      // Render structured sections for each tag
      const structuredOrder = ['role', 'context', 'goal', 'requirements', 'analysis', 'solution', 'implementation', 'todos', 'verification', 'notes'];

      let hasStructuredContent = false;
      structuredOrder.forEach(tagName => {
        if (tags[tagName]) {
          const isCollapsible = ['todos', 'analysis', 'implementation', 'verification'].includes(tagName);
          const section = createStructuredSection(tagName, tags[tagName], isCollapsible);
          messageContent.appendChild(section);
          hasStructuredContent = true;
        }
      });

      // Add any remaining XML tags not in the standard order
      Object.keys(tags).forEach(tagName => {
        if (!structuredOrder.includes(tagName)) {
          const section = createStructuredSection(tagName, tags[tagName], false);
          messageContent.appendChild(section);
          hasStructuredContent = true;
        }
      });

      // Add remaining content if any
      if (remainingContent) {
        const textSection = document.createElement('div');
        textSection.className = 'message-text';
        textSection.innerHTML = escapeHtml(remainingContent).replace(/\n/g, '<br>');
        if (hasStructuredContent) {
          messageContent.appendChild(textSection);
        } else {
          messageContent.innerHTML = textSection.innerHTML;
        }
      }

      // Add thinking mode if present (artifact-style)
      if (entry.thinking) {
        const wordCount = entry.thinking.split(/\s+/).length;
        const thinkingSection = document.createElement('div');
        thinkingSection.className = 'thinking-section collapsed';
        thinkingSection.innerHTML = `
          <div class="thinking-header" onclick="this.parentElement.classList.toggle('collapsed')">
            <div class="thinking-header-left">
              <svg class="thinking-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
              <span class="thinking-label">
                Thinking Process
                <span class="thinking-word-count">${wordCount} words</span>
              </span>
            </div>
            <svg class="thinking-toggle" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          <div class="thinking-content">
            <div class="thinking-text">${escapeHtml(entry.thinking)}</div>
          </div>
        `;
        messageContent.appendChild(thinkingSection);
      }

      contentWrapper.appendChild(messageContent);

      // Add message actions
      const messageActions = document.createElement('div');
      messageActions.className = 'message-actions';
      const assistantText = escapeHtml(entry.assistant);
      const userText = escapeHtml(entry.user || '');
      messageActions.innerHTML = `
        <button class="action-btn copy-btn" data-copy-text="${assistantText}" title="Copy message">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy
        </button>
        <button class="action-btn regenerate-btn" data-user-message="${userText}" title="Regenerate response">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
          Regenerate
        </button>
      `;
      contentWrapper.appendChild(messageActions);

      assistantBubble.appendChild(contentWrapper);
      conversation.appendChild(assistantBubble);
    }

    container.appendChild(conversation);
  });

  // Add message action event listeners
  container.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const text = e.currentTarget.dataset.copyText;
      try {
        await navigator.clipboard.writeText(text);
        e.currentTarget.innerHTML = '<span style="color: var(--success)">✓</span>';
        setTimeout(() => {
          e.currentTarget.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          `;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy text:', err);
      }
    });
  });

  // Add regenerate button handlers
  container.querySelectorAll('.regenerate-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const userMessage = e.currentTarget.dataset.userMessage;
      if (!userMessage) return;
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = userMessage;
        input.focus();
        // Optionally auto-send
        // sendMessage();
      }
    });
  });

  container.scrollTop = container.scrollHeight;
}

function renderQuickActions() {
  const container = document.getElementById('chat-quick-actions');
  if (!container) return;
  container.innerHTML = '';
  QUICK_ACTIONS.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-action-btn';
    button.textContent = action.label;
    button.dataset.promptId = action.id;
    button.addEventListener('click', () => {
      const input = document.getElementById('chat-input');
      if (!input) return;
      input.value = action.prompt;
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    container.appendChild(button);
  });
}

function getActivePresetLabel() {
  const sessionsArray = Array.isArray(state.sessions) ? state.sessions : [];
  const session = sessionsArray.find((item) => item.id === state.activeSessionId);
  if (!session) {
    return null;
  }
  if (session.presetId && Array.isArray(state.instructionPresets)) {
    const preset = state.instructionPresets.find((p) => p.id === session.presetId);
    return preset?.label || session.presetId;
  }
  return null;
}

function renderAiDisclosure() {
  const container = document.getElementById('ai-disclosure');
  if (!container) return;
  const messageEl = document.getElementById('ai-disclosure-message');
  const toggleBtn = document.getElementById('ai-disclosure-toggle');
  const instructionsPreview = document.getElementById('session-instructions-preview');

  const modelName = state.settings?.model || '—';
  const thinkingCopy = state.thinkingEnabled ? 'Thinking stream on' : 'Thinking stream off';
  const presetLabel = getActivePresetLabel();
  const presetCopy = presetLabel ? `Preset: ${presetLabel}` : 'Custom instructions';

  if (messageEl) {
    messageEl.textContent = `Using model ${modelName}. ${presetCopy}. ${thinkingCopy}.`;
  }

  if (toggleBtn && instructionsPreview) {
    const hasInstructions = Boolean(instructionsPreview.textContent?.trim());
    toggleBtn.disabled = !hasInstructions;
    toggleBtn.textContent = instructionsPreview.hidden ? 'View instructions' : 'Hide instructions';
    toggleBtn.onclick = () => {
      if (!hasInstructions) return;
      instructionsPreview.hidden = !instructionsPreview.hidden;
      toggleBtn.textContent = instructionsPreview.hidden ? 'View instructions' : 'Hide instructions';
    };
  }
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clearLiveEntries() {
  document.querySelectorAll('.live-entry').forEach((node) => node.remove());
}

function appendLiveUserMessage(content) {
  const container = document.getElementById('chat-history') || document.getElementById('chat-history-ultra');
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
  const container = document.getElementById('chat-history') || document.getElementById('chat-history-ultra');
  if (!container) return null;
  const article = document.createElement('article');
  article.className = 'chat-entry assistant live-entry thinking-entry';
  article.innerHTML = `
    <header>
      <strong>Assistant</strong>
      <span>${new Date().toLocaleTimeString()}</span>
    </header>
    <div class="thinking-section">
      <button class="thinking-toggle-btn expanded" aria-label="Toggle thinking">
        <svg class="thinking-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
        </svg>
        <span class="thinking-label">Thinking...</span>
        <svg class="chevron-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <div class="thinking-content">
        <p><span class="assistant-live-text"></span></p>
      </div>
    </div>
  `;

  const toggleBtn = article.querySelector('.thinking-toggle-btn');
  const content = article.querySelector('.thinking-content');
  if (toggleBtn && content) {
    toggleBtn.addEventListener('click', () => {
      content.classList.toggle('collapsed');
      toggleBtn.classList.toggle('expanded');
    });
  }

  container.appendChild(article);
  container.scrollTop = container.scrollHeight;
  return article;
}

function updateThinkingEntry(entry, text) {
  if (!entry) return;
  const stream = entry.querySelector('.assistant-live-text');
  if (stream) {
    stream.textContent = text || '';
  }

  // Auto-scroll to show new thinking content
  const container = document.getElementById('chat-history') || document.getElementById('chat-history-ultra');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }

  const label = entry.querySelector('.thinking-label');
  if (label) {
    if (text && text.length > 0) {
      // Update label to show active thinking with live indicator
      const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
      label.innerHTML = `<span style="display: inline-block; width: 6px; height: 6px; background: #10b981; border-radius: 50%; margin-right: 6px; animation: pulse 1.5s infinite;"></span>Thinking (${wordCount} words)`;
    } else {
      label.innerHTML = `<span style="display: inline-block; width: 6px; height: 6px; background: #10b981; border-radius: 50%; margin-right: 6px; animation: pulse 1.5s infinite;"></span>Thinking...`;
    }
  }

  // Auto-expand the thinking section while streaming
  const thinkingSection = entry.querySelector('.thinking-section');
  const thinkingContent = entry.querySelector('.thinking-content');
  if (thinkingSection && thinkingContent && text && text.length > 10) {
    thinkingSection.classList.remove('collapsed');
    thinkingContent.classList.remove('collapsed');
  }
}

function finalizeThinkingEntry(entry, thinkingText, responseText) {
  if (!entry) return;

  // Remove live-entry class so it doesn't get cleared
  entry.classList.remove('live-entry');

  // Update label to show it's the response
  const label = entry.querySelector('.thinking-label');
  if (label) {
    label.textContent = 'Response';
  }

  // Collapse the thinking section by default after completion
  const toggleBtn = entry.querySelector('.thinking-toggle-btn');
  const content = entry.querySelector('.thinking-content');
  if (toggleBtn && content) {
    content.classList.add('collapsed');
    toggleBtn.classList.remove('expanded');
  }

  // Auto-scroll
  const container = document.getElementById('chat-history');
  if (container) {
    container.scrollTop = container.scrollHeight;
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
  setupInstructionPresetControls({
    selectId: 'instruction-preset-select',
    applyButtonId: 'instruction-preset-apply',
    descriptionId: 'instruction-preset-description',
    targetField: form?.elements?.systemInstructions
  });

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
      console.error('Proxy request failed:', error);
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

function setupInstructionPresetControls({
  selectId,
  applyButtonId,
  descriptionId,
  targetField
}) {
  const select = selectId ? document.getElementById(selectId) : null;
  const applyButton = applyButtonId ? document.getElementById(applyButtonId) : null;
  const descriptionEl = descriptionId ? document.getElementById(descriptionId) : null;
  if (!select || !targetField) return;

  const control = {
    select,
    targetField,
    descriptionEl,
    applyButton,
    refresh() {
      if (!document.body.contains(select) || !document.body.contains(targetField)) {
        return false;
      }
      populateOptions();
      syncSelectionFromValue(targetField.value);
      return true;
    }
  };

  function populateOptions() {
    const presets = getInstructionPresetCatalog();
    const customOption = '<option value="">Custom / manual</option>';
    const presetOptions = presets
      .map((preset) => `<option value="${preset.id}">${preset.label}</option>`)
      .join('');
    select.innerHTML = `${customOption}${presetOptions}`;
  }

  function updateDescription(preset) {
    if (!descriptionEl) return;
    if (preset) {
      descriptionEl.textContent = preset.description || 'Preset applied.';
    } else {
      descriptionEl.textContent = 'Custom instructions in use.';
    }
  }

  function syncSelectionFromValue(value) {
    const match = findInstructionPresetMatch(value);
    if (match) {
      select.value = match.id;
      updateDescription(match);
    } else {
      select.value = '';
      updateDescription(null);
    }
  }

  select.addEventListener('change', () => {
    const preset = findInstructionPresetById(select.value);
    updateDescription(preset || null);
  });

  targetField.addEventListener('input', () => {
    syncSelectionFromValue(targetField.value);
  });

  applyButton?.addEventListener('click', () => {
    let preset = findInstructionPresetById(select.value);
    if (!preset) {
      preset = getInstructionPresetCatalog().find((entry) => entry.id);
      if (!preset) {
        return;
      }
      select.value = preset.id;
      updateDescription(preset);
    }
    targetField.value = preset.instructions || '';
    targetField.dispatchEvent(new Event('input', { bubbles: true }));
    // Store presetId in a data attribute so it can be accessed during form submission
    if (targetField.form && preset.id) {
      targetField.form.dataset.selectedPresetId = preset.id;
    }
  });

  instructionPresetControlRegistry.push(control);
  control.refresh();
  ensureInstructionPresetsLoaded();
}

function setupChatInstructionPresetControl() {
  const select = document.getElementById('chat-instruction-preset-select');
  const applyButton = document.getElementById('chat-instruction-preset-apply');
  const descriptionEl = document.getElementById('chat-instruction-preset-description');
  if (!select) return;
  if (select.dataset.initialized === 'true') {
    return;
  }
  select.dataset.initialized = 'true';

  // Auto-apply mode if no apply button (settings modal)
  const autoApply = !applyButton;

  const syncFromSession = () => {
    if (!document.body.contains(select)) {
      window.removeEventListener('ollama-state', syncFromSession);
      return;
    }
    const session =
      state.sessions.find((item) => item.id === state.activeSessionId) ||
      state.sessions[0];
    const match = findInstructionPresetMatch(session?.instructions);
    if (match) {
      select.value = match.id;
      updateDescription(match);
    } else {
      select.value = '';
      updateDescription(null);
    }
  };

  function populateOptions() {
    const presets = getInstructionPresetCatalog();
    const customOption = '<option value=\"\">Custom / manual</option>';
    const presetOptions = presets
      .map((preset) => `<option value=\"${preset.id}\">${preset.label}</option>`)
      .join('');
    select.innerHTML = `${customOption}${presetOptions}`;
  }

  function updateDescription(preset) {
    if (!descriptionEl) return;
    if (preset) {
      descriptionEl.textContent = `Selected: ${preset.label}`;
    } else {
      descriptionEl.textContent = 'Custom instructions active for this session.';
    }
  }

  select.addEventListener('change', async () => {
    const preset = findInstructionPresetById(select.value);
    updateDescription(preset || null);

    // Auto-apply if in settings modal (no apply button)
    if (autoApply && state.activeSessionId) {
      try {
        const instructions = preset ? preset.instructions : '';
        const presetId = preset ? preset.id : null;

        await fetchJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
          method: 'PUT',
          body: JSON.stringify({ instructions, presetId })
        });

        await loadSessions();
        await loadServerHistory(state.activeSessionId);
        updateSessionInstructionsPreview();
        renderSessionSelector();
      } catch (error) {
        console.error('Failed to apply preset', error);
      }
    }
  });

  if (applyButton) {
    applyButton.addEventListener('click', async () => {
    const preset = findInstructionPresetById(select.value);
    if (!preset) {
      updateDescription(null);
      if (!state.activeSessionId) {
        return;
      }
      applyButton.disabled = true;
      try {
        await fetchJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
          method: 'PUT',
          body: JSON.stringify({ instructions: '', presetId: null })
        });
        await loadSessions();
        await loadServerHistory(state.activeSessionId);
        updateSessionInstructionsPreview();
        renderSessionSelector();
      } catch (error) {
        console.error('Failed to reset session instructions', error);
        if (descriptionEl) {
          descriptionEl.textContent = error.message || 'Failed to reset instructions';
        }
      } finally {
        applyButton.disabled = false;
      }
      return;
    }
    if (!state.activeSessionId) {
      updateDescription(null);
      return;
    }
    applyButton.disabled = true;
    try {
      await fetchJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
        method: 'PUT',
        body: JSON.stringify({ instructions: preset.instructions, presetId: preset.id })
      });
      await loadSessions();
      await loadServerHistory(state.activeSessionId);
      updateSessionInstructionsPreview();
      renderSessionSelector();
      updateDescription(preset);
    } catch (error) {
      console.error('Failed to apply preset to session', error);
      if (descriptionEl) {
        descriptionEl.textContent = error.message || 'Failed to apply preset';
      }
    } finally {
      applyButton.disabled = false;
    }
    });
  }

  const control = {
    refresh() {
      if (!document.body.contains(select)) {
        window.removeEventListener('ollama-state', syncFromSession);
        return false;
      }
      populateOptions();
      syncFromSession();
      return true;
    }
  };

  instructionPresetControlRegistry.push(control);
  window.addEventListener('ollama-state', syncFromSession);
  control.refresh();
  ensureInstructionPresetsLoaded();
}

function getInstructionPresetCatalog() {
  const source = Array.isArray(state.instructionPresets) ? state.instructionPresets : [];
  return source.map((preset, index) => ({
    id: preset.id || `preset-${index + 1}`,
    label: preset.label || `Preset ${index + 1}`,
    description: preset.description || '',
    instructions: preset.instructions || '',
    version: preset.version || '1.0',
    category: preset.category || 'general',
    workflow: preset.workflow || {},
    updatedAt: preset.updatedAt || new Date().toISOString()
  }));
}

function findInstructionPresetById(id) {
  if (!id) return null;
  return getInstructionPresetCatalog().find((preset) => preset.id === id) || null;
}

function findInstructionPresetMatch(value) {
  const normalized = normalizeInstructionText(value);
  if (!normalized) {
    return null;
  }
  return (
    getInstructionPresetCatalog().find(
      (preset) => normalizeInstructionText(preset.instructions) === normalized
    ) || null
  );
}

function normalizeInstructionText(value) {
  return value ? value.replace(/\r\n/g, '\n').trim() : '';
}

function normalizeInstructionPresets(presets, fallbackInstruction) {
  if (Array.isArray(presets) && presets.length) {
    return presets.map((preset, index) => ({
      id: preset.id || `preset-${index + 1}`,
      label: preset.label || `Preset ${index + 1}`,
      description: preset.description || '',
      instructions: preset.instructions || '',
      version: preset.version || '1.0',
      category: preset.category || 'general',
      workflow: preset.workflow || {},
      updatedAt: preset.updatedAt || new Date().toISOString()
    }));
  }
  const fallback = normalizeInstructionText(fallbackInstruction);
  if (fallback) {
    return [
      {
        id: 'default-assistant',
        label: 'Default instructions',
        description: 'Fallback preset derived from server defaults.',
        instructions: fallback,
        version: '1.0',
        category: 'general',
        workflow: {},
        updatedAt: new Date().toISOString()
      }
    ];
  }
  return [];
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
  if (form.elements.instructions) {
    form.elements.instructions.dispatchEvent(new Event('input', { bubbles: true }));
  }
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
  if (form.elements.instructions) {
    form.elements.instructions.dispatchEvent(new Event('input', { bubbles: true }));
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

  try {
    const response = await fetch(target, init);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText);
    }

    return response.json();
  } catch (error) {
    // Update the connection status to offline when there's a connection error
    if (elements.status) {
      elements.status.textContent = 'offline';
      elements.status.classList.remove('badge-online');
      elements.status.classList.add('badge-offline');
    }

    // Update model status to show it's unavailable
    if (elements.activeModel) {
      elements.activeModel.textContent = 'model: —';
    }

    // Check if it's a network error
    if (error.name === 'TypeError' || error.message.includes('Failed to fetch') ||
        error.message.includes('NetworkError') || error.message.includes('ECONNREFUSED')) {
      throw new Error('Cannot connect to the backend server. Is the server running?');
    }

    throw error;
  }
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

// XML Structure Prompting System
function addXMLStructurePrompt(userMessage) {
  // Check if structured prompts are enabled
  if (!isStructuredPromptEnabled()) {
    return userMessage; // Return original message if disabled
  }

  const xmlPromptTemplate = `
Please structure your response using XML tags to organize the content clearly. Use the following structure when relevant:

<role>Your role or perspective in responding to this query</role>
<context>Relevant background information or context</context>
<goal>The main objective or what you aim to achieve</goal>
<analysis>Your analysis of the situation, problem, or request</analysis>
<solution>Your proposed solution or main response</solution>
<implementation>Specific steps or implementation details</implementation>
<todos>
- Actionable task 1
- Actionable task 2
- Actionable task 3
</todos>
<verification>How to verify or validate the solution</verification>
<notes>Additional notes, considerations, or warnings</notes>

User's request: ${userMessage}

Please provide a comprehensive, structured response using the relevant XML tags from above.`;

  return xmlPromptTemplate;
}

function isStructuredPromptEnabled() {
  // Check if user wants structured XML responses
  return state.settings?.enableStructuredPrompts === true; // Default to DISABLED
}

function toggleStructuredPrompts() {
  state.settings.enableStructuredPrompts = !state.settings.enableStructuredPrompts;
  persistClientSettings();

  // Show notification
  const status = state.settings.enableStructuredPrompts ? 'enabled' : 'disabled';
  showStructuredPromptNotification(status);
}

// Spell-check and auto-correct common mistakes
function spellCheckMessage(message) {
  // Common typos and corrections (case-insensitive)
  const corrections = {
    // Common misspellings
    'teh': 'the',
    'tehm': 'them',
    'taht': 'that',
    'thsi': 'this',
    'waht': 'what',
    'hwo': 'how',
    'adn': 'and',
    'nad': 'and',
    'recieve': 'receive',
    'recieved': 'received',
    'acheive': 'achieve',
    'beleive': 'believe',
    'occured': 'occurred',
    'seperete': 'separate',
    'definately': 'definitely',
    'wierd': 'weird',
    'untill': 'until',
    'thier': 'their',
    'freind': 'friend',

    // Programming-specific
    'funciton': 'function',
    'fucntion': 'function',
    'funtion': 'function',
    'functino': 'function',
    'retrun': 'return',
    'reutrn': 'return',
    'calss': 'class',
    'clas': 'class',
    'improt': 'import',
    'imoprt': 'import',
    'consoel': 'console',
    'cosole': 'console',
    'docuemnt': 'document',
    'documetn': 'document',
    'lenght': 'length',
    'heigth': 'height',
    'widht': 'width',
    'tihs': 'this',
    'asynch': 'async',
    'awiat': 'await',
    'varaible': 'variable',
    'varialbe': 'variable',
    'promsie': 'promise',
    'promies': 'promise',
    'respone': 'response',
    'resposne': 'response',
    'respnse': 'response',
    'reqeust': 'request',
    'requset': 'request',
    'rquest': 'request',
    'arry': 'array',
    'arary': 'array',
    'obejct': 'object',
    'ojbect': 'object',
    'strign': 'string',
    'stirng': 'string',
    'sring': 'string',
    'elemnent': 'element',
    'elemnet': 'element',
    'componet': 'component',
    'compnent': 'component',
    'contructor': 'constructor',
    'costructor': 'constructor',
    'excecute': 'execute',
    'exeucte': 'execute',
    'implmement': 'implement',
    'implmeent': 'implement',
    'enviroment': 'environment',
    'enviornment': 'environment',
    'paramter': 'parameter',
    'paramater': 'parameter',
    'arguemnt': 'argument',
    'argumetn': 'argument',
    'interaface': 'interface',
    'interfce': 'interface',
    'databse': 'database',
    'databae': 'database',
    'atribute': 'attribute',
    'attribtue': 'attribute',
    'validtion': 'validation',
    'valiation': 'validation'
  };

  let correctedMessage = message;

  // Replace each misspelling while preserving word boundaries
  for (const [wrong, right] of Object.entries(corrections)) {
    // Case-insensitive replacement with word boundaries
    const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
    correctedMessage = correctedMessage.replace(regex, (match) => {
      // Preserve original capitalization pattern
      if (match[0] === match[0].toUpperCase()) {
        return right.charAt(0).toUpperCase() + right.slice(1);
      }
      return right;
    });
  }

  return correctedMessage;
}

// AI Coder Enhancement - Smart, concise prompt improvement
function enhanceAICoderPrompt(userMessage) {
  // Check if AI Coder enhancement is enabled
  if (!state.settings?.aiCoderEnabled) {
    console.log('[AI CODER] DISABLED - returning original message');
    return userMessage;
  }

  console.log('[AI CODER] ENABLED - enhancing message');

  // Step 1: Fix spelling mistakes
  const spellChecked = spellCheckMessage(userMessage);
  console.log('[AI CODER] Spell-checked:', spellChecked);

  // Step 2: Don't enhance if already detailed or structured
  const isDetailed = spellChecked.length > 200;
  const isStructured = spellChecked.includes('<') || spellChecked.includes('```');

  if (isDetailed || isStructured) {
    return spellChecked;
  }

  // Step 3: Detect intent
  const codingKeywords = /\b(fix|add|create|implement|build|develop|make|update|modify|change|refactor|optimize|improve|debug|test|write|code|script|function|feature|bug|issue|error|component|api|endpoint|database|query|style|css|html|javascript|react|vue|python|node|express)\b/i;
  const isCodingTask = codingKeywords.test(spellChecked);

  // Step 4: Autonomous enhancement for coding tasks
  if (isCodingTask) {
    const enhanced = `${spellChecked}

EXECUTE AUTONOMOUSLY:
1. Search the codebase to find all relevant files - don't ask, just do it
2. Read the files to understand how things work - don't ask, just do it
3. Implement the complete solution following existing patterns - don't ask, just do it
4. Test your changes and fix any errors - don't ask, just do it
5. Report what you did when finished - don't ask what to do next

NEVER ask "would you like me to..." or "should I..." - just complete the full task.`;
    console.log('[AI CODER] Enhanced coding task:', enhanced);
    return enhanced;
  }

  // For non-coding queries, just return spell-checked version
  console.log('[AI CODER] Non-coding query, returning spell-checked only');
  return spellChecked;
}

function showStructuredPromptNotification(status) {
  const notification = document.createElement('div');
  notification.className = 'theme-notification';
  notification.textContent = `📋 Structured prompts ${status}`;

  document.body.appendChild(notification);

  // Animate in
  requestAnimationFrame(() => {
    notification.classList.add('show');
  });

  // Remove after delay
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, 2000);
}

function initializeStructuredPromptToggle() {
  const structuredToggle = document.getElementById('structured-prompt-toggle');
  if (structuredToggle) {
    // Set initial state
    structuredToggle.checked = isStructuredPromptEnabled();

    structuredToggle.addEventListener('change', (event) => {
      toggleStructuredPrompts();
    });
  }
}

// Enhanced Theme Management with System Preference Detection
function applyTheme(theme) {
  const resolvedTheme = resolveTheme(theme);

  if (resolvedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  updateThemeToggleIcon(resolvedTheme);

  // Store the resolved theme for UI state
  state.resolvedTheme = resolvedTheme;
}

function resolveTheme(theme) {
  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme || 'light';
}

function getSystemTheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function updateThemeToggleIcon(resolvedTheme) {
  const lightIcon = document.querySelector('.theme-icon-light');
  const darkIcon = document.querySelector('.theme-icon-dark');

  if (lightIcon && darkIcon) {
    if (resolvedTheme === 'dark') {
      lightIcon.style.display = 'none';
      darkIcon.style.display = 'block';
    } else {
      lightIcon.style.display = 'block';
      darkIcon.style.display = 'none';
    }
  }
}

function cycleTheme() {
  const currentTheme = state.settings.theme || 'system';
  let nextTheme;

  switch (currentTheme) {
    case 'light':
      nextTheme = 'dark';
      break;
    case 'dark':
      nextTheme = 'system';
      break;
    case 'system':
    default:
      nextTheme = 'light';
      break;
  }

  return nextTheme;
}

function initializeThemeSystem() {
  // Apply initial theme
  applyTheme(state.settings.theme);

  // Listen for system theme changes
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    mediaQuery.addEventListener('change', (e) => {
      // Only react to system changes if user has system theme selected
      if (state.settings.theme === 'system') {
        applyTheme('system');
      }
    });
  }

  // Setup theme toggle button
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', async () => {
      const newTheme = cycleTheme();

      // Update local state
      state.settings.theme = newTheme;
      applyTheme(newTheme);
      persistClientSettings();

      // Update server settings
      try {
        await fetchJson('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: newTheme })
        });

        notifySettingsSubscribers();

        // Show brief notification
        showThemeNotification(newTheme);
      } catch (error) {
        console.error('Failed to save theme preference:', error);
        // Revert on error
        state.settings.theme = currentTheme;
        applyTheme(currentTheme);
      }
    });
  }
}

// Generic notification system
function showNotification(message, type = 'info', duration = 2500) {
  const notification = document.createElement('div');
  notification.className = `notification-ultra notification-${type}`;
  notification.textContent = message;

  // Position in top-right corner
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-light);
    color: var(--text-primary);
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    opacity: 0;
    transition: opacity 0.3s ease;
  `;

  document.body.appendChild(notification);

  // Animate in
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
  });

  // Remove after delay
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, duration);
}

function showThemeNotification(theme) {
  let message;
  switch (theme) {
    case 'light':
      message = '☀️ Light theme enabled';
      break;
    case 'dark':
      message = '🌙 Dark theme enabled';
      break;
    case 'system':
      const systemTheme = getSystemTheme();
      message = `🖥️ System theme (${systemTheme})`;
      break;
  }
  showNotification(message, 'info', 2000);
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

function persistInstructionPresets(presets) {
  try {
    localStorage.setItem(
      STORAGE_KEYS.instructionPresets,
      JSON.stringify(Array.isArray(presets) ? presets : [])
    );
  } catch (_) {
    // ignore
  }
}

function loadInstructionPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.instructionPresets);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function refreshInstructionPresetControls() {
  instructionPresetControlRegistry = instructionPresetControlRegistry.filter((control) => {
    if (!control?.refresh) {
      return false;
    }
    try {
      return control.refresh() !== false;
    } catch (error) {
      console.warn('Failed to refresh preset control', error);
      return false;
    }
  });
}

function ensureInstructionPresetsLoaded() {
  if (state.instructionPresets && state.instructionPresets.length) {
    return null;
  }
  if (presetRefreshPromise) {
    return presetRefreshPromise;
  }
  presetRefreshPromise = (async () => {
    try {
      const data = await fetchJson('/api/settings');
      const normalized = normalizeInstructionPresets(
        data.presets,
        data.defaults?.systemInstructions || data.current?.systemInstructions
      );
      if (normalized.length) {
        state.instructionPresets = normalized;
        persistInstructionPresets(normalized);
        refreshInstructionPresetControls();
      }
    } catch (error) {
      console.warn('Unable to fetch instruction presets', error);
    } finally {
      presetRefreshPromise = null;
    }
  })();
  return presetRefreshPromise;
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
  // Thinking is now always enabled for better AI responses
  return true;
}

// Cloud synchronization functions
async function syncDataToCloud() {
  try {
    // Prepare data for sync
    const syncData = {
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      settings: state.settings,
      localHistory: state.localHistory,
      customPages: state.customPages,
      thinkingEnabled: state.thinkingEnabled
    };

    const response = await fetchJson('/api/sync/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(syncData)
    });

    if (response.success) {
      console.log('Data synced to cloud successfully:', response.timestamp);
      return true;
    } else {
      console.error('Failed to sync data to cloud:', response);
      return false;
    }
  } catch (error) {
    console.error('Error syncing data to cloud:', error);
    // Update connection status to offline if there's a connection error
    if (error.message && (error.message.includes('connect') || error.message.includes('fetch') || error.message.includes('offline'))) {
      if (elements.status) {
        elements.status.textContent = 'offline';
        elements.status.classList.remove('badge-online');
        elements.status.classList.add('badge-offline');
      }
      if (elements.activeModel) {
        elements.activeModel.textContent = 'model: —';
      }
    }
    return false;
  }
}

async function syncDataFromCloud() {
  try {
    const response = await fetchJson('/api/sync/data');

    if (response && response.sessions !== undefined) {
      const syncedSessions = Array.isArray(response.sessions)
        ? response.sessions
        : Object.values(response.sessions || {});
      if (syncedSessions.length) {
        state.sessions = syncedSessions;
      }
      if (response.activeSessionId) {
        const existsInSync = state.sessions.find((session) => session.id === response.activeSessionId);
        state.activeSessionId = existsInSync ? response.activeSessionId : state.activeSessionId;
      }
      state.settings = { ...state.settings, ...response.settings };
      state.localHistory = response.localHistory || state.localHistory;
      // Note: We might want to be more careful about merging history data

      // Update UI to reflect synced changes
      renderNav();
      renderSessionSelector();
      renderChatMessages();
      renderHistoryPage();
      applyTheme(state.settings.theme);

      // Update the active model display
      if (elements.activeModel) {
        elements.activeModel.textContent = `model: ${state.settings.model}`;
      }

      console.log('Data synced from cloud successfully:', response.timestamp);
      return true;
    } else {
      console.error('Unexpected response format when syncing from cloud:', response);
      return false;
    }
  } catch (error) {
    console.error('Error syncing data from cloud:', error);
    // Update connection status to offline if there's a connection error
    if (error.message && (error.message.includes('connect') || error.message.includes('fetch') || error.message.includes('offline'))) {
      if (elements.status) {
        elements.status.textContent = 'offline';
        elements.status.classList.remove('badge-online');
        elements.status.classList.add('badge-offline');
      }
      if (elements.activeModel) {
        elements.activeModel.textContent = 'model: —';
      }
    }
    return false;
  }
}

// Auto-sync functionality
function setupAutoSync() {
  // Sync when the page is about to unload
  window.addEventListener('beforeunload', async () => {
    await syncDataToCloud();
  });

  // Periodic sync (every 5 minutes)
  setInterval(async () => {
    // Don't sync if any session is currently sending
    const anySending = Object.values(state.sessionSendingStates).some(s => s);
    if (!anySending) {
      await syncDataToCloud();
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Initial sync on page load
  setTimeout(async () => {
    await syncDataFromCloud(); // Get latest from cloud on startup
  }, 2000); // Wait a bit for initial load
}


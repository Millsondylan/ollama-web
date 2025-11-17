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
  instructionPresets: 'ollama-web-instruction-presets',
  modelReady: 'ollama-web-model-ready',
  workflow: 'ollama-web-workflow-phases'
};

const THINKING_PREF_KEY = STORAGE_KEYS.thinking;
const DEFAULT_THINKING_MODE = 'max';
const THINKING_ABORT_KEYWORDS = [
  'operation was aborted',
  'user aborted',
  'network connection was lost',
  'pipe is being closed'
];

const FALLBACK_BASE_URL = window.location.origin + '/';
const persistentErrors = {};

function registerPersistentError(context, error) {
  if (!context) return;
  const entry = persistentErrors[context] || { count: 0 };
  entry.count += 1;
  entry.lastError = error?.message || String(error || '');
  entry.timestamp = Date.now();
  persistentErrors[context] = entry;
  if (entry.count >= 3) {
    console.warn(`[Error Monitor] Repeated ${context} failures`, entry.lastError);
    showNotification(`Recovering from repeated ${context} errors.`, 'warning', 3500);
    resetStuckState();
    entry.count = 0;
  }
}

function clearPersistentError(context) {
  if (context && persistentErrors[context]) {
    delete persistentErrors[context];
  }
}

// Default navigation stack. Additional HTML pages can be appended at runtime via the Custom Pages form.
const defaultPages = [
  { id: 'home', label: 'Home', type: 'component', template: 'home-page' },
  { id: 'chat', label: 'Chat', type: 'component', template: 'chat-page', hidden: true },
  { id: 'planning', label: 'Planning', type: 'component', template: 'planning-page', hidden: true },
  { id: 'projects', label: 'Projects', type: 'component', template: 'projects-page' },
  { id: 'settings', label: 'Settings', type: 'component', template: 'settings-page' }
];

const QUICK_ACTIONS = [
  {
    id: 'qa-summary',
    label: 'Summarize last reply',
    description: 'Capture key takeaways and next actions.',
    prompt: "Summarize the assistant's last response and list the next concrete steps."
  },
  {
    id: 'qa-clarify',
    label: 'Ask for clarity',
    description: 'Highlight missing requirements before coding.',
    prompt: 'Clarify the current requirements and note any missing details before coding.'
  },
  {
    id: 'qa-review',
    label: 'Review session plan',
    description: 'Audit instructions, risks, and blockers.',
    prompt: "Review this session's instructions and highlight potential risks or blockers."
  },
  {
    id: 'qa-compare',
    label: 'Compare models',
    description: 'Recommend the best model for this task.',
    prompt: 'Compare the available models and recommend the best choice for this task.'
  }
];

const MODEL_ACQUISITION_GROUPS = [
  {
    id: 'lightweight',
    label: 'Laptops / ≤ 8 GB RAM',
    description: 'Great for ultrabooks or CPUs without large GPUs.',
    models: [
      {
        name: 'phi3:mini-vision',
        download: '≈2.8 GB download',
        ram: 'Needs ≥ 8 GB system RAM',
        vram: '≈6 GB VRAM recommended',
        notes: 'Fast startup, solid screenshots + tables.'
      },
      {
        name: 'llava-phi3:3.8b',
        download: '≈3.2 GB download',
        ram: 'Needs ≥ 8 GB system RAM',
        vram: '≈6 GB VRAM recommended',
        notes: 'Smallest LLava variant with strong OCR.'
      }
    ]
  },
  {
    id: 'balanced',
    label: 'Workstations / 12–16 GB VRAM',
    description: 'Balanced models for mid-range GPUs.',
    models: [
      {
        name: 'llava:13b',
        download: '≈7.5 GB download',
        ram: 'Needs ≥ 16 GB system RAM',
        vram: '≈12 GB VRAM recommended',
        notes: 'Robust reasoning for UI screenshots.'
      },
      {
        name: 'qwen2.5-vision:14b',
        download: '≈9.6 GB download',
        ram: 'Needs ≥ 24 GB system RAM',
        vram: '≈16 GB VRAM recommended',
        notes: 'Best mix of speed and accuracy.'
      }
    ]
  },
  {
    id: 'enthusiast',
    label: 'Heavy GPUs / 24+ GB VRAM',
    description: 'Highest fidelity local models.',
    models: [
      {
        name: 'llava:34b',
        download: '≈19 GB download',
        ram: 'Needs ≥ 32 GB system RAM',
        vram: '≥ 24 GB VRAM',
        notes: 'Deep reasoning, best for multi-screen captures.'
      },
      {
        name: 'mixtral-vision',
        download: '≈22 GB download',
        ram: 'Needs ≥ 48 GB system RAM',
        vram: '≥ 32 GB VRAM',
        notes: 'Premium quality, slower pull/install.'
      }
    ]
  }
];

const WEB_MODEL_OPTIONS = [
  {
    id: 'web-gpt4o',
    label: 'GPT-4o Mini (Ollama Cloud)',
    provider: 'Ollama Cloud',
    model: 'gpt4o-mini',
    endpoint: 'https://ollama.com/',
    url: 'https://ollama.com/pricing',
    notes: 'Hosted multimodal model with great latency. Requires Ollama Cloud API key.',
    instructions: 'Switch to Cloud mode, set endpoint to https://ollama.com/, and paste your Ollama API key.'
  },
  {
    id: 'web-claude3',
    label: 'Claude 3 Haiku (Ollama Cloud)',
    provider: 'Ollama Cloud',
    model: 'claude-3-haiku',
    endpoint: 'https://ollama.com/',
    url: 'https://ollama.com/models/claude-3-haiku',
    notes: 'Fastest Anthropic hosted option with solid screenshot reasoning.',
    instructions: 'Enable Cloud mode with your Ollama key. Select Claude 3 Haiku as the active model.'
  },
  {
    id: 'web-gemini15',
    label: 'Gemini 1.5 Flash (Ollama Cloud)',
    provider: 'Ollama Cloud',
    model: 'gemini-1.5-flash',
    endpoint: 'https://ollama.com/',
    url: 'https://ollama.com/models/gemini-1.5-flash',
    notes: 'High throughput hosted model ideal for large screenshot batches.',
    instructions: 'Use Ollama Cloud endpoint and key, then select Gemini 1.5 Flash as your model.'
  }
];

const WORKFLOW_PHASES = Object.freeze({
  PLANNING: 'planning',
  EXECUTION: 'execution'
});
const WORKFLOW_STORAGE_VERSION = 1;

function loadWorkflowPhasesFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.workflow);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.version === WORKFLOW_STORAGE_VERSION && parsed.sessions) {
        return parsed.sessions;
      }
      return parsed.sessions ? parsed.sessions : parsed;
    }
  } catch (error) {
    console.warn('Failed to parse workflow storage', error);
  }
  return {};
}

function persistWorkflowPhases() {
  try {
    localStorage.setItem(
      STORAGE_KEYS.workflow,
      JSON.stringify({
        version: WORKFLOW_STORAGE_VERSION,
        sessions: state.workflowPhases || {}
      })
    );
  } catch (error) {
    console.warn('Failed to persist workflow state', error);
  }
}

const MAX_CLIENT_IMAGE_DIMENSION = 1600;
const MAX_CLIENT_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CHAT_IMAGES = 4;

async function downscaleImageDataUrl(dataUrl, mimeType = 'image/png') {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxEdge = Math.max(image.width, image.height);
      const ratio = maxEdge > MAX_CLIENT_IMAGE_DIMENSION ? MAX_CLIENT_IMAGE_DIMENSION / maxEdge : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * ratio);
      canvas.height = Math.round(image.height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const targetMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      const quality = targetMime === 'image/png' ? 0.92 : 0.85;
      resolve(canvas.toDataURL(targetMime, quality));
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function estimateBase64Bytes(dataUrl = '') {
  if (!dataUrl) return 0;
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Math.round((base64.length * 3) / 4);
}

async function optimizeImageDataUrl(dataUrl, mimeType = 'image/png') {
  let optimized = dataUrl;
  let attempts = 0;
  while (estimateBase64Bytes(optimized) > MAX_CLIENT_IMAGE_BYTES && attempts < 3) {
    optimized = await downscaleImageDataUrl(optimized, mimeType);
    attempts += 1;
  }
  return {
    dataUrl: optimized,
    size: estimateBase64Bytes(optimized),
    type: mimeType
  };
}

async function captureScreenshotFrame() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen capture not supported in this browser');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: false
  });

  try {
    const [track] = stream.getVideoTracks();
    const video = document.createElement('video');
    video.srcObject = new MediaStream([track]);
    await video.play();
    await new Promise((resolve) => {
      if (video.readyState >= 2) {
        resolve();
      } else {
        video.onloadeddata = () => resolve();
      }
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png', 0.92);
    return {
      name: `Screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
      type: 'image/png',
      dataUrl
    };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

function loadModelReadinessFlag() {
  try {
    return localStorage.getItem(STORAGE_KEYS.modelReady) === 'true';
  } catch (_) {
    return false;
  }
}

function persistModelReadinessFlag(value) {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEYS.modelReady, 'true');
    } else {
      localStorage.removeItem(STORAGE_KEYS.modelReady);
    }
  } catch (_) {
    // ignore
  }
}

function hasUsableModel() {
  const activeModel = state.settings?.model;
  if (!activeModel) {
    return false;
  }
  const installed = state.availableModels.some((model) => model.name === activeModel);
  const ollamaMode = (state.settings?.ollamaMode || 'local').toLowerCase();
  const usingCloud = ollamaMode === 'cloud';
  const usingWebPreset = activeModel.toLowerCase().startsWith('web-');
  return Boolean(installed || usingCloud || usingWebPreset);
}

function isModelReadyForImages() {
  const ready = hasUsableModel();
  if (ready && !state.modelPrepAcknowledged) {
    state.modelPrepAcknowledged = true;
    persistModelReadinessFlag(true);
  }
  if (!ready && state.modelPrepAcknowledged) {
    state.modelPrepAcknowledged = false;
    persistModelReadinessFlag(false);
  }
  return ready;
}

function markModelReady(source = 'manual', options = {}) {
  if (!hasUsableModel()) {
    if (!options.silent) {
      showNotification('Select or install a model to enable screenshots.', 'warning', 2500);
    }
    return;
  }
  state.modelPrepAcknowledged = true;
  persistModelReadinessFlag(true);
  closeModelPrepModal({ silent: true });
  if (!options.silent) {
    showNotification('Model ready for image uploads.', 'success', 2200);
  }
  window.dispatchEvent(
    new CustomEvent('ollama-model-ready', { detail: { source, timestamp: Date.now() } })
  );
}

function evaluateModelReadiness(options = {}) {
  if (isModelReadyForImages()) {
    if (!options.skipEvent) {
      window.dispatchEvent(
        new CustomEvent('ollama-model-ready', { detail: { source: 'auto', timestamp: Date.now() } })
      );
    }
    return true;
  }
  return false;
}

function ensureModelReadyBeforeImages(reason = 'upload') {
  if (isModelReadyForImages()) {
    return true;
  }
  openModelPrepModal(reason);
  return false;
}

const initialThinkingPreference = loadThinkingPreference();
const initialWorkflowPhases = loadWorkflowPhasesFromStorage();

const state = {
  currentPage: 'home',  // Changed to 'home' as landing page
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
  thinkingEnabled: initialThinkingPreference,
  thinkingMode: DEFAULT_THINKING_MODE,
  instructionPresets: loadInstructionPresets(),
  currentImages: [],
  suggestedModels: [],
  modelPrepAcknowledged: loadModelReadinessFlag(),
  modelPrepLastReason: null,
  modelPrepModalOpen: false,
  workflowPhases: initialWorkflowPhases,

  // Dual-mode support fields
  currentMode: 'instant',  // 'instant' | 'planning'
  modeData: {
    instant: {
      images: [],
      quickPrompts: []
    },
    planning: {
      images: [],
      draftData: null,
      isLocked: false
    }
  },

  // Projects (Brain) module state
  projects: [],
  activeProjectId: null,
  brain: {
    lastPrompt: '',
    lastContextNotes: []
  }
};

persistThinkingPreference(state.thinkingEnabled);

let instructionPresetControlRegistry = [];
let presetRefreshPromise = null;

window.appState = state;

if (typeof window !== 'undefined') {
  window.WorkflowBridge = {
    getMountConfig: buildPlanningMountConfig,
    saveDraft: saveWorkflowPlanningDraft,
    completePlanning: completePlanningPhase,
    resetPlanning: resetPlanningPhase
  };
}

// Global navigation function for back buttons
window.navigateToPage = function(pageId) {
  state.currentPage = pageId;
  if (pageId === 'planning') {
    state.currentMode = 'planning';
  } else if (pageId === 'chat') {
    state.currentMode = 'instant';
  }
  renderNav();
  renderPage(pageId);
  updateModeIndicator();
};

// ==================== PROJECTS (BRAIN) MODULE ====================

function getProjectById(id) {
  return state.projects.find((p) => p.id === id) || null;
}

async function loadProjects(options = {}) {
  try {
    const data = await fetchJson('/api/projects', { method: 'GET' });
    state.projects = Array.isArray(data.projects) ? data.projects : [];
    if (!state.activeProjectId && state.projects.length > 0) {
      state.activeProjectId = state.projects[0].id;
    }
  } catch (error) {
    console.error('[Projects] Failed to load projects:', error);
    showNotification('Failed to load projects', 'error');
  } finally {
    if (!options.skipRender && state.currentPage === 'projects') {
      renderProjectsPage();
    }
  }
}

async function ensureActiveProject() {
  if (state.activeProjectId && getProjectById(state.activeProjectId)) {
    return state.activeProjectId;
  }
  try {
    const created = await fetchJson('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Brain',
        description: 'Central knowledge hub',
        tags: ['brain', 'default']
      })
    });
    state.projects.unshift(created);
    state.activeProjectId = created.id;
    return created.id;
  } catch (error) {
    console.error('[Projects] Failed to create default project:', error);
    showNotification('Failed to create default project', 'error');
    return null;
  }
}

function parseTags(inputValue) {
  return String(inputValue || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function renderProjectsList() {
  const list = document.getElementById('projects-list');
  if (!list) return;
  list.innerHTML = '';
  const projects = state.projects || [];
  if (!projects.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No projects yet. Click "New Project" to create one.';
    list.appendChild(empty);
    return;
  }
  projects
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .forEach((p) => {
      const item = document.createElement('button');
      item.className = 'sidebar-item';
      if (p.id === state.activeProjectId) item.classList.add('active');
      item.textContent = p.name || p.slug || p.id;
      item.addEventListener('click', () => {
        state.activeProjectId = p.id;
        renderProjectsPage();
      });
      list.appendChild(item);
    });
}

function fillProjectEditor(project) {
  const nameEl = document.getElementById('project-name-input');
  const descEl = document.getElementById('project-desc-input');
  const instrEl = document.getElementById('project-instr-input');
  const tagsEl = document.getElementById('project-tags-input');
  if (!nameEl || !descEl || !instrEl || !tagsEl) return;
  if (!project) {
    nameEl.value = '';
    descEl.value = '';
    instrEl.value = '';
    tagsEl.value = '';
    return;
  }
  nameEl.value = project.name || '';
  descEl.value = project.description || '';
  instrEl.value = project.instructions || '';
  tagsEl.value = (project.tags || []).join(', ');
}

function renderNotesList(project) {
  const container = document.getElementById('notes-list');
  if (!container) return;
  container.innerHTML = '';
  if (!project) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Select or create a project to add notes.';
    container.appendChild(empty);
    return;
  }
  const notes = Array.isArray(project.notes) ? project.notes : [];
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No notes yet. Add your first idea, instruction, or query.';
    container.appendChild(empty);
    return;
  }
  notes
    .slice()
    .reverse()
    .forEach((n) => {
      const row = document.createElement('div');
      row.className = 'list-item';
      const left = document.createElement('div');
      left.className = 'list-item-content';
      const title = document.createElement('div');
      title.className = 'list-item-title';
      title.textContent = `[${n.type}] ${((n.tags || [])[0] ? `#${n.tags[0]} ` : '')}${(n.content || '').slice(0, 80)}`;
      const body = document.createElement('div');
      body.className = 'list-item-subtitle';
      body.textContent = (n.content || '').slice(0, 240);
      left.appendChild(title);
      left.appendChild(body);
      const actions = document.createElement('div');
      actions.className = 'list-item-actions';
      const del = document.createElement('button');
      del.className = 'btn danger';
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        try {
          await fetchJson(`/api/projects/${project.id}/notes/${n.id}`, { method: 'DELETE' });
          const fresh = await fetchJson(`/api/projects/${project.id}`, { method: 'GET' });
          const idx = state.projects.findIndex((p) => p.id === project.id);
          if (idx !== -1) state.projects[idx] = fresh;
          renderProjectsPage();
          showNotification('Note deleted', 'success');
        } catch (error) {
          console.error('[Projects] Delete note failed:', error);
          showNotification('Failed to delete note', 'error');
        }
      });
      actions.appendChild(del);
      row.appendChild(left);
      row.appendChild(actions);
      container.appendChild(row);
    });
}

async function handleProjectSave() {
  const projectId = state.activeProjectId;
  const name = document.getElementById('project-name-input')?.value || '';
  const description = document.getElementById('project-desc-input')?.value || '';
  const instructions = document.getElementById('project-instr-input')?.value || '';
  const tags = parseTags(document.getElementById('project-tags-input')?.value || '');
  try {
    if (projectId && getProjectById(projectId)) {
      const updated = await fetchJson(`/api/projects/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, description, instructions, tags })
      });
      const idx = state.projects.findIndex((p) => p.id === projectId);
      if (idx !== -1) state.projects[idx] = updated;
      showNotification('Project saved', 'success');
    } else {
      const created = await fetchJson('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, description, tags, instructions })
      });
      state.projects.unshift(created);
      state.activeProjectId = created.id;
      showNotification('Project created', 'success');
    }
    renderProjectsPage();
  } catch (error) {
    console.error('[Projects] Save failed:', error);
    showNotification('Failed to save project', 'error');
  }
}

async function handleProjectDelete() {
  const projectId = state.activeProjectId;
  if (!projectId) return;
  try {
    await fetchJson(`/api/projects/${projectId}`, { method: 'DELETE' });
    state.projects = state.projects.filter((p) => p.id !== projectId);
    state.activeProjectId = state.projects[0]?.id || null;
    renderProjectsPage();
    showNotification('Project deleted', 'success');
  } catch (error) {
    console.error('[Projects] Delete failed:', error);
    showNotification('Failed to delete project', 'error');
  }
}

async function handleAddNote() {
  const projectId = await ensureActiveProject();
  if (!projectId) return;
  const type = document.getElementById('note-type-select')?.value || 'note';
  const content = document.getElementById('note-content-input')?.value || '';
  const tags = parseTags(document.getElementById('note-tags-input')?.value || '');
  if (!content.trim()) {
    showNotification('Note content is required', 'warning');
    return;
  }
  try {
    const result = await fetchJson(`/api/projects/${projectId}/notes`, {
      method: 'POST',
      body: JSON.stringify({
        type,
        content,
        tags,
        source: {
          mode: state.currentMode,
          sessionId: state.activeSessionId
        }
      })
    });
    const fresh = await fetchJson(`/api/projects/${projectId}`, { method: 'GET' });
    const idx = state.projects.findIndex((p) => p.id === projectId);
    if (idx !== -1) state.projects[idx] = fresh;
    const cEl = document.getElementById('note-content-input');
    const tEl = document.getElementById('note-tags-input');
    if (cEl) cEl.value = '';
    if (tEl) tEl.value = '';
    renderProjectsPage();
    showNotification('Note added', 'success');
    return result;
  } catch (error) {
    console.error('[Projects] Add note failed:', error);
    showNotification('Failed to add note', 'error');
    return null;
  }
}

async function handleSearchNotes() {
  const inputEl = document.getElementById('project-search-input');
  const container = document.getElementById('notes-list');
  if (!inputEl || !container) return;
  const query = inputEl.value.trim();
  if (!query) {
    renderProjectsPage();
    return;
  }
  try {
    const projectId = state.activeProjectId;
    const resp = await fetchJson('/api/projects/search', {
      method: 'POST',
      body: JSON.stringify({ query, projectId })
    });
    const results = Array.isArray(resp.results) ? resp.results : [];
    const resultBlock = document.createElement('div');
    resultBlock.className = 'panel search-results';
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `<h3>Search Results (${results.length})</h3>`;
    const body = document.createElement('div');
    body.className = 'panel-body';
    results.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const left = document.createElement('div');
      left.className = 'list-item-content';
      const title = document.createElement('div');
      title.className = 'list-item-title';
      title.textContent = `${r.projectName || 'Project'} — score ${r.score}`;
      const sub = document.createElement('div');
      sub.className = 'list-item-subtitle';
      sub.textContent = r.snippet || '';
      left.appendChild(title);
      left.appendChild(sub);
      item.appendChild(left);
      item.addEventListener('click', () => {
        if (r.projectId) {
          state.activeProjectId = r.projectId;
          renderProjectsPage();
        }
      });
      body.appendChild(item);
    });
    container.innerHTML = '';
    container.appendChild(resultBlock);
  } catch (error) {
    console.error('[Projects] Search failed:', error);
    showNotification('Search failed', 'error');
  }
}

async function handleBrainGenerate() {
  const input = document.getElementById('brain-input')?.value || '';
  const output = document.getElementById('brain-output');
  if (!input.trim()) {
    showNotification('Enter an idea or plan to generate a prompt', 'warning');
    return;
  }
  try {
    const resp = await fetchJson('/api/brain/prompt', {
      method: 'POST',
      body: JSON.stringify({
        input,
        projectId: state.activeProjectId || undefined
      })
    });
    state.brain.lastPrompt = resp.prompt || '';
    state.brain.lastContextNotes = resp.contextNotes || [];
    if (output) output.value = state.brain.lastPrompt;
    showNotification('Prompt generated', 'success');
  } catch (error) {
    console.error('[Brain] Prompt generation failed:', error);
    showNotification('Failed to generate prompt', 'error');
  }
}

async function handleBrainCopy() {
  const output = document.getElementById('brain-output');
  if (!output || !output.value) return;
  try {
    await navigator.clipboard.writeText(output.value);
    showNotification('Prompt copied to clipboard', 'success');
  } catch {
    showNotification('Failed to copy prompt', 'error');
  }
}

function setChatInputValue(text) {
  state.currentPage = 'chat';
  renderPage('chat');
  setTimeout(() => {
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = text || '';
      input.focus();
    }
  }, 0);
}

function handleBrainSendToInstant() {
  const output = document.getElementById('brain-output');
  if (!output || !output.value) {
    showNotification('No prompt to send', 'warning');
    return;
  }
  setChatInputValue(output.value);
  showNotification('Prompt placed into Instant chat', 'success');
}

// Integration function to capture ideas from Instant/Planning to Projects
async function captureIdeaFromMode(content, options = {}) {
  try {
    const projectId = await ensureActiveProject();
    if (!projectId || !content || !content.trim()) {
      return null;
    }

    const result = await fetchJson(`/api/projects/${projectId}/notes`, {
      method: 'POST',
      body: JSON.stringify({
        type: options.type || 'idea',
        content: content.trim(),
        tags: options.tags || [],
        source: {
          mode: state.currentMode || 'instant',
          sessionId: state.activeSessionId,
          timestamp: new Date().toISOString()
        }
      })
    });

    // Update local state
    const fresh = await fetchJson(`/api/projects/${projectId}`, { method: 'GET' });
    const idx = state.projects.findIndex((p) => p.id === projectId);
    if (idx !== -1) {
      state.projects[idx] = fresh;
    }

    // Show success notification
    if (typeof showNotification === 'function') {
      showNotification('Idea captured to Projects', 'success');
    }

    return result;
  } catch (error) {
    console.error('[Brain] Capture from mode failed:', error);
    if (typeof showNotification === 'function') {
      showNotification('Failed to capture idea', 'error');
    }
    return null;
  }
}

// Function to send content from other modes to the Brain
async function sendToBrainGenerator(content) {
  if (!content || !content.trim()) {
    if (typeof showNotification === 'function') {
      showNotification('No content to process', 'warning');
    }
    return;
  }

  try {
    // Switch to projects page
    state.currentPage = 'projects';
    renderPage('projects');
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Fill the brain input
    const brainInput = document.getElementById('brain-input');
    if (brainInput) {
      brainInput.value = content.trim();
    }
    
    // Generate the prompt
    await handleBrainGenerate();
    
    // Show success
    if (typeof showNotification === 'function') {
      showNotification('Content sent to Brain for processing', 'success');
    }
  } catch (error) {
    console.error('[Brain] Send to generator failed:', error);
    if (typeof showNotification === 'function') {
      showNotification('Failed to send to Brain', 'error');
    }
  }
}

// Enhanced integration functions
function addBrainIntegrationToChat() {
  // Add a button to capture current chat context to projects
  const chatInput = document.getElementById('chat-input');
  if (!chatInput) return;

  // Add event listener for a special keyboard shortcut
  chatInput.addEventListener('keydown', (e) => {
    // Ctrl+Shift+S to send selection to projects
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      const selectedText = window.getSelection?.()?.toString()?.trim();
      if (selectedText) {
        captureIdeaFromMode(selectedText, { type: 'note', tags: ['from-chat'] });
      }
    }
  });

  // Add context menu or button to send current input to brain
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) {
    // Create a secondary button for brain processing
    const brainBtn = document.createElement('button');
    brainBtn.className = 'attach-button';
    brainBtn.title = 'Send to AI Brain for refinement';
    brainBtn.innerHTML = `🧠`;
    brainBtn.addEventListener('click', async () => {
      const input = document.getElementById('chat-input');
      if (input && input.value.trim()) {
        await sendToBrainGenerator(input.value);
      }
    });

    // Insert the brain button before the send button
    const inputBox = document.querySelector('.input-box') || sendBtn.closest('.input-box');
    if (inputBox) {
      inputBox.insertBefore(brainBtn, sendBtn);
    }
  }
}

// Add integration to planning mode as well
function addBrainIntegrationToPlanning() {
  const planningInput = document.getElementById('planning-input');
  if (!planningInput) return;

  planningInput.addEventListener('keydown', (e) => {
    // Ctrl+Shift+S to capture selection
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      const selectedText = window.getSelection?.()?.toString()?.trim();
      if (selectedText) {
        captureIdeaFromMode(selectedText, { type: 'note', tags: ['from-planning'] });
      }
    }
  });
}

async function handleProjectsExport() {
  try {
    const data = await fetchJson('/api/projects/backup', { method: 'GET' });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().split('T')[0];
    a.download = `projects-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  } catch (error) {
    console.error('[Projects] Export failed:', error);
    showNotification('Export failed', 'error');
  }
}

async function handleProjectsImport(file) {
  try {
    const text = await readFileAsText(file);
    const payload = JSON.parse(text);
    await fetchJson('/api/projects/restore', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    await loadProjects({ skipRender: true });
    renderProjectsPage();
    showNotification('Projects restored', 'success');
  } catch (error) {
    console.error('[Projects] Import failed:', error);
    showNotification('Import failed', 'error');
  }
}

function renderProjectsPage() {
  if (state.currentPage !== 'projects') return;
  if (!state.projects || !state.projects.length) {
    loadProjects({ skipRender: false });
  }
  renderProjectsList();
  const project = state.activeProjectId ? getProjectById(state.activeProjectId) : null;
  fillProjectEditor(project);
  renderNotesList(project);

  const backBtn = document.getElementById('projects-back-to-chat');
  backBtn?.addEventListener('click', () => {
    state.currentPage = 'chat';
    renderPage('chat');
  });

  const newBtn = document.getElementById('projects-new-btn');
  newBtn?.addEventListener('click', async () => {
    try {
      const created = await fetchJson('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Untitled Project', description: '', tags: [] })
      });
      state.projects.unshift(created);
      state.activeProjectId = created.id;
      renderProjectsPage();
      showNotification('Project created', 'success');
    } catch (error) {
      console.error('[Projects] New failed:', error);
      showNotification('Failed to create project', 'error');
    }
  });

  document.getElementById('project-save-btn')?.addEventListener('click', handleProjectSave);
  document.getElementById('project-delete-btn')?.addEventListener('click', handleProjectDelete);
  document.getElementById('note-add-btn')?.addEventListener('click', handleAddNote);

  document.getElementById('project-search-btn')?.addEventListener('click', handleSearchNotes);
  document.getElementById('project-search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearchNotes();
  });

  document.getElementById('brain-generate-btn')?.addEventListener('click', handleBrainGenerate);
  document.getElementById('brain-copy-btn')?.addEventListener('click', handleBrainCopy);
  document.getElementById('brain-send-instant-btn')?.addEventListener('click', handleBrainSendToInstant);

  document.getElementById('projects-export-btn')?.addEventListener('click', handleProjectsExport);
  document.getElementById('projects-import-btn')?.addEventListener('click', () => {
    document.getElementById('projects-import-file').click();
  });
  document.getElementById('projects-import-file')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleProjectsImport(file);
    e.target.value = '';
  });
}

// Public Brain API for other modules
async function captureIdeaToProject(content, { type = 'note', tags = [], source = {} } = {}) {
  const projectId = await ensureActiveProject();
  if (!projectId || !content || !content.trim()) return null;
  try {
    return await fetchJson(`/api/projects/${projectId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ type, content, tags, source })
    });
  } catch (error) {
    console.error('[Brain] Capture failed:', error);
    return null;
  }
}

// Enhanced Brain API with more functionality
if (typeof window !== 'undefined') {
  window.BrainAPI = {
    capture: captureIdeaToProject,
    generatePrompt: async (input, projectId) => {
      return fetchJson('/api/brain/prompt', {
        method: 'POST',
        body: JSON.stringify({ input, projectId })
      });
    },
    sendToBrain: sendToBrainGenerator,
    captureFromMode: captureIdeaFromMode,
    ensureActiveProject: ensureActiveProject,
    getActiveProject: () => state.activeProjectId ? getProjectById(state.activeProjectId) : null,
    search: async (query, options = {}) => {
      return fetchJson('/api/projects/search', {
        method: 'POST',
        body: JSON.stringify({
          query,
          projectId: options.projectId,
          limit: options.limit || 10
        })
      });
    }
  };
}

/**
 * Enhanced Error Handling and Privacy Safeguards
 */

// Sanitize user input to prevent XSS and other security issues
function sanitizeInput(text) {
  if (!text) return '';
  return String(text)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, 'jscript:')
    .trim();
}

// Enhanced error handling with fallbacks
function safeApiCall(endpoint, options = {}) {
  return fetchJson(endpoint, options)
    .catch(error => {
      console.error(`API call failed: ${endpoint}`, error);
      // Return a safe fallback response based on the endpoint
      if (endpoint.includes('/search')) {
        return { results: [], query: '' };
      } else if (endpoint.includes('/backup')) {
        return { projects: {}, exportedAt: new Date().toISOString() };
      } else {
        return null;
      }
    });
}

// Privacy safeguards - ensure sensitive data is not exposed
function sanitizeProjectData(project) {
  if (!project) return null;
  
  // Only return safe project properties
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    tags: project.tags || [],
    noteCount: Array.isArray(project.notes) ? project.notes.length : 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

// Enhanced privacy protection for notes
function sanitizeNoteData(note) {
  if (!note) return null;
  
  return {
    id: note.id,
    type: note.type,
    tags: note.tags || [],
    content: note.content ? note.content.substring(0, 2000) : '', // Limit content length
    createdAt: note.createdAt,
    updatedAt: note.updatedAt
  };
}

// Add privacy-focused project loading with sanitization
async function loadProjectsSecure(options = {}) {
  try {
    const data = await safeApiCall('/api/projects');
    if (!data || !Array.isArray(data.projects)) {
      state.projects = [];
      return;
    }

    // Sanitize projects before storing
    state.projects = data.projects.map(sanitizeProjectData).filter(Boolean);
    
    if (!state.activeProjectId && state.projects.length > 0) {
      state.activeProjectId = state.projects[0].id;
    }
  } catch (error) {
    console.error('[Projects] Security-hardened load failed:', error);
    state.projects = [];
    if (typeof showNotification === 'function') {
      showNotification('Failed to load projects securely', 'error');
    }
  } finally {
    if (!options.skipRender && state.currentPage === 'projects') {
      renderProjectsPage();
    }
  }
}

// Enhanced error handling for project operations
async function createProjectSecure(name, description, tags = []) {
  try {
    const sanitizedInput = {
      name: sanitizeInput(name || ''),
      description: sanitizeInput(description || ''),
      tags: Array.isArray(tags) 
        ? tags.map(tag => sanitizeInput(tag)).slice(0, 50) 
        : [],
      instructions: sanitizeInput(options?.instructions || '')
    };

    const response = await safeApiCall('/api/projects', {
      method: 'POST',
      body: JSON.stringify(sanitizedInput)
    });

    if (response && response.id) {
      state.projects.unshift(response);
      state.activeProjectId = response.id;
      return response;
    } else {
      throw new Error('Invalid response from server');
    }
  } catch (error) {
    console.error('[Projects] Secure creation failed:', error);
    if (typeof showNotification === 'function') {
      showNotification('Failed to create project securely', 'error');
    }
    return null;
  }
}

// ==================== MODAL UTILITIES ====================

/**
 * Show a permission modal asking user to confirm an action
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @param {Object} options - Additional options
 * @returns {Promise<boolean>} - Resolves true if user approved, false if denied
 */
function askPermission(title, message, options = {}) {
  return new Promise((resolve) => {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
    `;

    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: var(--surface);
      border-radius: 16px;
      padding: 2rem;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border);
    `;

    // Modal HTML
    modal.innerHTML = `
      <div style="margin-bottom: 1.5rem;">
        <h3 style="margin: 0 0 0.75rem 0; color: var(--text); font-size: 1.25rem;">${escapeHtml(title)}</h3>
        <p style="margin: 0; color: var(--text-light); line-height: 1.5;">${escapeHtml(message)}</p>
        ${options.details ? `<p style="margin: 0.75rem 0 0 0; color: var(--text-light); font-size: 0.875rem; font-family: monospace; background: var(--hover); padding: 0.5rem; border-radius: 4px;">${escapeHtml(options.details)}</p>` : ''}
      </div>
      <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
        <button id="modal-cancel-btn" style="
          padding: 0.625rem 1.25rem;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text);
          cursor: pointer;
          font-size: 0.95rem;
        ">${options.cancelLabel || 'Cancel'}</button>
        <button id="modal-confirm-btn" style="
          padding: 0.625rem 1.25rem;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #0084ff 0%, #0066cc 100%);
          color: white;
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 600;
        ">${options.confirmLabel || 'Confirm'}</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Event handlers
    const cleanup = () => {
      overlay.remove();
    };

    document.getElementById('modal-cancel-btn').addEventListener('click', () => {
      cleanup();
      resolve(false);
    });

    document.getElementById('modal-confirm-btn').addEventListener('click', () => {
      cleanup();
      resolve(true);
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(false);
      }
    });

    // Close on escape key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(false);
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);
  });
}

/**
 * Handle vision-aware image upload with automatic model detection
 * @param {FileList|Array} files - Image files to upload
 * @returns {Promise<Object>} - Upload result with vision check data
 */
async function handleVisionAwareUpload(files) {
  try {
    const imageFiles = Array.from(files);
    const imageCount = imageFiles.length;

    // Check vision capabilities
    const visionCheck = await fetch('/api/vision/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageCount })
    });

    if (!visionCheck.ok) {
      throw new Error('Failed to check vision capabilities');
    }

    const visionData = await visionCheck.json();

    // If model needs to be pulled, ask for permission
    if (visionData.needsPull && visionData.suggestedModel) {
      const modelName = visionData.suggestedModel;
      const approved = await askPermission(
        'Vision Model Required',
        `To process images, we need to download the ${modelName} vision model from Ollama.`,
        {
          details: `This will download approximately 3-5GB of data. The model will be cached for future use.`,
          confirmLabel: `Pull ${modelName}`,
          cancelLabel: 'Cancel'
        }
      );

      if (!approved) {
        return { success: false, cancelled: true };
      }

      // Pull the model with streaming progress
      const pullResult = await pullModelWithProgress(modelName);
      if (!pullResult.success) {
        throw new Error('Failed to pull vision model');
      }

      visionData.model = modelName;
      visionData.needsPull = false;
    }

    // Process images (convert to base64, etc.)
    const processedImages = await Promise.all(
      imageFiles.map(file => convertImageToBase64(file))
    );

    return {
      success: true,
      images: processedImages,
      visionData,
      count: imageCount
    };

  } catch (error) {
    console.error('[VisionUpload] Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Pull a model with streaming progress feedback
 * @param {string} modelName - Name of model to pull
 * @returns {Promise<Object>} - Pull result
 */
async function pullModelWithProgress(modelName) {
  return new Promise((resolve) => {
    // Create progress modal
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 10001;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: var(--surface); border-radius: 16px; padding: 2rem;
      max-width: 400px; width: 90%; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    `;

    modal.innerHTML = `
      <h3 style="margin: 0 0 1rem 0; color: var(--text);">Downloading ${escapeHtml(modelName)}</h3>
      <div id="pull-progress" style="color: var(--text-light); margin-bottom: 1rem;">Starting download...</div>
      <div style="background: var(--hover); height: 8px; border-radius: 4px; overflow: hidden;">
        <div id="pull-progress-bar" style="background: linear-gradient(90deg, #0084ff, #0066cc); height: 100%; width: 0%; transition: width 0.3s;"></div>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Start streaming pull
    fetch('/api/models/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelName })
    })
    .then(response => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processStream = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim().startsWith('data:')) {
              try {
                const data = JSON.parse(line.slice(5).trim());

                // Update progress
                if (data.status === 'pulling') {
                  const progressEl = document.getElementById('pull-progress');
                  const progressBar = document.getElementById('pull-progress-bar');

                  if (progressEl && data.completed && data.total) {
                    const percent = Math.round((data.completed / data.total) * 100);
                    progressEl.textContent = `Downloading: ${percent}%`;
                    if (progressBar) progressBar.style.width = `${percent}%`;
                  }
                } else if (data.status === 'complete') {
                  overlay.remove();
                  resolve({ success: true });
                  return;
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      };

      processStream().catch(error => {
        console.error('[PullModel] Stream error:', error);
        overlay.remove();
        resolve({ success: false, error: error.message });
      });
    })
    .catch(error => {
      console.error('[PullModel] Fetch error:', error);
      overlay.remove();
      resolve({ success: false, error: error.message });
    });
  });
}

/**
 * Convert image file to base64
 * @param {File} file - Image file
 * @returns {Promise<string>} - Base64 data URL
 */
function convertImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==================== END MODAL UTILITIES ====================

const elements = {
  nav: null,
  root: null,
  status: null,
  activeModel: null
};

// Wait for DOM to be ready before initializing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOM already loaded
  initializeApp();
}

function initializeApp() {
  // Get DOM elements after DOM is ready
  elements.nav = document.getElementById('page-nav');
  elements.root = document.getElementById('page-root');
  elements.status = document.getElementById('connection-status');
  elements.activeModel = document.getElementById('active-model');

  // Now initialize the app
  init();
}

async function init() {
  // Start error monitoring for auto-cleanup
  startErrorMonitoring();
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

/**
 * Validate settings object for integrity
 * @param {Object} settings - Settings to validate
 * @returns {Object} - Validated and sanitized settings
 */
function validateSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    console.warn('[Settings] Invalid settings object, using defaults');
    return {};
  }

  const validated = { ...settings };

  // Validate model name (alphanumeric, dots, hyphens, underscores, colons)
  if (validated.model && !/^[a-zA-Z0-9._:-]+$/.test(validated.model)) {
    console.warn('[Settings] Invalid model name:', validated.model);
    delete validated.model;
  }

  // Validate API endpoint
  if (validated.apiEndpoint) {
    try {
      new URL(validated.apiEndpoint);
    } catch (e) {
      console.warn('[Settings] Invalid API endpoint:', validated.apiEndpoint);
      delete validated.apiEndpoint;
    }
  }

  // Validate maxHistory (must be positive integer)
  if (validated.maxHistory !== undefined) {
    const maxHistory = parseInt(validated.maxHistory, 10);
    if (isNaN(maxHistory) || maxHistory < 0 || maxHistory > 1000) {
      console.warn('[Settings] Invalid maxHistory:', validated.maxHistory);
      validated.maxHistory = 20;
    } else {
      validated.maxHistory = maxHistory;
    }
  }

  // Validate thinking mode
  const validThinkingModes = ['off', 'standard', 'max'];
  if (validated.thinkingMode && !validThinkingModes.includes(validated.thinkingMode)) {
    console.warn('[Settings] Invalid thinking mode:', validated.thinkingMode);
    validated.thinkingMode = 'max';
  }

  // Validate boolean settings
  const booleanSettings = ['enableStructuredPrompts', 'autoSync'];
  booleanSettings.forEach(key => {
    if (validated[key] !== undefined && typeof validated[key] !== 'boolean') {
      validated[key] = Boolean(validated[key]);
    }
  });

  return validated;
}

/**
 * Persist settings with integrity hash
 * @param {Object} settings - Settings to persist
 */
async function persistSettingsWithIntegrity(settings) {
  try {
    const validated = validateSettings(settings);
    const response = await fetchJson('/api/settings', {
      method: 'POST',
      body: JSON.stringify(validated)
    });

    if (response.success) {
      console.log('[Settings] Persisted successfully with integrity check');
      showNotification('Settings saved successfully', 'success', 2000);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[Settings] Failed to persist:', error);
    showNotification('Failed to save settings', 'error', 3000);
    return false;
  }
}

async function bootstrapSettings() {
  try {
    const data = await fetchJson('/api/settings');

    // Validate presets
    state.instructionPresets = normalizeInstructionPresets(
      data.presets,
      data.defaults?.systemInstructions || data.current?.systemInstructions
    );
    persistInstructionPresets(state.instructionPresets);
    refreshInstructionPresetControls();

    const normalizedBase = normalizeBaseUrl(data.current?.backendBaseUrl);

    // Preserve client-side settings stored locally
    const preservedSettings = {
      enableStructuredPrompts: state.settings?.enableStructuredPrompts === true
    };

    // Validate and merge settings
    const rawSettings = {
      ...data.current,
      backendBaseUrl: normalizedBase,
      ...preservedSettings
    };

    state.settings = validateSettings(rawSettings);
    state.baseUrl = normalizedBase;
    state.settings.thinkingMode = DEFAULT_THINKING_MODE;
    state.thinkingMode = DEFAULT_THINKING_MODE;
    state.settings.enableStructuredPrompts =
      typeof data.current?.enableStructuredPrompts !== 'undefined'
        ? data.current.enableStructuredPrompts === true
        : preservedSettings.enableStructuredPrompts === true;
    if (typeof state.settings.enableStructuredPrompts === 'undefined') {
      state.settings.enableStructuredPrompts = false;
    }
    applyTheme(state.settings.theme);
    persistClientSettings();
    notifySettingsSubscribers();
    renderVisionProviderDetails();
    updateVisionBridgeStatus();
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
      elements.activeModel.textContent = 'model: --';
    }
    restoreClientSettings();
    if (!state.instructionPresets || !state.instructionPresets.length) {
      state.instructionPresets = loadInstructionPresets();
    }
    refreshInstructionPresetControls();
    state.baseUrl = normalizeBaseUrl(state.settings?.backendBaseUrl);
    const structuredSetting = state.settings?.enableStructuredPrompts;
    state.settings = {
      ...(state.settings || {}),
      backendBaseUrl: state.baseUrl,
      enableStructuredPrompts: structuredSetting === true
    };
    notifySettingsSubscribers();
    renderVisionProviderDetails();
    updateVisionBridgeStatus();
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
    syncWorkflowStateWithSessions();
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
    syncModeFromActiveSession(); // Sync mode from session
    renderSessionSelector();
    renderChatSessionsList();
    renderHistoryPage();
    updateSessionInstructionsPreview();
    notifySettingsSubscribers();
  } catch (error) {
    console.error('Failed to load sessions', error);
    if (!state.activeSessionId) {
      state.activeSessionId = 'default';
    }
    // Update connection status to offline if there's a connection error
    if (
      error.message &&
      (error.message.includes('connect') || error.message.includes('fetch') || error.message.includes('offline')) &&
      elements.status
    ) {
      elements.status.textContent = 'offline';
      elements.status.classList.remove('badge-online');
      elements.status.classList.add('badge-offline');
    }
  }
}

/**
 * Retry wrapper with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} - Result of successful execution
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    onRetry = null
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = Math.min(initialDelay * Math.pow(backoffFactor, attempt), maxDelay);
        console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed. Retrying in ${delay}ms...`, error.message);

        if (onRetry) {
          onRetry(attempt + 1, delay, error);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Verify model is actually available and functional
 * @param {string} modelName - Model to verify
 * @returns {Promise<boolean>} - True if model is verified
 */
async function verifyModel(modelName) {
  try {
    const data = await fetchJson('/api/models');
    const models = data.models || [];
    return models.some(m => m.name === modelName);
  } catch (error) {
    console.error('[Model Verification] Failed:', error);
    return false;
  }
}

/**
 * Clean up persistent error states
 * Removes error flags older than threshold
 */
function cleanupPersistentErrors() {
  const ERROR_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();

  // Clean up model load errors
  if (state.modelLoadError && (now - state.modelLoadError.timestamp) > ERROR_EXPIRY_MS) {
    console.log('[Error Cleanup] Removing expired model load error');
    delete state.modelLoadError;
  }

  // Clean up streaming errors
  if (state.streamError && (now - state.streamError.timestamp) > ERROR_EXPIRY_MS) {
    console.log('[Error Cleanup] Removing expired stream error');
    delete state.streamError;
  }

  // Clean up connection errors
  if (state.connectionError && (now - state.connectionError.timestamp) > ERROR_EXPIRY_MS) {
    console.log('[Error Cleanup] Removing expired connection error');
    delete state.connectionError;
  }
}

/**
 * Reset stuck state (when streaming hangs, etc.)
 */
function resetStuckState() {
  console.log('[State Reset] Resetting potentially stuck state');

  // Abort any ongoing streams
  if (state.streamController) {
    try {
      state.streamController.abort();
    } catch (e) {
      console.warn('[State Reset] Error aborting stream:', e);
    }
    state.streamController = null;
  }

  // Reset streaming flag
  if (state.isStreaming) {
    state.isStreaming = false;
  }

  // Reset session sending states
  Object.keys(state.sessionSendingStates || {}).forEach(sessionId => {
    if (state.sessionSendingStates[sessionId]) {
      console.log(`[State Reset] Resetting stuck sending state for session ${sessionId}`);
      state.sessionSendingStates[sessionId] = false;
    }
  });

  // Re-enable UI elements
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) {
    sendBtn.disabled = false;
  }

  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.disabled = false;
  }

  // Clear any lingering error messages
  cleanupPersistentErrors();

  console.log('[State Reset] State reset complete');
  showNotification('State reset successfully', 'success', 2000);
}

/**
 * Monitor for persistent errors and auto-cleanup
 * Runs every minute to check for stale error states
 */
function startErrorMonitoring() {
  // Run cleanup every minute
  setInterval(() => {
    cleanupPersistentErrors();

    // Check for stuck streaming state (streaming flag set but no controller)
    if (state.isStreaming && !state.streamController) {
      const elapsedTime = Date.now() - (state.lastStreamStart || 0);
      // If stuck for more than 2 minutes, auto-reset
      if (elapsedTime > 120000) {
        console.warn('[Error Monitor] Detected stuck streaming state, auto-resetting');
        resetStuckState();
      }
    }
  }, 60000); // Every minute
}

/**
 * Graceful degradation - fallback model selection
 * @returns {string|null} - Fallback model name
 */
function getFallbackModel() {
  const fallbackPriority = [
    'qwen3:1.7B',
    'llama2:latest',
    'mistral:latest',
    'phi3:latest'
  ];

  for (const modelName of fallbackPriority) {
    if (state.availableModels.some(m => m.name === modelName)) {
      console.log(`[Fallback] Using fallback model: ${modelName}`);
      return modelName;
    }
  }

  // If no preferred fallback, use first available model
  if (state.availableModels.length > 0) {
    const firstModel = state.availableModels[0].name;
    console.log(`[Fallback] Using first available model: ${firstModel}`);
    return firstModel;
  }

  return null;
}

async function loadAvailableModels() {
  try {
    const data = await retryWithBackoff(
      () => fetchJson('/api/models'),
      {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 5000,
        onRetry: (attempt, delay, error) => {
          console.log(`[Model Loading] Retry ${attempt}/3 after ${delay}ms due to: ${error.message}`);
          showNotification(`Retrying model load (${attempt}/3)...`, 'info', 2000);
        }
      }
    );

    state.availableModels = data.models || [];
    console.log(`[Model Loading] Successfully loaded ${state.availableModels.length} models`);

    renderModelPrepModalSections();
    evaluateModelReadiness();
    if (document.getElementById('model-selector')) {
      renderModelSelector();
      updateThinkingStatus();
    }
    await ensureValidModelSelection('model-load');

    // Clear any error state
    if (state.modelLoadError) {
      delete state.modelLoadError;
    }
    clearPersistentError('model-load');
  } catch (error) {
    console.error('[Model Loading] Failed after retries:', error);
    state.availableModels = [];
    state.modelLoadError = {
      message: error.message,
      timestamp: Date.now()
    };
    registerPersistentError('model-load', error);

    // Update connection status to offline if there's a connection error
    if (elements.status) {
      elements.status.textContent = 'offline';
      elements.status.classList.remove('badge-online');
      elements.status.classList.add('badge-offline');
    }

    // Show user-friendly error message
    showNotification('Failed to load models. Check if Ollama is running.', 'error', 5000);
  }
}

async function ensureValidModelSelection(context = 'bootstrap') {
  const selectedModel = state.settings?.model;
  if (selectedModel && state.availableModels.some((model) => model.name === selectedModel)) {
    clearPersistentError('model-validation');
    return true;
  }

  if (selectedModel) {
    const exists = await verifyModel(selectedModel);
    if (exists) {
      return true;
    }
    registerPersistentError('model-validation', new Error(`Model ${selectedModel} unavailable`));
    showNotification(`Model ${selectedModel} not detected. Selecting fallback.`, 'warning', 3000);
  }

  const fallback = getFallbackModel();
  if (fallback) {
    state.settings = state.settings || {};
    state.settings.model = fallback;
    persistClientSettings();
    if (elements.activeModel) {
      elements.activeModel.textContent = `model: ${fallback}`;
    }
    renderModelSelector();
    renderChatMeta();
    clearPersistentError('model-validation');
    return true;
  }
  return false;
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
    const serverHistory = Array.isArray(data.history) ? data.history : [];
    const localBackup = Array.isArray(state.localHistory[sessionId]) ? state.localHistory[sessionId] : [];
    const mergedHistory = serverHistory.length ? serverHistory : localBackup;
    state.sessionHistories[sessionId] = mergedHistory;
    if (sessionId === state.activeSessionId) {
      state.chat = state.sessionHistories[sessionId];
    }
    state.localHistory[sessionId] = mergedHistory;
    persistLocalHistory();
    if (state.currentPage === 'chat') {
      renderChatMessages();
    } else {
      toggleEmptyHero(!(state.sessionHistories[sessionId] && state.sessionHistories[sessionId].length));
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
  const buttons = Object.values(registry)
    .filter((page) => !page.hidden)
    .map((page) => {
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

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pagechange', { detail: { page: pageId } }));
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

  if (templateId !== 'chat-page' && window.__workflowPhaseHandler) {
    window.removeEventListener('workflow-phase-change', window.__workflowPhaseHandler);
    window.__workflowPhaseHandler = null;
  }

  switch (templateId) {
    case 'home-page':
      attachHomeHandlers();
      break;
    case 'chat-page':
      attachChatHandlers();
      break;
    case 'planning-page':
      // Initialize planning module if available
      if (window.PlanningModule && typeof window.PlanningModule.init === 'function') {
        window.PlanningModule.init();
      } else if (typeof attachPlanningHandlers === 'function') {
        attachPlanningHandlers();
      } else {
        console.warn('[Planning] Planning module not loaded');
      }
      break;
    case 'projects-page':
      renderProjectsPage();
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

// Attach event handlers for the home page
function attachHomeHandlers() {
  // Mode selection buttons
  const modeButtons = document.querySelectorAll('.mode-select-btn');
  modeButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      await handleModeSelection(mode);
    });
  });

  // Settings button
  const settingsBtn = document.getElementById('home-settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      state.currentPage = 'settings';
      renderPage('settings');
    });
  }

  // Add hover effects for mode cards
  const modeCards = document.querySelectorAll('.mode-card');
  modeCards.forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode;
      if (mode) {
        const btn = card.querySelector('.mode-select-btn');
        if (btn) btn.click();
      }
    });
  });
}

// Handle mode selection from home page
async function handleModeSelection(mode) {
  try {
    // Update state mode
    state.currentMode = mode;

    // Use existing active session or default session
    let activeSession = state.sessions.find(s => s.id === state.activeSessionId);

    // If no active session, use default or create one
    if (!activeSession) {
      activeSession = state.sessions.find(s => s.id === 'default');
    }

    // If still no session, create a new one
    if (!activeSession) {
      const sessionName = mode === 'instant'
        ? `Instant Chat - ${new Date().toLocaleDateString()}`
        : `Planning Session - ${new Date().toLocaleDateString()}`;

      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sessionName,
          mode: mode,
          instructions: ''
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      const payload = await response.json();
      activeSession = payload?.session || payload;

      if (!activeSession?.id) {
        throw new Error('Server returned an invalid session payload');
      }

      const existingIndex = state.sessions.findIndex((s) => s.id === activeSession.id);
      if (existingIndex !== -1) {
        state.sessions[existingIndex] = activeSession;
      } else {
        state.sessions.push(activeSession);
      }

      state.activeSessionId = activeSession.id;
      state.historySessionId = activeSession.id;
      saveActiveSessionPreference(activeSession.id);
      await loadSessions();
    } else {
      // Update existing session mode
      state.activeSessionId = activeSession.id;
      saveActiveSessionPreference(activeSession.id);
    }

    // Navigate to appropriate page based on mode
    if (mode === 'instant') {
      state.currentPage = 'chat';
      renderPage('chat');
    } else if (mode === 'planning') {
      state.currentPage = 'planning';
      renderPage('planning');
    }

    console.log(`[Home] Mode selected: ${mode}, Session: ${activeSession.id}`);
  } catch (error) {
    console.error('[Home] Error selecting mode:', error);
    alert(`Failed to start ${mode} mode: ${error.message}\n\nPlease check the console for details.`);
  }
}

/**
 * Switch between instant and planning modes with draft handling
 * @param {string} targetMode - The mode to switch to ('instant' | 'planning')
 */
async function switchMode(targetMode) {
  try {
    const currentMode = state.currentMode;
    const activeSession = state.sessions.find(s => s.id === state.activeSessionId);

    if (!activeSession) {
      throw new Error('No active session');
    }

    // If switching from planning, check for unsaved data
    if (currentMode === 'planning') {
      const planningData = state.modeData.planning.draftData;
      const hasUnsavedData = planningData && (
        planningData.answers?.objective ||
        planningData.answers?.context ||
        planningData.images?.length > 0
      );

      if (hasUnsavedData && planningData.status !== 'complete') {
        // Prompt user for action
        const choice = await showDraftHandlingModal();

        switch (choice) {
          case 'save':
            // Save draft and switch
            await savePlanningDraft(activeSession.id, planningData);
            break;

          case 'transfer':
            // Transfer to instant mode
            await transferPlanningToInstant();
            // Switch will happen in transferPlanningToInstant
            return;

          case 'discard':
            // Just switch without saving
            break;

          case 'cancel':
            // User cancelled, don't switch
            return;
        }
      }
    }

    // Call backend to switch mode
    const response = await fetch(`/api/sessions/${activeSession.id}/mode/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMode,
        saveDraft: currentMode === 'planning'
      })
    });

    if (!response.ok) {
      throw new Error('Failed to switch mode');
    }

    const result = await response.json();

    // Update local state
    state.currentMode = targetMode;
    activeSession.mode = targetMode;

    // Update session in state
    const sessionIndex = state.sessions.findIndex(s => s.id === activeSession.id);
    if (sessionIndex >= 0) {
      state.sessions[sessionIndex] = result.session;
    }

    // Navigate to appropriate page
    if (targetMode === 'instant') {
      state.currentPage = 'chat';
      renderPage('chat');
    } else if (targetMode === 'planning') {
      state.currentPage = 'planning';
      renderPage('planning');
    }

    console.log(`[Mode] Switched from ${currentMode} to ${targetMode}`);

  } catch (error) {
    console.error('[Mode] Error switching mode:', error);
    alert(`Failed to switch to ${targetMode} mode. ${error.message}`);
  }
}

/**
 * Show modal for handling unsaved planning draft
 * @returns {Promise<string>} - User choice: 'save', 'transfer', 'discard', or 'cancel'
 */
function showDraftHandlingModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.6); display: flex;
      align-items: center; justify-content: center; z-index: 10000;
      backdrop-filter: blur(4px);
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: var(--surface); border-radius: 16px; padding: 2rem;
      max-width: 500px; width: 90%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border);
    `;

    modal.innerHTML = `
      <h3 style="margin: 0 0 1rem 0; color: var(--text); font-size: 1.25rem;">Unsaved Planning Data</h3>
      <p style="margin: 0 0 1.5rem 0; color: var(--text-light); line-height: 1.5;">
        You have unsaved planning work. What would you like to do?
      </p>
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <button id="draft-save-btn" style="
          padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border);
          background: var(--background); color: var(--text); cursor: pointer;
          text-align: left; font-size: 0.95rem;
        ">
          <strong>Save Draft</strong> - Save and switch to Instant Mode
        </button>
        <button id="draft-transfer-btn" style="
          padding: 0.75rem 1rem; border-radius: 8px; border: none;
          background: linear-gradient(135deg, #0084ff, #0066cc); color: white;
          cursor: pointer; text-align: left; font-size: 0.95rem; font-weight: 600;
        ">
          <strong>Transfer Data</strong> - Move planning to Instant Mode
        </button>
        <button id="draft-discard-btn" style="
          padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid #ff4444;
          background: transparent; color: #ff4444; cursor: pointer;
          text-align: left; font-size: 0.95rem;
        ">
          <strong>Discard</strong> - Switch without saving
        </button>
        <button id="draft-cancel-btn" style="
          padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border);
          background: transparent; color: var(--text-light); cursor: pointer;
          font-size: 0.95rem;
        ">Cancel</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const cleanup = () => overlay.remove();

    document.getElementById('draft-save-btn').addEventListener('click', () => {
      cleanup();
      resolve('save');
    });

    document.getElementById('draft-transfer-btn').addEventListener('click', () => {
      cleanup();
      resolve('transfer');
    });

    document.getElementById('draft-discard-btn').addEventListener('click', () => {
      cleanup();
      resolve('discard');
    });

    document.getElementById('draft-cancel-btn').addEventListener('click', () => {
      cleanup();
      resolve('cancel');
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve('cancel');
      }
    });
  });
}

/**
 * Save planning draft to backend
 * @param {string} sessionId - Session ID
 * @param {Object} planningData - Planning data to save
 */
async function savePlanningDraft(sessionId, planningData) {
  try {
    const response = await fetch(`/api/sessions/${sessionId}/planning/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planningData })
    });

    if (!response.ok) {
      throw new Error('Failed to save planning draft');
    }

    const result = await response.json();
    console.log('[Planning] Draft saved successfully');
    return result;

  } catch (error) {
    console.error('[Planning] Error saving draft:', error);
    throw error;
  }
}

/**
 * Transfer planning data to instant mode
 * Planning AI selects relevant data to transfer
 */
async function transferPlanningToInstant() {
  try {
    const activeSession = state.sessions.find(s => s.id === state.activeSessionId);
    if (!activeSession) {
      throw new Error('No active session');
    }

    const planningData = state.modeData.planning.draftData;
    if (!planningData) {
      throw new Error('No planning data to transfer');
    }

    // Planning AI determines what to transfer
    const transferPackage = buildPlanningTransferPackage(planningData);

    // Create system message with planning context
    const systemMessage = {
      role: 'system',
      content: transferPackage.prompt,
      metadata: {
        source: 'planning',
        timestamp: new Date().toISOString(),
        planningId: crypto.randomUUID(),
        hasImages: transferPackage.images.length > 0
      }
    };

    // Add to chat history
    if (!Array.isArray(state.chat)) {
      state.chat = [];
    }
    state.chat.push(systemMessage);

    // Transfer images to instant mode
    if (transferPackage.images.length > 0) {
      state.modeData.instant.images = [...transferPackage.images];
    }

    // Mark planning as transferred
    planningData.status = 'transferred';
    await savePlanningDraft(activeSession.id, planningData);

    // Switch to instant mode
    state.currentMode = 'instant';
    activeSession.mode = 'instant';

    // Update session in backend
    await fetch(`/api/sessions/${activeSession.id}/mode/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMode: 'instant',
        saveDraft: true
      })
    });

    // Navigate to chat
    state.currentPage = 'chat';
    renderPage('chat');

    console.log('[Planning] Data transferred to instant mode successfully');

    // Show success notification
    showNotification('Planning data transferred to Instant Mode', 'success');

  } catch (error) {
    console.error('[Planning] Error transferring data:', error);
    alert(`Failed to transfer planning data: ${error.message}`);
    throw error;
  }
}

/**
 * Build transfer package from planning data
 * Planning AI selects what data is relevant
 * @param {Object} planningData - Raw planning data
 * @returns {Object} - Transfer package with prompt and images
 */
function buildPlanningTransferPackage(planningData) {
  const { answers, images, conversation, generatedPrompt } = planningData;

  // Planning AI logic: Determine what's critical to transfer
  const criticalComponents = [];

  // Always include objective if present
  if (answers?.objective) {
    criticalComponents.push(`**Objective**: ${answers.objective}`);
  }

  // Include context if substantive
  if (answers?.context && answers.context.length > 20) {
    criticalComponents.push(`**Context**: ${answers.context}`);
  }

  // Include constraints if specified
  if (answers?.constraints && answers.constraints.trim()) {
    criticalComponents.push(`**Constraints**: ${answers.constraints}`);
  }

  // Include verification criteria if specified
  if (answers?.verification && answers.verification.trim()) {
    criticalComponents.push(`**Success Criteria**: ${answers.verification}`);
  }

  // Build transfer prompt
  let transferPrompt = '';

  if (generatedPrompt) {
    // Use AI-generated prompt if available
    transferPrompt = generatedPrompt;
  } else if (criticalComponents.length > 0) {
    // Build from components
    transferPrompt = `# Planning Context\n\n${criticalComponents.join('\n\n')}`;
  } else {
    // Fallback
    transferPrompt = '# Planning Session\n\nPlanning data has been transferred to this conversation.';
  }

  // Add image count if present
  if (images && images.length > 0) {
    transferPrompt += `\n\n**Images**: ${images.length} image(s) attached`;
  }

  return {
    prompt: transferPrompt,
    images: images || [],
    answers: answers || {},
    metadata: {
      transferredAt: new Date().toISOString(),
      conversationSteps: conversation?.length || 0
    }
  };
}

/**
 * Show a notification toast
 * @param {string} message - Notification message
 * @param {string} type - Notification type ('success', 'error', 'info')
 */
// showNotification defined later in file - removed duplicate

// ==================== MODE-SPECIFIC IMAGE MANAGEMENT ====================

/**
 * Get images for the current mode
 * @returns {Array} - Array of image data URLs
 */
function getCurrentModeImages() {
  const mode = state.currentMode || 'instant';

  if (mode === 'planning') {
    return state.modeData.planning.images || [];
  } else {
    return state.modeData.instant.images || [];
  }
}

/**
 * Set images for the current mode
 * @param {Array} images - Array of image data URLs
 */
function setCurrentModeImages(images) {
  const mode = state.currentMode || 'instant';

  if (mode === 'planning') {
    state.modeData.planning.images = images;
  } else {
    state.modeData.instant.images = images;
  }

  // Also update legacy currentImages for backward compatibility
  state.currentImages = images;
}

/**
 * Add an image to the current mode
 * @param {string} imageDataUrl - Image data URL
 */
function addImageToCurrentMode(imageDataUrl) {
  const mode = state.currentMode || 'instant';

  if (mode === 'planning') {
    if (!state.modeData.planning.images) {
      state.modeData.planning.images = [];
    }
    state.modeData.planning.images.push(imageDataUrl);
  } else {
    if (!state.modeData.instant.images) {
      state.modeData.instant.images = [];
    }
    state.modeData.instant.images.push(imageDataUrl);
  }

  // Sync to legacy currentImages
  state.currentImages = getCurrentModeImages();
}

/**
 * Remove an image from the current mode
 * @param {number} index - Index of image to remove
 */
function removeImageFromCurrentMode(index) {
  const mode = state.currentMode || 'instant';

  if (mode === 'planning') {
    if (state.modeData.planning.images) {
      state.modeData.planning.images.splice(index, 1);
    }
  } else {
    if (state.modeData.instant.images) {
      state.modeData.instant.images.splice(index, 1);
    }
  }

  // Sync to legacy currentImages
  state.currentImages = getCurrentModeImages();
}

/**
 * Clear all images for the current mode
 */
function clearCurrentModeImages() {
  const mode = state.currentMode || 'instant';

  if (mode === 'planning') {
    state.modeData.planning.images = [];
  } else {
    state.modeData.instant.images = [];
  }

  state.currentImages = [];
}

// ==================== END MODE-SPECIFIC IMAGE MANAGEMENT ====================

/**
 * Synchronize currentMode from the active session
 * Called when session is loaded or switched
 */
function syncModeFromActiveSession() {
  const activeSession = state.sessions?.find(s => s.id === state.activeSessionId);

  if (activeSession && activeSession.mode) {
    state.currentMode = activeSession.mode;

    // Sync images from session planning data if in planning mode
    if (activeSession.mode === 'planning' && activeSession.planningData) {
      if (activeSession.planningData.images) {
        state.modeData.planning.images = activeSession.planningData.images;
      }
      if (activeSession.planningData) {
        state.modeData.planning.draftData = activeSession.planningData;
      }
    }

    console.log('[Session] Mode synced from session:', activeSession.mode);
  } else {
    // Default to instant mode
    state.currentMode = 'instant';
  }

  // Sync legacy currentImages
  state.currentImages = getCurrentModeImages();
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
        <td>${key.lastUsedAt ? formatDate(key.lastUsedAt) : '--'}</td>
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
  const newChatBtn = document.getElementById('new-chat-btn');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarToggleMobile = document.getElementById('sidebar-toggle-mobile');
  const chatSidebar = document.getElementById('chat-sidebar');
  const chatMenuBtn = document.getElementById('chat-menu-btn');
  const chatMenu = document.getElementById('chat-menu');
  const topBarModeButtons = (typeof getModeButtons === 'function' ? getModeButtons() : document.querySelectorAll('.mode-button')) || [];
  const topBarSettingsBtn = document.getElementById('settings-btn');

  // Modern top bar mode buttons (instant/planning)
  if (topBarModeButtons && typeof topBarModeButtons.forEach === 'function') {
    topBarModeButtons.forEach((btn) => {
      const targetMode = btn.getAttribute('data-mode');
      if (!targetMode) return;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (typeof switchMode === 'function') {
          await switchMode(targetMode);
        } else {
          state.currentPage = targetMode === 'planning' ? 'planning' : 'chat';
          renderPage(state.currentPage);
        }
      });
    });
  }

  // Modern settings button
  if (topBarSettingsBtn) {
    topBarSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      state.currentPage = 'settings';
      renderPage('settings');
    });
  }

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
  initializeSuggestionCardHandlers(input);
  renderChatMeta();
  updateVisionBridgeStatus();
  initializeModelPrepModal();
  evaluateModelReadiness();
  renderPhaseBanner();
  renderPhaseBadge();

  // Add Brain integration to chat
  addBrainIntegrationToChat();

  // Planning mode toggle - switch between normal chat and planning
  const planningToggle = document.getElementById('planning-mode-toggle');
  if (planningToggle) {
    // Remove any existing listeners by cloning
    const newToggle = planningToggle.cloneNode(true);
    planningToggle.parentNode?.replaceChild(newToggle, planningToggle);
    
    newToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      
      // Show visual feedback
      newToggle.style.opacity = '0.7';
      setTimeout(() => {
        newToggle.style.opacity = '1';
      }, 200);
      
      // Navigate to planning mode
      if (window.navigateToPage) {
        window.navigateToPage('planning');
      } else if (typeof navigateTo === 'function') {
        navigateTo('planning');
      }
    });
    
    // Add tooltip/aria label for accessibility
    newToggle.setAttribute('aria-label', 'Switch to Planning Mode');
    newToggle.setAttribute('title', 'Switch to Planning Mode - Plan your task before execution');
  }

  const phaseGateButton = document.getElementById('phase-gate-open-planning');
  phaseGateButton?.addEventListener('click', (event) => {
    event.preventDefault();
    window.navigateToPage('planning');
  });

  // Mode switch button handler
  const modeSwitchBtn = document.getElementById('chat-mode-switch-btn');
  if (modeSwitchBtn) {
    modeSwitchBtn.addEventListener('click', async () => {
      const currentMode = state.currentMode || 'instant';
      const targetMode = currentMode === 'instant' ? 'planning' : 'instant';

      if (typeof switchMode === 'function') {
        await switchMode(targetMode);
      } else {
        console.error('[Chat] switchMode function not available');
      }
    });
  }

  if (topBarModeButtons && topBarModeButtons.length) {
    topBarModeButtons.forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        const targetMode = button.dataset.mode;
        if (!targetMode || targetMode === (state.currentMode || 'instant')) {
          return;
        }
        if (typeof switchMode === 'function') {
          await switchMode(targetMode);
        } else {
          console.warn('[Chat] switchMode function not available for mode buttons');
        }
      });
    });
  }

  // Update mode indicator
  updateModeIndicator();

  if (modelSelector) {
    modelSelector.addEventListener('change', (event) => {
      state.settings.model = event.target.value;
      persistClientSettings();
      elements.activeModel.textContent = `model: ${state.settings.model || '--'}`;
      updateThinkingStatus();
      renderAiDisclosure();
      renderChatMeta();
      evaluateModelReadiness();
    });
  }


  if (sendBtn) {
    sendBtn.addEventListener('click', () => sendMessage());
  }
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  // Enable/disable send button + update character counter + auto-resize textarea
  const charCounter = document.getElementById('char-counter');

  if (input) {
    ['maxlength', 'max', 'data-max'].forEach((attr) => input.removeAttribute(attr));
  }

  function updateInputState() {
    const text = input.value;
    const length = text.length;
    const isEmpty = text.trim().length === 0;
    const isSessionSending = state.sessionSendingStates[state.activeSessionId];
    const requiresPlanning = !isSessionReadyForExecution(state.activeSessionId);

    // Enable send button only if has text and not currently sending
    sendBtn.disabled = isEmpty || isSessionSending || requiresPlanning;
    if (requiresPlanning) {
      sendBtn.setAttribute('title', 'Complete planning to unlock execution.');
    } else {
      sendBtn.removeAttribute('title');
    }

    // Update character counter
    if (charCounter) {
      charCounter.textContent = `${length} characters`;
      charCounter.style.color = '';
    }

    // Auto-resize textarea to fit content with smooth transition
    input.style.height = 'auto';
    const newHeight = Math.min(input.scrollHeight, 200); // Max 200px to match CSS
    input.style.height = newHeight + 'px';
    
    // Update send button aria state
    if (sendBtn) {
      sendBtn.setAttribute('aria-disabled', sendBtn.disabled ? 'true' : 'false');
    }
  }

  input?.addEventListener('input', updateInputState);

  // Initialize on page load
  updateInputState();
  if (window.__workflowPhaseHandler) {
    window.removeEventListener('workflow-phase-change', window.__workflowPhaseHandler);
  }
  window.__workflowPhaseHandler = (event) => {
    if (!event.detail || event.detail.sessionId !== state.activeSessionId) {
      return;
    }
    renderPhaseBanner();
    renderPhaseBadge();
    updateInputState();
  };
  window.addEventListener('workflow-phase-change', window.__workflowPhaseHandler);

  // Image upload functionality (support legacy and modern IDs)
  const imageUploadBtn = document.getElementById('image-upload-btn') || document.getElementById('attach-btn');
  const imageUploadInput = document.getElementById('image-upload-input') || document.getElementById('file-input');
  const imagePreviewContainer = document.getElementById('image-preview-container') || document.getElementById('attachments-preview');
  const imagePreviewList = document.getElementById('image-preview-list'); // legacy only
  const imageCounter = document.getElementById('image-counter');

  // Initialize images array in state if not exists
  if (!state.currentImages) {
    state.currentImages = [];
  }

  // Click upload button to trigger file input
  if (imageUploadBtn && imageUploadInput) {
    imageUploadBtn.addEventListener('click', () => {
      if (!ensureModelReadyBeforeImages('upload')) {
        return;
      }
      imageUploadInput.click();
    });

    // Handle file selection
    imageUploadInput.addEventListener('change', async (event) => {
      if (!ensureModelReadyBeforeImages('upload')) {
        imageUploadInput.value = '';
        return;
      }
      const files = Array.from(event.target.files || []);

      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          continue;
        }
        if (state.currentImages.length >= MAX_CHAT_IMAGES) {
          showNotification(`Maximum of ${MAX_CHAT_IMAGES} images per message.`, 'warning', 3000);
          break;
        }
        try {
          const rawDataUrl = await readFileAsDataUrl(file);
          const optimized = await optimizeImageDataUrl(rawDataUrl, file.type);
          state.currentImages.push({
            file,
            dataUrl: optimized.dataUrl,
            name: file.name,
            size: optimized.size || file.size,
            type: optimized.type || file.type
          });
        } catch (error) {
          console.error('Image upload failed', error);
          showNotification(`Failed to load ${file.name}`, 'error', 2500);
        }
      }

      renderImagePreviews();
      // Clear input so same file can be selected again
      imageUploadInput.value = '';
    });
  }

  const screenshotBtn = document.getElementById('screenshot-capture-btn');
  if (screenshotBtn) {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      screenshotBtn.disabled = true;
      screenshotBtn.title = 'Screen capture not supported in this browser.';
    } else {
      screenshotBtn.addEventListener('click', async () => {
        try {
          if (!ensureModelReadyBeforeImages('screenshot')) {
            return;
          }
          if (state.currentImages.length >= MAX_CHAT_IMAGES) {
            showNotification(`Maximum of ${MAX_CHAT_IMAGES} images per message.`, 'warning', 3000);
            return;
          }
          screenshotBtn.disabled = true;
          const capture = await captureScreenshotFrame();
          const optimized = await optimizeImageDataUrl(capture.dataUrl, capture.type);
          state.currentImages.push({
            name: capture.name,
            dataUrl: optimized.dataUrl,
            size: optimized.size,
            type: optimized.type
          });
          renderImagePreviews();
          showNotification('Screenshot captured', 'success', 2000);
        } catch (error) {
          console.error('Screenshot capture failed', error);
          showNotification('Screenshot capture failed. Check browser permissions.', 'error', 3500);
        } finally {
          screenshotBtn.disabled = false;
        }
      });
    }
  }

  function renderImagePreviews() {
    // Support legacy and modern containers
    const instantAttachments = document.getElementById('instant-attachments');
    const attachmentsPreview = document.getElementById('attachments-preview');
    const legacyPreviewContainer = document.getElementById('image-preview-container');
    const legacyPreviewList = document.getElementById('image-preview-list');
    const imageCounter = document.getElementById('image-counter');

    // Prefer modern attachments preview, then legacy instant, then legacy list
    const container = attachmentsPreview || instantAttachments || legacyPreviewContainer;
    const list = instantAttachments || legacyPreviewList;

    if (!container && !list) return;

    if (state.currentImages.length === 0) {
      if (container) container.style.display = 'none';
      if (imageCounter) imageCounter.style.display = 'none';
      return;
    }

    // Show container with proper styling
    if (container) {
      container.style.display = 'flex';
      container.style.flexWrap = 'wrap';
      container.style.gap = '8px';
      container.style.padding = '8px';
      container.style.marginBottom = '8px';
      container.style.background = 'var(--surface-secondary, #f5f5f5)';
      container.style.borderRadius = '8px';
    } else if (list && legacyPreviewContainer) {
      legacyPreviewContainer.style.display = 'block';
    }
    
    if (imageCounter) {
      imageCounter.style.display = 'inline';
      imageCounter.textContent = `${state.currentImages.length} image${state.currentImages.length !== 1 ? 's' : ''}`;
    }

    const targetElement = container || list;
    targetElement.innerHTML = state.currentImages
      .map((img, index) => {
        const label = `${escapeHtml(img.name || 'Screenshot')} • ${formatFileSize(img.size || 0)}`;
        return `
        <div class="image-preview-item" data-index="${index}" title="${label}"
             style="position: relative; width: 100px; height: 100px; border-radius: 4px; overflow: hidden;">
          <img src="${img.dataUrl}" alt="${escapeHtml(img.name || 'Screenshot')}" 
               style="width: 100%; height: 100%; object-fit: cover;" />
          <button class="image-preview-remove" data-index="${index}" aria-label="Remove image"
                  style="position: absolute; top: 4px; right: 4px; background: rgba(220, 53, 69, 0.9); 
                         color: white; border: none; border-radius: 50%; width: 24px; height: 24px; 
                         cursor: pointer; font-size: 16px; line-height: 1; display: flex;
                         align-items: center; justify-content: center;">×</button>
        </div>
      `;
      })
      .join('');

    // Add click handlers for remove buttons
    targetElement.querySelectorAll('.image-preview-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index);
        state.currentImages.splice(index, 1);
        renderImagePreviews();
        scrollChatToBottom(true);
      });
    });
  }

  function clearImagePreviews() {
    state.currentImages = [];
    renderImagePreviews();
    const attachmentsPreview = document.getElementById('attachments-preview');
    const instantAttachments = document.getElementById('instant-attachments');
    if (imagePreviewContainer) {
      imagePreviewContainer.style.display = 'none';
    }
    if (attachmentsPreview) {
      attachmentsPreview.style.display = 'none';
    }
    if (instantAttachments) {
      instantAttachments.style.display = 'none';
    }
    if (imageCounter) {
      imageCounter.style.display = 'none';
      imageCounter.textContent = '0 images';
    }
  }

  if (clearBtn) clearBtn.addEventListener('click', async () => {
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

  const getSidebarOverlay = () => {
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      overlay.addEventListener('click', () => closeMobileSidebar());
      document.body.appendChild(overlay);
    }
    return overlay;
  };

  function openMobileSidebar() {
    if (!chatSidebar) return;
    chatSidebar.classList.add('open');
    sidebarToggleMobile?.setAttribute('aria-expanded', 'true');
    const overlay = getSidebarOverlay();
    overlay.classList.add('visible');
    document.body.classList.add('sidebar-open');
  }

  function closeMobileSidebar() {
    if (!chatSidebar) return;
    chatSidebar.classList.remove('open');
    sidebarToggleMobile?.setAttribute('aria-expanded', 'false');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
      overlay.classList.remove('visible');
    }
    document.body.classList.remove('sidebar-open');
  }

  // Side Panel System (Right-side overlay panels)
  const sidePanelContainer = document.getElementById('side-panel-container');
  const sidePanels = {
    prompts: document.getElementById('prompts-panel'),
    models: document.getElementById('models-panel'),
    history: document.getElementById('history-panel'),
    options: document.getElementById('options-panel')
  };

  function openSidePanel(panelName) {
    if (!sidePanelContainer || !sidePanels[panelName]) return;

    // Close any currently open panel
    Object.values(sidePanels).forEach(panel => {
      if (panel) panel.classList.remove('active');
    });

    // Open the requested panel
    sidePanelContainer.classList.add('open');
    sidePanels[panelName].classList.add('active');

    // Render panel content
    renderPanelContent(panelName);

    // Close mobile sidebar if open
    closeMobileSidebar();
  }

  function closeSidePanel() {
    if (!sidePanelContainer) return;

    sidePanelContainer.classList.remove('open');
    Object.values(sidePanels).forEach(panel => {
      if (panel) panel.classList.remove('active');
    });
  }

  // Render panel content based on panel type
  function renderPanelContent(panelName) {
    switch (panelName) {
      case 'prompts':
        renderPromptsPanel();
        break;
      case 'models':
        renderModelsPanel();
        break;
      case 'history':
        renderHistoryPanel();
        break;
      case 'options':
        // Options panel is static, no rendering needed
        break;
    }
  }

  function renderPromptsPanel() {
    const promptsList = document.getElementById('prompts-list');
    if (!promptsList) return;

    // Get saved prompts from localStorage
    const savedPrompts = JSON.parse(localStorage.getItem('savedPrompts') || '[]');

    if (savedPrompts.length === 0) {
      promptsList.innerHTML = '<p class="side-panel-empty">No saved prompts yet.</p>';
      return;
    }

    promptsList.innerHTML = savedPrompts.map((prompt, index) => `
      <div class="side-panel-item" data-prompt-index="${index}">
        <h4>${escapeHtml(prompt.title || 'Untitled Prompt')}</h4>
        <p>${escapeHtml(prompt.content.substring(0, 100))}${prompt.content.length > 100 ? '...' : ''}</p>
      </div>
    `).join('');

    // Add click handlers
    promptsList.querySelectorAll('.side-panel-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.promptIndex);
        const prompt = savedPrompts[index];
        if (prompt && chatInput) {
          chatInput.value = prompt.content;
          closeSidePanel();
          chatInput.focus();
        }
      });
    });
  }

  async function renderModelsPanel() {
    const modelsList = document.getElementById('models-list');
    if (!modelsList) return;

    // Use cached models if available
    if (state.availableModels && state.availableModels.length > 0) {
      renderModelsList(modelsList, state.availableModels);
      return;
    }

    modelsList.innerHTML = '<p class="side-panel-loading">Loading models...</p>';

    try {
      // Fetch available models using correct endpoint
      const data = await fetchJson('/api/models');
      const models = (data.models || []).map(m => m.name || m);

      if (models.length === 0) {
        modelsList.innerHTML = '<p class="side-panel-empty">No models available. Make sure Ollama is running.</p>';
        return;
      }

      // Cache models in state
      state.availableModels = models.map(name => ({ name }));

      renderModelsList(modelsList, models);
    } catch (error) {
      console.error('Failed to load models:', error);
      const errorMessage = error.message || 'Failed to load models';
      const isConnectionError = errorMessage.includes('connect') || errorMessage.includes('fetch') || errorMessage.includes('offline');
      
      if (isConnectionError) {
        modelsList.innerHTML = '<p class="side-panel-empty">Cannot connect to Ollama. Is the service running?</p>';
      } else if (state.modelLoadError) {
        modelsList.innerHTML = `<p class="side-panel-empty">${escapeHtml(state.modelLoadError.message || 'Failed to load models')}</p>`;
      } else {
        modelsList.innerHTML = '<p class="side-panel-empty">Failed to load models. Check console for details.</p>';
      }
    }
  }

  function renderModelsList(container, models) {
    const currentModel = state.settings?.model || state.model || getSettings()?.model || '';

    container.innerHTML = models.map(model => {
      const modelName = typeof model === 'string' ? model : (model.name || model);
      const isActive = modelName === currentModel;
      return `
        <div class="side-panel-item ${isActive ? 'active' : ''}" data-model="${escapeHtml(modelName)}">
          <h4>${escapeHtml(modelName)}</h4>
          ${isActive ? '<p style="color: var(--primary); font-weight: 600;">Currently active</p>' : '<p>Click to switch to this model</p>'}
        </div>
      `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('.side-panel-item').forEach(item => {
      item.addEventListener('click', () => {
        const model = item.dataset.model;
        if (model) {
          state.model = model;
          if (state.settings) {
            state.settings.model = model;
          }
          const settings = getSettings();
          settings.model = model;
          setSettings(settings);
          showNotification(`Switched to model: ${model}`, 'success', 2000);
          renderModelsPanel(); // Re-render to show new active model
        }
      });
    });
  }

  function renderHistoryPanel() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;

    historyList.innerHTML = '<p class="side-panel-loading">Loading history...</p>';

    // Get chat history from state or localStorage
    const sessions = Object.values(state.sessions || {}).filter(s => s.messages && s.messages.length > 0);

    if (sessions.length === 0) {
      historyList.innerHTML = '<p class="side-panel-empty">No chat history yet.</p>';
      return;
    }

    // Sort by last message timestamp
    sessions.sort((a, b) => {
      const aTime = a.messages[a.messages.length - 1]?.timestamp || 0;
      const bTime = b.messages[b.messages.length - 1]?.timestamp || 0;
      return bTime - aTime;
    });

    historyList.innerHTML = sessions.map(session => {
      const lastMessage = session.messages[session.messages.length - 1];
      const preview = lastMessage?.user || lastMessage?.assistant || '';
      const timestamp = lastMessage?.timestamp ? new Date(lastMessage.timestamp).toLocaleDateString() : '';

      return `
        <div class="side-panel-item" data-session-id="${escapeHtml(session.id)}">
          <h4>${escapeHtml(session.name || 'Untitled Session')}</h4>
          <p>${escapeHtml(preview.substring(0, 100))}${preview.length > 100 ? '...' : ''}</p>
          ${timestamp ? `<p style="font-size: 0.75rem; color: var(--text-light); margin-top: 0.25rem;">${timestamp}</p>` : ''}
        </div>
      `;
    }).join('');

    // Add click handlers
    historyList.querySelectorAll('.side-panel-item').forEach(item => {
      item.addEventListener('click', () => {
        const sessionId = item.dataset.sessionId;
        if (sessionId) {
          switchToSession(sessionId);
          closeSidePanel();
        }
      });
    });
  }

  // Close panel event listeners
  if (sidePanelContainer) {
    // Close button handlers
    sidePanelContainer.querySelectorAll('.side-panel-close').forEach(btn => {
      btn.addEventListener('click', closeSidePanel);
    });

    // Backdrop click handler
    const backdrop = sidePanelContainer.querySelector('.side-panel-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', closeSidePanel);
    }

    // ESC key handler for side panels
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidePanelContainer.classList.contains('open')) {
        closeSidePanel();
      }
    });
  }

  if (sidebarToggleMobile) {
    sidebarToggleMobile.addEventListener('click', (e) => {
      e.stopPropagation();
      if (chatSidebar?.classList.contains('open')) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
    });
  }

  if (chatSidebar) {
    document.addEventListener('click', (e) => {
      if (!chatSidebar.classList.contains('open')) {
        return;
      }
      if (
        chatSidebar.contains(e.target) ||
        sidebarToggleMobile?.contains(e.target)
      ) {
        return;
      }
      closeMobileSidebar();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && chatSidebar.classList.contains('open')) {
        closeMobileSidebar();
      }
    });
  }

  // Chat menu toggle
  if (chatMenuBtn && chatMenu) {
    chatMenuBtn.setAttribute('aria-haspopup', 'menu');
    chatMenuBtn.setAttribute('aria-expanded', 'false');

    const openChatMenu = () => {
      chatMenu.style.display = 'block';
      chatMenuBtn.setAttribute('aria-expanded', 'true');
    };

    const closeChatMenu = () => {
      chatMenu.style.display = 'none';
      chatMenuBtn.setAttribute('aria-expanded', 'false');
    };

    chatMenuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (chatMenu.style.display === 'block') {
        closeChatMenu();
      } else {
        openChatMenu();
      }
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!chatMenu.contains(e.target) && !chatMenuBtn.contains(e.target)) {
        closeChatMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeChatMenu();
      }
    });
  }

  if (topBarSettingsBtn) {
    topBarSettingsBtn.addEventListener('click', (event) => {
      event.preventDefault();
      state.currentPage = 'settings';
      renderPage('settings');
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
      activeModelDisplay.textContent = state.settings?.model || '--';
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
            <div class="github-repo-meta">${repo.fileCount} files | Connected ${new Date(repo.connectedAt).toLocaleDateString()}</div>
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
  const navModelsBtn = document.getElementById('nav-models-ultra');
  const navPromptsBtn = document.getElementById('nav-prompts-ultra');
  const navHistoryBtn = document.getElementById('nav-history-ultra');
  const navOptionsBtn = document.getElementById('nav-options-ultra');
  const navSettingsBtn = document.getElementById('nav-settings-ultra');

  if (navSessionsBtn) {
    navSessionsBtn.addEventListener('click', () => {
      // Sessions are in the left sidebar, so just close any open panels
      closeSidePanel();
      closeMobileSidebar();
      // Sessions are always visible on desktop, no action needed
    });
  }

  if (navModelsBtn) {
    navModelsBtn.addEventListener('click', () => {
      // Open models side panel
      openSidePanel('models');
    });
  }

  if (navPromptsBtn) {
    navPromptsBtn.addEventListener('click', () => {
      // Open prompts side panel
      openSidePanel('prompts');
    });
  }

  if (navHistoryBtn) {
    navHistoryBtn.addEventListener('click', () => {
      // Open history side panel
      openSidePanel('history');
    });
  }

  if (navOptionsBtn) {
    navOptionsBtn.addEventListener('click', () => {
      // Open options side panel
      openSidePanel('options');
    });
  }

  if (navSettingsBtn) {
    navSettingsBtn.addEventListener('click', () => {
      // Toggle sidebar visibility
      if (chatSidebar?.classList.contains('open')) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
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
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
      indicator.style.display = active ? 'block' : 'none';
      indicator.classList.toggle('active', active);
      indicator.setAttribute('aria-hidden', active ? 'false' : 'true');
      indicator.setAttribute('aria-busy', active ? 'true' : 'false');
    }
    // Update session sending state
    state.sessionSendingStates[sessionId] = active;
    // Re-check input state to update send button (considers both text and sending state)
    if (typeof updateInputState === 'function') {
      updateInputState();
    }
    if (!state.thinkingEnabled) {
      return;
    }
  }

  async function sendMessage() {
    const message = input.value.trim();
    const currentSessionId = state.activeSessionId;
    const isSessionSending = state.sessionSendingStates[currentSessionId];

    if (!message || isSessionSending) {
      return;
    }

    if (!isSessionReadyForExecution(currentSessionId)) {
      renderPhaseBanner();
      renderPhaseBadge();
      showNotification('Complete planning before sending messages.', 'warning', 3500);
      if (errorEl) {
        errorEl.textContent = 'Planning phase must finish before execution.';
      }
      return;
    }

    if (errorEl) {
      errorEl.textContent = '';
    }
    input.value = '';
    setThinking(true, currentSessionId);
    // CRITICAL: Display original message, not enhanced version
    const originalMessage = message;
    const liveUser = appendLiveUserMessage(originalMessage);
    const liveThinking = state.thinkingEnabled ? appendThinkingMessage() : null;
    const effectiveModel = resolveModelForRequest();
    updateThinkingStatus(effectiveModel);

    try {
  const sessionsArray = Array.isArray(state.sessions) ? state.sessions : [];
  const session = sessionsArray.find((item) => item.id === state.activeSessionId);
  const sessionInstructions = session?.instructions?.trim();
  let instructionsToUse =
    sessionInstructions && sessionInstructions.length
      ? sessionInstructions
      : state.settings?.systemInstructions;

  if (isStructuredPromptEnabled()) {
    instructionsToUse = applyStructuredDirective(instructionsToUse);
  }

      // Use raw message; no additional prompt engineering
      const processedMessage = message;

      // Prepare images for the payload (convert to base64 strings)
      const images = state.currentImages && state.currentImages.length > 0
        ? state.currentImages.map(img => ({
            data: img.dataUrl.split(',')[1], // Extract base64 data
            type: img.type,
            name: img.name
          }))
        : [];

      const payload = {
        message: originalMessage, // Original for storage
        enhancedMessage: processedMessage, // Enhanced for AI
        useEnhanced: true,
        model: effectiveModel,
        instructions: instructionsToUse,
        apiEndpoint: state.settings?.apiEndpoint,
        sessionId: state.activeSessionId,
        thinkingEnabled: state.thinkingEnabled,
        thinkingMode: state.thinkingMode,
        images: images.length > 0 ? images : undefined
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
            if (liveThinking) {
              liveThinking.remove();
            }
          }
        } else {
          thinkingStreamFailed = true;
          if (errorEl) {
            errorEl.textContent =
              errorEl.textContent ||
              'Thinking mode requires a reachable Ollama model list. Falling back to standard response.';
          }
        }
      }

      console.log('[DEBUG] Using standard chat with model:', effectiveModel, 'stream fallback:', triedThinkingStream);

      const data = await fetchJson('/api/chat', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const fallbackEntry =
        !Array.isArray(data.history) || !data.history.length
          ? createLocalHistoryEntry({
              sessionId: state.activeSessionId,
              user: originalMessage,
              assistant: data.response,
              thinking: data.thinking,
              model: payload.model,
              endpoint: payload.apiEndpoint,
              visionDescriptions: data.visionDescriptions
            })
          : null;
      const synchronizedHistory = synchronizeSessionHistory(
        state.activeSessionId,
        data.history,
        fallbackEntry
      );
      state.chat = synchronizedHistory;
      clearLiveEntries();
      renderChatMessages();
      renderHistoryPage();
      if (Array.isArray(data.visionDescriptions) && data.visionDescriptions.length) {
        showNotification('Vision context attached from screenshots.', 'info', 2500);
      }
      if (data.visionBridgeError) {
        showNotification(data.visionBridgeError, 'warning', 3500);
      }
      clearImagePreviews(); // Clear images after successful send
      if (thinkingStreamFailed) {
        clearThinkingStatusError();
      }
      clearPersistentError('chat-send');
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = error.message || 'Failed to send message';
      if (errorEl) {
        errorEl.textContent = errorMessage;
      }
      registerPersistentError('chat-send', error);

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
        elements.activeModel.textContent = 'model: --';
      }
    } finally {
      setThinking(false, currentSessionId);
    }
  }

  async function sendThinkingStream(payload, liveThinking, liveUser) {
    console.log('[DEBUG] Starting SSE stream to:', buildUrl('/api/chat/stream'));
    
    // Start auto-scroll when streaming begins
    state.isStreaming = true;
    enableAutoScroll();
    
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
      state.isStreaming = false;
      disableAutoScroll();
      throw new Error(errorText || `Unable to start thinking mode (status ${response.status})`);
    }
    if (!response.body) {
      state.isStreaming = false;
      disableAutoScroll();
      throw new Error('Unable to start thinking mode (empty stream)');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let aggregated = '';
    let latestSplit = { thinking: '', response: '', hasMarker: false, rawSegment: '' };

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
          latestSplit = splitThinkingPanels(aggregated);
          const thinkingPreviewRaw = latestSplit.hasMarker ? latestSplit.thinking : '';
          const thinkingPreview = resolveRenderableThinking(thinkingPreviewRaw);
          console.log('[DEBUG] Token received:', chunk.token, 'Total:', aggregated.length);
          updateThinkingEntry(liveThinking, thinkingPreview);
        }
        if (chunk.error) {
          throw new Error(chunk.error);
        }
        if (chunk.done) {
          const responseText = chunk.response || latestSplit.response || aggregated;
          let thinkingText = resolveRenderableThinking(chunk.thinking, latestSplit.hasMarker ? latestSplit.thinking : '');
          if (!thinkingText && latestSplit && !latestSplit.hasMarker && aggregated.trim().length) {
          console.debug('[thinking-stream] Stream completed without detectable reasoning markers');
        }
        if (liveThinking) {
          finalizeThinkingEntry(liveThinking, thinkingText, responseText);
        }

        // Remove user live entry only
        if (liveUser) {
          liveUser.remove();
        }
        
        // Stop auto-scroll when stream completes
        state.isStreaming = false;
        disableAutoScroll();

          const fallbackEntry =
            !Array.isArray(chunk.history) || !chunk.history.length
              ? createLocalHistoryEntry({
                  sessionId: state.activeSessionId,
                  user: payload.message,
                  assistant: responseText,
                  thinking: thinkingText,
                  model: payload.model,
                  endpoint: payload.apiEndpoint,
                  visionDescriptions: chunk.visionDescriptions
                })
              : null;

          const synchronizedHistory = synchronizeSessionHistory(
            state.activeSessionId,
            chunk.history,
            fallbackEntry
          );
          state.chat = synchronizedHistory;
          clearLiveEntries();
          renderChatMessages();
          renderHistoryPage();
          if (Array.isArray(chunk.visionDescriptions) && chunk.visionDescriptions.length) {
            showNotification('Vision context attached from screenshots.', 'info', 2500);
          }
          if (chunk.visionBridgeError) {
            showNotification(chunk.visionBridgeError, 'warning', 3500);
          }
          clearImagePreviews(); // Clear images after successful send
          clearPersistentError('chat-send');
          return true;
        }
      } catch (error) {
        console.warn('[thinking-stream] Failed to parse SSE chunk', {
          error: error.message,
          rawEvent
        });
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
      console.error('[thinking-stream] SSE aborted', streamError);
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

  renderChatPageModelSelector();
  loadAndRenderSuggestedModels();
  renderModelPrepInstalledList();
}

async function loadAndRenderSuggestedModels() {
  try {
    const sessionsArray = Array.isArray(state.sessions) ? state.sessions : [];
    const activeSession = sessionsArray.find(s => s.id === state.activeSessionId);
    const presetId = activeSession?.presetId || 'ai-coder-prompt';

    const data = await fetchJson(`/api/models/suggested?presetId=${encodeURIComponent(presetId)}`);
    state.suggestedModels = data.suggestions || [];
    renderSuggestedModels();
  } catch (error) {
    console.error('Failed to load suggested models:', error);
    state.suggestedModels = [];
  }
}

function renderSuggestedModels() {
  const suggestions = Array.isArray(state.suggestedModels) ? state.suggestedModels : [];
  const legacyContainer = document.getElementById('suggested-models-container');
  const legacyList = document.getElementById('suggested-models-list');
  const modernHost = document.getElementById('model-selector-container');
  const existingModernSection = document.getElementById('suggested-models-section');
  if (existingModernSection) {
    existingModernSection.remove();
  }

  if (legacyContainer && legacyList) {
    if (!suggestions.length) {
      legacyContainer.style.display = 'none';
    } else {
      legacyContainer.style.display = 'block';
      legacyList.innerHTML = '';
      suggestions.forEach((suggestion) => {
        const item = document.createElement('div');
        item.style.cssText = `
          padding: 0.75rem;
          background: var(--bg-primary);
          border-radius: 0.375rem;
          border-left: 3px solid var(--accent);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.75rem;
        `;
        const infoDiv = document.createElement('div');
        infoDiv.style.flex = '1';
        infoDiv.innerHTML = `
          <div style="font-weight: 500; font-size: 0.95rem;">${suggestion.name}</div>
          <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">${suggestion.reason}</div>
        `;
        const addButton = document.createElement('button');
        addButton.className = 'ghost-btn';
        addButton.textContent = 'Add';
        addButton.style.whiteSpace = 'nowrap';
        addButton.style.padding = '0.5rem 0.75rem';
        addButton.style.fontSize = '0.85rem';
        addButton.disabled = false;
        addButton.addEventListener('click', () => handleSuggestedModelInstallLegacy(suggestion.name, addButton));
        item.appendChild(infoDiv);
        item.appendChild(addButton);
        legacyList.appendChild(item);
      });
    }
  }

  if (modernHost && suggestions.length) {
    const section = document.createElement('div');
    section.id = 'suggested-models-section';
    section.className = 'suggested-models-section';
    section.innerHTML = `
      <div class="suggested-models-header">
        <span class="suggested-models-icon">✨</span>
        <span class="suggested-models-title">Suggested Models for This Preset</span>
      </div>
      <div class="suggested-models-list"></div>
    `;
    const listEl = section.querySelector('.suggested-models-list');
    suggestions.forEach((suggestion) => {
      const isInstalled = state.availableModels.some((model) => model.name === suggestion.name);
      const tags = suggestion.tags || suggestion.capabilities || [];
      const description = suggestion.description || suggestion.reason || 'Recommended for this workflow.';
      const sizeLabel = suggestion.size || '';
      const card = document.createElement('div');
      card.className = `suggested-model-card ${isInstalled ? 'installed' : ''}`;
      card.innerHTML = `
        <div class="suggested-model-info">
          <div class="suggested-model-name">${suggestion.name}</div>
          <div class="suggested-model-description">${description}</div>
          <div class="suggested-model-size">${sizeLabel}</div>
          <div class="suggested-model-tags">
            ${tags.map((tag) => `<span class="model-tag">${tag}</span>`).join('')}
          </div>
        </div>
        <div class="suggested-model-action"></div>
      `;
      const actionArea = card.querySelector('.suggested-model-action');
      if (isInstalled) {
        const installedBtn = document.createElement('button');
        installedBtn.className = 'btn-installed';
        installedBtn.textContent = '✓ Installed';
        installedBtn.disabled = true;
        actionArea.appendChild(installedBtn);
      } else {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn-add-model';
        addBtn.innerHTML = '<span class="btn-icon">⬇</span> Add model';
        addBtn.addEventListener('click', async () => {
          addBtn.disabled = true;
          addBtn.innerHTML = '<span class="spinner"></span> Pulling...';
          const success = await pullModelAndInstall(suggestion.name, addBtn);
          if (success) {
            state.settings = state.settings || {};
            state.settings.model = suggestion.name;
            persistClientSettings();
            renderModelSelector();
            renderChatPageModelSelector();
            renderAiDisclosure();
            renderChatMeta();
            updateThinkingStatus();
            addBtn.classList.add('btn-success');
            addBtn.textContent = '✓ Added';
            evaluateModelReadiness();
            markModelReady('install');
          } else {
            addBtn.disabled = false;
            addBtn.innerHTML = '<span class="btn-icon">⬇</span> Add model';
          }
        });
        actionArea.appendChild(addBtn);
      }
      listEl.appendChild(card);
    });
    modernHost.appendChild(section);
  }
}

function handleSuggestedModelInstallLegacy(modelName, buttonEl) {
  buttonEl.disabled = true;
  buttonEl.textContent = 'Installing...';
  pullModelAndInstall(modelName, buttonEl).then((success) => {
    if (success) {
      state.settings = state.settings || {};
      state.settings.model = modelName;
      persistClientSettings();
      renderModelSelector();
      renderChatPageModelSelector();
      renderAiDisclosure();
      renderChatMeta();
      updateThinkingStatus();
      evaluateModelReadiness();
      markModelReady('install');
    } else {
      buttonEl.disabled = false;
      buttonEl.textContent = 'Add';
    }
  });
}

async function pullModelAndInstall(modelName, buttonElement) {
  try {
    const response = await fetch(buildUrl('/api/models/pull'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to pull model');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pullInProgress = true;
    let completed = false;

    while (pullInProgress) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(line.slice(6));
          if (json.status === 'complete') {
            pullInProgress = false;
            completed = true;
            await loadAvailableModels();
            renderModelPrepModalSections();
            if (buttonElement) {
              buttonElement.textContent = 'Installed ✓';
              buttonElement.style.color = 'var(--success, #10b981)';
            }
            setTimeout(() => {
              renderSuggestedModels();
            }, 1000);
          } else if (json.error) {
            throw new Error(json.error);
          } else if (json.status) {
            if (buttonElement) {
              buttonElement.textContent = `${json.status.split(' ')[0]}...`;
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    return completed;
  } catch (error) {
    console.error('Model pull error:', error);
    if (buttonElement) {
      buttonElement.textContent = 'Error';
      buttonElement.style.color = 'var(--danger, #ef4444)';
      setTimeout(() => {
        buttonElement.textContent = 'Add';
        buttonElement.style.color = '';
        buttonElement.disabled = false;
      }, 2000);
    }
    return false;
  }
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

function renderChatPageModelSelector() {
  const select = document.getElementById('chat-page-model-selector');
  if (!select) return;
  select.innerHTML = '';
  select.disabled = !state.availableModels.length;
  if (!state.availableModels.length) {
    select.innerHTML = '<option value="">No models available</option>';
    return;
  }
  state.availableModels.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = model.name;
    if (model.name === state.settings?.model) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  select.onchange = (event) => {
    state.settings.model = event.target.value;
    state.settings.thinkingMode = DEFAULT_THINKING_MODE;
    state.thinkingMode = DEFAULT_THINKING_MODE;
    persistClientSettings();
    if (elements.activeModel) {
      elements.activeModel.textContent = `model: ${state.settings.model || '--'}`;
    }
    updateThinkingStatus();
    renderChatMeta();
    evaluateModelReadiness();
  };
}

async function applyPresetToActiveSession(presetId) {
  if (!state.activeSessionId) return;
  const preset = findInstructionPresetById(presetId);
  const instructions = preset ? preset.instructions : '';
  const presetValue = preset ? preset.id : null;
  try {
    await fetchJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PUT',
      body: JSON.stringify({ instructions, presetId: presetValue })
    });
    await loadSessions();
    await loadServerHistory(state.activeSessionId);
    updateSessionInstructionsPreview();
    renderSessionSelector();
    // Refresh suggested models when preset changes
    await loadAndRenderSuggestedModels();
  } catch (error) {
    console.error('Failed to apply preset from chat controls', error);
  }
}

function updateChatPresetDescription(presetId) {
  const descriptionNode = document.getElementById('chat-preset-description');
  if (!descriptionNode) return;
  if (!presetId) {
    descriptionNode.textContent = 'Custom instructions will be used for this session.';
    return;
  }
  const preset = getInstructionPresetCatalog().find((item) => item.id === presetId);
  if (preset && preset.description) {
    descriptionNode.textContent = preset.description;
  } else {
    descriptionNode.textContent = 'Custom instructions will be used for this session.';
  }
}

function renderChatPagePresetSelector() {
  const select = document.getElementById('chat-page-preset-selector');
  if (!select) return;
  const presets = getInstructionPresetCatalog();
  const customOption = '<option value="">Custom / manual</option>';
  const presetOptions = presets.map((preset) => `<option value="${preset.id}">${preset.label}</option>`).join('');
  select.innerHTML = `${customOption}${presetOptions}`;
  const sessionsArray = Array.isArray(state.sessions) ? state.sessions : [];
  const session = sessionsArray.find((item) => item.id === state.activeSessionId);
  if (session?.presetId) {
    select.value = session.presetId;
  } else {
    select.value = '';
  }
  select.disabled = !sessionsArray.length;
  updateChatPresetDescription(select.value || null);
  select.onchange = async (event) => {
    const value = event.target.value || null;
    event.target.disabled = true;
    await applyPresetToActiveSession(value);
    event.target.disabled = false;
    renderChatPagePresetSelector();
  };
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
  ensureWorkflowEntry(sessionId);

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
  renderChatMeta();
  renderPhaseBanner();
  renderPhaseBadge();
  if (state.currentPage === 'planning') {
    planningHandlersAttached = false;
    attachPlanningHandlers();
  }

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
    renderChatMeta();
    return;
  }

  const attachmentsCount = session.attachments?.length || 0;
  const previewText = session.instructions
    ? session.instructions.trim().slice(0, 140) + (session.instructions.length > 140 ? '…' : '')
    : 'No custom instructions';
  previewEl.textContent = `${previewText} | ${attachmentsCount} attachment${attachmentsCount === 1 ? '' : 's'}`;
  previewEl.hidden = !session.instructions;
  renderAiDisclosure();
  renderChatMeta();
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
  renderChatMeta();
}

function updateThinkingStatus(effectiveModel = resolveModelForRequest()) {
  const status = document.getElementById('thinking-status');
  if (!status) return;
  status.classList.remove('error');
  if (!state.thinkingEnabled) {
    status.classList.remove('active');
    status.textContent = 'Thinking mode off';
    renderAiDisclosure();
    renderChatMeta();
    return;
  }
  status.classList.add('active');
  const modeLabel = (state.thinkingMode || 'default').toUpperCase();
  if (effectiveModel && effectiveModel !== state.settings?.model) {
    status.textContent = `Thinking with ${effectiveModel} (${modeLabel})`;
  } else if (effectiveModel) {
    status.textContent = `Thinking with ${effectiveModel} (${modeLabel})`;
  } else {
    status.textContent = `Thinking enabled (${modeLabel})`;
  }
  renderAiDisclosure();
  renderChatMeta();
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

function formatSessionMeta(session, sessionHistory) {
  const metaParts = [];
  const messageCount = sessionHistory.length;
  if (messageCount) {
    metaParts.push(`${messageCount} msg${messageCount === 1 ? '' : 's'}`);
  }
  const updatedAt = sessionHistory.length
    ? sessionHistory[sessionHistory.length - 1]?.timestamp
    : session.updatedAt;
  if (updatedAt) {
    const date = new Date(updatedAt);
    metaParts.push(date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }
  if (!metaParts.length && session.createdAt) {
    const created = new Date(session.createdAt);
    metaParts.push(`Created ${created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
  }
  if (!metaParts.length) {
    metaParts.push('No activity yet');
  }
  return metaParts.join(' | ');
}

function getSessionDisplayInfo(session) {
  const sessionHistory = state.sessionHistories[session.id] || [];
  const firstMessage = sessionHistory.length > 0 ? sessionHistory[0].user : null;
  const fallbackName = session.name && session.name !== 'New Chat' ? session.name : null;
  const titleSource = firstMessage || fallbackName || 'New Chat';
  const title =
    titleSource && titleSource.length > 40 ? `${titleSource.substring(0, 40)}...` : (titleSource || 'New Chat');
  const metaText = formatSessionMeta(session, sessionHistory);
  return { title, metaText, sessionHistory };
}

async function handleSessionSelection(session, title) {
  state.activeSessionId = session.id;
  persistActiveSession();
  await loadServerHistory(session.id);
  renderChatMessages();
  renderChatSessionsList();
  updateSessionInstructionsPreview();
  updatePresetIndicator();
  if (typeof clearImagePreviews === 'function') {
    clearImagePreviews();
  }

  const chatTitle = document.getElementById('chat-title');
  if (chatTitle) {
    chatTitle.textContent = title.length > 30 ? `${title.substring(0, 30)}...` : title;
  }

  const chatSidebar = document.getElementById('chat-sidebar');
  if (chatSidebar && window.innerWidth <= 768) {
    chatSidebar.classList.remove('open');
  }
}

async function handleSessionDeletion(session) {
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

    await response.json();

    state.sessions = state.sessions.filter((s) => s.id !== session.id);
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
}

function renderChatSessionsList() {
  const modernContainer = document.getElementById('chat-list');
  if (modernContainer) {
    renderModernSessionList(modernContainer);
    return;
  }
  renderLegacySessionList();
}

function renderModernSessionList(container) {
  container.innerHTML = '';

  if (!state.sessions || state.sessions.length === 0) {
    container.innerHTML =
      '<p class="text-small muted" style="padding: 1rem; text-align: center;">No chats yet</p>';
    return;
  }

  state.sessions.forEach((session) => {
    const { title, metaText } = getSessionDisplayInfo(session);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'chat-item';
    if (session.id === state.activeSessionId) {
      item.classList.add('active');
    }
    item.dataset.sessionId = session.id;
    item.innerHTML = `
      <div class="chat-item-title">
        <div class="chat-item-name">${escapeHtml(title)}</div>
        <div class="chat-item-meta">${escapeHtml(metaText)}</div>
      </div>
      <span class="chat-item-delete" aria-label="Delete chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
        </svg>
      </span>
    `;

    const deleteBtn = item.querySelector('.chat-item-delete');
    deleteBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      handleSessionDeletion(session);
    });

    item.addEventListener('click', () => handleSessionSelection(session, title));

    container.appendChild(item);
  });
}

function renderLegacySessionList() {
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
    btn.className = 'session-item-ultra session-item';
    if (session.id === state.activeSessionId) {
      btn.classList.add('active');
    }

    const { title, metaText } = getSessionDisplayInfo(session);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'session-delete-btn';
    deleteBtn.title = 'Delete chat';
    deleteBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
    `;

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSessionDeletion(session);
    });

    const copyDiv = document.createElement('div');
    copyDiv.className = 'session-item-copy';
    copyDiv.innerHTML = `
      <span class="session-item-title-text">${escapeHtml(title)}</span>
      <span class="session-item-meta">${escapeHtml(metaText)}</span>
    `;

    btn.appendChild(copyDiv);
    btn.appendChild(deleteBtn);

    btn.addEventListener('click', () => handleSessionSelection(session, title));

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
  const hasUltraSections = Boolean(todayContainer || yesterdayContainer || weekContainer || olderContainer);
  if (!hasUltraSections && container) {
    container.innerHTML = '';
    state.sessions.forEach((session) => {
      container.appendChild(createSessionButton(session));
    });
  } else if (container) {
    container.innerHTML = '';
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
      markSessionRequiresPlanning(response.session.id);
      renderPhaseBanner();
      renderPhaseBadge();
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
function parseXMLTags(content = '') {
  const tags = {};
  const sanitized = String(content || '');
  if (!sanitized.includes('<')) {
    return { tags, remainingContent: sanitized };
  }

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<wrapper>${sanitized}</wrapper>`, 'text/xml');
      if (!doc.querySelector('parsererror')) {
        const queue = [];
        Array.from(doc.documentElement.children).forEach((node) => {
          if (node.tagName && node.tagName.toLowerCase() === 'response') {
            queue.push(...Array.from(node.children));
          } else {
            queue.push(node);
          }
        });
        queue.forEach((node) => {
          if (!node.tagName) return;
          const tagName = node.tagName.toLowerCase();
          const tagContent = (node.textContent || '').trim();
          if (tagContent) {
            assignStructuredTagValue(tags, tagName, tagContent);
          }
        });
        const looseText = Array.from(doc.documentElement.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent.trim())
          .filter(Boolean)
          .join('\n\n');
        return { tags, remainingContent: looseText };
      }
    } catch (error) {
      console.warn('[structured-tags] DOM parsing fallback triggered', error);
    }
  }

  const xmlTagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let match;
  let remainingContent = sanitized;
  while ((match = xmlTagRegex.exec(sanitized)) !== null) {
    const tagName = match[1].toLowerCase();
    const tagContent = match[2].trim();
    if (!tagContent) continue;
    assignStructuredTagValue(tags, tagName, tagContent);
    remainingContent = remainingContent.replace(match[0], '').trim();
  }

  return { tags, remainingContent: remainingContent.trim() };
}

function assignStructuredTagValue(target, tagName, value) {
  if (!value) {
    return;
  }
  if (target[tagName]) {
    if (!Array.isArray(target[tagName])) {
      target[tagName] = [target[tagName]];
    }
    target[tagName].push(value);
  } else {
    target[tagName] = value;
  }
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
    objectives: '🎯',
    todos: '✅',
    requirements: '📋',
    discovery: '🧭',
    research: '🌐',
    analysis: '🔍',
    solution: '💡',
    execution: '⚙️',
    implementation: '⚙️',
    verification: '✓',
    notes: '📝',
    reporting: '🗒️',
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
    objectives: 'Objectives',
    todos: 'Todo Items',
    requirements: 'Requirements',
    discovery: 'Discovery',
    research: 'Web Research',
    analysis: 'Analysis',
    solution: 'Solution',
    execution: 'Execution',
    implementation: 'Implementation',
    verification: 'Verification',
    notes: 'Notes',
    reporting: 'Reporting',
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
  const modernContainer = document.getElementById('messages-container');
  const container =
    modernContainer ||
    document.getElementById('chat-history') ||
    document.getElementById('chat-history-ultra');
  const welcomeScreen = document.getElementById('welcome-screen');

  if (!container) return;

  clearLiveEntries();
  container.innerHTML = '';

  const sessionId = state.activeSessionId;
  const history =
    (state.sessionHistories[sessionId] && state.sessionHistories[sessionId].length
      ? state.sessionHistories[sessionId]
      : state.localHistory[sessionId]) || [];

  renderChatMeta();

  const hasHistory = Array.isArray(history) && history.length > 0;

  if (modernContainer || welcomeScreen) {
    setConversationViewState(hasHistory);
  }

  if (!hasHistory) {
    toggleEmptyHero(true);
    return;
  }

  toggleEmptyHero(false);

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
      const splitSegments = splitThinkingPanels(entry.assistant || '');
      const assistantBody = splitSegments.response || entry.assistant || '';
      const derivedThinking = splitSegments.thinking;
      const { tags, remainingContent } = parseXMLTags(assistantBody);

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

      const thinkingSource = resolveRenderableThinking(entry.thinking, derivedThinking);
      if (thinkingSource) {
        const wordCount = thinkingSource.split(/\s+/).filter(Boolean).length;
        const thinkingSection = document.createElement('div');
        thinkingSection.className = 'thinking-section';
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
            <div class="thinking-text">${escapeHtml(thinkingSource).replace(/\n/g, '<br>')}</div>
          </div>
        `;
        messageContent.appendChild(thinkingSection);
      }

      // Render structured sections for each tag
      const structuredOrder = [
        'role',
        'context',
        'goal',
        'objectives',
        'requirements',
        'discovery',
        'research',
        'analysis',
        'solution',
        'execution',
        'implementation',
        'todos',
        'verification',
        'reporting',
        'notes'
      ];
      const collapsibleTags = new Set(['discovery', 'research']);

      let hasStructuredContent = false;
      const processedTags = new Set();
      structuredOrder.forEach((tagName) => {
        if (!tags[tagName]) {
          return;
        }
        const values = Array.isArray(tags[tagName]) ? tags[tagName] : [tags[tagName]];
        values.forEach((sectionValue) => {
          const section = createStructuredSection(tagName, sectionValue, collapsibleTags.has(tagName));
          messageContent.appendChild(section);
        });
        hasStructuredContent = true;
        processedTags.add(tagName);
      });

      // Add any remaining XML tags not in the standard order
      Object.keys(tags).forEach((tagName) => {
        if (processedTags.has(tagName)) {
          return;
        }
        const values = Array.isArray(tags[tagName]) ? tags[tagName] : [tags[tagName]];
        values.forEach((sectionValue) => {
          const section = createStructuredSection(tagName, sectionValue, false);
          messageContent.appendChild(section);
        });
        hasStructuredContent = true;
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

      contentWrapper.appendChild(messageContent);

      // Add message actions
      const messageActions = document.createElement('div');
      messageActions.className = 'message-actions';
      const assistantRaw = entry.assistant || '';
      const userRaw = entry.user || '';
      messageActions.innerHTML = `
        <button class="action-btn copy-btn" title="Copy prompt">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy
        </button>
        <button class="action-btn regenerate-btn" title="Regenerate response">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
          Regenerate
        </button>
      `;
      const copyButton = messageActions.querySelector('.copy-btn');
      if (copyButton) {
        copyButton.dataset.copyText = assistantRaw;
      }
      const regenerateButton = messageActions.querySelector('.regenerate-btn');
      if (regenerateButton) {
        regenerateButton.dataset.userMessage = userRaw;
      }
      contentWrapper.appendChild(messageActions);

      assistantBubble.appendChild(contentWrapper);
      conversation.appendChild(assistantBubble);
    }

    if (Array.isArray(entry.visionDescriptions) && entry.visionDescriptions.length) {
      const visionBlock = document.createElement('div');
      visionBlock.className = 'vision-context-block';
      const items = entry.visionDescriptions
        .map((vision, idx) => {
          const title = escapeHtml(vision?.name || `Screenshot ${idx + 1}`);
          const text = escapeHtml(vision?.description || '').replace(/\n/g, '<br>');
          return `<div class="vision-context-item"><strong>${title}</strong>${text}</div>`;
        })
        .join('');
      visionBlock.innerHTML = `<h5>Vision context</h5>${items}`;
      conversation.appendChild(visionBlock);
    }

    container.appendChild(conversation);
  });

  // Add message action event listeners
  container.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const text = e.currentTarget.dataset.copyText || '';
      const originalContent = e.currentTarget.innerHTML;
      const success = await copyToClipboard(text, {
        successMessage: 'Prompt copied to clipboard',
        errorMessage: 'Unable to copy prompt'
      });
      if (success) {
        e.currentTarget.innerHTML = '<span style="color: var(--success)">✓</span>';
        setTimeout(() => {
          e.currentTarget.innerHTML = originalContent;
        }, 1800);
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

  scrollChatToBottom();
  applySidebarStaggering();
  renderChatMeta();
}

function applySidebarStaggering() {
  const sidebar = document.getElementById('chat-sidebar');
  if (!sidebar) return;
  const sequentialItems = sidebar.querySelectorAll('.sidebar-btn-ultra, .session-item-ultra');
  sequentialItems.forEach((item, index) => {
    item.classList.add('stagger-item');
    item.style.setProperty('--stagger-index', index);
  });
  if (sequentialItems.length) {
    sidebar.classList.add('stagger-ready');
  }
}

function toggleEmptyHero(show) {
  const hero = document.getElementById('chat-empty-hero');
  if (hero) {
    hero.hidden = !show;
    hero.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
  setConversationViewState(!show ? true : false);
}

function setConversationViewState(showMessages) {
  const modernWelcome = document.getElementById('welcome-screen');
  const modernMessages = document.getElementById('messages-container');
  if (modernWelcome) {
    modernWelcome.style.display = showMessages ? 'none' : 'flex';
    modernWelcome.setAttribute('aria-hidden', showMessages ? 'true' : 'false');
  }
  if (modernMessages) {
    modernMessages.style.display = showMessages ? '' : 'none';
  }
}

function getModeButtons() {
  return Array.from(document.querySelectorAll('.mode-button[data-mode]'));
}

function getSuggestionCards() {
  return Array.from(document.querySelectorAll('.suggestion-card[data-prompt]'));
}

/**
 * Update mode indicator in chat header
 */
function updateModeIndicator() {
  const modePill = document.getElementById('meta-mode-pill');
  const modeLabelText = document.getElementById('mode-label-text');
  const switchModeBtn = document.getElementById('chat-mode-switch-btn');
  const switchModeLabel = document.getElementById('switch-mode-label');
  const instantIcon = document.querySelector('.mode-icon-instant');
  const planningIcon = document.querySelector('.mode-icon-planning');
  const topBarModeButtons = getModeButtons();

  const currentMode = state.currentMode || 'instant';

  // Update pill
  if (modePill) {
    if (currentMode === 'planning') {
      modePill.classList.add('planning-mode');
      modePill.classList.remove('instant-mode');
    } else {
      modePill.classList.add('instant-mode');
      modePill.classList.remove('planning-mode');
    }
  }

  // Update label
  if (modeLabelText) {
    modeLabelText.textContent = currentMode === 'instant' ? 'Instant Mode' : 'Planning Mode';
  }

  // Update icons
  if (instantIcon && planningIcon) {
    if (currentMode === 'instant') {
      instantIcon.style.display = 'block';
      planningIcon.style.display = 'none';
    } else {
      instantIcon.style.display = 'none';
      planningIcon.style.display = 'block';
    }
  }

  // Update switch button
  if (switchModeLabel) {
    switchModeLabel.textContent = currentMode === 'instant' ? 'Switch to Planning' : 'Switch to Instant';
  }

  if (topBarModeButtons && topBarModeButtons.length) {
    topBarModeButtons.forEach((button) => {
      const buttonMode = button.dataset.mode || 'instant';
      if (buttonMode === currentMode) {
        button.classList.add('active');
        button.setAttribute('aria-pressed', 'true');
      } else {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
      }
    });
  }
}

function renderChatMeta() {
  const sessionTitle = document.getElementById('chat-meta-session');
  const sessionSubtitle = document.getElementById('chat-meta-subtitle');
  const modelPill = document.getElementById('meta-model-pill');
  const presetPill = document.getElementById('meta-preset-pill');
  const thinkingPill = document.getElementById('meta-thinking-pill');
  const heroSessionPill = document.getElementById('hero-session-pill');

  const sessionsArray = Array.isArray(state.sessions) ? state.sessions : [];
  const session = sessionsArray.find((item) => item.id === state.activeSessionId);
  const sessionName = session?.name || 'Untitled session';
  const attachments = session?.attachments?.length || 0;
  const updatedAt = session?.updatedAt ? new Date(session.updatedAt).toLocaleDateString() : null;

  if (sessionTitle) {
    sessionTitle.textContent = sessionName;
  }

  if (sessionSubtitle) {
    if (attachments || updatedAt) {
      const attachmentCopy = attachments ? `${attachments} attachment${attachments === 1 ? '' : 's'}` : null;
      const updatedCopy = updatedAt ? `Updated ${updatedAt}` : null;
      sessionSubtitle.textContent = [attachmentCopy, updatedCopy].filter(Boolean).join(' | ');
    } else {
      sessionSubtitle.textContent = 'Use instructions or attachments to tailor this workspace.';
    }
  }

  if (modelPill) {
    modelPill.textContent = state.settings?.model ? `Model: ${state.settings.model}` : 'Model: Select one';
  }

  if (presetPill) {
    const presetLabel = getActivePresetLabel();
    presetPill.textContent = presetLabel ? `Preset: ${presetLabel}` : 'Preset: Custom';
  }

  if (thinkingPill) {
    const modeLabel = (state.thinkingMode || 'default').toUpperCase();
    thinkingPill.textContent = `Thinking: ${modeLabel}`;
  }

  if (heroSessionPill) {
    heroSessionPill.textContent = `Session: ${sessionName}`;
  }

  renderChatPageModelSelector();
  renderChatPagePresetSelector();
  renderPhaseBadge();
}

function renderPhaseBadge() {
  const pill = document.getElementById('meta-phase-pill');
  if (!pill) return;
  const textEl = pill.querySelector('span');
  const entry = getWorkflowEntry(state.activeSessionId);
  const phase = entry?.phase || WORKFLOW_PHASES.EXECUTION;
  pill.dataset.phase = phase;
  if (textEl) {
    textEl.textContent = phase === WORKFLOW_PHASES.PLANNING ? 'Phase: Planning' : 'Phase: Execution';
  }
}

function renderPhaseBanner() {
  const banner = document.getElementById('phase-gate-banner');
  if (!banner) return;
  const requiresPlanning = !isSessionReadyForExecution(state.activeSessionId);
  if (!requiresPlanning) {
    banner.hidden = true;
    banner.style.display = 'none';
    return;
  }
  banner.hidden = false;
  banner.style.display = 'flex';
  const entry = getWorkflowEntry(state.activeSessionId);
  const label = banner.querySelector('.phase-gate-label');
  const text = banner.querySelector('.phase-gate-text');
  if (label) {
    label.textContent = 'Planning required';
  }
  if (text) {
    if (entry?.summary?.objective) {
      text.textContent = `Objective: ${entry.summary.objective}`;
    } else {
      text.textContent =
        'Finish the planning checklist and tap Done to unlock execution for this session.';
    }
  }
}

function renderQuickActions() {
  const legacyContainer = document.getElementById('chat-quick-actions');
  const suggestionContainer = document.querySelector('.suggestion-cards');
  const actions = Array.isArray(QUICK_ACTIONS) ? QUICK_ACTIONS : [];

  if (!legacyContainer && !suggestionContainer) {
    return;
  }

  if (legacyContainer) {
    legacyContainer.innerHTML = '';
    actions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-action-btn';
      button.setAttribute('aria-label', `Insert prompt: ${action.label}`);
      button.innerHTML = `
        <span class="qa-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 19L19 5M10 5h9v9" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </span>
        <span class="qa-copy">
          <span class="qa-title">${action.label}</span>
          <span class="qa-subtitle">${action.description || ''}</span>
        </span>
      `;
      button.dataset.promptId = action.id;
      button.addEventListener('click', () => {
        const input = document.getElementById('chat-input');
        if (!input) return;
        input.value = action.prompt;
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      });
      legacyContainer.appendChild(button);
    });
  }

  if (suggestionContainer) {
    suggestionContainer.innerHTML = actions
      .map(
        (action) => `
        <div class="suggestion-card" data-prompt="${escapeHtml(action.prompt)}" tabindex="0" role="button">
          <h4>${escapeHtml(action.label)}</h4>
          <p>${escapeHtml(action.description || '')}</p>
        </div>
      `
      )
      .join('');
  }
}

function initializeSuggestionCardHandlers(inputElement) {
  if (!inputElement) return;
  const cards = getSuggestionCards();
  if (!cards.length) return;

  cards.forEach((card) => {
    if (card.dataset.bound === 'true') {
      return;
    }
    card.dataset.bound = 'true';
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      if (!prompt) return;
      inputElement.value = prompt;
      inputElement.focus();
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      toggleEmptyHero(false);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        card.click();
      }
    });
  });
}

function initializeModelPrepModal() {
  const modal = document.getElementById('model-prep-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('model-prep-close');
  closeBtn?.addEventListener('click', () => closeModelPrepModal());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModelPrepModal();
    }
  });
  const dismissBtn = document.getElementById('model-prep-dismiss');
  dismissBtn?.addEventListener('click', () => closeModelPrepModal());
  renderModelPrepModalSections();
}

function openModelPrepModal(reason = 'upload') {
  const modal = document.getElementById('model-prep-modal');
  if (!modal) return;
  state.modelPrepModalOpen = true;
  state.modelPrepLastReason = reason;
  const reasonEl = document.getElementById('model-prep-reason');
  const copy =
    reason === 'screenshot'
      ? 'Screenshots require an active model. Pick one below to continue.'
      : 'Select or install a model before attaching screenshots.';
  if (reasonEl) {
    reasonEl.textContent = copy;
  }
  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
  renderModelPrepModalSections();
}

function closeModelPrepModal(options = {}) {
  const modal = document.getElementById('model-prep-modal');
  if (!modal) return;
  modal.style.display = 'none';
  document.body.classList.remove('modal-open');
  state.modelPrepModalOpen = false;
  if (!options.silent && !state.modelPrepAcknowledged) {
    showNotification('Select a model to unlock image uploads.', 'warning', 2500);
  }
}

function renderModelPrepModalSections() {
  if (!document.getElementById('model-prep-modal')) {
    return;
  }
  renderModelPrepInstalledList();
  renderModelPrepSuggestedList();
  renderModelPrepWebList();
}

function renderModelPrepInstalledList() {
  const list = document.getElementById('model-prep-installed-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.availableModels.length) {
    list.innerHTML = '<p class="model-prep-empty">No installed models detected yet.</p>';
    return;
  }
  state.availableModels.forEach((model) => {
    const card = document.createElement('div');
    card.className = 'model-card';
    const sizeGb = (model.size / (1024 * 1024 * 1024)).toFixed(1);
    const isActive = model.name === state.settings?.model;
    card.innerHTML = `
      <div class="model-card-body">
        <div class="model-card-title">${model.name}</div>
        <div class="model-card-subtitle">${sizeGb} GB download</div>
      </div>
    `;
    const button = document.createElement('button');
    button.className = 'model-card-btn';
    button.textContent = isActive ? 'Selected' : 'Use model';
    button.disabled = isActive;
    button.addEventListener('click', () => handleInstalledModelSelection(model.name));
    card.appendChild(button);
    list.appendChild(card);
  });
}

function renderModelPrepSuggestedList() {
  const container = document.getElementById('model-prep-suggested-list');
  if (!container) return;
  container.innerHTML = '';
  MODEL_ACQUISITION_GROUPS.forEach((group) => {
    const section = document.createElement('div');
    section.className = 'model-prep-group';
    section.innerHTML = `
      <div class="model-prep-group-header">
        <div>
          <h4>${group.label}</h4>
          <p>${group.description}</p>
        </div>
      </div>
    `;
    const grid = document.createElement('div');
    grid.className = 'model-card-grid';
    group.models.forEach((model) => {
      const card = document.createElement('div');
      card.className = 'model-card';
      card.innerHTML = `
        <div class="model-card-body">
          <div class="model-card-title">${model.name}</div>
          <div class="model-card-meta">${model.download}</div>
          <ul class="model-card-requirements">
            <li>${model.ram}</li>
            <li>${model.vram}</li>
          </ul>
          <p class="model-card-notes">${model.notes}</p>
        </div>
      `;
      const button = document.createElement('button');
      button.className = 'model-card-btn';
      button.textContent = 'Install';
      button.addEventListener('click', () => handleSuggestedModelInstall(model, button));
      card.appendChild(button);
      grid.appendChild(card);
    });
    section.appendChild(grid);
    container.appendChild(section);
  });
}

function renderModelPrepWebList() {
  const list = document.getElementById('model-prep-web-list');
  if (!list) return;
  list.innerHTML = '';
  WEB_MODEL_OPTIONS.forEach((option) => {
    const card = document.createElement('div');
    card.className = 'model-card model-card-web';
    card.innerHTML = `
      <div class="model-card-body">
        <div class="model-card-title">${option.label}</div>
        <div class="model-card-meta">${option.notes}</div>
        <p class="model-card-notes">${option.instructions}</p>
      </div>
    `;
    const button = document.createElement('button');
    button.className = 'model-card-btn';
    button.textContent = 'Use cloud model';
    button.addEventListener('click', () => handleWebModelSelection(option));
    card.appendChild(button);
    list.appendChild(card);
  });
}

function handleInstalledModelSelection(modelName) {
  state.settings = state.settings || {};
  state.settings.model = modelName;
  persistClientSettings();
  if (elements.activeModel) {
    elements.activeModel.textContent = `model: ${state.settings.model || '--'}`;
  }
  renderModelSelector();
  renderChatPageModelSelector();
  renderAiDisclosure();
  renderChatMeta();
  updateThinkingStatus();
  if (evaluateModelReadiness()) {
    markModelReady('installed-select');
  }
  showNotification(`Using ${modelName} for uploads.`, 'success', 2200);
}

async function handleSuggestedModelInstall(modelInfo, buttonElement) {
  if (buttonElement.disabled) {
    return;
  }
  buttonElement.disabled = true;
  buttonElement.textContent = 'Installing...';
  const success = await pullModelAndInstall(modelInfo.name, buttonElement);
  if (!success) {
    buttonElement.disabled = false;
    buttonElement.textContent = 'Install';
    return;
  }
  state.settings = state.settings || {};
  state.settings.model = modelInfo.name;
  persistClientSettings();
  renderModelSelector();
  renderChatPageModelSelector();
  renderAiDisclosure();
  renderChatMeta();
  updateThinkingStatus();
  evaluateModelReadiness();
  markModelReady('install');
}

function handleWebModelSelection(option) {
  state.settings = state.settings || {};
  state.settings.ollamaMode = 'cloud';
  state.settings.apiEndpoint = option.endpoint || 'https://ollama.com/';
  state.settings.model = option.model;
  persistClientSettings();
  notifySettingsSubscribers();
  renderModelSelector();
  renderChatPageModelSelector();
  renderAiDisclosure();
  renderChatMeta();
  updateThinkingStatus();
  if (option.url) {
    window.open(option.url, '_blank', 'noopener');
  }
  evaluateModelReadiness();
  markModelReady('web');
  showNotification(`Cloud model ${option.label} selected. Configure your Ollama key to finish setup.`, 'info', 3500);
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

  const modelName = state.settings?.model || '--';
  const thinkingLabel = (state.thinkingMode || 'default').toUpperCase();
  const thinkingCopy = state.thinkingEnabled ? `Thinking stream on (${thinkingLabel})` : 'Thinking stream off';
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

function renderVisionProviderDetails() {
  const details = document.getElementById('vision-provider-status-details');
  if (!details || !state.settings) return;
  const provider = (state.settings.visionProvider || 'auto').toLowerCase();
  const mode = (state.settings.visionBridgeMode || 'auto').toLowerCase();
  if (provider === 'off' || mode === 'off') {
    details.textContent = 'Vision bridge is disabled. Screenshots are sent only to models with native visual support.';
    return;
  }
  const providerLabel = provider === 'auto' ? 'the best available provider' : provider;
  let modeCopy = '';
  switch (mode) {
    case 'force':
      modeCopy = 'always summarize screenshots before sending them to the model';
      break;
    case 'hybrid':
      modeCopy = 'send both the raw screenshots and their summaries';
      break;
    default:
      modeCopy = 'summarize screenshots when a text-only model is active';
  }
  details.textContent = `Vision bridge will use ${providerLabel} and ${modeCopy}.`;
}

function updateVisionBridgeStatus() {
  const pill = document.getElementById('vision-bridge-status');
  if (!pill) return;
  const provider = (state.settings?.visionProvider || 'auto').toLowerCase();
  const mode = (state.settings?.visionBridgeMode || 'auto').toLowerCase();
  if (provider === 'off' || mode === 'off') {
    pill.style.display = 'none';
    return;
  }
  pill.style.display = 'inline-flex';
  pill.textContent = `vision ${provider} • ${mode}`;
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scrollChatToBottom(smooth = true) {
  const container = document.getElementById('messages-container') ||
                   document.getElementById('conversation-content') ||
                   document.getElementById('conversation-container') ||
                   document.getElementById('chat-history') || 
                   document.getElementById('chat-history-ultra') ||
                   document.getElementById('instant-conversation');
  if (!container) return;
  
  requestAnimationFrame(() => {
    if (smooth) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  });
}

// Auto-scroll during streaming responses
function enableAutoScroll() {
  if (!state.autoScrollInterval) {
    setAutoScrollVisualState(true);
    state.autoScrollInterval = setInterval(() => {
      if (state.isStreaming) {
        scrollChatToBottom(true);
      }
    }, 1000); // Scroll every second during streaming
  }
}

function disableAutoScroll() {
  if (state.autoScrollInterval) {
    clearInterval(state.autoScrollInterval);
    state.autoScrollInterval = null;
  }
  setAutoScrollVisualState(false);
}

function setAutoScrollVisualState(active) {
  const host =
    document.getElementById('conversation-content') ||
    document.getElementById('conversation-container');
  if (host) {
    host.classList.toggle('auto-scroll-active', Boolean(active));
  }
}

function normalizeTextBlock(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

const TAGGED_THINKING_PATTERNS = [
  { regex: /<(think|thinking|reasoning)>([\s\S]*?)<\/\1>/i, captureGroup: 2, strip: true },
  { regex: /<thought>([\s\S]*?)<\/thought>/i, captureGroup: 1, strip: true },
  { regex: /\[think(?:ing)?\]([\s\S]*?)\[\/think(?:ing)?\]/i, captureGroup: 1, strip: true },
  { regex: /<<THINK>>([\s\S]*?)<<\/THINK>>/i, captureGroup: 1, strip: true }
];

function extractTaggedThinkingPanels(normalized) {
  for (const pattern of TAGGED_THINKING_PATTERNS) {
    const match = normalized.match(pattern.regex);
    if (match) {
      const captured = (match[pattern.captureGroup] || '').trim();
      const before = normalized.slice(0, match.index).trim();
      const after = normalized.slice(match.index + match[0].length).trim();
      const thinking = captured;
      return {
        thinking,
        response: pattern.strip ? [before, after].filter(Boolean).join('\n').trim() : normalized,
        hasMarker: Boolean(thinking.length),
        rawSegment: pattern.strip ? match[0] : ''
      };
    }
  }
  return null;
}

function splitThinkingPanels(text = '') {
  const normalized = (text || '').trim();
  if (!normalized) {
    return { thinking: '', response: '', hasMarker: false, rawSegment: '' };
  }

  const tagged = extractTaggedThinkingPanels(normalized);
  if (tagged) {
    return tagged;
  }

  const heuristic = extractHeuristicThinkingPanels(normalized);
  if (heuristic) {
    return heuristic;
  }

  return { thinking: '', response: normalized, hasMarker: false, rawSegment: '' };
}

function extractHeuristicThinkingPanels(normalized) {
  const lower = normalized.toLowerCase();
  const thinkingMarkers = ['thinking:', 'analysis:', 'reasoning:', 'thought:', 'chain-of-thought:', 'plan:', 'cot:'];
  let thinkingIdx = -1;
  let markerLength = 0;

  thinkingMarkers.forEach((marker) => {
    const idx = lower.indexOf(marker);
    if (idx !== -1 && (thinkingIdx === -1 || idx < thinkingIdx)) {
      thinkingIdx = idx;
      markerLength = marker.length;
    }
  });

  if (thinkingIdx === -1) {
    return null;
  }

  const prelude = normalized.slice(0, thinkingIdx).trim();
  const afterMarker = normalized.slice(thinkingIdx + markerLength);
  const responseMarkers = [
    'response:',
    'final answer:',
    'final response:',
    'answer:',
    'assistant:',
    'output:',
    'solution:',
    'final:'
  ];
  const afterLower = afterMarker.toLowerCase();
  let responseIdx = -1;
  let responseMarkerLength = 0;
  responseMarkers.forEach((marker) => {
    const idx = afterLower.indexOf(marker);
    if (idx !== -1 && (responseIdx === -1 || idx < responseIdx)) {
      responseIdx = idx;
      responseMarkerLength = marker.length;
    }
  });

  let thinkingBody = '';
  let responseBody = '';
  let rawSegment = '';

  if (responseIdx === -1) {
    const boundaryIdx = afterMarker.search(/\n{2,}/);
    if (boundaryIdx !== -1) {
      thinkingBody = afterMarker.slice(0, boundaryIdx).trim();
      responseBody = afterMarker.slice(boundaryIdx).trim();
      rawSegment = normalized.slice(thinkingIdx, thinkingIdx + markerLength + boundaryIdx).trim();
    } else {
      thinkingBody = afterMarker.trim();
      rawSegment = normalized.slice(thinkingIdx).trim();
    }
  } else {
    thinkingBody = afterMarker.slice(0, responseIdx).trim();
    responseBody = afterMarker.slice(responseIdx + responseMarkerLength).trim();
    rawSegment = normalized.slice(thinkingIdx, thinkingIdx + markerLength + responseIdx).trim();
  }

  const thinkingText = [prelude, thinkingBody].filter(Boolean).join('\n').trim();
  if (!thinkingText) {
    return null;
  }

  const responseText = responseBody || (responseIdx === -1 ? '' : normalized);

  return {
    thinking: thinkingText,
    response: responseText,
    hasMarker: Boolean(thinkingText.length),
    rawSegment: rawSegment || thinkingBody
  };
}

function generateLocalEntryId(prefix = 'local-entry') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createLocalHistoryEntry({ sessionId, user, assistant, thinking, model, endpoint, visionDescriptions }) {
  const cleanedThinking = shouldDiscardClientThinking(thinking) ? '' : (thinking || '').trim();
  return {
    id: generateLocalEntryId('history'),
    timestamp: new Date().toISOString(),
    sessionId,
    user: user || '',
    assistant: assistant || '',
    thinking: cleanedThinking,
    model: model || state.settings?.model || 'local',
    endpoint: endpoint || state.settings?.apiEndpoint || window.location.origin,
    visionDescriptions: Array.isArray(visionDescriptions) && visionDescriptions.length ? visionDescriptions : undefined
  };
}

function shouldDiscardClientThinking(text = '') {
  const normalized = normalizeTextBlock(text);
  if (!normalized) {
    return true;
  }
  const session = (Array.isArray(state.sessions) ? state.sessions : []).find(
    (item) => item.id === state.activeSessionId
  );
  const instructionCandidates = [
    session?.instructions,
    state.settings?.systemInstructions,
    state.settings?.structuredPromptTemplate
  ]
    .map(normalizeTextBlock)
    .filter(Boolean);
  if (instructionCandidates.some((candidate) => candidate && candidate === normalized)) {
    return true;
  }
  const heuristics = [
    'please structure your response using xml tags',
    '<role>',
    'discovery (what to find/understand)',
    'work first, ask never'
  ];
  const lower = normalized.toLowerCase();
  return heuristics.some((phrase) => lower.includes(phrase));
}

function resolveRenderableThinking(primary, fallback) {
  const candidates = [primary, fallback];
  for (const candidate of candidates) {
    const trimmed = (candidate || '').trim();
    if (trimmed && !shouldDiscardClientThinking(trimmed)) {
      return trimmed;
    }
  }
  return '';
}

function synchronizeSessionHistory(sessionId, serverHistory, fallbackEntry) {
  let history = Array.isArray(serverHistory) ? serverHistory.slice() : [];
  if (!history.length && fallbackEntry) {
    console.warn('[history-sync] Server history empty, using local fallback entry');
    history = [...(state.sessionHistories[sessionId] || []), fallbackEntry].filter(Boolean);
  }
  const deduped = [];
  const seen = new Set();
  history
    .filter(Boolean)
    .forEach((entry) => {
      const key = entry.id || `${entry.timestamp || ''}-${entry.user || ''}-${entry.assistant || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(entry);
      }
    });
  state.sessionHistories[sessionId] = deduped;
  state.localHistory[sessionId] = deduped;
  persistLocalHistory();
  return deduped;
}

function clearLiveEntries() {
  document.querySelectorAll('.live-entry').forEach((node) => node.remove());
}

function appendLiveUserMessage(content) {
  const modernContainer = document.getElementById('messages-container');
  const container =
    modernContainer ||
    document.getElementById('chat-history') ||
    document.getElementById('chat-history-ultra');
  if (!container) return null;

  const sanitized = escapeHtml(content || '').replace(/\n/g, '<br>');
  const timestamp = new Date().toLocaleTimeString();

  if (modernContainer) {
    setConversationViewState(true);
  }

  if (modernContainer) {
    const group = document.createElement('div');
    group.className = 'conversation-group live-entry live-user-entry';
    group.innerHTML = `
      <div class="message-bubble-user">
        <div class="message-avatar user">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div class="message-content">
          <div class="message-header">
            <span class="message-sender">You</span>
            <span class="message-timestamp">${timestamp}</span>
          </div>
          <div class="message-text">${sanitized}</div>
        </div>
      </div>
    `;
    container.appendChild(group);
    scrollChatToBottom();
    return group;
  }

  const article = document.createElement('article');
  article.className = 'chat-entry live-entry';
  article.innerHTML = `
    <header>
      <strong>You</strong>
      <span>${timestamp}</span>
    </header>
    <p><strong>Q:</strong> ${sanitized}</p>
  `;
  container.appendChild(article);
  scrollChatToBottom();
  return article;
}

function appendThinkingMessage() {
  const modernContainer = document.getElementById('messages-container');
  const container =
    modernContainer ||
    document.getElementById('chat-history') ||
    document.getElementById('chat-history-ultra');
  if (!container) return null;

  const timestamp = new Date().toLocaleTimeString();

  if (modernContainer) {
    setConversationViewState(true);
    const group = document.createElement('div');
    group.className = 'conversation-group live-entry live-thinking-entry';
    group.innerHTML = `
      <div class="message-bubble-assistant">
        <div class="message-avatar assistant">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="assistant-content-wrapper">
          <div class="message-content">
            <div class="message-header">
              <span class="message-sender">Assistant</span>
              <span class="message-timestamp">${timestamp}</span>
            </div>
            <div class="thinking-section live-thinking">
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
                <div class="thinking-live">
                  <p><span class="assistant-live-text"></span></p>
                </div>
                <div class="thinking-text" hidden></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const toggleBtn = group.querySelector('.thinking-toggle-btn');
    const content = group.querySelector('.thinking-content');
    if (toggleBtn && content) {
      toggleBtn.addEventListener('click', () => {
        content.classList.toggle('collapsed');
        toggleBtn.classList.toggle('expanded');
      });
    }

    container.appendChild(group);
    scrollChatToBottom();
    return group;
  }

  const article = document.createElement('article');
  article.className = 'chat-entry assistant live-entry thinking-entry';
  article.innerHTML = `
    <header>
      <strong>Assistant</strong>
      <span>${timestamp}</span>
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
        <div class="thinking-live">
          <p><span class="assistant-live-text"></span></p>
        </div>
        <div class="thinking-text" hidden></div>
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
  scrollChatToBottom();
  return article;
}

function updateThinkingEntry(entry, text) {
  if (!entry) return;
  const trimmed = (text || '').trim();
  const allowedText = trimmed && !shouldDiscardClientThinking(trimmed) ? trimmed : '';
  const stream = entry.querySelector('.assistant-live-text');
  if (stream) {
    stream.textContent = allowedText;
  }

  // Auto-scroll to show new thinking content
  if (allowedText) {
    scrollChatToBottom();
  }

  const label = entry.querySelector('.thinking-label');
  if (label) {
    if (allowedText && allowedText.length > 0) {
      const wordCount = allowedText.split(/\s+/).filter((w) => w.length > 0).length;
      label.innerHTML = `<span style="display: inline-block; width: 6px; height: 6px; background: #10b981; border-radius: 50%; margin-right: 6px; animation: pulse 1.5s infinite;"></span>Thinking (${wordCount} words)`;
    } else {
      label.innerHTML = `<span style="display: inline-block; width: 6px; height: 6px; background: #10b981; border-radius: 50%; margin-right: 6px; animation: pulse 1.5s infinite;"></span>Thinking...`;
    }
  }

  const thinkingSection = entry.querySelector('.thinking-section');
  const thinkingContent = entry.querySelector('.thinking-content');
  if (thinkingSection && thinkingContent && allowedText && allowedText.length > 10) {
    thinkingSection.classList.remove('collapsed');
    thinkingContent.classList.remove('collapsed');
  }
}

function finalizeThinkingEntry(entry, thinkingText, responseText) {
  if (!entry) return;

  const trimmedThinking = resolveRenderableThinking(thinkingText);
  if (trimmedThinking) {
    console.debug('[thinking-entry] Final reasoning captured:', trimmedThinking.length, 'chars');
  }
  entry.remove();
}

// Track if planning handlers are attached to prevent duplicates
let planningHandlersAttached = false;

function attachPlanningHandlers() {
  // Prevent duplicate bindings
  if (planningHandlersAttached) {
    console.log('[Planning] Handlers already attached, skipping');
    return;
  }

  // Check if PlanningMode is available
  if (typeof window.PlanningMode === 'undefined') {
    console.warn('[Planning] PlanningMode not available yet');
    return;
  }

  // Add Brain integration to planning mode
  addBrainIntegrationToPlanning();

  // Modern top bar mode buttons (instant/planning)
  const topBarModeButtons = document.querySelectorAll('.mode-button');
  if (topBarModeButtons && typeof topBarModeButtons.forEach === 'function') {
    topBarModeButtons.forEach((btn) => {
      const targetMode = btn.getAttribute('data-mode');
      if (!targetMode) return;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (typeof switchMode === 'function') {
          await switchMode(targetMode);
        } else {
          state.currentPage = targetMode === 'planning' ? 'planning' : 'chat';
          renderPage(state.currentPage);
        }
      });
    });
  }

  // Wire up event handlers for planning mode
  const planningInput = document.getElementById('planning-input');
  const planningSendBtn = refreshPlanningControl('planning-send-btn');
  const planningSkipBtn = refreshPlanningControl('planning-skip-btn');
  const planningCreateBtn = refreshPlanningControl('planning-create-btn');
  const copyPromptBtn = refreshPlanningControl('copy-prompt-btn');
  const sendToChatBtn = refreshPlanningControl('send-to-chat-btn');
  const startNewPlanningBtn = refreshPlanningControl('start-new-planning-btn');
  const doneBtn = refreshPlanningControl('planning-done-btn');

  // Helper to create handler with guard
  const createHandler = (handlerFn) => {
    return async (e) => {
      e?.preventDefault?.();
      if (window.PlanningMode && typeof handlerFn === 'function') {
        await handlerFn.call(window.PlanningMode);
      }
    };
  };

  // Send answer handler
  planningSendBtn?.addEventListener('click', createHandler(window.PlanningMode.handleAnswer));

  // Skip question handler
  planningSkipBtn?.addEventListener('click', createHandler(window.PlanningMode.handleSkip));

  // Enter key in textarea (Cmd/Ctrl+Enter)
  if (planningInput) {
    planningInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (window.PlanningMode?.handleAnswer) {
          window.PlanningMode.handleAnswer();
        }
      }
    });
  }

  // Create prompt handler
  planningCreateBtn?.addEventListener('click', createHandler(window.PlanningMode.handleCreate));

  // Copy prompt handler
  copyPromptBtn?.addEventListener('click', createHandler(window.PlanningMode.copyPrompt));

  // Send to chat handler
  sendToChatBtn?.addEventListener('click', createHandler(window.PlanningMode.sendToChat));

  // Start new planning handler
  startNewPlanningBtn?.addEventListener('click', createHandler(window.PlanningMode.startNew));

  // Done handler - completes planning and transitions to execution/chat
  if (doneBtn && window.PlanningMode.handleDone) {
    doneBtn.addEventListener('click', async (e) => {
      e?.preventDefault?.();
      if (!window.PlanningMode || typeof window.PlanningMode.handleDone !== 'function') {
        console.warn('[Planning] handleDone not available');
        return;
      }
      
      try {
        // Disable button during processing
        if (doneBtn) {
          doneBtn.disabled = true;
          const originalText = doneBtn.textContent;
          doneBtn.textContent = 'Processing...';
        }
        
        await window.PlanningMode.handleDone();
        
        // Show success message
        if (typeof showNotification === 'function') {
          showNotification('Planning complete! Switching to execution...', 'success', 3000);
        }
        
        // Transition to chat after a brief delay
        setTimeout(() => {
          if (window.navigateToPage) {
            window.navigateToPage('chat');
          }
        }, 500);
      } catch (error) {
        console.error('[Planning] Failed to complete planning:', error);
        if (doneBtn) {
          doneBtn.disabled = false;
        }
        if (typeof showNotification === 'function') {
          showNotification(error?.message || 'Failed to complete planning', 'error', 5000);
        } else {
          alert(error?.message || 'Failed to complete planning');
        }
      }
    });
  }

  // Mark as attached
  planningHandlersAttached = true;

  // Initialize planning mode
  if (window.PlanningMode.initialize) {
    window.PlanningMode.initialize(buildPlanningMountConfig());
  }
}

function refreshPlanningControl(id) {
  const node = document.getElementById(id);
  if (!node) return null;
  const clone = node.cloneNode(true);
  node.parentNode.replaceChild(clone, node);
  return clone;
}

// Reset flag when page changes
window.addEventListener('pagechange', (event) => {
  if (event.detail && event.detail.page !== 'planning') {
    planningHandlersAttached = false;
  }
});

function showSettingsFeedback(messages, type = 'error') {
  const box = document.getElementById('settings-feedback');
  if (!box) return;
  const contentArray = Array.isArray(messages) ? messages : [messages];
  box.className = `settings-feedback visible ${type}`;
  box.innerHTML = `<ul>${contentArray.map((msg) => `<li>${msg}</li>`).join('')}</ul>`;
}

function clearSettingsFeedback() {
  const box = document.getElementById('settings-feedback');
  if (!box) return;
  box.className = 'settings-feedback';
  box.textContent = '';
}

function collectSettingsErrors(payload) {
  const errors = [];
  if (!payload.model || !payload.model.trim()) {
    errors.push('Model name is required.');
  }
  if (!payload.apiEndpoint || !payload.apiEndpoint.trim()) {
    errors.push('Ollama endpoint is required.');
  } else {
    try {
      new URL(payload.apiEndpoint);
    } catch (_) {
      errors.push('Provide a valid Ollama endpoint (e.g., http://127.0.0.1:11434).');
    }
  }
  if (payload.maxHistory !== undefined) {
    const maxHistory = Number(payload.maxHistory);
    if (Number.isNaN(maxHistory) || maxHistory <= 0 || maxHistory > 1000) {
      errors.push('Messages per prompt must be between 1 and 1000.');
    }
  }
  return errors;
}

function attachSettingsHandlers() {
  // Modern settings (card-based) quick bindings
  const modernModel = document.getElementById('settings-model');
  const modernMode = document.getElementById('settings-mode');
  const modernTheme = document.getElementById('settings-theme');
  const modernEndpoint = document.getElementById('settings-endpoint');
  const modernHistory = document.getElementById('settings-history');

  // If modern controls exist, wire them and return
  if (modernModel || modernMode || modernTheme || modernEndpoint || modernHistory) {
    (async () => {
      try {
        if (!state.availableModels?.length) {
          await loadAvailableModels();
        }
        // Populate model select
        if (modernModel) {
          modernModel.innerHTML = '';
          (state.availableModels || []).forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m.name || m;
            opt.textContent = m.name || m;
            if ((state.settings?.model || '') === (m.name || m)) {
              opt.selected = true;
            }
            modernModel.appendChild(opt);
          });
          modernModel.addEventListener('change', async (e) => {
            await saveSettings({ model: e.target.value });
          });
        }
        if (modernMode) {
          modernMode.value = (state.settings?.ollamaMode || 'local');
          modernMode.addEventListener('change', async (e) => {
            await saveSettings({ ollamaMode: e.target.value });
          });
        }
        if (modernTheme) {
          modernTheme.value = (state.settings?.theme || 'system');
          modernTheme.addEventListener('change', async (e) => {
            await saveSettings({ theme: e.target.value });
            initializeThemeSystem();
          });
        }
        if (modernEndpoint) {
          modernEndpoint.value = (state.settings?.apiEndpoint || 'http://127.0.0.1:11434/');
          modernEndpoint.addEventListener('change', async (e) => {
            await saveSettings({ apiEndpoint: e.target.value });
          });
        }
        if (modernHistory) {
          modernHistory.value = String(state.settings?.maxHistory || 20);
          modernHistory.addEventListener('change', async (e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v) && v > 0) {
              await saveSettings({ maxHistory: v });
            }
          });
        }
      } catch (err) {
        console.error('[Settings] Modern bindings failed:', err);
      }
    })();

    // Helper to POST settings
    async function saveSettings(payload) {
      try {
        const response = await fetch(buildUrl('/api/settings'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || 'Failed to save settings');
        }
        const updated = await response.json();
        state.settings = { ...(state.settings || {}), ...(updated || {}) };
        persistClientSettings();
        // Reflect on model selector if in chat
        renderModelSelector();
        renderChatMeta();
      } catch (e) {
        console.error('[Settings] Save failed:', e);
        alert(e.message || 'Failed to save settings');
      }
    }
    return; // Modern settings path handled
  }

  // Legacy settings (form-based)
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

  // Setup cloud mode UI switching
  const modeSelect = document.getElementById('ollama-mode-select');
  const apiKeyLabel = document.getElementById('cloud-api-key-label');
  const modeHelpLocal = document.getElementById('mode-help-local');
  const modeHelpCloud = document.getElementById('mode-help-cloud');
  const endpointInput = document.getElementById('ollama-endpoint-input');
  const endpointHelp = document.getElementById('endpoint-help');

  function updateModeUI() {
    const mode = modeSelect.value;
    const isCloud = mode === 'cloud';
    apiKeyLabel.style.display = isCloud ? 'block' : 'none';
    modeHelpLocal.style.display = isCloud ? 'none' : 'block';
    modeHelpCloud.style.display = isCloud ? 'block' : 'none';
    if (isCloud) {
      endpointInput.value = 'https://ollama.com';
      endpointInput.placeholder = 'https://ollama.com';
      endpointHelp.textContent = 'Cloud endpoint (Ollama datacenter)';
    } else {
      if (endpointInput.value === 'https://ollama.com') {
        endpointInput.value = 'http://127.0.0.1:11434';
      }
      endpointInput.placeholder = 'http://127.0.0.1:11434';
      endpointHelp.textContent = 'Local endpoint (your device)';
    }
  }

  modeSelect.addEventListener('change', updateModeUI);
  updateModeUI();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    payload.maxHistory = Number(payload.maxHistory);
    payload.model = (payload.model || '').trim();
    payload.apiEndpoint = (payload.apiEndpoint || '').trim();

    payload.backendBaseUrl =
      payload.backendBaseUrl && payload.backendBaseUrl.trim()
        ? normalizeBaseUrl(payload.backendBaseUrl)
        : state.settings?.backendBaseUrl || FALLBACK_BASE_URL;

    clearSettingsFeedback();
    const validationErrors = collectSettingsErrors(payload);
    if (validationErrors.length) {
      showSettingsFeedback(validationErrors, 'error');
      return;
    }

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
      renderVisionProviderDetails();
      updateVisionBridgeStatus();
      elements.activeModel.textContent = `model: ${state.settings.model}`;
      await loadAvailableModels();
      renderModelSelector();
      showSettingsFeedback(['Settings saved and applied.'], 'success');
      await ensureValidModelSelection('settings-save');
    } catch (error) {
      console.error('Failed to save settings', error);
      showSettingsFeedback([error?.message || 'Failed to save settings.'], 'error');
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
  if (form.elements.ollamaMode) {
    form.elements.ollamaMode.value = state.settings.ollamaMode || 'local';
  }
  if (form.elements.ollamaApiKey && state.settings.ollamaApiKey) {
    form.elements.ollamaApiKey.value = state.settings.ollamaApiKey;
  }
  if (form.elements.visionProvider) {
    form.elements.visionProvider.value = state.settings.visionProvider || 'auto';
  }
  if (form.elements.visionBridgeMode) {
    form.elements.visionBridgeMode.value = state.settings.visionBridgeMode || 'auto';
  }
  if (form.elements.visionMaxDescriptionChars) {
    form.elements.visionMaxDescriptionChars.value = state.settings.visionMaxDescriptionChars || 1200;
  }
  if (form.elements.visionDescriptionPrompt) {
    form.elements.visionDescriptionPrompt.value = state.settings.visionDescriptionPrompt || '';
  }
  if (form.elements.visionNativeModels) {
    const nativeList = Array.isArray(state.settings.visionNativeModels)
      ? state.settings.visionNativeModels.join(', ')
      : state.settings.visionNativeModels || '';
    form.elements.visionNativeModels.value = nativeList;
  }
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
  if (!value) return '--';
  try {
    return new Date(value).toLocaleString();
  } catch (_) {
    return value;
  }
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '--';
  const units = ['B', 'KB', 'MB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
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
      elements.activeModel.textContent = 'model: --';
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

function isStructuredPromptEnabled() {
  if (!state.settings) {
    return false;
  }
  return state.settings.enableStructuredPrompts === true;
}

function toggleStructuredPrompts(forceValue) {
  if (!state.settings) {
    state.settings = {};
  }
  const nextValue =
    typeof forceValue === 'boolean' ? forceValue : !isStructuredPromptEnabled();
  state.settings.enableStructuredPrompts = nextValue;
  persistClientSettings();
  const status = nextValue ? 'enabled' : 'disabled';
  showStructuredPromptNotification(status);
}

function applyStructuredDirective(baseInstructions = '') {
  const directive = `
Respond ONLY using the XML golden schema below. Keep every section in order and replace the ellipses with concrete content so the user receives a complete document. Discovery must happen first, web research second, execution third, then verification and reporting.

<response>
  <role>...</role>
  <context>...</context>
  <objectives>
    <item>...</item>
  </objectives>
  <discovery>
    <step>...</step>
  </discovery>
  <research>
    <webQuery>...</webQuery>
    <source>...</source>
    <insight>...</insight>
  </research>
  <execution>
    <step>...</step>
  </execution>
  <verification>
    <check>...</check>
  </verification>
  <reporting>
    <summary>...</summary>
    <deliverables>
      <item>...</item>
    </deliverables>
  </reporting>
  <notes>...</notes>
</response>`;

  return [baseInstructions || '', directive].filter(Boolean).join('\n\n');
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
      toggleStructuredPrompts(Boolean(event.target.checked));
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

// Get the appropriate theme toggle button element
function getThemeToggleButton() {
  // Try to find the most common theme toggle button IDs - be conservative
  let themeToggle = null;
  
  // Check for the most commonly referenced theme toggle
  themeToggle = document.getElementById('theme-toggle-btn');
  if (themeToggle) return themeToggle;
  
  // Alternative ID
  themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) return themeToggle;
  
  // Class-based selector as backup
  themeToggle = document.querySelector('.theme-toggle-btn');
  if (themeToggle) return themeToggle;
  
  return null; // Return null if no element found
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
  const themeToggle = getThemeToggleButton();
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

async function copyToClipboard(text, options = {}) {
  const { successMessage = 'Copied to clipboard', errorMessage = 'Unable to copy to clipboard' } = options;
  const value = typeof text === 'string' ? text : String(text || '');
  if (!value.trim()) {
    showNotification('Nothing to copy', 'warning', 2000);
    return false;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    if (successMessage) {
      showNotification(successMessage, 'success', 1600);
    }
    return true;
  } catch (error) {
    console.error('Failed to copy text:', error);
    if (errorMessage) {
      showNotification(errorMessage, 'error', 2200);
    }
    return false;
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
      state.settings.thinkingMode = state.settings.thinkingMode || DEFAULT_THINKING_MODE;
      state.thinkingMode = state.settings.thinkingMode;
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

function saveActiveSessionPreference(sessionId) {
  try {
    localStorage.setItem('ollama-active-session', sessionId);
  } catch (_) {
    // ignore
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
    const stored = localStorage.getItem(THINKING_PREF_KEY);
    if (stored === null) {
      return true;
    }
    return JSON.parse(stored) !== false;
  } catch (_) {
    return true;
  }
}

function getWorkflowEntry(sessionId) {
  if (!sessionId || !state.workflowPhases) {
    return null;
  }
  return state.workflowPhases[sessionId] || null;
}

function ensureWorkflowEntry(sessionId, options = {}) {
  if (!sessionId) {
    return null;
  }
  if (!state.workflowPhases[sessionId]) {
    state.workflowPhases[sessionId] = {
      phase: options.phase || WORKFLOW_PHASES.EXECUTION,
      answers: {},
      conversation: [],
      prompt: '',
      summary: null,
      updatedAt: new Date().toISOString(),
      completedAt: null
    };
  }
  return state.workflowPhases[sessionId];
}

function markSessionRequiresPlanning(sessionId) {
  if (!sessionId) return;
  const entry = ensureWorkflowEntry(sessionId, { phase: WORKFLOW_PHASES.PLANNING });
  entry.phase = WORKFLOW_PHASES.PLANNING;
  entry.answers = {};
  entry.conversation = [];
  entry.prompt = '';
  entry.summary = null;
  entry.updatedAt = new Date().toISOString();
  entry.completedAt = null;
  persistWorkflowPhases();
  window.appState = state;
  emitWorkflowPhaseChange(sessionId);
}

function syncWorkflowStateWithSessions() {
  const validIds = new Set(state.sessions.map((session) => session.id));
  Object.keys(state.workflowPhases || {}).forEach((sessionId) => {
    if (!validIds.has(sessionId)) {
      delete state.workflowPhases[sessionId];
    }
  });
  state.sessions.forEach((session) => {
    ensureWorkflowEntry(session.id, { phase: WORKFLOW_PHASES.EXECUTION });
  });
  persistWorkflowPhases();
  window.appState = state;
}

function isSessionReadyForExecution(sessionId) {
  // Always allow chat in instant/default mode (no planning required)
  // This fix removes the "planning must be completed first" error
  const session = state.sessions.find(s => s.id === sessionId);
  
  // If session is instant mode or doesn't exist (default), always ready
  if (!session || session.mode === 'instant' || session.mode === undefined) {
    return true;
  }

  // Only check workflow phases for planning mode sessions
  if (session.mode === 'planning') {
    const entry = getWorkflowEntry(sessionId);
    if (!entry) return true;
    return entry.phase === WORKFLOW_PHASES.EXECUTION;
  }
  
  // Default to allowing execution
  return true;
}

function emitWorkflowPhaseChange(sessionId) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('workflow-phase-change', {
      detail: {
        sessionId,
        phase: getWorkflowEntry(sessionId)?.phase || WORKFLOW_PHASES.PLANNING
      }
    })
  );
}

function saveWorkflowPlanningDraft(payload) {
  if (!payload?.sessionId) return;
  const entry = ensureWorkflowEntry(payload.sessionId, { phase: WORKFLOW_PHASES.PLANNING });
  entry.phase = payload.phase || entry.phase || WORKFLOW_PHASES.PLANNING;
  entry.answers = payload.answers || entry.answers || {};
  entry.conversation = payload.conversation || entry.conversation || [];
  entry.prompt = payload.prompt || entry.prompt || '';
  entry.summary = payload.summary || entry.summary || null;
  entry.isComplete = Boolean(payload.isComplete);
  entry.updatedAt = new Date().toISOString();
  persistWorkflowPhases();
  if (payload.sessionId === state.activeSessionId) {
    renderPhaseBanner();
    renderPhaseBadge();
  }
  window.appState = state;
}

async function completePlanningPhase(payload) {
  if (!payload?.sessionId) return { success: false };
  const entry = ensureWorkflowEntry(payload.sessionId, { phase: WORKFLOW_PHASES.EXECUTION });
  entry.phase = WORKFLOW_PHASES.EXECUTION;
  entry.answers = payload.answers || entry.answers || {};
  entry.conversation = payload.conversation || entry.conversation || [];
  entry.prompt = payload.prompt || entry.prompt || '';
  entry.summary = payload.summary || entry.summary || buildPlanSummaryFromEntry(entry);
  entry.isComplete = true;
  entry.completedAt = new Date().toISOString();
  entry.updatedAt = entry.completedAt;
  persistWorkflowPhases();
  window.appState = state;
  emitWorkflowPhaseChange(payload.sessionId);
  if (payload.sessionId === state.activeSessionId) {
    renderPhaseBanner();
    renderPhaseBadge();
  }
  showNotification('Planning phase complete. Execution unlocked.', 'success', 2500);
  return { success: true };
}

async function resetPlanningPhase(sessionId) {
  if (!sessionId) return;
  markSessionRequiresPlanning(sessionId);
  if (sessionId === state.activeSessionId) {
    renderPhaseBanner();
    renderPhaseBadge();
  }
}

function buildPlanSummaryFromEntry(entry = {}) {
  return {
    objective: entry.answers?.objective || '',
    context: entry.answers?.context || '',
    constraints: entry.answers?.constraints || '',
    verification: entry.answers?.verification || ''
  };
}

function buildPlanningMountConfig() {
  const sessionId = state.activeSessionId || state.sessions[0]?.id || null;
  const session = state.sessions.find((item) => item.id === sessionId);
  const entry = sessionId
    ? ensureWorkflowEntry(sessionId, {
        phase: session ? WORKFLOW_PHASES.EXECUTION : WORKFLOW_PHASES.PLANNING
      })
    : {
        phase: WORKFLOW_PHASES.PLANNING,
        answers: {},
        conversation: [],
        prompt: ''
      };
  return {
    sessionId,
    sessionName: session?.name || 'Untitled session',
    answers: entry.answers,
    conversation: entry.conversation,
    generatedPrompt: entry.prompt,
    phase: entry.phase,
    isComplete: entry.phase === WORKFLOW_PHASES.EXECUTION
  };
}

// Cloud synchronization functions
async function syncDataToCloud() {
  try {
    // Prepare data for sync
    const syncData = {
      activeSessionId: state.activeSessionId,
      settings: state.settings,
      localHistory: state.localHistory,
      thinkingEnabled: state.thinkingEnabled,
      thinkingMode: state.thinkingMode
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
        elements.activeModel.textContent = 'model: --';
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
        elements.activeModel.textContent = 'model: --';
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


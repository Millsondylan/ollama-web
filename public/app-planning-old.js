/**
 * Planning Mode Module for Ollama Web - Split-Pane Version
 * Provides conversational requirement gathering and prompt generation
 * Fully integrated with dual-mode system
 */

// Planning mode state
const planningState = {
  currentStep: 0,
  conversation: [],
  answers: {
    objective: '',
    context: '',
    constraints: '',
    verification: ''
  },
  images: [],
  isComplete: false,
  generatedPrompt: null,
  sessionId: null,
  sessionName: '',
  phase: 'planning',
  autoSaveInterval: null
};

// Planning questions with AI-driven follow-ups
const PLANNING_QUESTIONS = [
  {
    id: 'objective',
    step: 1,
    question: "What's the main objective or goal you want to accomplish?",
    aiPrompt: "Ask a clarifying follow-up question about the user's objective to ensure we understand the scope and desired outcome.",
    placeholder: "Describe what you want to build, fix, or improve...",
    required: true
  },
  {
    id: 'context',
    step: 2,
    question: "What context should I know? Describe your current environment, codebase, or situation.",
    aiPrompt: "Based on the objective, ask about technical details, existing implementations, or environmental constraints that would be relevant.",
    placeholder: "Tech stack, existing code, limitations, dependencies...",
    required: true,
    supportsImages: true
  },
  {
    id: 'constraints',
    step: 3,
    question: "Are there any specific constraints, requirements, or preferences?",
    aiPrompt: "Probe for non-obvious constraints like performance requirements, compatibility needs, or design preferences.",
    placeholder: "Performance targets, browser support, design requirements...",
    required: false
  },
  {
    id: 'verification',
    step: 4,
    question: "How should the work be verified or tested?",
    aiPrompt: "Suggest appropriate testing strategies based on the objective and help the user define clear success criteria.",
    placeholder: "Testing approach, success criteria, acceptance criteria...",
    required: false
  }
];

const REQUIRED_QUESTION_IDS = ['objective', 'context'];

/**
 * Initialize planning mode when page loads
 */
function initPlanning() {
  // Get session ID from state
  if (window.appState && window.appState.activeSessionId) {
    planningState.sessionId = window.appState.activeSessionId;

    // Load session name
    const activeSession = window.appState.sessions?.find(s => s.id === planningState.sessionId);
    if (activeSession) {
      planningState.sessionName = activeSession.name;

      // Load existing planning data if present
      if (activeSession.planningData) {
        loadExistingPlanningData(activeSession.planningData);
      }
    }
  }

  // Setup auto-save
  startAutoSave();

  // Load UI
  renderPlanningUI();
  attachPlanningHandlers();

  console.log('[Planning] Initialized for session:', planningState.sessionId);
}

/**
 * Load existing planning data from session
 */
function loadExistingPlanningData(data) {
  if (data.answers) {
    planningState.answers = { ...planningState.answers, ...data.answers };
  }
  if (data.conversation) {
    planningState.conversation = data.conversation;
  }
  if (data.images) {
    planningState.images = data.images;
  }
  if (data.generatedPrompt) {
    planningState.generatedPrompt = data.generatedPrompt;
  }
  if (data.status) {
    planningState.isComplete = data.status === 'complete';
  }

  // Resume at the right step
  const answeredSteps = Object.keys(data.answers || {}).filter(k => data.answers[k]).length;
  planningState.currentStep = Math.min(answeredSteps, PLANNING_QUESTIONS.length - 1);
}

/**
 * Render the planning UI
 */
function renderPlanningUI() {
  // Update session name in header
  const sessionNameEl = document.getElementById('planning-session-name');
  if (sessionNameEl) {
    sessionNameEl.textContent = planningState.sessionName || 'Planning Session';
  }

  // Update progress indicators
  updateProgressIndicators();

  // Update summary cards
  updateSummaryCards();

  // Update prompt preview
  updatePromptPreview();

  // Render conversation
  renderConversation();
}

/**
 * Attach event handlers for planning page
 */
function attachPlanningHandlers() {
  // Start planning button
  const startBtn = document.getElementById('planning-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', startPlanning);
  }

  // Submit answer button
  const submitBtn = document.getElementById('planning-submit-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', submitAnswer);
  }

  // Image upload button
  const imageBtn = document.getElementById('planning-image-btn');
  const imageInput = document.getElementById('planning-image-input');

  if (imageBtn && imageInput) {
    imageBtn.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', handlePlanningImageUpload);
  }

  // Switch to instant button
  const switchBtn = document.getElementById('planning-switch-instant-btn');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      if (typeof switchMode === 'function') {
        switchMode('instant');
      }
    });
  }

  // Settings button
  const settingsBtn = document.getElementById('planning-settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      if (window.navigateToPage) {
        window.navigateToPage('settings');
      }
    });
  }

  // Save draft button
  const saveDraftBtn = document.getElementById('planning-save-draft-btn');
  if (saveDraftBtn) {
    saveDraftBtn.addEventListener('click', () => {
      if (typeof savePlanningDraft === 'function') {
        const draftData = buildPlanningDraftData();
        savePlanningDraft(planningState.sessionId, draftData);
        showNotification('Draft saved', 'success');
      }
    });
  }

  // Transfer button
  const transferBtn = document.getElementById('planning-transfer-btn');
  if (transferBtn) {
    transferBtn.addEventListener('click', () => {
      if (typeof transferPlanningToInstant === 'function') {
        transferPlanningToInstant();
      }
    });
  }

  // Enter key to submit
  const textarea = document.getElementById('planning-input');
  if (textarea) {
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitAnswer();
      }
    });
  }
}

/**
 * Start the planning conversation
 */
function startPlanning() {
  planningState.currentStep = 0;
  showNextQuestion();
}

/**
 * Show the next question in the planning workflow
 */
function showNextQuestion() {
  if (planningState.currentStep >= PLANNING_QUESTIONS.length) {
    // All questions answered, complete planning
    completePlanning();
    return;
  }

  const question = PLANNING_QUESTIONS[planningState.currentStep];

  // Add AI message to conversation
  addPlanningMessage('ai', question.question, question.step);

  // Update progress indicators
  updateProgressIndicators();

  // Enable/disable image button based on step
  const imageBtn = document.getElementById('planning-image-btn');
  if (imageBtn) {
    imageBtn.style.display = question.supportsImages ? 'flex' : 'none';
  }

  // Focus textarea
  const textarea = document.getElementById('planning-input');
  if (textarea) {
    textarea.focus();
  }
}

/**
 * Submit the current answer
 */
async function submitAnswer() {
  const textarea = document.getElementById('planning-input');
  if (!textarea) return;

  const answer = textarea.value.trim();
  const currentQuestion = PLANNING_QUESTIONS[planningState.currentStep];

  // Validate required answers
  if (currentQuestion.required && !answer) {
    showNotification('This field is required', 'error');
    return;
  }

  // Save answer
  planningState.answers[currentQuestion.id] = answer;

  // Add user message to conversation
  if (answer) {
    addPlanningMessage('user', answer, currentQuestion.step);
  }

  // Save to conversation history
  planningState.conversation.push({
    step: currentQuestion.step,
    questionId: currentQuestion.id,
    question: currentQuestion.question,
    answer: answer,
    timestamp: new Date().toISOString()
  });

  // Update summary card
  updateSummaryCards();

  // Generate and update prompt preview
  generatePromptPreview();

  // Clear textarea
  textarea.value = '';

  // Move to next step
  planningState.currentStep++;

  // Show next question or complete
  if (planningState.currentStep < PLANNING_QUESTIONS.length) {
    // Show AI follow-up (simulated for now, can be replaced with actual AI call)
    setTimeout(() => {
      showNextQuestion();
    }, 300);
  } else {
    completePlanning();
  }

  // Save draft
  autoSaveDraft();
}

/**
 * Add a message to the planning conversation
 */
function addPlanningMessage(role, content, step) {
  const conversationEl = document.getElementById('planning-conversation');
  if (!conversationEl) return;

  // Remove welcome message if present
  const welcome = conversationEl.querySelector('.planning-welcome');
  if (welcome) {
    welcome.remove();
  }

  // Create message element
  const messageDiv = document.createElement('div');
  messageDiv.className = `planning-message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'planning-message-avatar';
  avatar.textContent = role === 'ai' ? '🤖' : '👤';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'planning-message-content';

  const label = document.createElement('div');
  label.className = 'planning-message-label';
  label.textContent = role === 'ai' ? `Step ${step}: AI` : 'You';

  const text = document.createElement('div');
  text.className = 'planning-message-text';
  text.textContent = content;

  contentDiv.appendChild(label);
  contentDiv.appendChild(text);

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentDiv);

  conversationEl.appendChild(messageDiv);

  // Scroll to bottom
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

/**
 * Update progress indicators
 */
function updateProgressIndicators() {
  const steps = document.querySelectorAll('.progress-step');
  steps.forEach((stepEl, index) => {
    stepEl.classList.remove('active', 'complete');

    if (index < planningState.currentStep) {
      stepEl.classList.add('complete');
    } else if (index === planningState.currentStep) {
      stepEl.classList.add('active');
    }
  });
}

/**
 * Update summary cards with current answers
 */
function updateSummaryCards() {
  // Objective
  const objectiveCard = document.querySelector('#summary-objective .summary-card-content');
  if (objectiveCard) {
    objectiveCard.textContent = planningState.answers.objective || 'Not yet defined';
  }

  // Context
  const contextCard = document.querySelector('#summary-context .summary-card-content');
  if (contextCard) {
    contextCard.textContent = planningState.answers.context || 'Not yet defined';
  }

  // Constraints
  const constraintsCard = document.querySelector('#summary-constraints .summary-card-content');
  if (constraintsCard) {
    constraintsCard.textContent = planningState.answers.constraints || 'None specified';
  }

  // Verification
  const verificationCard = document.querySelector('#summary-verification .summary-card-content');
  if (verificationCard) {
    verificationCard.textContent = planningState.answers.verification || 'None specified';
  }

  // Images
  const imagesCard = document.getElementById('summary-images');
  const imagesList = document.getElementById('summary-images-list');
  if (imagesCard && imagesList) {
    if (planningState.images.length > 0) {
      imagesCard.style.display = 'block';
      imagesList.textContent = `${planningState.images.length} image(s) attached`;
    } else {
      imagesCard.style.display = 'none';
    }
  }

  // Enable/disable action buttons based on state
  updateActionButtons();
}

/**
 * Update prompt preview display
 */
function updatePromptPreview() {
  const previewPanel = document.getElementById('planning-prompt-preview');
  if (!previewPanel) return;

  if (planningState.generatedPrompt) {
    previewPanel.textContent = planningState.generatedPrompt;
    previewPanel.style.display = 'block';
  } else {
    previewPanel.style.display = 'none';
  }
}

/**
 * Generate and update the prompt preview
 */
function generatePromptPreview() {
  const { objective, context, constraints, verification } = planningState.answers;

  let prompt = '';

  // Build XML-style prompt
  if (objective || context) {
    prompt += '<task>\n';

    if (objective) {
      prompt += `  <objective>${objective}</objective>\n`;
    }

    if (context) {
      prompt += `  <context>${context}</context>\n`;
    }

    if (constraints) {
      prompt += `  <constraints>${constraints}</constraints>\n`;
    }

    if (verification) {
      prompt += `  <verification>${verification}</verification>\n`;
    }

    if (planningState.images.length > 0) {
      prompt += `  <images count="${planningState.images.length}">Images will be processed with vision model</images>\n`;
    }

    prompt += '</task>';
  }

  // Update preview
  const previewEl = document.getElementById('prompt-preview');
  if (previewEl) {
    if (prompt) {
      previewEl.textContent = prompt;
      previewEl.classList.remove('prompt-preview-placeholder');
    } else {
      previewEl.innerHTML = '<div class="prompt-preview-placeholder">Complete the planning steps to see your generated prompt here.</div>';
    }
  }

  // Update stats
  const statsEl = document.getElementById('prompt-stats');
  if (statsEl && prompt) {
    const charCount = prompt.length;
    const tokenEstimate = Math.ceil(charCount / 4); // Rough estimate
    statsEl.innerHTML = `<span>${charCount} characters</span><span>•</span><span>~${tokenEstimate} tokens</span>`;
  }

  // Save to state
  planningState.generatedPrompt = prompt;

  return prompt;
}

/**
 * Update action buttons state
 */
function updateActionButtons() {
  const hasAnyData = Object.values(planningState.answers).some(a => a && a.trim());
  const hasRequiredData = REQUIRED_QUESTION_IDS.every(id => {
    const value = planningState.answers[id];
    return value && value.trim().length > 0;
  });

  // Save draft button - enabled if any data
  const saveDraftBtn = document.getElementById('planning-save-draft-btn');
  if (saveDraftBtn) {
    saveDraftBtn.disabled = !hasAnyData;
  }

  // Transfer button - enabled if required data is present
  const transferBtn = document.getElementById('planning-transfer-btn');
  if (transferBtn) {
    transferBtn.disabled = !hasRequiredData;
    if (hasRequiredData) {
      transferBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="13,2 3,14 12,14 11,22 21,10 12,10 13,2"/>
        </svg>
        <span>Transfer to Instant</span>
      `;
    }
  }
}

/**
 * Complete the planning phase
 */
function completePlanning() {
  planningState.isComplete = true;
  planningState.phase = 'complete';

  // Add completion message
  addPlanningMessage('ai', 'Planning complete! Your structured prompt has been generated. You can now transfer this to Instant Mode to begin execution.', 5);

  // Generate final prompt
  generatePromptPreview();

  // Enable transfer button
  updateActionButtons();

  // Save draft
  autoSaveDraft();

  console.log('[Planning] Planning phase completed');
}

/**
 * Handle image upload in planning mode
 */
async function handlePlanningImageUpload(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  try {
    // Use vision-aware upload
    if (typeof handleVisionAwareUpload === 'function') {
      const result = await handleVisionAwareUpload(files);

      if (result.success) {
        // Add images to planning state
        planningState.images.push(...result.images);

        // Render image previews
        renderImagePreviews();

        // Update summary
        updateSummaryCards();

        // Update prompt preview
        generatePromptPreview();

        // Save draft
        autoSaveDraft();

        showNotification(`${result.count} image(s) added`, 'success');
      } else if (!result.cancelled) {
        showNotification(result.error || 'Failed to upload images', 'error');
      }
    } else {
      // Fallback: Simple base64 conversion
      const imagePromises = Array.from(files).map(file => convertImageToBase64(file));
      const images = await Promise.all(imagePromises);
      planningState.images.push(...images);
      renderImagePreviews();
      updateSummaryCards();
      generatePromptPreview();
      autoSaveDraft();
    }

  } catch (error) {
    console.error('[Planning] Image upload error:', error);
    showNotification('Failed to upload images', 'error');
  }

  // Clear input
  event.target.value = '';
}

/**
 * Render image previews in the attachments area
 */
function renderImagePreviews() {
  const attachmentsEl = document.getElementById('planning-attachments');
  if (!attachmentsEl) return;

  attachmentsEl.innerHTML = '';

  planningState.images.forEach((image, index) => {
    const preview = document.createElement('div');
    preview.className = 'planning-attachment-preview';

    const img = document.createElement('img');
    img.src = image;
    img.alt = `Image ${index + 1}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'planning-attachment-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeImage(index));

    preview.appendChild(img);
    preview.appendChild(removeBtn);
    attachmentsEl.appendChild(preview);
  });
}

/**
 * Remove an image from planning
 */
function removeImage(index) {
  planningState.images.splice(index, 1);
  renderImagePreviews();
  updateSummaryCards();
  generatePromptPreview();
  autoSaveDraft();
}

/**
 * Render the conversation history
 */
function renderConversation() {
  const conversationEl = document.getElementById('planning-conversation');
  if (!conversationEl) return;

  // Clear existing messages (except welcome if no conversation)
  if (planningState.conversation.length === 0) {
    return; // Keep welcome message
  }

  conversationEl.innerHTML = '';

  // Render all conversation items
  planningState.conversation.forEach(item => {
    addPlanningMessage('ai', item.question, item.step);
    if (item.answer) {
      addPlanningMessage('user', item.answer, item.step);
    }
  });
}

/**
 * Start auto-save interval
 */
function startAutoSave() {
  // Clear any existing interval
  if (planningState.autoSaveInterval) {
    clearInterval(planningState.autoSaveInterval);
  }

  // Auto-save every 30 seconds
  planningState.autoSaveInterval = setInterval(() => {
    if (typeof savePlanningDraft === 'function' && planningState.sessionId) {
      const hasData = Object.values(planningState.answers).some(a => a && a.trim());
      if (hasData) {
        const draftData = buildPlanningDraftData();
        savePlanningDraft(planningState.sessionId, draftData)
          .then(() => console.log('[Planning] Auto-saved'))
          .catch(error => console.error('[Planning] Auto-save failed:', error));
      }
    }
  }, 30000); // 30 seconds
}

/**
 * Auto-save draft (immediate)
 */
function autoSaveDraft() {
  if (typeof savePlanningDraft === 'function' && planningState.sessionId) {
    const draftData = buildPlanningDraftData();
    savePlanningDraft(planningState.sessionId, draftData)
      .catch(error => console.error('[Planning] Auto-save failed:', error));
  }
}

/**
 * Build draft data object
 */
function buildPlanningDraftData() {
  return {
    status: planningState.isComplete ? 'complete' : 'draft',
    answers: planningState.answers,
    generatedPrompt: planningState.generatedPrompt,
    conversation: planningState.conversation,
    images: planningState.images,
    visionModel: null, // Will be determined when images are processed
    updatedAt: new Date().toISOString()
  };
}

/**
 * Update planning state in global state
 */
function syncPlanningToGlobalState() {
  if (window.appState && window.appState.modeData) {
    window.appState.modeData.planning.draftData = buildPlanningDraftData();
    window.appState.modeData.planning.images = planningState.images;
  }
}

/**
 * Cleanup on page unload
 */
function cleanupPlanning() {
  if (planningState.autoSaveInterval) {
    clearInterval(planningState.autoSaveInterval);
  }

  // Final sync to global state
  syncPlanningToGlobalState();
}

// Initialize when the planning page is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('planning-conversation')) {
      initPlanning();
    }
  });
} else {
  // DOM already loaded
  if (document.getElementById('planning-conversation')) {
    initPlanning();
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanupPlanning);

// Export for main app to call
if (typeof window !== 'undefined') {
  window.PlanningModule = {
    init: initPlanning,
    getState: () => planningState,
    cleanup: cleanupPlanning,
    syncToGlobalState: syncPlanningToGlobalState
  };
}

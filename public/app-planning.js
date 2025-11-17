/**
 * AI-Driven Planning Mode - Conversational Requirements Gathering
 * Uses the user's chosen Ollama model to ask intelligent contextual questions
 */

const planningState = {
  sessionId: null,
  sessionName: '',
  conversation: [],
  userRequest: '',
  gatheredContext: {},
  images: [],
  isComplete: false,
  generatedPrompt: null,
  autoSaveInterval: null
};

/**
 * Initialize planning mode
 */
function initPlanning() {
  console.log('[Planning] Initializing AI-driven planning mode');

  // Get session ID from app state
  if (window.appState && window.appState.activeSessionId) {
    planningState.sessionId = window.appState.activeSessionId;

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

  // Render UI
  renderPlanningUI();
  attachPlanningHandlers();
}

/**
 * Load existing planning data
 */
function loadExistingPlanningData(data) {
  if (data.conversation && Array.isArray(data.conversation)) {
    planningState.conversation = data.conversation;
  }
  if (data.userRequest) {
    planningState.userRequest = data.userRequest;
  }
  if (data.gatheredContext) {
    planningState.gatheredContext = data.gatheredContext;
  }
  if (data.images && Array.isArray(data.images)) {
    planningState.images = data.images;
  }
  if (data.generatedPrompt) {
    planningState.generatedPrompt = data.generatedPrompt;
    planningState.isComplete = true;
  }
}

/**
 * Render planning UI
 */
function renderPlanningUI() {
  renderConversation();
  updatePromptPreview();
}

/**
 * Attach event handlers
 */
function attachPlanningHandlers() {
  // Start planning button
  const startBtn = document.getElementById('planning-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', startPlanning);
  }

  // Submit button (for user responses)
  const submitBtn = document.getElementById('planning-submit-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', submitUserMessage);
  }

  // Done button (when user finishes planning)
  const doneBtn = document.getElementById('planning-done-btn');
  if (doneBtn) {
    doneBtn.addEventListener('click', finalizePlanning);
  }

  // Image upload
  const imageBtn = document.getElementById('planning-image-btn');
  const imageInput = document.getElementById('planning-image-input');
  if (imageBtn && imageInput) {
    imageBtn.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', handleImageUpload);
  }

  // Switch to instant
  const switchBtn = document.getElementById('planning-switch-instant-btn');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      if (typeof switchMode === 'function') {
        switchMode('instant');
      } else {
        window.navigateToPage && window.navigateToPage('chat');
      }
    });
  }

  // Settings button
  const settingsBtn = document.getElementById('planning-settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      window.navigateToPage && window.navigateToPage('settings');
    });
  }

  // Enter key to submit
  const textarea = document.getElementById('planning-input');
  if (textarea) {
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitUserMessage();
      }
    });
  }
}

/**
 * Start planning conversation
 */
function startPlanning() {
  // Hide welcome, show input
  const welcome = document.querySelector('.planning-welcome');
  const inputArea = document.querySelector('.planning-input-area');

  if (welcome) welcome.style.display = 'none';
  if (inputArea) inputArea.style.display = 'block';

  // Add initial AI message
  addMessage('ai', "Hi! I'm here to help you create a comprehensive plan. What would you like to accomplish?");

  // Focus input
  const textarea = document.getElementById('planning-input');
  if (textarea) textarea.focus();
}

/**
 * Submit user message and get AI response
 */
async function submitUserMessage() {
  const textarea = document.getElementById('planning-input');
  if (!textarea) return;

  const userMessage = textarea.value.trim();
  if (!userMessage) return;

  // Clear input
  textarea.value = '';

  // If this is the first user message, store it as the main request
  if (!planningState.userRequest) {
    planningState.userRequest = userMessage;
  }

  // Add user message to conversation
  addMessage('user', userMessage);

  // Show loading indicator
  const loadingId = addMessage('ai', '...', true);

  try {
    // Get AI response using user's chosen model
    const aiResponse = await getAIQuestionOrResponse(userMessage);

    // Remove loading indicator
    removeMessage(loadingId);

    // Add AI response
    addMessage('ai', aiResponse);

    // Auto-save
    autoSaveDraft();

  } catch (error) {
    console.error('[Planning] Error getting AI response:', error);
    removeMessage(loadingId);
    addMessage('ai', "I'm having trouble connecting. Please check your Ollama configuration and try again.");
  }
}

/**
 * Get AI response using Ollama
 */
async function getAIQuestionOrResponse(userMessage) {
  const model = window.appState?.settings?.model || 'qwen3:1.7b';

  // Build context-aware prompt for the AI
  const systemPrompt = `You are a planning assistant helping gather requirements for a coding task.

Your role:
1. Ask intelligent, contextual questions to fully understand the user's needs
2. Probe for technical details, constraints, environment, and verification needs
3. Help the user think through edge cases and potential issues
4. Be conversational but focused - each question should add value
5. When you sense the user has provided sufficient detail, acknowledge it and ask if they're ready to finalize

Current context from conversation:
${planningState.conversation.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n')}

Ask ONE focused follow-up question to gather more important context. If the user seems to have covered everything, ask if they're ready to finalize the plan.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      messages: messages,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  const aiResponse = data.message?.content || data.response || 'Could not generate response';

  // Extract structured context and update side panel
  await extractAndUpdateContext();

  return aiResponse;
}

/**
 * Extract structured information from conversation and update side panel
 */
async function extractAndUpdateContext() {
  const model = window.appState?.settings?.model || 'qwen3:1.7b';

  // Get conversation summary for extraction
  const conversationText = planningState.conversation
    .map(m => `${m.role === 'ai' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n\n');

  const extractionPrompt = `Based on the following planning conversation, extract and organize the key information into these categories. Be concise but comprehensive:

1. **Objective**: What is the main goal/task?
2. **Context**: Technical details, environment, current state
3. **Constraints**: Requirements, limitations, preferences
4. **Verification**: How to test/verify the work

Conversation:
${conversationText}

Respond in this exact JSON format:
{
  "objective": "Brief summary of the main goal",
  "context": "Key technical details and environment",
  "constraints": "Important requirements and limitations",
  "verification": "Testing approach and success criteria"
}

If information for a category hasn't been discussed yet, use "Not yet discussed".`;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'user', content: extractionPrompt }
        ],
        stream: false
      })
    });

    if (!response.ok) return;

    const data = await response.json();
    const content = data.message?.content || data.response || '';

    // Try to parse JSON from response
    let extracted;
    try {
      // Look for JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.warn('[Planning] Could not parse extraction:', e);
      return;
    }

    // Update gathered context
    if (extracted) {
      planningState.gatheredContext = extracted;
      updateSidePanel();
    }

  } catch (error) {
    console.error('[Planning] Error extracting context:', error);
  }
}

/**
 * Update side panel with extracted context
 */
function updateSidePanel() {
  const ctx = planningState.gatheredContext;

  // Update objective card
  const objectiveCard = document.querySelector('#summary-objective .summary-card-content');
  if (objectiveCard && ctx.objective) {
    objectiveCard.textContent = ctx.objective;
  }

  // Update context card
  const contextCard = document.querySelector('#summary-context .summary-card-content');
  if (contextCard && ctx.context) {
    contextCard.textContent = ctx.context;
  }

  // Update constraints card
  const constraintsCard = document.querySelector('#summary-constraints .summary-card-content');
  if (constraintsCard && ctx.constraints) {
    constraintsCard.textContent = ctx.constraints;
  }

  // Update verification card
  const verificationCard = document.querySelector('#summary-verification .summary-card-content');
  if (verificationCard && ctx.verification) {
    verificationCard.textContent = ctx.verification;
  }

  // Update images card
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
}

/**
 * Finalize planning and generate comprehensive prompt
 */
async function finalizePlanning() {
  const doneBtn = document.getElementById('planning-done-btn');
  if (doneBtn) {
    doneBtn.disabled = true;
    doneBtn.textContent = 'Generating...';
  }

  try {
    // Get comprehensive prompt from AI
    const prompt = await generateFinalPrompt();

    planningState.generatedPrompt = prompt;
    planningState.isComplete = true;

    // Update UI
    updatePromptPreview();

    // Show completion message
    addMessage('ai', "✅ Planning complete! I've generated a comprehensive prompt based on our conversation. You can review it in the right panel, copy it, or transfer it to Instant Mode.");

    // Save
    await autoSaveDraft();

    // Show transfer button
    showTransferOptions();

  } catch (error) {
    console.error('[Planning] Error finalizing:', error);
    addMessage('ai', "Error generating final prompt. Please try again.");
  } finally {
    if (doneBtn) {
      doneBtn.disabled = false;
      doneBtn.textContent = 'Done Planning';
    }
  }
}

/**
 * Generate final comprehensive prompt
 */
async function generateFinalPrompt() {
  const model = window.appState?.settings?.model || 'qwen3:1.7b';

  const conversationSummary = planningState.conversation
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n\n');

  const systemPrompt = `You are a prompt engineering expert. Based on the planning conversation, generate a comprehensive, well-structured prompt for an AI coding assistant.

The prompt should:
1. Clearly state the objective
2. Provide all necessary context
3. Specify constraints and requirements
4. Define verification/testing approach
5. Be actionable and complete

Use this format:
<task>
  <objective>[Clear goal]</objective>
  <context>[Technical details, environment, current state]</context>
  <constraints>[Requirements, limitations, preferences]</constraints>
  <verification>[How to test/verify the work]</verification>
  <execution>[Specific steps or approach]</execution>
</task>

Planning conversation summary:
${conversationSummary}`;

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate the comprehensive prompt based on our planning conversation.' }
      ],
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.message?.content || data.response || '<task>Error generating prompt</task>';
}

/**
 * Add message to conversation
 */
function addMessage(role, content, isLoading = false) {
  const id = Date.now() + Math.random();

  const message = {
    id,
    role,
    content,
    isLoading,
    timestamp: new Date().toISOString()
  };

  planningState.conversation.push(message);
  renderConversation();

  return id;
}

/**
 * Remove message by ID
 */
function removeMessage(id) {
  const index = planningState.conversation.findIndex(m => m.id === id);
  if (index !== -1) {
    planningState.conversation.splice(index, 1);
    renderConversation();
  }
}

/**
 * Render conversation
 */
function renderConversation() {
  const container = document.getElementById('planning-conversation');
  if (!container) return;

  // Clear and rebuild
  container.innerHTML = '';

  planningState.conversation.forEach(msg => {
    const msgDiv = document.createElement('div');
    msgDiv.className = `planning-message planning-message-${msg.role}`;

    const avatar = document.createElement('div');
    avatar.className = 'planning-message-avatar';
    avatar.textContent = msg.role === 'ai' ? '🤖' : '👤';

    const content = document.createElement('div');
    content.className = 'planning-message-content';

    if (msg.isLoading) {
      content.innerHTML = '<div class="planning-loading-dots"><span></span><span></span><span></span></div>';
    } else {
      content.textContent = msg.content;
    }

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(content);
    container.appendChild(msgDiv);
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

/**
 * Update prompt preview
 */
function updatePromptPreview() {
  const preview = document.getElementById('prompt-preview');
  if (!preview) return;

  if (planningState.generatedPrompt) {
    preview.innerHTML = `<pre>${escapeHtml(planningState.generatedPrompt)}</pre>`;
  } else {
    preview.innerHTML = '<div class="prompt-preview-placeholder">Complete the planning conversation and click "Done Planning" to generate your prompt.</div>';
  }
}

/**
 * Show transfer options
 */
function showTransferOptions() {
  const conversation = document.getElementById('planning-conversation');
  if (!conversation) return;

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'planning-completion-actions';
  actionsDiv.innerHTML = `
    <button id="copy-prompt-btn" class="planning-action-btn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      Copy Prompt
    </button>
    <button id="transfer-to-instant-btn" class="planning-action-btn primary">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="13,2 3,14 12,14 11,22 21,10 12,10 13,2"/>
      </svg>
      Transfer to Instant Mode
    </button>
  `;

  conversation.appendChild(actionsDiv);

  // Attach handlers
  const copyBtn = document.getElementById('copy-prompt-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(planningState.generatedPrompt);
      showNotification('Prompt copied to clipboard!', 'success');
    });
  }

  const transferBtn = document.getElementById('transfer-to-instant-btn');
  if (transferBtn) {
    transferBtn.addEventListener('click', async () => {
      if (typeof transferPlanningToInstant === 'function') {
        await transferPlanningToInstant();
      } else {
        // Fallback: navigate to chat with prompt in state
        window.navigateToPage && window.navigateToPage('chat');
      }
    });
  }
}

/**
 * Handle image upload
 */
async function handleImageUpload(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue;

    const reader = new FileReader();
    reader.onload = (e) => {
      planningState.images.push({
        name: file.name,
        dataUrl: e.target.result,
        size: file.size
      });

      renderImagePreviews();
      autoSaveDraft();
    };
    reader.readAsDataURL(file);
  }

  // Clear input
  event.target.value = '';
}

/**
 * Render image previews
 */
function renderImagePreviews() {
  const container = document.getElementById('planning-attachments');
  if (!container) return;

  container.innerHTML = '';

  planningState.images.forEach((img, index) => {
    const preview = document.createElement('div');
    preview.className = 'planning-image-preview';
    preview.innerHTML = `
      <img src="${img.dataUrl}" alt="${escapeHtml(img.name)}" />
      <button class="remove-image-btn" data-index="${index}" title="Remove">×</button>
    `;
    container.appendChild(preview);
  });

  // Attach remove handlers
  container.querySelectorAll('.remove-image-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      planningState.images.splice(index, 1);
      renderImagePreviews();
      autoSaveDraft();
    });
  });

  container.style.display = planningState.images.length > 0 ? 'flex' : 'none';
}

/**
 * Auto-save draft
 */
async function autoSaveDraft() {
  if (!planningState.sessionId) return;

  const draftData = {
    status: planningState.isComplete ? 'complete' : 'draft',
    conversation: planningState.conversation,
    userRequest: planningState.userRequest,
    gatheredContext: planningState.gatheredContext,
    generatedPrompt: planningState.generatedPrompt,
    images: planningState.images,
    updatedAt: new Date().toISOString()
  };

  try {
    if (typeof savePlanningDraft === 'function') {
      await savePlanningDraft(planningState.sessionId, draftData);
      console.log('[Planning] Auto-saved');
    }
  } catch (error) {
    console.error('[Planning] Auto-save failed:', error);
  }
}

/**
 * Start auto-save interval
 */
function startAutoSave() {
  if (planningState.autoSaveInterval) {
    clearInterval(planningState.autoSaveInterval);
  }

  planningState.autoSaveInterval = setInterval(() => {
    if (planningState.conversation.length > 0) {
      autoSaveDraft();
    }
  }, 30000); // 30 seconds
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
  if (typeof window.escapeHtml === 'function') {
    return window.escapeHtml(text);
  }
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show notification (if available)
 */
function showNotification(message, type) {
  if (typeof window.showNotification === 'function') {
    window.showNotification(message, type);
  } else {
    console.log(`[Notification] ${message}`);
  }
}

// Export for window.PlanningModule
window.PlanningModule = {
  init: initPlanning
};

console.log('[Planning] AI-driven planning module loaded');

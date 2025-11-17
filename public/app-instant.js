/**
 * Instant Mode UI Handlers
 * Handles the new planning-inspired instant mode interface
 */

(function() {
  'use strict';

  // Initialize instant mode UI handlers when chat page loads
  function initInstantModeUI() {
    console.log('[Instant Mode] Initializing UI handlers');

    // Get modal elements
    const sessionsModal = document.getElementById('sessions-modal');
    const sessionsModalClose = document.getElementById('sessions-modal-close');
    const instantSessionsBtn = document.getElementById('instant-sessions-btn');
    const instantSettingsBtn = document.getElementById('instant-settings-btn');
    const instantSwitchPlanningBtn = document.getElementById('instant-switch-planning-btn');
    const newChatBtn = document.getElementById('new-chat-btn');
    const settingsModal = document.getElementById('settings-modal-ultra');
    const closeSettingsBtn = document.getElementById('close-settings-ultra');
    const themeToggleBtn = document.getElementById('theme-toggle');

    // Sessions Modal Handlers
    if (instantSessionsBtn) {
      instantSessionsBtn.addEventListener('click', () => {
        console.log('[Instant Mode] Opening sessions modal');
        openSessionsModal();
      });
    }

    if (sessionsModalClose) {
      sessionsModalClose.addEventListener('click', () => {
        console.log('[Instant Mode] Closing sessions modal');
        closeSessionsModal();
      });
    }

    // Close modal on backdrop click
    if (sessionsModal) {
      sessionsModal.addEventListener('click', (e) => {
        if (e.target === sessionsModal) {
          closeSessionsModal();
        }
      });
    }

    // Settings Modal Handlers
    if (instantSettingsBtn) {
      instantSettingsBtn.addEventListener('click', () => {
        console.log('[Instant Mode] Opening settings modal');
        openSettingsModal();
      });
    }

    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        console.log('[Instant Mode] Closing settings modal');
        closeSettingsModal();
      });
    }

    // Close settings modal on backdrop click
    if (settingsModal) {
      settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
          closeSettingsModal();
        }
      });
    }

    // Mode Switching
    if (instantSwitchPlanningBtn) {
      instantSwitchPlanningBtn.addEventListener('click', () => {
        console.log('[Instant Mode] Switching to planning mode');
        switchToPlanningMode();
      });
    }

    // New Chat/Session
    if (newChatBtn) {
      newChatBtn.addEventListener('click', () => {
        console.log('[Instant Mode] Creating new session');
        createNewSession();
        closeSessionsModal();
      });
    }

    // Theme Toggle
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        toggleTheme();
      });
    }

    // Initialize welcome message visibility
    updateWelcomeVisibility();

    // Update session name in header
    updateSessionHeader();

    // Load and render sessions in modal
    loadSessionsToModal();

    // Handle image attachments display
    initImageAttachments();
  }

  // Open Sessions Modal
  function openSessionsModal() {
    const modal = document.getElementById('sessions-modal');
    if (modal) {
      loadSessionsToModal();
      modal.style.display = 'flex';
    }
  }

  // Close Sessions Modal
  function closeSessionsModal() {
    const modal = document.getElementById('sessions-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  // Open Settings Modal
  function openSettingsModal() {
    const modal = document.getElementById('settings-modal-ultra');
    if (modal) {
      modal.style.display = 'flex';
      // Trigger settings load if available
      if (typeof loadSettings === 'function') {
        loadSettings();
      }
    }
  }

  // Close Settings Modal
  function closeSettingsModal() {
    const modal = document.getElementById('settings-modal-ultra');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  // Switch to Planning Mode
  function switchToPlanningMode() {
    if (typeof window.navigateToPage === 'function') {
      window.navigateToPage('planning');
    } else {
      console.error('[Instant Mode] navigateToPage function not found');
    }
  }

  // Create New Session
  function createNewSession() {
    if (typeof createSession === 'function') {
      createSession();
    } else {
      console.log('[Instant Mode] createSession function not found, using fallback');
      // Fallback: trigger new chat via API
      fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `New Chat ${new Date().toLocaleTimeString()}`,
          instructions: '',
          attachments: []
        })
      })
      .then(response => response.json())
      .then(session => {
        console.log('[Instant Mode] New session created:', session);
        if (typeof selectSession === 'function') {
          selectSession(session.id);
        }
        loadSessionsToModal();
      })
      .catch(error => {
        console.error('[Instant Mode] Error creating session:', error);
      });
    }
  }

  // Toggle Theme
  function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    // Update theme icon visibility
    const lightIcon = document.querySelector('.theme-icon-light');
    const darkIcon = document.querySelector('.theme-icon-dark');

    if (newTheme === 'dark') {
      if (lightIcon) lightIcon.style.display = 'none';
      if (darkIcon) darkIcon.style.display = 'block';
    } else {
      if (lightIcon) lightIcon.style.display = 'block';
      if (darkIcon) darkIcon.style.display = 'none';
    }

    console.log('[Instant Mode] Theme toggled to:', newTheme);
  }

  // Update Welcome Message Visibility
  function updateWelcomeVisibility() {
    const welcome = document.getElementById('instant-welcome');
    const chatHistory = document.getElementById('chat-history');

    if (welcome && chatHistory) {
      const hasMessages = chatHistory.children.length > 0;
      welcome.style.display = hasMessages ? 'none' : 'flex';
    }
  }

  // Update Session Header
  function updateSessionHeader() {
    const sessionNameEl = document.getElementById('instant-session-name');
    if (sessionNameEl && window.state && window.state.activeSessionId) {
      const sessions = window.state.sessions || [];
      const activeSession = sessions.find(s => s.id === window.state.activeSessionId);
      if (activeSession) {
        sessionNameEl.textContent = activeSession.name || 'Chat Session';
      }
    }
  }

  // Load Sessions to Modal
  function loadSessionsToModal() {
    const sessionsList = document.querySelector('.instant-sessions-list');
    if (!sessionsList) return;

    // Get sessions from state or API
    const sessions = window.state?.sessions || [];
    const activeSessionId = window.state?.activeSessionId;

    sessionsList.innerHTML = '';

    if (sessions.length === 0) {
      sessionsList.innerHTML = '<p style="text-align: center; color: var(--text-light); padding: 2rem;">No sessions yet. Create one to get started!</p>';
      return;
    }

    // Sort sessions by updatedAt (newest first)
    const sortedSessions = [...sessions].sort((a, b) => {
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });

    sortedSessions.forEach(session => {
      const sessionItem = document.createElement('div');
      sessionItem.className = 'instant-session-item';
      if (session.id === activeSessionId) {
        sessionItem.classList.add('active');
      }

      const content = document.createElement('div');
      content.className = 'instant-session-item-content';

      const name = document.createElement('div');
      name.className = 'instant-session-item-name';
      name.textContent = session.name || 'Untitled Session';

      const meta = document.createElement('div');
      meta.className = 'instant-session-item-meta';
      const messageCount = session.history?.length || 0;
      const updatedDate = session.updatedAt ? new Date(session.updatedAt).toLocaleDateString() : '';
      meta.textContent = `${messageCount} messages • ${updatedDate}`;

      content.appendChild(name);
      content.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'instant-session-item-actions';

      // Delete button
      if (session.id !== 'default') { // Don't allow deleting default session
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'instant-session-delete';
        deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        deleteBtn.title = 'Delete session';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteSession(session.id);
        });
        actions.appendChild(deleteBtn);
      }

      sessionItem.appendChild(content);
      sessionItem.appendChild(actions);

      // Click to select session
      sessionItem.addEventListener('click', () => {
        selectSession(session.id);
        closeSessionsModal();
      });

      sessionsList.appendChild(sessionItem);
    });
  }

  // Select Session
  function selectSession(sessionId) {
    console.log('[Instant Mode] Selecting session:', sessionId);

    // Use existing select function if available
    if (typeof window.selectSession === 'function') {
      window.selectSession(sessionId);
    } else {
      // Fallback API call
      fetch(`/api/sessions/${sessionId}/select`, {
        method: 'POST'
      })
      .then(response => response.json())
      .then(() => {
        console.log('[Instant Mode] Session selected');
        if (typeof loadHistory === 'function') {
          loadHistory();
        }
        updateSessionHeader();
      })
      .catch(error => {
        console.error('[Instant Mode] Error selecting session:', error);
      });
    }
  }

  // Delete Session
  function deleteSession(sessionId) {
    if (!confirm('Are you sure you want to delete this session? This cannot be undone.')) {
      return;
    }

    console.log('[Instant Mode] Deleting session:', sessionId);

    fetch(`/api/sessions/${sessionId}`, {
      method: 'DELETE'
    })
    .then(response => {
      if (response.ok) {
        console.log('[Instant Mode] Session deleted');
        // Reload sessions if available
        if (typeof loadSessions === 'function') {
          loadSessions();
        }
        loadSessionsToModal();
      } else {
        throw new Error('Failed to delete session');
      }
    })
    .catch(error => {
      console.error('[Instant Mode] Error deleting session:', error);
      alert('Failed to delete session. Please try again.');
    });
  }

  // Initialize Image Attachments
  function initImageAttachments() {
    const imageUploadBtn = document.getElementById('image-upload-btn');
    const imageUploadInput = document.getElementById('image-upload-input');
    const attachmentsContainer = document.getElementById('instant-attachments');

    if (imageUploadBtn && imageUploadInput) {
      imageUploadBtn.addEventListener('click', () => {
        imageUploadInput.click();
      });

      imageUploadInput.addEventListener('change', (e) => {
        handleImageUpload(e.target.files);
      });
    }
  }

  // Handle Image Upload
  function handleImageUpload(files) {
    const attachmentsContainer = document.getElementById('instant-attachments');
    if (!attachmentsContainer || !files || files.length === 0) return;

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const preview = createImagePreview(e.target.result, file.name);
        attachmentsContainer.appendChild(preview);
        attachmentsContainer.style.display = 'flex';
      };
      reader.readAsDataURL(file);
    });
  }

  // Create Image Preview Element
  function createImagePreview(dataUrl, filename) {
    const preview = document.createElement('div');
    preview.className = 'instant-attachment-preview';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = filename;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'instant-attachment-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      preview.remove();
      const attachmentsContainer = document.getElementById('instant-attachments');
      if (attachmentsContainer && attachmentsContainer.children.length === 0) {
        attachmentsContainer.style.display = 'none';
      }
    });

    preview.appendChild(img);
    preview.appendChild(removeBtn);

    return preview;
  }

  // Override message rendering to match new design
  function renderMessageInInstantMode(message) {
    const messageEl = document.createElement('div');
    messageEl.className = `instant-message ${message.role}`;

    // Icon
    const icon = document.createElement('div');
    icon.className = 'instant-message-icon';
    icon.textContent = message.role === 'user' ? 'U' : 'AI';
    messageEl.appendChild(icon);

    // Content
    const content = document.createElement('div');
    content.className = 'instant-message-content';

    const label = document.createElement('div');
    label.className = 'instant-message-label';
    label.textContent = message.role === 'user' ? 'You' : 'Assistant';
    content.appendChild(label);

    const text = document.createElement('div');
    text.className = 'instant-message-text';
    text.textContent = message.content;
    content.appendChild(text);

    messageEl.appendChild(content);

    return messageEl;
  }

  // Listen for page changes to re-initialize when chat page loads
  window.addEventListener('pagechange', (event) => {
    if (event.detail.page === 'chat') {
      // Small delay to ensure DOM is ready
      setTimeout(initInstantModeUI, 100);
    }
  });

  // Initialize on load if already on chat page
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.state?.currentPage === 'chat') {
        setTimeout(initInstantModeUI, 100);
      }
    });
  } else {
    if (window.state?.currentPage === 'chat') {
      setTimeout(initInstantModeUI, 100);
    }
  }

  // Export functions for external use
  window.instantModeUI = {
    init: initInstantModeUI,
    updateWelcomeVisibility,
    updateSessionHeader,
    loadSessionsToModal,
    renderMessage: renderMessageInInstantMode
  };

  console.log('[Instant Mode] Module loaded');
})();

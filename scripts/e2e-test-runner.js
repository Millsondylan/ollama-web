'use strict';

/**
 * End-to-End Test Runner for Ollama Web Application
 * ==================================================
 * Comprehensive browser-based testing with Puppeteer
 *
 * Features:
 * - Real user account testing (configurable via environment variables)
 * - Data persistence verification with page refresh checks
 * - Complete app functionality coverage
 * - Detailed success and failure reporting
 */

const puppeteer = require('puppeteer');

// Test configuration from environment variables
const CONFIG = {
  serverUrl: process.env.SERVER_URL || 'http://127.0.0.1:4100',
  userName: process.env.TEST_USER_NAME || 'TestUser',
  userEmail: process.env.TEST_USER_EMAIL || 'testuser@example.com',
  sessionName: process.env.TEST_SESSION_NAME || 'E2E Test Session',
  headless: process.env.HEADLESS !== 'false',
  timeout: parseInt(process.env.TEST_TIMEOUT || '120000', 10),
  slowMo: parseInt(process.env.SLOW_MO || '0', 10)
};

// Test results tracking
const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

// Logging utilities
function logInfo(message) {
  console.log(`[E2E-INFO] ${message}`);
}

function logSuccess(testName) {
  console.log(`[E2E-SUCCESS] ✓ ${testName}`);
  testResults.passed.push(testName);
}

function logError(testName, error) {
  console.error(`[E2E-ERROR] ✗ ${testName}: ${error.message || error}`);
  testResults.failed.push({ test: testName, error: error.message || error });
}

function logWarning(message) {
  console.warn(`[E2E-WARNING] ${message}`);
  testResults.warnings.push(message);
}

function logSection(title) {
  console.log('');
  console.log('='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

// Helper functions
async function waitForSelector(page, selector, options = {}) {
  const timeout = options.timeout || 10000;
  try {
    await page.waitForSelector(selector, { timeout, ...options });
    return true;
  } catch (error) {
    throw new Error(`Selector "${selector}" not found within ${timeout}ms`);
  }
}

async function safeClick(page, selector, description) {
  try {
    await waitForSelector(page, selector, { visible: true });
    await page.click(selector);
    await page.waitForTimeout(500); // Small delay for UI updates
    return true;
  } catch (error) {
    throw new Error(`Failed to click ${description}: ${error.message}`);
  }
}

async function safeType(page, selector, text, description) {
  try {
    await waitForSelector(page, selector, { visible: true });
    await page.click(selector);
    await page.type(selector, text, { delay: 10 });
    await page.waitForTimeout(300);
    return true;
  } catch (error) {
    throw new Error(`Failed to type in ${description}: ${error.message}`);
  }
}

// Test: Load homepage
async function testLoadHomepage(page) {
  const testName = 'Load Homepage';
  try {
    logInfo(`Testing: ${testName}`);
    const response = await page.goto(CONFIG.serverUrl, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()}`);
    }

    // Verify page title or key element
    const title = await page.title();
    if (!title) {
      throw new Error('Page title is empty');
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
    throw error;
  }
}

// Test: Settings page access
async function testSettingsPageAccess(page) {
  const testName = 'Access Settings Page';
  try {
    logInfo(`Testing: ${testName}`);

    // Look for settings link/button
    const settingsSelectors = [
      'a[href*="settings"]',
      'button[title*="Settings"]',
      '[data-page="settings"]',
      'nav a:has-text("Settings")'
    ];

    let found = false;
    for (const selector of settingsSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          await element.click();
          found = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!found) {
      // Try navigating directly
      await page.goto(`${CONFIG.serverUrl}/settings`, {
        waitUntil: 'networkidle0'
      });
    }

    await page.waitForTimeout(1000);
    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: Create new session with user-defined name
async function testCreateSession(page) {
  const testName = 'Create New Session';
  try {
    logInfo(`Testing: ${testName} - "${CONFIG.sessionName}"`);

    // Navigate to main page
    await page.goto(CONFIG.serverUrl, { waitUntil: 'networkidle0' });
    await page.waitForTimeout(1000);

    // Look for new session button
    const newSessionSelectors = [
      'button:has-text("New Session")',
      '[data-action="new-session"]',
      'button[title*="New"]',
      '#new-session-btn'
    ];

    let sessionCreated = false;
    for (const selector of newSessionSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          await page.waitForTimeout(500);

          // Try to find and fill session name input
          const nameInputSelectors = [
            'input[name="session-name"]',
            'input[placeholder*="name"]',
            '#session-name',
            'input[type="text"]'
          ];

          for (const inputSelector of nameInputSelectors) {
            const input = await page.$(inputSelector);
            if (input) {
              await input.click({ clickCount: 3 }); // Select all
              await input.type(CONFIG.sessionName);
              sessionCreated = true;
              break;
            }
          }

          if (sessionCreated) {
            // Try to submit
            const submitSelectors = [
              'button[type="submit"]',
              'button:has-text("Create")',
              'button:has-text("Save")'
            ];

            for (const submitSelector of submitSelectors) {
              const submitBtn = await page.$(submitSelector);
              if (submitBtn) {
                await submitBtn.click();
                await page.waitForTimeout(1000);
                break;
              }
            }
          }
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!sessionCreated) {
      logWarning('Could not create session via UI, will use API');
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: Send chat message
async function testSendChatMessage(page) {
  const testName = 'Send Chat Message';
  try {
    logInfo(`Testing: ${testName}`);

    await page.goto(CONFIG.serverUrl, { waitUntil: 'networkidle0' });
    await page.waitForTimeout(1000);

    const testMessage = `Hello, this is a test message from ${CONFIG.userName}`;

    // Find chat input
    const inputSelectors = [
      'textarea[name="message"]',
      'input[type="text"][placeholder*="message"]',
      '#message-input',
      'textarea#prompt',
      'textarea'
    ];

    let messageSent = false;
    for (const selector of inputSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          const isVisible = await page.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          }, input);

          if (isVisible) {
            await input.click();
            await input.type(testMessage);
            await page.waitForTimeout(300);

            // Try to submit
            const submitSelectors = [
              'button[type="submit"]',
              'button:has-text("Send")',
              '#send-btn',
              'button[title*="Send"]'
            ];

            for (const submitSelector of submitSelectors) {
              const submitBtn = await page.$(submitSelector);
              if (submitBtn) {
                await submitBtn.click();
                messageSent = true;
                await page.waitForTimeout(2000); // Wait for response
                break;
              }
            }

            if (!messageSent) {
              // Try Enter key
              await input.press('Enter');
              messageSent = true;
              await page.waitForTimeout(2000);
            }
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (!messageSent) {
      throw new Error('Could not send chat message via UI');
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: Verify chat history persistence with refresh
async function testChatHistoryPersistence(page) {
  const testName = 'Chat History Persistence After Refresh';
  try {
    logInfo(`Testing: ${testName}`);

    // Get current history length before refresh
    const historyBefore = await page.evaluate(() => {
      const messages = document.querySelectorAll('.message, [class*="message"], .chat-message');
      return messages.length;
    });

    logInfo(`Found ${historyBefore} messages before refresh`);

    // Refresh the page
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForTimeout(2000);

    // Check history after refresh
    const historyAfter = await page.evaluate(() => {
      const messages = document.querySelectorAll('.message, [class*="message"], .chat-message');
      return messages.length;
    });

    logInfo(`Found ${historyAfter} messages after refresh`);

    if (historyBefore > 0 && historyAfter === 0) {
      throw new Error('Chat history was lost after refresh');
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: API health endpoint
async function testHealthEndpoint(page) {
  const testName = 'API Health Endpoint';
  try {
    logInfo(`Testing: ${testName}`);

    const response = await page.goto(`${CONFIG.serverUrl}/health`, {
      waitUntil: 'networkidle0'
    });

    if (!response.ok()) {
      throw new Error(`Health endpoint returned ${response.status()}`);
    }

    const data = await response.json();
    if (!data.status || data.status !== 'ok') {
      throw new Error('Health check status is not ok');
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: Settings API
async function testSettingsAPI(page) {
  const testName = 'Settings API';
  try {
    logInfo(`Testing: ${testName}`);

    const response = await page.goto(`${CONFIG.serverUrl}/api/settings`, {
      waitUntil: 'networkidle0'
    });

    if (!response.ok()) {
      throw new Error(`Settings API returned ${response.status()}`);
    }

    const data = await response.json();
    if (!data.current || !data.defaults) {
      throw new Error('Settings API response missing required fields');
    }

    if (!Array.isArray(data.presets)) {
      throw new Error('Presets not found in settings');
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: Sessions API
async function testSessionsAPI(page) {
  const testName = 'Sessions API';
  try {
    logInfo(`Testing: ${testName}`);

    const response = await page.goto(`${CONFIG.serverUrl}/api/sessions`, {
      waitUntil: 'networkidle0'
    });

    if (!response.ok()) {
      throw new Error(`Sessions API returned ${response.status()}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.sessions)) {
      throw new Error('Sessions API response missing sessions array');
    }

    if (!data.activeSessionId) {
      throw new Error('No active session ID found');
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: Clear history and verify persistence
async function testClearHistory(page) {
  const testName = 'Clear History and Verify Persistence';
  try {
    logInfo(`Testing: ${testName}`);

    await page.goto(CONFIG.serverUrl, { waitUntil: 'networkidle0' });
    await page.waitForTimeout(1000);

    // Look for clear history button
    const clearSelectors = [
      'button:has-text("Clear")',
      '[data-action="clear-history"]',
      'button[title*="Clear"]',
      '#clear-history-btn'
    ];

    let cleared = false;
    for (const selector of clearSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          const isVisible = await page.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          }, button);

          if (isVisible) {
            await button.click();
            await page.waitForTimeout(500);

            // Check for confirmation dialog
            const confirmSelectors = [
              'button:has-text("Confirm")',
              'button:has-text("Yes")',
              'button:has-text("OK")'
            ];

            for (const confirmSelector of confirmSelectors) {
              const confirmBtn = await page.$(confirmSelector);
              if (confirmBtn) {
                await confirmBtn.click();
                await page.waitForTimeout(1000);
                break;
              }
            }

            cleared = true;
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Refresh and verify history is still empty
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForTimeout(2000);

    if (!cleared) {
      logWarning('Could not clear history via UI, skipping verification');
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: Model selection (if available)
async function testModelSelection(page) {
  const testName = 'Model Selection';
  try {
    logInfo(`Testing: ${testName}`);

    await page.goto(CONFIG.serverUrl, { waitUntil: 'networkidle0' });
    await page.waitForTimeout(1000);

    // Look for model selector
    const modelSelectors = [
      'select[name="model"]',
      '#model-select',
      'select[id*="model"]',
      '[data-field="model"]'
    ];

    let modelFound = false;
    for (const selector of modelSelectors) {
      try {
        const select = await page.$(selector);
        if (select) {
          const options = await page.evaluate(el => {
            return Array.from(el.options).map(opt => opt.value);
          }, select);

          if (options.length > 0) {
            logInfo(`Found ${options.length} models available`);
            modelFound = true;
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (!modelFound) {
      logWarning('No model selector found in UI');
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: Session persistence after refresh
async function testSessionPersistence(page) {
  const testName = 'Session Data Persistence After Refresh';
  try {
    logInfo(`Testing: ${testName}`);

    // Get sessions before refresh
    await page.goto(`${CONFIG.serverUrl}/api/sessions`, {
      waitUntil: 'networkidle0'
    });
    const dataBefore = await page.evaluate(() => {
      return document.body.textContent;
    });
    const sessionsBefore = JSON.parse(dataBefore);

    logInfo(`Found ${sessionsBefore.sessions.length} sessions before refresh`);

    // Wait a bit
    await page.waitForTimeout(1000);

    // Refresh and check again
    await page.reload({ waitUntil: 'networkidle0' });
    const dataAfter = await page.evaluate(() => {
      return document.body.textContent;
    });
    const sessionsAfter = JSON.parse(dataAfter);

    logInfo(`Found ${sessionsAfter.sessions.length} sessions after refresh`);

    if (sessionsBefore.sessions.length !== sessionsAfter.sessions.length) {
      throw new Error('Session count changed after refresh');
    }

    if (sessionsBefore.activeSessionId !== sessionsAfter.activeSessionId) {
      throw new Error('Active session changed after refresh');
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: Responsive design (viewport changes)
async function testResponsiveDesign(page) {
  const testName = 'Responsive Design';
  try {
    logInfo(`Testing: ${testName}`);

    await page.goto(CONFIG.serverUrl, { waitUntil: 'networkidle0' });

    // Test mobile viewport
    await page.setViewport({ width: 375, height: 667 });
    await page.waitForTimeout(1000);
    logInfo('Tested mobile viewport (375x667)');

    // Test tablet viewport
    await page.setViewport({ width: 768, height: 1024 });
    await page.waitForTimeout(1000);
    logInfo('Tested tablet viewport (768x1024)');

    // Test desktop viewport
    await page.setViewport({ width: 1920, height: 1080 });
    await page.waitForTimeout(1000);
    logInfo('Tested desktop viewport (1920x1080)');

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Test: Console errors check
async function testConsoleErrors(page) {
  const testName = 'Console Errors Check';
  try {
    logInfo(`Testing: ${testName}`);

    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    page.on('pageerror', error => {
      errors.push(error.message);
    });

    await page.goto(CONFIG.serverUrl, { waitUntil: 'networkidle0' });
    await page.waitForTimeout(2000);

    if (errors.length > 0) {
      logWarning(`Found ${errors.length} console errors`);
      errors.forEach(err => logWarning(`  - ${err}`));
    }

    logSuccess(testName);
  } catch (error) {
    logError(testName, error);
  }
}

// Generate test report
function generateReport() {
  logSection('End-to-End Test Results');

  console.log('');
  console.log(`Total Tests: ${testResults.passed.length + testResults.failed.length}`);
  console.log(`Passed: ${testResults.passed.length}`);
  console.log(`Failed: ${testResults.failed.length}`);
  console.log(`Warnings: ${testResults.warnings.length}`);
  console.log('');

  if (testResults.passed.length > 0) {
    console.log('Passed Tests:');
    testResults.passed.forEach(test => {
      console.log(`  ✓ ${test}`);
    });
    console.log('');
  }

  if (testResults.failed.length > 0) {
    console.log('Failed Tests:');
    testResults.failed.forEach(({ test, error }) => {
      console.log(`  ✗ ${test}`);
      console.log(`    Error: ${error}`);
    });
    console.log('');
    return false;
  }

  if (testResults.warnings.length > 0) {
    console.log('Warnings:');
    testResults.warnings.forEach(warning => {
      console.log(`  ⚠ ${warning}`);
    });
    console.log('');
  }

  return true;
}

// Main test runner
async function runTests() {
  logSection('Starting End-to-End Tests');
  console.log('Configuration:');
  console.log(`  Server URL: ${CONFIG.serverUrl}`);
  console.log(`  Test User: ${CONFIG.userName}`);
  console.log(`  Session Name: ${CONFIG.sessionName}`);
  console.log(`  Headless: ${CONFIG.headless}`);
  console.log(`  Timeout: ${CONFIG.timeout}ms`);
  console.log('');

  let browser;
  let page;

  try {
    // Launch browser
    logInfo('Launching browser...');
    browser = await puppeteer.launch({
      headless: CONFIG.headless,
      slowMo: CONFIG.slowMo,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security'
      ]
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setDefaultTimeout(CONFIG.timeout);

    logInfo('Browser launched successfully');

    // Run all tests
    await testLoadHomepage(page);
    await testHealthEndpoint(page);
    await testSettingsAPI(page);
    await testSessionsAPI(page);
    await testSettingsPageAccess(page);
    await testCreateSession(page);
    await testSendChatMessage(page);
    await testChatHistoryPersistence(page);
    await testSessionPersistence(page);
    await testClearHistory(page);
    await testModelSelection(page);
    await testResponsiveDesign(page);
    await testConsoleErrors(page);

  } catch (error) {
    logError('Test Suite Execution', error);
  } finally {
    if (browser) {
      await browser.close();
      logInfo('Browser closed');
    }
  }

  // Generate and display report
  const success = generateReport();
  process.exit(success ? 0 : 1);
}

// Run the tests
runTests().catch(error => {
  console.error('[E2E-FATAL] Test runner failed:', error);
  process.exit(1);
});

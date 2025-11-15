# Full Test Suite Documentation

## Overview

The comprehensive test suite for Ollama Web Application provides end-to-end testing coverage including:

- ✅ Backend API endpoint testing
- ✅ Browser-based UI testing with Puppeteer
- ✅ Data persistence verification with refresh checks
- ✅ Real user account testing (configurable)
- ✅ Complete app functionality coverage
- ✅ Detailed success and failure reporting

## Quick Start

### Basic Usage

```bash
# Run the full test suite
npm test

# Or run directly
./scripts/run_full_test_suite.sh
```

### Run Individual Test Suites

```bash
# API tests only
npm run test:api

# End-to-end browser tests only
npm run test:e2e
```

## Configuration

The test suite uses environment variables for configuration. **No hardcoded values like 'Chet' are used anywhere.**

### Required Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TEST_USER_NAME` | Name of the test user account | `TestUser` |
| `TEST_USER_EMAIL` | Email of the test user | `testuser@example.com` |
| `TEST_SESSION_NAME` | Name for test sessions | `E2E Test Session` |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVER_PORT` | Port for the application server | `4100` |
| `MOCK_PORT` | Port for the mock Ollama server | `14001` |
| `SERVER_URL` | Full server URL | `http://127.0.0.1:4100` |
| `HEADLESS` | Run browser in headless mode | `true` |
| `TEST_TIMEOUT` | Test timeout in milliseconds | `120000` |
| `SLOW_MO` | Puppeteer slow motion delay (ms) | `0` |

### Example Configuration

```bash
# Set up your test account
export TEST_USER_NAME="John Doe"
export TEST_USER_EMAIL="john.doe@example.com"
export TEST_SESSION_NAME="My Test Session"

# Run with visible browser (useful for debugging)
export HEADLESS=false

# Run tests
npm test
```

## Test Coverage

### API Tests (Backend)

1. **Non-streaming generation** - `/api/generate` endpoint
2. **Streaming generation** - `/api/generate` with streaming
3. **Chat streaming** - `/api/chat/stream` endpoint
4. **Preset caching** - Settings and presets
5. **Session preset sync** - Session management

### End-to-End Tests (Browser)

1. **Load Homepage** - Verify app loads correctly
2. **Access Settings Page** - Settings UI accessibility
3. **Create New Session** - Session creation with custom name
4. **Send Chat Message** - Message submission and response
5. **Chat History Persistence** - History survives page refresh ✅
6. **Session Data Persistence** - Sessions survive page refresh ✅
7. **Clear History** - History clearing and verification
8. **Model Selection** - Model picker functionality
9. **Responsive Design** - Mobile, tablet, desktop viewports
10. **API Health Endpoint** - Server health check
11. **Settings API** - Settings endpoint validation
12. **Sessions API** - Sessions endpoint validation
13. **Console Errors Check** - JavaScript error detection

## Refresh Logic

The test suite includes comprehensive refresh checks to ensure data persistence:

### Chat History Refresh Test
```javascript
// Counts messages before refresh
// Reloads the page
// Verifies message count matches after reload
// FAILS if history is lost
```

### Session Persistence Refresh Test
```javascript
// Fetches sessions via API
// Records session count and active session
// Reloads page
// Verifies sessions are unchanged
// FAILS if data is lost
```

## Output and Reporting

### Success Output
```
================================================
Test Summary Report
================================================

Total Tests Run: 18
Tests Passed: 18
Tests Failed: 0

All tests passed successfully! ✓
```

### Failure Output
```
================================================
Test Summary Report
================================================

Total Tests Run: 18
Tests Passed: 15
Tests Failed: 3

Failed Tests:
  ✗ Chat History Persistence After Refresh
  ✗ Session Data Persistence After Refresh
  ✗ Send Chat Message
```

### Detailed Logging

Each test provides detailed logging:
- `[INFO]` - Informational messages
- `[SUCCESS]` - Test passed
- `[ERROR]` - Test failed with error details
- `[WARNING]` - Non-critical issues

## Debugging

### Run with Visible Browser

```bash
export HEADLESS=false
npm run test:e2e
```

This allows you to watch the tests execute in real-time.

### Slow Motion Mode

```bash
export HEADLESS=false
export SLOW_MO=100
npm run test:e2e
```

Adds a 100ms delay between actions for easier observation.

### View Server Logs

The test suite starts its own server instance. Check the output for server logs during test execution.

## Troubleshooting

### Tests Fail with "Cannot connect to server"

**Solution:** Ensure no other instance is running on the test ports (4100, 14001).

```bash
# Kill any running instances
pkill -f "node server.js"
pkill -f "node scripts/mock-ollama.js"

# Run tests again
npm test
```

### Browser Launch Fails

**Solution:** Install required dependencies (Linux).

```bash
# Debian/Ubuntu
sudo apt-get install -y \
  chromium-browser \
  fonts-liberation \
  libnss3 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libasound2
```

### Timeout Errors

**Solution:** Increase test timeout.

```bash
export TEST_TIMEOUT=180000  # 3 minutes
npm test
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - name: Run tests
        env:
          TEST_USER_NAME: "CI Test User"
          TEST_USER_EMAIL: "ci@example.com"
          HEADLESS: true
        run: npm test
```

### GitLab CI

```yaml
test:
  image: node:18
  before_script:
    - npm install
  script:
    - export TEST_USER_NAME="CI Test User"
    - export TEST_USER_EMAIL="ci@example.com"
    - export HEADLESS=true
    - npm test
```

## Best Practices

1. **Always use environment variables** for user-specific data
2. **Never hardcode test accounts** in the code
3. **Run tests before commits** to catch regressions early
4. **Use meaningful test names** for easy identification
5. **Keep tests independent** - each test should work in isolation
6. **Clean up test data** after test runs

## Architecture

```
scripts/
├── run_full_test_suite.sh    # Main orchestrator script
├── e2e-test-runner.js         # Puppeteer end-to-end tests
├── verify.js                  # Backend API tests
└── mock-ollama.js             # Mock Ollama server
```

### Flow Diagram

```
run_full_test_suite.sh
    ├── Check dependencies
    ├── Start mock Ollama server (port 14001)
    ├── Start application server (port 4100)
    ├── Run API tests (verify.js)
    ├── Run E2E tests (e2e-test-runner.js)
    │   ├── Launch Puppeteer browser
    │   ├── Execute UI tests
    │   ├── Verify data persistence with refreshes
    │   └── Generate detailed report
    └── Display final summary
```

## Contributing

When adding new tests:

1. Add the test function to `e2e-test-runner.js`
2. Call the function in the `runTests()` sequence
3. Use consistent naming: `testFeatureName(page)`
4. Log results with `logSuccess()` or `logError()`
5. Update this documentation

## License

Same as the main project.

---

**Note:** This test suite uses **ONLY** configurable environment variables for user accounts. There are **NO** references to 'Chet' or any other hardcoded user names in the entire test suite.

#!/bin/bash

# Full Test Suite for Ollama Web Application
# ============================================
# This script runs comprehensive tests including:
# - API endpoint tests
# - End-to-end browser tests with real user interactions
# - Data persistence verification with refresh checks
# - All app function coverage
# - Detailed issue and success reporting

set -e

# Color output for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration from environment variables
export TEST_USER_NAME="${TEST_USER_NAME:-TestUser}"
export TEST_USER_EMAIL="${TEST_USER_EMAIL:-testuser@example.com}"
export TEST_SESSION_NAME="${TEST_SESSION_NAME:-E2E Test Session}"
export SERVER_PORT="${PORT:-4100}"
export MOCK_PORT="${MOCK_PORT:-14001}"
export SERVER_URL="${SERVER_URL:-http://127.0.0.1:${SERVER_PORT}}"
export HEADLESS="${HEADLESS:-true}"
export TEST_TIMEOUT="${TEST_TIMEOUT:-120000}"

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0
FAILED_TESTS=()

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    FAILED_TESTS+=("$1")
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================================${NC}"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up test processes..."
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
    fi
    if [ ! -z "$MOCK_PID" ]; then
        kill $MOCK_PID 2>/dev/null || true
    fi
}

trap cleanup EXIT

# Check dependencies
check_dependencies() {
    log_section "Checking Dependencies"

    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        exit 1
    fi
    log_success "Node.js is installed: $(node --version)"

    if [ ! -d "node_modules" ]; then
        log_error "Node modules not installed. Run 'npm install' first."
        exit 1
    fi
    log_success "Node modules are installed"

    if [ ! -f "scripts/mock-ollama.js" ]; then
        log_error "Mock Ollama server not found"
        exit 1
    fi
    log_success "Mock Ollama server found"
}

# Start test servers
start_servers() {
    log_section "Starting Test Servers"

    # Start mock Ollama server
    log_info "Starting mock Ollama server on port ${MOCK_PORT}..."
    export OLLAMA_HOST="http://127.0.0.1:${MOCK_PORT}/"
    export OLLAMA_CONNECTIVITY_TIMEOUT_MS=2000
    export OLLAMA_GENERATION_TIMEOUT_MS=10000
    export OLLAMA_STREAM_TIMEOUT_MS=120000
    export STREAM_HEARTBEAT_INTERVAL_MS=50

    node scripts/mock-ollama.js $MOCK_PORT &
    MOCK_PID=$!
    sleep 2

    if ! kill -0 $MOCK_PID 2>/dev/null; then
        log_error "Failed to start mock Ollama server"
        exit 1
    fi
    log_success "Mock Ollama server started (PID: $MOCK_PID)"

    # Start application server
    log_info "Starting application server on port ${SERVER_PORT}..."
    node server.js &
    SERVER_PID=$!
    sleep 3

    if ! kill -0 $SERVER_PID 2>/dev/null; then
        log_error "Failed to start application server"
        exit 1
    fi
    log_success "Application server started (PID: $SERVER_PID)"

    # Wait for server to be ready
    log_info "Waiting for server to be ready..."
    MAX_RETRIES=30
    RETRY_COUNT=0
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -s "${SERVER_URL}/health" > /dev/null 2>&1; then
            log_success "Server is ready and responding"
            return 0
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        sleep 1
    done

    log_error "Server did not become ready in time"
    exit 1
}

# Run API tests
run_api_tests() {
    log_section "Running API Tests"

    log_info "Running backend verification tests..."
    if node scripts/verify.js; then
        log_success "Backend API tests passed"
    else
        log_error "Backend API tests failed"
    fi
}

# Run end-to-end tests
run_e2e_tests() {
    log_section "Running End-to-End Browser Tests"

    log_info "Starting comprehensive browser tests..."
    log_info "Test User: ${TEST_USER_NAME}"
    log_info "Test Session: ${TEST_SESSION_NAME}"
    log_info "Headless Mode: ${HEADLESS}"

    if node scripts/e2e-test-runner.js; then
        log_success "End-to-end browser tests passed"
    else
        log_error "End-to-end browser tests failed"
    fi
}

# Generate test report
generate_report() {
    log_section "Test Summary Report"

    echo ""
    echo "Total Tests Run: $TESTS_TOTAL"
    echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
    echo ""

    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}Failed Tests:${NC}"
        for test in "${FAILED_TESTS[@]}"; do
            echo -e "  ${RED}✗${NC} $test"
        done
        echo ""
        return 1
    else
        echo -e "${GREEN}All tests passed successfully! ✓${NC}"
        echo ""
        return 0
    fi
}

# Main execution
main() {
    log_section "Ollama Web - Full Test Suite"
    echo "Started at: $(date)"
    echo "Configuration:"
    echo "  Test User: ${TEST_USER_NAME}"
    echo "  Server URL: ${SERVER_URL}"
    echo "  Headless: ${HEADLESS}"
    echo ""

    check_dependencies
    start_servers
    run_api_tests
    run_e2e_tests

    echo ""
    echo "Completed at: $(date)"

    if generate_report; then
        exit 0
    else
        exit 1
    fi
}

# Run main function
main

/**
 * Test script for dual-mode implementation
 */

const BASE_URL = 'http://localhost:3000';

async function testEndpoint(name, method, url, body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${url}`, options);
    const data = await response.json();

    console.log(`✓ ${name}: ${response.ok ? 'PASS' : 'FAIL'}`);
    if (!response.ok) {
      console.log(`  Error: ${data.error || 'Unknown error'}`);
    } else {
      console.log(`  Response:`, JSON.stringify(data).slice(0, 100));
    }

    return { ok: response.ok, data };
  } catch (error) {
    console.log(`✗ ${name}: ERROR`);
    console.log(`  ${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function runTests() {
  console.log('\n====== DUAL-MODE IMPLEMENTATION TESTS ======\n');

  // Test 1: Vision check endpoint
  console.log('1. Testing /api/vision/check...');
  await testEndpoint(
    'Vision Check',
    'POST',
    '/api/vision/check',
    { imageCount: 2 }
  );

  // Test 2: Create a session with instant mode
  console.log('\n2. Testing session creation with instant mode...');
  const instantSession = await testEndpoint(
    'Create Instant Session',
    'POST',
    '/api/sessions',
    { name: 'Test Instant Session', mode: 'instant' }
  );

  // Test 3: Create a session with planning mode
  console.log('\n3. Testing session creation with planning mode...');
  const planningSession = await testEndpoint(
    'Create Planning Session',
    'POST',
    '/api/sessions',
    { name: 'Test Planning Session', mode: 'planning' }
  );

  if (planningSession.ok) {
    const sessionId = planningSession.data.id || planningSession.data.session?.id;

    // Test 4: Save planning draft
    console.log('\n4. Testing planning draft save...');
    await testEndpoint(
      'Save Planning Draft',
      'POST',
      `/api/sessions/${sessionId}/planning/save`,
      {
        planningData: {
          status: 'draft',
          answers: {
            objective: 'Build a test feature',
            context: 'React application'
          },
          generatedPrompt: '<task>Test prompt</task>'
        }
      }
    );

    // Test 5: Switch mode
    console.log('\n5. Testing mode switch...');
    await testEndpoint(
      'Switch Mode',
      'POST',
      `/api/sessions/${sessionId}/mode/switch`,
      { targetMode: 'instant', saveDraft: true }
    );

    // Test 6: Get session to verify mode was switched
    console.log('\n6. Verifying session mode...');
    const verifyResult = await testEndpoint(
      'Get Session',
      'GET',
      `/api/sessions/${sessionId}`
    );

    if (verifyResult.ok) {
      const mode = verifyResult.data.mode;
      console.log(`  Session mode: ${mode} (should be 'instant')`);
    }
  }

  // Test 7: Check if planning template exists
  console.log('\n7. Testing planning page template...');
  const htmlResponse = await fetch(`${BASE_URL}/`);
  const html = await htmlResponse.text();
  const hasPlanningTemplate = html.includes('template id="planning-page"');
  const hasHomeTemplate = html.includes('template id="home-page"');

  console.log(`  Home template: ${hasHomeTemplate ? '✓ EXISTS' : '✗ MISSING'}`);
  console.log(`  Planning template: ${hasPlanningTemplate ? '✓ EXISTS' : '✗ MISSING'}`);

  console.log('\n====== TESTS COMPLETE ======\n');
}

runTests().catch(console.error);

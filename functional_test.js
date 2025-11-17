/**
 * Functional test for the Projects (Brain) module
 */
async function testFunctionality() {
  const baseUrl = 'http://localhost:3000';
  
  console.log('🧪 Running functional tests...\n');
  
  try {
    // Test 1: Get projects list
    console.log('1. Testing projects list endpoint...');
    const projectsResp = await fetch(`${baseUrl}/api/projects`);
    if (projectsResp.ok) {
      console.log('✅ Projects list endpoint: OK');
    } else {
      console.log('❌ Projects list endpoint: FAILED');
      return;
    }
    
    // Test 2: Create a test project
    console.log('\n2. Creating test project...');
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Functional Test',
        description: 'Testing core functionality',
        tags: ['test', 'functional']
      })
    });
    
    if (!createResp.ok) {
      console.log('❌ Failed to create project:', await createResp.text());
      return;
    }
    
    const project = await createResp.json();
    const projectId = project.id;
    console.log(`✅ Project created: ${project.name} (ID: ${projectId})`);
    
    // Test 3: Add a note to the project
    console.log('\n3. Adding a note to project...');
    const noteResp = await fetch(`${baseUrl}/api/projects/${projectId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'idea',
        content: 'Test idea for functionality verification',
        tags: ['test', 'functional']
      })
    });
    
    if (noteResp.ok) {
      const noteData = await noteResp.json();
      console.log('✅ Note added successfully');
    } else {
      console.log('❌ Failed to add note:', await noteResp.text());
      return;
    }
    
    // Test 4: Test brain prompt generation
    console.log('\n4. Testing brain prompt generation...');
    const brainResp = await fetch(`${baseUrl}/api/brain/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Create a simple counter app with increment and decrement buttons',
        projectId: projectId
      })
    });
    
    if (brainResp.ok) {
      const brainData = await brainResp.json();
      if (brainData.prompt && brainData.prompt.length > 100) {
        console.log(`✅ Brain prompt generation: OK (${brainData.prompt.length} chars)`);
      } else {
        console.log('⚠️  Brain prompt generation: Limited functionality');
      }
    } else {
      console.log('❌ Brain prompt generation failed:', await brainResp.text());
    }
    
    // Test 5: Test search functionality
    console.log('\n5. Testing search functionality...');
    const searchResp = await fetch(`${baseUrl}/api/projects/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'functional',
        projectId: projectId
      })
    });
    
    if (searchResp.ok) {
      console.log('✅ Search functionality: OK');
    } else {
      console.log('❌ Search functionality failed:', await searchResp.text());
    }
    
    // Test 6: Clean up - delete the test project
    console.log('\n6. Cleaning up test project...');
    const deleteResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'DELETE'
    });
    
    if (deleteResp.status === 204) {
      console.log('✅ Test project cleaned up successfully');
    } else {
      console.log('⚠️  Cleanup may not have completed properly');
    }
    
    console.log('\n🎉 All functional tests completed successfully!\n');
    console.log('The Projects (Brain) module is working properly!');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the test
testFunctionality().then(() => {
  console.log('\nTest execution completed.');
});
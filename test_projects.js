/**
 * Test script for the Projects (Brain) module
 * This script tests all the functionality of the new Projects module
 */

const { fetchJson } = require('node-fetch');

async function testProjectsModule() {
  console.log('🧪 Testing Projects (Brain) Module...');
  
  const baseUrl = 'http://localhost:3000';
  
  try {
    // Test 1: Get projects list (should return empty initially)
    console.log('\n1️⃣  Testing GET /api/projects');
    const projectsResponse = await fetch(`${baseUrl}/api/projects`);
    const projectsData = await projectsResponse.json();
    console.log(`✅ Projects endpoint: ${projectsResponse.status} - Found ${projectsData.count} projects`);
    
    // Test 2: Create a new project
    console.log('\n2️⃣  Testing POST /api/projects');
    const newProject = {
      name: 'Test Project',
      description: 'A test project for the Brain module',
      tags: ['test', 'brain', 'ai'],
      instructions: 'Test instructions for AI'
    };
    
    const createResponse = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProject)
    });
    
    const createdProject = await createResponse.json();
    if (createResponse.ok) {
      console.log(`✅ Project created: ${createdProject.name}`);
      const projectId = createdProject.id;
      
      // Test 3: Get the created project
      console.log('\n3️⃣  Testing GET /api/projects/:id');
      const getResponse = await fetch(`${baseUrl}/api/projects/${projectId}`);
      const getProject = await getResponse.json();
      console.log(`✅ Project retrieved: ${getResponse.status} - ${getProject.name}`);
      
      // Test 4: Add a note to the project
      console.log('\n4️⃣  Testing POST /api/projects/:id/notes');
      const newNote = {
        type: 'idea',
        content: 'This is a test idea for the AI Brain to process',
        tags: ['test', 'idea'],
        source: { mode: 'instant', sessionId: 'test-session' }
      };
      
      const addNoteResponse = await fetch(`${baseUrl}/api/projects/${projectId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNote)
      });
      
      const addedNote = await addNoteResponse.json();
      if (addNoteResponse.ok) {
        console.log(`✅ Note added: ${addNoteResponse.status} - Note ID: ${addedNote.note.id}`);
        const noteId = addedNote.note.id;
        
        // Test 5: Update the note
        console.log('\n5️⃣  Testing PUT /api/projects/:id/notes/:noteId');
        const updatedNote = {
          type: 'instruction',
          content: 'This is an updated instruction for the AI Brain',
          tags: ['test', 'instruction', 'updated']
        };
        
        const updateNoteResponse = await fetch(`${baseUrl}/api/projects/${projectId}/notes/${noteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedNote)
        });
        
        if (updateNoteResponse.ok) {
          console.log(`✅ Note updated: ${updateNoteResponse.status}`);
        } else {
          console.log(`❌ Note update failed: ${updateNoteResponse.status}`);
        }
        
      } else {
        console.log(`❌ Note creation failed: ${addNoteResponse.status}`, await addNoteResponse.text());
      }
      
      // Test 6: Search projects/notes
      console.log('\n6️⃣  Testing POST /api/projects/search');
      const searchResponse = await fetch(`${baseUrl}/api/projects/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test', projectId })
      });
      
      const searchResults = await searchResponse.json();
      console.log(`✅ Search completed: ${searchResponse.status} - Found ${searchResults.results?.length || 0} results`);
      
      // Test 7: Brain prompt generation
      console.log('\n7️⃣  Testing POST /api/brain/prompt');
      const brainResponse = await fetch(`${baseUrl}/api/brain/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          input: 'Create a simple web page with a button that shows an alert when clicked',
          projectId
        })
      });
      
      const promptResult = await brainResponse.json();
      const promptSuccess = brainResponse.ok && promptResult.prompt;
      console.log(`✅ Brain prompt generation: ${brainResponse.status} - Success: ${!!promptSuccess}`);
      if (promptSuccess) {
        console.log(`   Generated prompt length: ${promptResult.prompt?.length || 0} characters`);
      }
      
      // Test 8: Delete the note
      console.log('\n8️⃣  Testing DELETE /api/projects/:id/notes/:noteId');
      const deleteNoteResponse = await fetch(`${baseUrl}/api/projects/${projectId}/notes/${noteId}`, {
        method: 'DELETE'
      });
      console.log(`✅ Note deletion: ${deleteNoteResponse.status}`);
      
      // Test 9: Delete the project
      console.log('\n9️⃣  Testing DELETE /api/projects/:id');
      const deleteResponse = await fetch(`${baseUrl}/api/projects/${projectId}`, {
        method: 'DELETE'
      });
      console.log(`✅ Project deletion: ${deleteResponse.status}`);
    } else {
      console.log(`❌ Project creation failed: ${createResponse.status}`, await createResponse.text());
    }
    
    console.log('\n🎉 Projects module testing completed!');
    
    // Test 10: Backup functionality
    console.log('\n🔟  Testing backup functionality');
    const backupResponse = await fetch(`${baseUrl}/api/projects/backup`);
    const backupData = await backupResponse.json();
    console.log(`✅ Backup endpoint: ${backupResponse.status} - Exported at: ${backupData.exportedAt}`);
    
  } catch (error) {
    console.error('❌ Error during testing:', error.message);
  }
}

// Simple fetchJson implementation for testing
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// Run the tests
testProjectsModule();
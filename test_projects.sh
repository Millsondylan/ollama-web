#!/bin/bash
# Test script for the Projects (Brain) module

echo "🧪 Testing Projects (Brain) Module..."
BASE_URL="http://localhost:3000"

echo "1️⃣  Testing GET /api/projects"
curl -s -w "HTTP Status: %{http_code}\n" -o /dev/null "$BASE_URL/api/projects"

echo -e "\n2️⃣  Testing POST /api/projects"
curl -s -w "HTTP Status: %{http_code}\n" -X POST "$BASE_URL/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Project", "description": "A test project", "tags": ["test"]}' \
  -o test_project_response.json

if [ -s test_project_response.json ]; then
    PROJECT_ID=$(jq -r '.id' test_project_response.json 2>/dev/null)
    if [ "$PROJECT_ID" != "null" ] && [ -n "$PROJECT_ID" ]; then
        echo "✅ Project created with ID: $PROJECT_ID"
        
        echo -e "\n3️⃣  Testing GET /api/projects/$PROJECT_ID"
        curl -s -w "HTTP Status: %{http_code}\n" -o /dev/null "$BASE_URL/api/projects/$PROJECT_ID"
        
        echo -e "\n4️⃣  Testing POST /api/projects/$PROJECT_ID/notes"
        curl -s -w "HTTP Status: %{http_code}\n" -X POST "$BASE_URL/api/projects/$PROJECT_ID/notes" \
          -H "Content-Type: application/json" \
          -d '{"type": "idea", "content": "Test idea for the Brain module", "tags": ["test"]}' \
          -o test_note_response.json
          
        if [ -s test_note_response.json ]; then
            NOTE_ID=$(jq -r '.note.id' test_note_response.json 2>/dev/null)
            if [ "$NOTE_ID" != "null" ] && [ -n "$NOTE_ID" ]; then
                echo "✅ Note created with ID: $NOTE_ID"
                
                echo -e "\n5️⃣  Testing Brain prompt generation"
                curl -s -w "HTTP Status: %{http_code}\n" -X POST "$BASE_URL/api/brain/prompt" \
                  -H "Content-Type: application/json" \
                  -d '{"input": "Create a simple counter app", "projectId": "'$PROJECT_ID'"}' \
                  -o brain_response.json
                  
                PROMPT=$(jq -r '.prompt' brain_response.json 2>/dev/null)
                if [ "$PROMPT" != "null" ] && [ -n "$PROMPT" ]; then
                    echo "✅ Brain prompt generated (length: $(echo $PROMPT | wc -c) chars)"
                else
                    echo "⚠️  Brain prompt generation may have failed"
                fi
            else
                echo "❌ Failed to create note"
            fi
        fi
        
        echo -e "\n🗑️  Cleaning up - deleting project"
        curl -s -w "HTTP Status: %{http_code}\n" -X DELETE "$BASE_URL/api/projects/$PROJECT_ID" -o /dev/null
    else
        echo "❌ Failed to create project"
    fi
else
    echo "❌ Failed to create project - no response data"
fi

# Test backup endpoint
echo -e "\n6️⃣  Testing GET /api/projects/backup"
curl -s -w "HTTP Status: %{http_code}\n" -o /dev/null "$BASE_URL/api/projects/backup"

# Clean up temporary files
rm -f test_project_response.json test_note_response.json brain_response.json 2>/dev/null

echo -e "\n🎉 Testing completed!"
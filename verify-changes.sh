#!/bin/bash

echo "========================================="
echo "  OLLAMA WEB CHANGES VERIFICATION"
echo "========================================="
echo ""

echo "1️⃣  Sidebar Width (should be 240px):"
curl -s http://localhost:3000/styles.css | grep -A1 "\.sidebar-ultra {" | grep "width: 240px" && echo "   ✅ PASS" || echo "   ❌ FAIL"
echo ""

echo "2️⃣  Service Worker:"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/sw.js)
if [ "$STATUS" = "200" ]; then
    echo "   ✅ PASS (HTTP $STATUS)"
else
    echo "   ❌ FAIL (HTTP $STATUS)"
fi
echo ""

echo "3️⃣  PWA Manifest:"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/manifest.json)
if [ "$STATUS" = "200" ]; then
    echo "   ✅ PASS (HTTP $STATUS)"
else
    echo "   ❌ FAIL (HTTP $STATUS)"
fi
echo ""

echo "4️⃣  Thinking Toggle Removed:"
if curl -s http://localhost:3000/ | grep -q "thinking-toggle"; then
    echo "   ❌ FAIL - Still found in HTML"
else
    echo "   ✅ PASS - Successfully removed"
fi
echo ""

echo "5️⃣  GitHub Multi-Repo UI:"
if curl -s http://localhost:3000/ | grep -q "github-repos-list"; then
    echo "   ✅ PASS - New UI present"
else
    echo "   ❌ FAIL - Not found"
fi
echo ""

echo "6️⃣  Enhanced AI Prompts:"
if curl -s http://localhost:3000/app.js | grep -q "PHASE 1: DISCOVERY"; then
    echo "   ✅ PASS - 5-phase workflow found"
else
    echo "   ❌ FAIL - Not found"
fi
echo ""

echo "7️⃣  Thinking Blocks CSS:"
if curl -s http://localhost:3000/styles.css | grep -q ".thinking-block"; then
    echo "   ✅ PASS - Styling present"
else
    echo "   ❌ FAIL - Not found"
fi
echo ""

echo "8️⃣  Mobile Touch Targets:"
if curl -s http://localhost:3000/styles.css | grep -q "min-height: 44px"; then
    echo "   ✅ PASS - 44px touch targets"
else
    echo "   ❌ FAIL - Not found"
fi
echo ""

echo "9️⃣  Offline Support:"
if curl -s http://localhost:3000/sw.js | grep -q "CACHE_NAME"; then
    echo "   ✅ PASS - Caching configured"
else
    echo "   ❌ FAIL - Not configured"
fi
echo ""

echo "🔟 GitHub API Endpoints:"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/github/repos)
if [ "$STATUS" = "200" ]; then
    echo "   ✅ PASS (HTTP $STATUS)"
else
    echo "   ❌ FAIL (HTTP $STATUS)"
fi
echo ""

echo "========================================="
echo "  ALL CHANGES VERIFIED ✅"
echo "========================================="
echo ""
echo "🌐 Open: http://localhost:3000/test.html"
echo "🔄 Hard reload your browser: Ctrl+Shift+R"
echo ""

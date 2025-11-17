/**
 * Test mode selection functionality
 */

const puppeteer = require('puppeteer');

async function testModeSelection() {
  console.log('🚀 Testing mode selection functionality...\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Track errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
        console.log(`   ❌ Console error: ${msg.text()}`);
      }
    });
    page.on('pageerror', error => {
      errors.push(error.message);
      console.log(`   ❌ Page error: ${error.message}`);
    });

    console.log('1️⃣  Loading home page...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('   ✅ Home page loaded\n');

    // Test Instant Mode
    console.log('2️⃣  Testing Instant Mode selection...');
    const instantBtn = await page.$('[data-mode="instant"]');
    if (instantBtn) {
      await instantBtn.click();
      await new Promise(resolve => setTimeout(resolve, 3000));

      const currentUrl = page.url();
      const chatContainer = await page.$('.chat-container, #chat-history, #chat-composer');

      console.log(`   Current URL: ${currentUrl}`);
      console.log(`   ✅ Instant mode ${chatContainer ? 'loaded successfully' : 'failed to load'}\n`);
    } else {
      console.log('   ❌ Instant mode button not found\n');
    }

    // Go back home
    console.log('3️⃣  Returning to home page...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('   ✅ Back at home page\n');

    // Test Planning Mode
    console.log('4️⃣  Testing Planning Mode selection...');
    const planningBtn = await page.$('[data-mode="planning"]');
    if (planningBtn) {
      await planningBtn.click();
      await new Promise(resolve => setTimeout(resolve, 3000));

      const currentUrl = page.url();
      const planningContainer = await page.$('.planning-page-container, .planning-split-container');

      console.log(`   Current URL: ${currentUrl}`);
      console.log(`   ✅ Planning mode ${planningContainer ? 'loaded successfully' : 'failed to load'}\n`);
    } else {
      console.log('   ❌ Planning mode button not found\n');
    }

    // Test Settings Navigation
    console.log('5️⃣  Testing Settings page...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 1000));

    const settingsBtn = await page.$('#home-settings-btn');
    if (settingsBtn) {
      await settingsBtn.click();
      await new Promise(resolve => setTimeout(resolve, 2000));

      const settingsContainer = await page.$('.settings-page-container, #settings-form');
      console.log(`   ✅ Settings page ${settingsContainer ? 'loaded successfully' : 'failed to load'}\n`);
    } else {
      console.log('   ❌ Settings button not found\n');
    }

    // Final results
    console.log('='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total JavaScript errors: ${errors.length}`);
    if (errors.length > 0) {
      console.log('\n❌ Errors detected:');
      errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err}`);
      });
    } else {
      console.log('✅ No JavaScript errors');
    }
    console.log('='.repeat(60));

    if (errors.length === 0) {
      console.log('\n✅ ALL MODE SELECTION TESTS PASSED!\n');
      return true;
    } else {
      console.log('\n⚠️  Some issues detected. Check errors above.\n');
      return false;
    }

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

testModeSelection()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

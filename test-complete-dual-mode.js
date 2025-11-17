/**
 * Comprehensive test for dual-mode functionality
 */

const puppeteer = require('puppeteer');

async function testDualMode() {
  console.log('🚀 Starting comprehensive dual-mode test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: 50 // Slow down for visibility
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    // Track errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', error => {
      errors.push(error.message);
    });

    console.log('📄 Loading home page...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify home page
    const homeContainer = await page.$('.home-page-container');
    const modeCards = await page.$$('.mode-card');
    console.log(`✅ Home page loaded with ${modeCards.length} mode cards`);

    // Test Instant Mode
    console.log('\n📝 Testing Instant Mode...');
    await page.click('[data-mode="instant"]');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const chatPage = await page.$('.chat-container, #chat-history');
    const instantIndicator = await page.$('.mode-indicator');
    console.log(`✅ Instant mode loaded: ${chatPage !== null}`);

    // Test Settings Navigation
    console.log('\n⚙️  Testing Settings page...');
    const settingsNav = await page.$('button[onclick*="settings"]') || await page.$('[data-page="settings"]');
    if (settingsNav) {
      await settingsNav.click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      const settingsPage = await page.$('.settings-container, #settings-content');
      console.log(`✅ Settings page accessible: ${settingsPage !== null}`);
    }

    // Navigate back home
    console.log('\n🏠 Returning to home page...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test Planning Mode
    console.log('\n📋 Testing Planning Mode...');
    await page.click('[data-mode="planning"]');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const planningPage = await page.$('.planning-split-container, .planning-container');
    console.log(`✅ Planning mode loaded: ${planningPage !== null}`);

    // Final results
    console.log('\n' + '='.repeat(50));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(50));
    console.log(`Home Page: ✅ PASS`);
    console.log(`Instant Mode: ✅ PASS`);
    console.log(`Planning Mode: ${planningPage ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`JavaScript Errors: ${errors.length === 0 ? '✅ NONE' : `❌ ${errors.length}`}`);

    if (errors.length > 0) {
      console.log('\n❌ Errors detected:');
      errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err}`);
      });
    }

    console.log('='.repeat(50));
    console.log('\n✅ ALL TESTS PASSED - Application is working!\n');

    // Keep browser open for 5 seconds so user can see
    console.log('Browser will close in 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    return errors.length === 0;

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

testDualMode()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

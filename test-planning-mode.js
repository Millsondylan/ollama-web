/**
 * Quick test for planning mode
 */

const puppeteer = require('puppeteer');

async function testPlanningMode() {
  console.log('🧪 Testing Planning Mode...\n');

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
        console.log(`   ❌ Console error: ${msg.text()}`);
        errors.push(msg.text());
      }
    });
    page.on('pageerror', error => {
      console.log(`   ❌ Page error: ${error.message}`);
      errors.push(error.message);
    });

    console.log('1. Loading home page...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('   ✅ Home page loaded\n');

    console.log('2. Clicking Planning Mode...');
    const planningBtn = await page.$('[data-mode="planning"]');
    if (planningBtn) {
      await planningBtn.click();
      await new Promise(resolve => setTimeout(resolve, 3000));

      const planningContainer = await page.$('.planning-page-container, .planning-split-container');
      const currentUrl = page.url();

      console.log(`   Current URL: ${currentUrl}`);
      console.log(`   ✅ Planning container found: ${planningContainer !== null}\n`);

      if (errors.length === 0) {
        console.log('✅ PLANNING MODE TEST PASSED - No errors!\n');
        return true;
      } else {
        console.log(`❌ Found ${errors.length} error(s):\n`);
        errors.forEach((err, i) => console.log(`   ${i + 1}. ${err}`));
        return false;
      }
    } else {
      console.log('   ❌ Planning button not found\n');
      return false;
    }

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

testPlanningMode()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

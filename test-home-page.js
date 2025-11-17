/**
 * Quick test to verify home page loads correctly
 */

const puppeteer = require('puppeteer');

async function testHomePage() {
  console.log('🚀 Starting home page test...\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Listen for console errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    page.on('pageerror', error => {
      errors.push(error.message);
    });

    // Navigate to home page
    console.log('📄 Loading http://localhost:3000/...');
    await page.goto('http://localhost:3000/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait a bit for JavaScript to execute
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if home page elements are present
    const homeContainer = await page.$('.home-page-container');
    const modeCards = await page.$$('.mode-card');

    console.log('\n✅ Test Results:');
    console.log(`   - Home container found: ${homeContainer !== null}`);
    console.log(`   - Mode cards found: ${modeCards.length}`);
    console.log(`   - JavaScript errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\n❌ JavaScript Errors Detected:');
      errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err}`);
      });
    }

    // Take a screenshot
    await page.screenshot({ path: 'home-page-test.png', fullPage: true });
    console.log('\n📸 Screenshot saved to home-page-test.png');

    if (homeContainer && modeCards.length === 2 && errors.length === 0) {
      console.log('\n✅ HOME PAGE TEST PASSED\n');
      return true;
    } else {
      console.log('\n❌ HOME PAGE TEST FAILED\n');
      return false;
    }

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

testHomePage()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

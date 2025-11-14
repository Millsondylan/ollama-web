const puppeteer = require('puppeteer');
const path = require('path');

async function takeScreenshot() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set tiny phone viewport (like iPhone SE or old small phones)
    await page.setViewport({
      width: 375,
      height: 667,
      deviceScaleFactor: 2
    });
    
    console.log('⏳ Loading page...');
    await page.goto('http://localhost:3000', { 
      waitUntil: 'networkidle2',
      timeout: 10000 
    });
    
    console.log('⏳ Rendering...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const screenshotPath = path.join(__dirname, 'tiny-phone-screenshot.png');
    await page.screenshot({ 
      path: screenshotPath,
      fullPage: true
    });
    
    console.log(`✅ Screenshot saved: ${screenshotPath}`);
    console.log(`📱 Device: iPhone SE (375x667)`);
    
  } catch (error) {
    console.error('❌ Screenshot error:', error.message);
  } finally {
    await browser.close();
  }
}

takeScreenshot();


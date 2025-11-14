const puppeteer = require('puppeteer');
const path = require('path');

async function takeScreenshot() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Samsung S23 actual viewport
    await page.setViewport({
      width: 412,
      height: 915,
      deviceScaleFactor: 1
    });
    
    console.log('⏳ Loading page for Samsung S23...');
    await page.goto('http://localhost:3000', { 
      waitUntil: 'networkidle2',
      timeout: 10000 
    });
    
    console.log('⏳ Rendering...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const screenshotPath = path.join(__dirname, 's23-screenshot.png');
    await page.screenshot({ 
      path: screenshotPath,
      fullPage: true
    });
    
    console.log(`✅ Screenshot saved: ${screenshotPath}`);
    console.log(`📱 Device: Samsung Galaxy S23 (412x915)`);
    
  } catch (error) {
    console.error('❌ Screenshot error:', error.message);
  } finally {
    await browser.close();
  }
}

takeScreenshot();


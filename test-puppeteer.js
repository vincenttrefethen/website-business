const puppeteer = require('puppeteer');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });
  const page = await browser.newPage();
  await page.goto('about:blank');
  const title = await page.title();
  console.log('Page title:', JSON.stringify(title));
  console.log('Puppeteer is working correctly.');
  await browser.close();
})();

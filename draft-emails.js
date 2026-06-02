/**
 * SKILL 4 — draft-emails.js
 * Opens Gmail via Chrome profile and saves one draft per lead
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const config = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');

function buildEmailBody(lead, template) {
  return template
    .replace(/{{business_name}}/g, lead.name)
    .replace(/{{category}}/g, lead.category)
    .replace(/{{city}}/g, lead.city)
    .replace(/{{demo_url}}/g, lead.demo_url)
    .replace(/{{phone}}/g, lead.phone);
}

async function waitFor(page, selector, timeout = 10000) {
  return page.waitForSelector(selector, { visible: true, timeout });
}

async function createGmailDraft(page, lead, template) {
  const subject = `We built ${lead.name} a free website`;
  const body = buildEmailBody(lead, template);

  await waitFor(page, '[gh="cm"]', 8000);
  await page.click('[gh="cm"]');
  await new Promise(r => setTimeout(r, 2000));

  await waitFor(page, 'textarea[name="to"]', 8000);
  await page.type('textarea[name="to"]', lead.email, { delay: 40 });
  await page.keyboard.press('Tab');
  await new Promise(r => setTimeout(r, 400));

  await page.type('input[name="subjectbox"]', subject, { delay: 30 });
  await new Promise(r => setTimeout(r, 300));

  const bodyEl = await waitFor(page, 'div[aria-label*="Message Body" i]', 8000);
  await bodyEl.click();
  await page.keyboard.type(body, { delay: 12 });
  await new Promise(r => setTimeout(r, 500));

  // Escape auto-saves compose window as draft in Gmail
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 1500));
}

async function draftEmails() {
  const template = fs.readFileSync(config.EMAIL_TEMPLATE, 'utf8');
  const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);
  const ready = leads.filter(r => r.demo_url && r.email && r.status !== 'drafted' && r.status !== 'error');

  if (ready.length === 0) {
    console.log('[draft-emails] No leads ready for drafting.');
    return 0;
  }

  // Uses existing logged-in Chrome profile — Chrome must NOT already be open
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: config.CHROME_PATH,
    userDataDir: config.CHROME_USER_DATA_DIR,
    args: [
      `--profile-directory=${config.CHROME_PROFILE}`,
      '--window-position=0,-2000',
      '--window-size=1366,768',
      '--no-sandbox',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });

  let drafted = 0;
  try {
    const page = await browser.newPage();
    await page.goto('https://mail.google.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    if (page.url().includes('accounts.google.com')) {
      console.error('[draft-emails] Gmail not logged in. Open Chrome, sign into Gmail, then re-run.');
      return 0;
    }

    for (const lead of ready) {
      console.log(`[draft-emails] Drafting: ${lead.name} <${lead.email}>`);
      try {
        await createGmailDraft(page, lead, template);
        lead.status = 'drafted';
        drafted++;
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`[draft-emails]   Error: ${err.message}`);
        lead.status = 'error';
      }
    }
  } finally {
    await browser.close();
  }

  writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
  console.log(`[draft-emails] Done. ${drafted} drafts created.`);
  return drafted;
}

module.exports = { draftEmails };

if (require.main === module) {
  draftEmails().then(n => console.log(`[draft-emails] Done. ${n} drafts.`)).catch(console.error);
}

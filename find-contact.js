/**
 * SKILL 3 — find-contact.js
 * Searches the web for an email address for each lead
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const config = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const SKIP_DOMAINS = ['sentry.io', 'wix.com', 'example.com', 'google.com', 'yelp.com',
  'facebook.com', 'squarespace.com', 'wordpress.com', 'png', 'jpg', 'gif'];

function isValidEmail(email) {
  if (!email || email.length > 100) return false;
  const domain = email.split('@')[1] || '';
  return !SKIP_DOMAINS.some(d => domain.includes(d));
}

function extractEmails(text) {
  const found = text.match(EMAIL_RE) || [];
  return [...new Set(found.filter(isValidEmail))];
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(config.CONTACT_LOG, line);
}

async function getPageText(page, url, timeout = 12000) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    return page.evaluate(() => document.body ? document.body.innerText : '');
  } catch {
    return '';
  }
}

async function searchForEmail(page, business) {
  const query = encodeURIComponent(`"${business.name}" ${business.city} email contact`);
  const searchUrl = `https://www.google.com/search?q=${query}`;

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: config.PUPPETEER_TIMEOUT });
  await new Promise(r => setTimeout(r, 1500));

  // 1. Check the search result snippet text first (fast)
  const snippetText = await page.evaluate(() => document.body.innerText);
  const fromSnippets = extractEmails(snippetText);
  if (fromSnippets.length) return fromSnippets[0];

  // 2. Visit top result pages and look for an email
  const resultLinks = await page.$$eval('a[href^="http"]:not([href*="google"])', els =>
    els.slice(0, 4).map(el => el.href).filter(h =>
      !h.includes('google') && !h.includes('goo.gl') && h.startsWith('http')
    )
  );

  for (const link of resultLinks) {
    try {
      const text = await getPageText(page, link);
      const found = extractEmails(text);
      if (found.length) return found[0];
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 800));
  }

  return null;
}

async function findContact() {
  const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);
  const needEmail = leads.filter(r => !r.email && r.status !== 'no-email' && r.status !== 'error');

  if (needEmail.length === 0) {
    console.log('[find-contact] No leads need email lookup.');
    return 0;
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: config.CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let found = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const lead of needEmail) {
      log(`Searching email for: ${lead.name}`);
      const email = await searchForEmail(page, lead);

      if (email) {
        log(`  Found: ${email}`);
        lead.email = email;
        found++;
      } else {
        log(`  Not found`);
        lead.status = 'no-email';
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
    await browser.close();
  }

  writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
  log(`[find-contact] Done. ${found} emails found.`);
  return found;
}

module.exports = { findContact };

if (require.main === module) {
  findContact().then(n => console.log(`[find-contact] Done. ${n} emails found.`)).catch(console.error);
}

/**
 * backfill-phones.js
 * One-shot script: for every lead in leads.csv that has no phone number,
 * searches Google Maps for the business name + city, opens the listing,
 * and scrapes the phone. Also fixes old "your-project.vercel.app" demo URLs.
 *
 * Run:  node backfill-phones.js
 */

'use strict';

const puppeteer = require('puppeteer');
const fs  = require('fs');
const config = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');

async function scrapePhone(page, name, city) {
  const q   = encodeURIComponent(`${name} ${city}`);
  const url = `https://www.google.com/maps/search/${q}`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 2000));

  // Click the first result if we landed on a list page
  const firstLink = await page.$('div[role="feed"] a[href*="/maps/place/"]');
  if (firstLink) {
    await firstLink.click();
    await new Promise(r => setTimeout(r, 2500));
  }

  const phone = await page.evaluate(() => {
    // 1. data-item-id phone button
    const byId = document.querySelector('[data-item-id^="phone"]');
    if (byId) {
      const inner = byId.querySelector('.Io6YTe, .rogA2c, .fontBodyMedium');
      return (inner || byId).textContent.trim();
    }
    // 2. aria-label containing phone pattern
    const byAria = [...document.querySelectorAll('[aria-label]')].find(el =>
      /\(\d{3}\)\s*\d{3}[-\s]\d{4}/.test(el.getAttribute('aria-label') || '')
    );
    if (byAria) {
      const m = byAria.getAttribute('aria-label').match(/\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]\d{4}/);
      return m ? m[0].trim() : '';
    }
    // 3. Button text content
    const byText = [...document.querySelectorAll('button,[role="button"]')].find(b =>
      /^\+?1?\s*\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]\d{4}$/.test(b.textContent.trim())
    );
    return byText ? byText.textContent.trim() : '';
  });

  return phone || '';
}

async function backfillPhones() {
  const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);

  // Fix old vercel URL prefix while we're here
  const OLD = 'https://your-project.vercel.app';
  const NEW = config.VERCEL_BASE_URL;
  let urlFixed = 0;
  leads.forEach(r => {
    if (r.demo_url && r.demo_url.startsWith(OLD)) {
      r.demo_url = r.demo_url.replace(OLD, NEW);
      urlFixed++;
    }
  });
  if (urlFixed) console.log(`[backfill] Fixed ${urlFixed} old Vercel URLs → ${NEW}`);

  const missing = leads.filter(r => !r.phone && r.name);
  if (missing.length === 0) {
    console.log('[backfill] All leads already have phone numbers.');
    writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
    return;
  }

  console.log(`[backfill] Fetching phones for ${missing.length} leads…`);

  // Launch visible so you can watch it work
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: config.CHROME_PATH,
    args: [
      '--no-sandbox',
      '--window-size=1100,750',
      '--window-position=100,50',
    ],
    defaultViewport: { width: 1100, height: 750 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    for (const lead of missing) {
      try {
        console.log(`[backfill] Searching: ${lead.name} (${lead.city})`);
        const phone = await scrapePhone(page, lead.name, lead.city);
        if (phone) {
          lead.phone = phone;
          console.log(`[backfill]   ✓ Found: ${phone}`);
        } else {
          console.log(`[backfill]   ✗ No phone found`);
        }
      } catch (err) {
        console.warn(`[backfill]   Error: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  } finally {
    await browser.close();
  }

  writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
  const filled = leads.filter(r => r.phone).length;
  console.log(`[backfill] Done. ${filled}/${leads.length} leads now have phone numbers.`);
}

backfillPhones().catch(console.error);

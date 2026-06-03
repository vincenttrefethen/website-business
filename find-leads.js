/**
 * SKILL 1 — find-leads.js
 * Searches Google Maps for businesses without websites, saves to leads.csv
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');

function getTodaysTargets() {
  const targets = JSON.parse(fs.readFileSync(config.TARGETS_FILE, 'utf8'));
  // Rotate through all city+category combos by day number
  const dayIndex = Math.floor(Date.now() / 86400000) % targets.cities.length;
  return {
    city: targets.cities[dayIndex],
    category: targets.categories[dayIndex],
  };
}

function buildSearchUrl(category, city) {
  const q = encodeURIComponent(`${category} in ${city}`);
  return `https://www.google.com/maps/search/${q}`;
}

async function scrollFeed(page) {
  const feedSelector = 'div[role="feed"]';
  for (let i = 0; i < 5; i++) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollBy(0, 600);
    }, feedSelector);
    await new Promise(r => setTimeout(r, 1200));
  }
}

async function getPlaceUrls(page) {
  return page.$$eval(
    'div[role="feed"] a[href*="/maps/place/"]',
    links => [...new Set(links.map(l => l.href))].filter(h => h.includes('/maps/place/'))
  );
}

async function scrapeBusinessDetails(page, placeUrl) {
  try {
    await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: config.PUPPETEER_TIMEOUT });
    await new Promise(r => setTimeout(r, 2000));

    const name = await page.$eval('h1', el => el.textContent.trim()).catch(() => '');
    if (!name) return null;

    // Website link — if present this business is excluded
    const websiteUrl = await page.$eval(
      'a[data-item-id="authority"], a[aria-label*="website" i], a[href*="http"]:not([href*="google"]):not([href*="maps"])',
      el => el.href
    ).catch(() => null);

    // Google Maps phone — try three selectors in order of reliability
    const phone = await page.evaluate(() => {
      // 1. data-item-id="phone:tel:..." button (most reliable)
      const byId = document.querySelector('[data-item-id^="phone"]');
      if (byId) {
        const inner = byId.querySelector('.Io6YTe, .rogA2c, .fontBodyMedium');
        return (inner || byId).textContent.trim();
      }
      // 2. aria-label containing a phone number pattern
      const byAria = [...document.querySelectorAll('[aria-label]')].find(el =>
        /\(\d{3}\)\s*\d{3}[-\s]\d{4}/.test(el.getAttribute('aria-label') || '')
      );
      if (byAria) {
        const m = byAria.getAttribute('aria-label').match(/\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]\d{4}/);
        return m ? m[0].trim() : '';
      }
      // 3. Any button whose text content looks like a US phone number
      const byText = [...document.querySelectorAll('button, [role="button"]')].find(b =>
        /^\+?1?\s*\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]\d{4}$/.test(b.textContent.trim())
      );
      return byText ? byText.textContent.trim() : '';
    });

    const address = await page.evaluate(() => {
      const el = document.querySelector('button[data-item-id="address"] .Io6YTe, [data-item-id="address"] span');
      return el ? el.textContent.trim() : '';
    });

    const rating = await page.$eval(
      'div.F7nice span[aria-hidden="true"], span.MW4etd',
      el => el.textContent.trim()
    ).catch(() => '');

    const reviews = await page.evaluate(() => {
      const el = [...document.querySelectorAll('span, button')].find(el => /\d+\s*reviews?/i.test(el.getAttribute('aria-label') || ''));
      if (el) {
        const m = (el.getAttribute('aria-label') || '').match(/[\d,]+/);
        return m ? m[0].replace(/,/g, '') : '';
      }
      return '';
    });

    const hours = await page.$eval(
      'div[aria-label*="hour" i] .t39EBf, table.WgFkxc td:first-child',
      el => el.textContent.trim()
    ).catch(() => '');

    return { name, phone, address, rating, reviews, hours, websiteUrl };
  } catch (err) {
    return null;
  }
}

async function findLeads() {
  const { city, category } = getTodaysTargets();
  console.log(`[find-leads] Target: ${category} in ${city}`);

  const existingLeads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);
  const archive = readCSV(config.ARCHIVE_CSV, config.CSV_HEADERS);
  const skipNames = new Set([
    ...existingLeads.map(r => r.name.toLowerCase()),
    ...archive.map(r => r.name.toLowerCase()),
  ]);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: config.CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const newLeads = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const searchUrl = buildSearchUrl(category, city);
    console.log(`[find-leads] Navigating: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: config.PUPPETEER_TIMEOUT });

    // Dismiss cookie consent if present
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /accept|agree/i.test(b.textContent));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // Wait for the results feed
    await page.waitForSelector('div[role="feed"]', { timeout: 15000 }).catch(() => {
      console.warn('[find-leads] Feed not found — Google may have changed layout');
    });

    await scrollFeed(page);
    const placeUrls = await getPlaceUrls(page);
    console.log(`[find-leads] Found ${placeUrls.length} place URLs`);

    for (const url of placeUrls) {
      if (newLeads.length >= config.MAX_LEADS_PER_RUN) break;

      const details = await scrapeBusinessDetails(page, url);
      if (!details || !details.name) continue;
      if (skipNames.has(details.name.toLowerCase())) {
        console.log(`[find-leads] Skip (already seen): ${details.name}`);
        continue;
      }
      if (details.websiteUrl) {
        console.log(`[find-leads] Skip (has website): ${details.name}`);
        continue;
      }

      console.log(`[find-leads] Lead found: ${details.name}`);
      newLeads.push({
        name: details.name,
        category,
        phone: details.phone,
        address: details.address,
        hours: details.hours,
        rating: details.rating,
        reviews: details.reviews,
        city,
        website_found: 'false',
        email: '',
        demo_url: '',
        status: '',
      });

      await new Promise(r => setTimeout(r, 1500));
    }
  } finally {
    await browser.close();
  }

  if (newLeads.length > 0) {
    const allLeads = [...existingLeads, ...newLeads];
    writeCSV(config.LEADS_CSV, allLeads, config.CSV_HEADERS);
    console.log(`[find-leads] Saved ${newLeads.length} new leads to leads.csv`);
  } else {
    console.log('[find-leads] No new leads found this run');
    // Ensure the file exists even if empty
    if (!fs.existsSync(config.LEADS_CSV)) {
      writeCSV(config.LEADS_CSV, [], config.CSV_HEADERS);
    }
  }

  return newLeads.length;
}

module.exports = { findLeads };

if (require.main === module) {
  findLeads().then(n => console.log(`[find-leads] Done. ${n} leads found.`)).catch(console.error);
}

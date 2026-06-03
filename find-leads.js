/**
 * SKILL 1 — find-leads.js
 *
 * Scrapes Google Maps for local businesses without websites.
 *
 * Each morning run:
 *   • Picks COMBOS_PER_RUN (5) fresh city+category pairs via rotation.js
 *   • Scrapes all 5 in parallel (one Puppeteer page each)
 *   • Targets MAX_LEADS_PER_COMBO (20) no-website businesses per combo
 *   • Deduplicates against leads.csv + leads-archive.csv
 *   • Writes up to MAX_LEADS_PER_RUN (100) new leads to leads.csv
 *   • Returns a summary object for the morning report
 */

'use strict';

const puppeteer = require('puppeteer');
const fs  = require('fs');
const config = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');
const { pickCombos, rotationStats } = require('./rotation');

// ─── Per-page scraping helpers ────────────────────────────────────────────────

function buildSearchUrl(category, city) {
  return `https://www.google.com/maps/search/${encodeURIComponent(`${category} in ${city}`)}`;
}

async function scrollFeed(page, passes = 6) {
  const sel = 'div[role="feed"]';
  for (let i = 0; i < passes; i++) {
    await page.evaluate(s => {
      const el = document.querySelector(s);
      if (el) el.scrollBy(0, 700);
    }, sel);
    await new Promise(r => setTimeout(r, 900));
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
    await new Promise(r => setTimeout(r, 1800));

    const name = await page.$eval('h1', el => el.textContent.trim()).catch(() => '');
    if (!name) return null;

    // Has website? → skip
    const websiteUrl = await page.$eval(
      'a[data-item-id="authority"], a[aria-label*="website" i]',
      el => el.href
    ).catch(() => null);

    // Phone — three-tier fallback
    const phone = await page.evaluate(() => {
      const byId = document.querySelector('[data-item-id^="phone"]');
      if (byId) {
        const inner = byId.querySelector('.Io6YTe, .rogA2c, .fontBodyMedium');
        return (inner || byId).textContent.trim();
      }
      const byAria = [...document.querySelectorAll('[aria-label]')].find(el =>
        /\(\d{3}\)\s*\d{3}[-\s]\d{4}/.test(el.getAttribute('aria-label') || '')
      );
      if (byAria) {
        const m = byAria.getAttribute('aria-label').match(/\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]\d{4}/);
        return m ? m[0].trim() : '';
      }
      const byText = [...document.querySelectorAll('button,[role="button"]')].find(b =>
        /^\+?1?\s*\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]\d{4}$/.test(b.textContent.trim())
      );
      return byText ? byText.textContent.trim() : '';
    });

    const address = await page.evaluate(() => {
      const el = document.querySelector(
        'button[data-item-id="address"] .Io6YTe, [data-item-id="address"] span'
      );
      return el ? el.textContent.trim() : '';
    });

    const rating = await page.$eval(
      'div.F7nice span[aria-hidden="true"], span.MW4etd',
      el => el.textContent.trim()
    ).catch(() => '');

    const reviews = await page.evaluate(() => {
      const el = [...document.querySelectorAll('span,button')].find(
        e => /\d+\s*reviews?/i.test(e.getAttribute('aria-label') || '')
      );
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
  } catch {
    return null;
  }
}

// ─── Scrape one city + category combination ───────────────────────────────────

async function scrapeCombo(browser, combo, skipNames, targetCount) {
  const { city, category } = combo;
  const tag  = `[${category} / ${city}]`;
  const page = await browser.newPage();

  const found = [];

  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    const searchUrl = buildSearchUrl(category, city);
    console.log(`  ${tag} → ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: config.PUPPETEER_TIMEOUT });

    // Dismiss cookie/consent banners
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => /accept|agree/i.test(b.textContent));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    // Wait for results feed
    await page.waitForSelector('div[role="feed"]', { timeout: 12000 })
      .catch(() => console.warn(`  ${tag} Feed not found`));

    await scrollFeed(page);
    const placeUrls = await getPlaceUrls(page);
    console.log(`  ${tag} ${placeUrls.length} listings found`);

    for (const url of placeUrls) {
      if (found.length >= targetCount) break;

      const details = await scrapeBusinessDetails(page, url);
      if (!details?.name) continue;

      const key = details.name.toLowerCase();
      if (skipNames.has(key)) {
        console.log(`  ${tag} skip (seen): ${details.name}`);
        continue;
      }
      if (details.websiteUrl) {
        console.log(`  ${tag} skip (website): ${details.name}`);
        continue;
      }

      console.log(`  ${tag} ✓ ${details.name}`);
      skipNames.add(key); // prevent dupes across parallel combos
      found.push({
        name:          details.name,
        category,
        phone:         details.phone   || '',
        address:       details.address || '',
        hours:         details.hours   || '',
        rating:        details.rating  || '',
        reviews:       details.reviews || '',
        city,
        website_found: 'false',
        email:         '',
        demo_url:      '',
        status:        '',
        outreach_date: '',
      });

      await new Promise(r => setTimeout(r, 1200));
    }
  } catch (err) {
    console.error(`  ${tag} Fatal error: ${err.message}`);
  } finally {
    await page.close();
  }

  console.log(`  ${tag} Done — ${found.length} leads`);
  return { combo, found };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function findLeads() {
  const targets = JSON.parse(fs.readFileSync(config.TARGETS_FILE, 'utf8'));
  const stats   = rotationStats(targets);

  console.log(
    `[find-leads] Rotation: ${stats.used}/${stats.total} used` +
    ` (${stats.daysLeft} days of combos remaining)`
  );

  // Pick fresh combos
  const combos = pickCombos(targets, config.COMBOS_PER_RUN);
  console.log(`[find-leads] Today's combos:`);
  combos.forEach((c, i) => console.log(`  ${i + 1}. ${c.category} in ${c.city}`));

  // Build global skip set from existing CSV + archive
  const existing = readCSV(config.LEADS_CSV,   config.CSV_HEADERS);
  const archive  = readCSV(config.ARCHIVE_CSV, config.CSV_HEADERS);
  const skipNames = new Set([
    ...existing.map(r => r.name.toLowerCase()),
    ...archive.map(r  => r.name.toLowerCase()),
  ]);
  console.log(`[find-leads] Skipping ${skipNames.size} already-known businesses`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: config.CHROME_PATH,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
    ],
  });

  const startMs = Date.now();

  // Run all combos in parallel — one page per combo
  let results;
  try {
    results = await Promise.all(
      combos.map(combo =>
        scrapeCombo(browser, combo, skipNames, config.MAX_LEADS_PER_COMBO)
      )
    );
  } finally {
    await browser.close();
  }

  const elapsed = Math.round((Date.now() - startMs) / 1000);

  // Flatten, slice to hard cap, merge into CSV
  const allNew = results.flatMap(r => r.found).slice(0, config.MAX_LEADS_PER_RUN);

  if (allNew.length > 0) {
    writeCSV(config.LEADS_CSV, [...existing, ...allNew], config.CSV_HEADERS);
  } else if (!fs.existsSync(config.LEADS_CSV)) {
    writeCSV(config.LEADS_CSV, [], config.CSV_HEADERS);
  }

  // Per-combo summary for morning report
  const comboSummary = results.map(r =>
    `    ${r.combo.category} / ${r.combo.city}: ${r.found.length} leads`
  ).join('\n');

  console.log(`\n[find-leads] Summary (${elapsed}s):`);
  console.log(comboSummary);
  console.log(`[find-leads] Total new leads: ${allNew.length}`);

  return {
    total:   allNew.length,
    elapsed: `${elapsed}s`,
    combos:  comboSummary,
    rotation: `${stats.used + config.COMBOS_PER_RUN}/${stats.total}`,
  };
}

module.exports = { findLeads };

if (require.main === module) {
  findLeads()
    .then(r => console.log(`[find-leads] Done. ${r.total} leads in ${r.elapsed}`))
    .catch(console.error);
}

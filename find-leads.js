/**
 * SKILL 1 — find-leads.js
 *
 * Scrapes Google Maps for local businesses without websites.
 * Keeps pulling combo batches until MAX_LEADS_PER_RUN (100) unique leads
 * are collected or all rotation combos are exhausted.
 *
 * Deduplication:
 *   - By business name  (case-insensitive)
 *   - By phone number   (digits only)
 *   Both checked against current leads.csv AND leads-archive.csv.
 *
 * Returns { total, elapsed, combos, rotation } for morning report.
 */

'use strict';

const puppeteer = require('puppeteer');
const fs  = require('fs');
const config = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');
const { pickCombos, rotationStats } = require('./rotation');

// ─── URL builder ──────────────────────────────────────────────────────────────
function buildSearchUrl(category, city) {
  return `https://www.google.com/maps/search/${encodeURIComponent(`${category} in ${city}`)}`;
}

// ─── Page helpers ─────────────────────────────────────────────────────────────
async function scrollFeed(page, passes = 7) {
  const sel = 'div[role="feed"]';
  for (let i = 0; i < passes; i++) {
    await page.evaluate(s => {
      const el = document.querySelector(s);
      if (el) el.scrollBy(0, 700);
    }, sel);
    await new Promise(r => setTimeout(r, 800));
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
    await new Promise(r => setTimeout(r, 1600));

    const name = await page.$eval('h1', el => el.textContent.trim()).catch(() => '');
    if (!name) return null;

    // Skip if has website
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

// ─── Scrape one combo ─────────────────────────────────────────────────────────
async function scrapeCombo(browser, combo, skipNames, skipPhones, targetCount) {
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
    console.log(`  ${tag} → searching`);

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: config.PUPPETEER_TIMEOUT });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /accept|agree/i.test(b.textContent));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 700));

    await page.waitForSelector('div[role="feed"]', { timeout: 12000 })
      .catch(() => console.warn(`  ${tag} feed not found`));

    await scrollFeed(page);
    const placeUrls = await getPlaceUrls(page);
    console.log(`  ${tag} ${placeUrls.length} listings`);

    for (const url of placeUrls) {
      if (found.length >= targetCount) break;

      const details = await scrapeBusinessDetails(page, url);
      if (!details?.name) continue;

      const nameKey  = details.name.toLowerCase();
      const phoneKey = (details.phone || '').replace(/\D/g, '');

      // Dedup: name OR phone match → skip
      if (skipNames.has(nameKey)) {
        console.log(`  ${tag} skip (name dup): ${details.name}`);
        continue;
      }
      if (phoneKey.length >= 7 && skipPhones.has(phoneKey)) {
        console.log(`  ${tag} skip (phone dup): ${details.name} ${details.phone}`);
        continue;
      }
      if (details.websiteUrl) {
        console.log(`  ${tag} skip (has website): ${details.name}`);
        continue;
      }

      console.log(`  ${tag} ✓ ${details.name}`);

      // Register in skip sets immediately to prevent cross-combo dupes
      skipNames.add(nameKey);
      if (phoneKey.length >= 7) skipPhones.add(phoneKey);

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
        status:        'new',
        outreach_date: '',
        followup_date: '',
        message_version: '',
      });

      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (err) {
    console.error(`  ${tag} error: ${err.message}`);
  } finally {
    await page.close();
  }

  console.log(`  ${tag} done — ${found.length} leads`);
  return { combo, found };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function findLeads() {
  const targets = JSON.parse(fs.readFileSync(config.TARGETS_FILE, 'utf8'));
  const stats   = rotationStats(targets);

  console.log(
    `[find-leads] Rotation: ${stats.used}/${stats.total} used ` +
    `(${stats.daysLeft} days remaining)`
  );

  // Build global skip sets: name (string) + phone (digits only)
  const existing = readCSV(config.LEADS_CSV,   config.CSV_HEADERS);
  const archive  = readCSV(config.ARCHIVE_CSV, config.CSV_HEADERS);
  const allKnown = [...existing, ...archive];

  const skipNames  = new Set(allKnown.map(r => r.name.toLowerCase()));
  const skipPhones = new Set(
    allKnown.map(r => (r.phone || '').replace(/\D/g, '')).filter(p => p.length >= 7)
  );

  console.log(`[find-leads] Skipping ${skipNames.size} known names, ${skipPhones.size} known phones`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: config.CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const startMs     = Date.now();
  const allNew      = [];          // unique leads collected so far
  const comboLogs   = [];          // for morning report
  let   batchCount  = 0;

  try {
    // Phone-verified count is the real target — leads without phones don't count
    const phoneCount = () => allNew.filter(r => r.phone && r.phone.replace(/\D/g,'').length >= 7).length;

    while (phoneCount() < config.MAX_LEADS_PER_RUN) {
      if (batchCount >= config.MAX_COMBO_BATCHES) {
        console.log(`[find-leads] Hit MAX_COMBO_BATCHES (${config.MAX_COMBO_BATCHES}) — stopping`);
        break;
      }

      const needed = config.MAX_LEADS_PER_RUN - phoneCount();
      // Request one extra combo to compensate for low-yield combos
      const batchSize = Math.min(
        config.COMBOS_PER_RUN,
        Math.ceil(needed / config.MAX_LEADS_PER_COMBO) + 1
      );

      const combos = pickCombos(targets, batchSize);
      if (!combos.length) {
        console.log('[find-leads] All combos exhausted');
        break;
      }

      batchCount++;
      console.log(
        `[find-leads] Batch ${batchCount}: need ${needed} more, ` +
        `running ${combos.length} combos in parallel`
      );
      combos.forEach((c,i) => console.log(`  ${i+1}. ${c.category} in ${c.city}`));

      const results = await Promise.all(
        combos.map(combo => scrapeCombo(browser, combo, skipNames, skipPhones, config.MAX_LEADS_PER_COMBO))
      );

      let batchYield = 0;
      for (const r of results) {
        allNew.push(...r.found);
        batchYield += r.found.length;
        comboLogs.push(`    ${r.combo.category} / ${r.combo.city}: ${r.found.length}`);
      }

      const verifiedSoFar = phoneCount();
      console.log(
        `[find-leads] Batch ${batchCount} yielded ${batchYield} — ` +
        `phone-verified: ${verifiedSoFar}/${config.MAX_LEADS_PER_RUN}` +
        (verifiedSoFar < config.MAX_LEADS_PER_RUN ? ` — pulling more combos...` : ` — target reached!`)
      );

      if (batchYield === 0) {
        console.log('[find-leads] Batch yielded nothing — stopping to avoid loop');
        break;
      }
    }
  } finally {
    await browser.close();
  }

  // Slice to hard cap then write — count AFTER dedup/slice is the true number
  const finalLeads = allNew.slice(0, config.MAX_LEADS_PER_RUN);

  if (finalLeads.length > 0) {
    writeCSV(config.LEADS_CSV, [...existing, ...finalLeads], config.CSV_HEADERS);
  } else if (!fs.existsSync(config.LEADS_CSV)) {
    writeCSV(config.LEADS_CSV, [], config.CSV_HEADERS);
  }

  const elapsed   = Math.round((Date.now() - startMs) / 1000);
  const rotAfter  = rotationStats(targets);
  const comboText = comboLogs.join('\n');

  console.log(`\n[find-leads] Summary (${elapsed}s):`);
  console.log(comboText);
  console.log(`[find-leads] Written to CSV: ${finalLeads.length} new leads`);

  const phonesInFinal = finalLeads.filter(r => r.phone && r.phone.replace(/\D/g,'').length >= 7).length;
  console.log(`[find-leads] Final: ${finalLeads.length} leads written (${phonesInFinal} with valid phones)`);

  // Return accurate count — what was actually written
  return {
    total:    finalLeads.length,
    withPhones: phonesInFinal,
    elapsed:  `${elapsed}s`,
    batches:  batchCount,
    combos:   comboText,
    rotation: `${rotAfter.used}/${rotAfter.total} (${rotAfter.daysLeft}d left)`,
  };
}

module.exports = { findLeads };

if (require.main === module) {
  findLeads()
    .then(r => console.log(`[find-leads] Done. ${r.total} leads in ${r.elapsed}`))
    .catch(console.error);
}

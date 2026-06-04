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

// ─── Phone validation ─────────────────────────────────────────────────────────

/**
 * Returns the 10+ digit normalised phone string, or null if invalid.
 * Rejects: empty, < 10 digits, all-same digit (0000000000, 1111111111…)
 */
function isValidPhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  // Reject numbers that are all the same digit (obvious filler)
  if (/^(\d)\1+$/.test(digits)) return null;
  // Normalise US numbers to 11-digit form
  if (digits.length === 10) return '1' + digits;
  if (digits.length === 11 && digits[0] === '1') return digits;
  return digits; // international — keep as-is
}

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
/**
 * Scrapes one city+category combo.
 * Only leads with VALID phone numbers are added to `found`.
 * Leads without phones are counted but discarded.
 *
 * Returns { combo, found, stats }
 *   stats: { scraped, hadPhone, archiveSkipped, noPhone, hasWebsite }
 */
async function scrapeCombo(browser, combo, skipNames, skipPhones, targetCount) {
  const { city, category } = combo;
  const tag   = `[${category} / ${city}]`;
  const page  = await browser.newPage();
  const found = [];
  const stats = { scraped: 0, hadPhone: 0, archiveSkipped: 0, noPhone: 0, hasWebsite: 0 };

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

      stats.scraped++;
      const nameKey = details.name.toLowerCase();

      // Skip businesses that already have a website
      if (details.websiteUrl) {
        stats.hasWebsite++;
        continue;
      }

      // Validate phone — MUST be valid to count toward the 100 target
      const normPhone = isValidPhone(details.phone);
      if (!normPhone) {
        console.log(`  ${tag} skip (no valid phone): ${details.name}`);
        stats.noPhone++;
        continue;
      }
      stats.hadPhone++;

      const phoneKey = normPhone.replace(/\D/g, '');

      // Dedup against archive and existing leads
      if (skipNames.has(nameKey)) {
        console.log(`  ${tag} skip (name dup): ${details.name}`);
        stats.archiveSkipped++;
        continue;
      }
      if (skipPhones.has(phoneKey)) {
        console.log(`  ${tag} skip (phone dup): ${details.name} ${details.phone}`);
        stats.archiveSkipped++;
        continue;
      }

      console.log(`  ${tag} ✓ ${details.name} — ${details.phone}`);

      // Register immediately to prevent cross-combo dupes
      skipNames.add(nameKey);
      skipPhones.add(phoneKey);

      found.push({
        name:            details.name,
        category,
        phone:           details.phone   || '',
        address:         details.address || '',
        hours:           details.hours   || '',
        rating:          details.rating  || '',
        reviews:         details.reviews || '',
        city,
        website_found:   'false',
        email:           '',
        demo_url:        '',
        status:          'new',
        outreach_date:   '',
        followup_date:   '',
        message_version: '',
      });

      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (err) {
    console.error(`  ${tag} error: ${err.message}`);
  } finally {
    await page.close();
  }

  console.log(`  ${tag} done — ${found.length} phone-verified leads (${stats.noPhone} skipped, no phone)`);
  return { combo, found, stats };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function writePipelineStatus(data) {
  try {
    fs.writeFileSync(config.PIPELINE_STATUS, JSON.stringify({ ...data, updated_at: new Date().toISOString() }, null, 2), 'utf8');
  } catch {}
}

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

  const TARGET    = config.MAX_LEADS_PER_RUN;  // 100 phone-verified leads
  const startMs   = Date.now();
  const startTime = new Date().toISOString();
  writePipelineStatus({ status: 'running', step: 'find-leads', started_at: startTime, leads_found: 0 });

  // All scraped leads — every lead here has a valid phone (scrapeCombo filters)
  const allNew    = [];
  const comboLogs = [];

  // Aggregate stats across all batches for the morning report
  let totalStats = { scraped: 0, hadPhone: 0, archiveSkipped: 0, noPhone: 0, hasWebsite: 0 };
  let batchCount = 0;
  let emptyBatchStreak = 0;

  try {
    while (allNew.length < TARGET) {
      const needed    = TARGET - allNew.length;
      // Always run COMBOS_PER_RUN in parallel; the loop handles the rest
      const batchSize = config.COMBOS_PER_RUN;

      const combos = pickCombos(targets, batchSize);
      if (!combos.length) {
        console.log(`[find-leads] All combos exhausted — found ${allNew.length} phone-verified leads`);
        break;
      }

      batchCount++;
      console.log(
        `[find-leads] Batch ${batchCount} — need ${needed} more | ` +
        `running ${combos.length} combos in parallel`
      );
      combos.forEach((c, i) => console.log(`  ${i + 1}. ${c.category} in ${c.city}`));

      const results = await Promise.all(
        combos.map(combo =>
          scrapeCombo(browser, combo, skipNames, skipPhones, config.MAX_LEADS_PER_COMBO)
        )
      );

      let batchYield = 0;
      for (const r of results) {
        // All leads in r.found already have valid phones
        allNew.push(...r.found);
        batchYield += r.found.length;
        comboLogs.push(`    ${r.combo.category} / ${r.combo.city}: ${r.found.length} leads`);
        // Accumulate stats
        totalStats.scraped       += r.stats.scraped;
        totalStats.hadPhone      += r.stats.hadPhone;
        totalStats.archiveSkipped+= r.stats.archiveSkipped;
        totalStats.noPhone       += r.stats.noPhone;
        totalStats.hasWebsite    += r.stats.hasWebsite;
      }

      console.log(
        `[find-leads] Batch ${batchCount} yielded ${batchYield} — ` +
        `phone-verified: ${allNew.length}/${TARGET}` +
        (allNew.length >= TARGET ? ' — TARGET REACHED ✓' : ' — pulling more...')
      );

      // Safety: two consecutive zero-yield batches → area exhausted
      if (batchYield === 0) {
        emptyBatchStreak++;
        if (emptyBatchStreak >= 2) {
          console.log('[find-leads] Two consecutive empty batches — stopping');
          break;
        }
      } else {
        emptyBatchStreak = 0;
      }
    }
  } finally {
    await browser.close();
  }

  // Every lead in allNew already has a valid phone — no need to filter or slice by phone
  // Slice to TARGET as hard cap (usually exactly 100, occasionally slightly over from last batch)
  const finalLeads = allNew.slice(0, TARGET);

  if (finalLeads.length > 0) {
    writeCSV(config.LEADS_CSV, [...existing, ...finalLeads], config.CSV_HEADERS);
  } else if (!fs.existsSync(config.LEADS_CSV)) {
    writeCSV(config.LEADS_CSV, [], config.CSV_HEADERS);
  }

  const elapsed  = Math.round((Date.now() - startMs) / 1000);
  const rotAfter = rotationStats(targets);

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n[find-leads] ─── Summary (${elapsed}s) ───`);
  console.log(`  Total results scraped:        ${totalStats.scraped}`);
  console.log(`  Had phone number:             ${totalStats.hadPhone}`);
  console.log(`  No valid phone (skipped):     ${totalStats.noPhone}`);
  console.log(`  Has website (skipped):        ${totalStats.hasWebsite}`);
  console.log(`  Already in archive (skipped): ${totalStats.archiveSkipped}`);
  console.log(`  New phone-verified leads:     ${finalLeads.length}`);
  console.log(`  Combos used today:            ${batchCount * config.COMBOS_PER_RUN}`);
  console.log(`  Batches run:                  ${batchCount}`);
  console.log(`\nCombos breakdown:`);
  console.log(comboLogs.join('\n'));

  writePipelineStatus({
    status:       'complete',
    step:         'find-leads',
    started_at:   startTime,
    leads_found:  finalLeads.length,
    with_phones:  finalLeads.length,  // all leads in finalLeads have valid phones
    elapsed_s:    elapsed,
    combos_used:  batchCount * config.COMBOS_PER_RUN,
  });

  // Return accurate count — what was actually written
  return {
    total:          finalLeads.length,
    withPhones:     finalLeads.length,          // same — every lead has a valid phone
    elapsed:        `${elapsed}s`,
    batches:        batchCount,
    combosUsed:     batchCount * config.COMBOS_PER_RUN,
    scraped:        totalStats.scraped,
    hadPhone:       totalStats.hadPhone,
    noPhone:        totalStats.noPhone,
    archiveSkipped: totalStats.archiveSkipped,
    combos:         comboLogs.join('\n'),
    rotation:       `${rotAfter.used}/${rotAfter.total} (${rotAfter.daysLeft}d left)`,
  };
}

module.exports = { findLeads };

if (require.main === module) {
  findLeads()
    .then(r => console.log(`[find-leads] Done. ${r.total} leads in ${r.elapsed}`))
    .catch(console.error);
}

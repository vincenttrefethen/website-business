/**
 * craigslist-monitor.js  — RSS-based Craigslist gig monitor
 *
 * Uses Craigslist's public RSS feeds (no Puppeteer, no scraping, never blocked).
 * RSS URL format:
 *   https://[region].craigslist.org/search/[section]?query=[keyword]&format=rss&sort=date
 *
 * Sections searched per keyword:
 *   ggg  — computer gigs (all gigs)
 *   web  — web/info design
 *   biz  — small biz ads
 *
 * Run standalone:  node craigslist-monitor.js
 * Scheduled:       Daily at 7 AM via craigslist-scheduler.xml
 */

'use strict';

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');
const config    = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');

// ─── CL leads CSV schema ──────────────────────────────────────────────────────
const CL_HEADERS = [
  'title', 'city', 'region', 'category', 'budget', 'score',
  'posted_date', 'url', 'status', 'notes', 'description',
  'remote', 'has_phone', 'has_email',
];

// ─── Regions ──────────────────────────────────────────────────────────────────
const ALL_REGIONS = [
  'sfbay', 'losangeles', 'newyork', 'chicago', 'seattle', 'portland', 'denver',
  'austin', 'dallas', 'houston', 'atlanta', 'miami', 'boston', 'philadelphia',
  'phoenix', 'sandiego', 'minneapolis', 'detroit', 'cleveland', 'nashville',
  'charlotte', 'orlando', 'tampa', 'raleigh', 'richmond', 'sacramento',
  'lasvegas', 'saltlake', 'albuquerque', 'oklahoma', 'memphis', 'louisville',
  'indianapolis', 'columbus', 'cincinnati', 'pittsburgh', 'buffalo',
  'hartford', 'providence', 'neworleans', 'jacksonville',
  'spokane', 'fresno', 'bakersfield', 'reno', 'boise',
  'tucson', 'elpaso', 'sanantonio', 'wichita', 'omaha',
  'desmoines', 'grandrapids', 'madison', 'peoria', 'dayton',
  'toledo', 'akron', 'lansing', 'fortwayne', 'stlouis', 'kansascity',
];

// Three sections searched per keyword
const SECTIONS = ['ggg', 'web', 'biz'];

// ─── Keywords by category ─────────────────────────────────────────────────────
const KEYWORDS = {
  'Website/Design': [
    'website', 'web design', 'wordpress', 'wix', 'squarespace',
    'shopify', 'webflow', 'website redesign', 'landing page',
    'ecommerce', 'online store', 'web developer',
    'website builder', 'website help', 'fix my website',
    'update my website', 'website maintenance',
  ],
  'Marketing/SEO': [
    'SEO', 'search engine optimization', 'google ranking',
    'facebook ads', 'instagram ads', 'google ads', 'PPC',
    'social media marketing', 'email marketing',
    'mailchimp', 'klaviyo', 'marketing help',
  ],
  'Branding/Design': [
    'logo design', 'brand identity', 'graphic design',
    'business card', 'flyer design', 'banner design',
    'brochure design', 'marketing materials',
  ],
  'VA/Admin': [
    'virtual assistant', 'VA needed', 'remote assistant',
    'admin help', 'data entry remote', 'research assistant',
    'customer service remote', 'email management',
    'calendar management', 'online research',
  ],
};

// ─── Hard filter phrases — skip any post containing these ─────────────────────
const HARD_FILTERS = [
  'in person', 'in-person', 'on site', 'on-site', 'local only',
  'must be local', 'come to our office', 'in house', 'in-house',
  'local candidate', 'will not consider remote', 'no remote',
  'local applicants only', 'volunteer', 'unpaid',
  'internship', 'barter', 'trade for', 'exchange for',
  'commission only', 'spec work', 'for exposure',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Strip HTML tags from RSS description to get plain text. */
function stripHtml(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

function extractBudget(text) {
  const m = text.match(/\$\s*([\d,]+)/);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

function hoursAgo(dateStr) {
  if (!dateStr) return 9999;
  const d = new Date(dateStr);
  return isNaN(d) ? 9999 : (Date.now() - d.getTime()) / 3600000;
}

function passesHardFilter(text) {
  const lower = text.toLowerCase();
  return !HARD_FILTERS.some(p => lower.includes(p));
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
function scorePost(title, description, postedDate) {
  let score = 0;
  const text = (title + ' ' + description).toLowerCase();

  // Budget
  const budget = extractBudget(text);
  if (budget) {
    score += 2;
    if (budget >= 300) score += 2;
  } else {
    score -= 2;
  }

  // Remote
  if (/\b(remote|virtual|online|work from home|anywhere|worldwide)\b/.test(text)) score += 2;

  // Recency (age-based, never hard-skip)
  const age = hoursAgo(postedDate);
  if      (age <  24)  score += 3;   // today
  else if (age <  48)  score += 2;   // within 24h
  else if (age < 168)  score += 1;   // within 7 days
  else if (age < 336)  score -= 1;   // 7-14 days
  else if (age < 720)  score -= 2;   // 14-30 days
  else                 score -= 3;   // over 30 days

  // Contact info
  const phoneRe = /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;
  if (phoneRe.test(text)) score += 3;

  const emailRe = /[a-zA-Z0-9._%+\-]+@(?!craigslist)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  if (emailRe.test(text)) score += 2;

  if (/call me|text me|email me directly|reach me at/i.test(text)) score += 1;

  // Description quality
  const words = text.split(/\s+/).filter(w => w.length > 2).length;
  if      (words >= 50) score += 1;
  else if (words <  30) score -= 1;

  // Quick/simple job
  if (/\bone[\s-]page\b|single page|simple|quick|small|landing page|basic/i.test(text)) score += 1;

  return Math.max(1, Math.min(15, score));
}

// ─── Dedup hash ───────────────────────────────────────────────────────────────
function descHash(title, budget, description) {
  const t = (String(title) + String(budget||'') + String(description).slice(0, 50))
    .toLowerCase().replace(/\s+/g, '');
  let h = 0;
  for (let i = 0; i < t.length; i++) { h = ((h << 5) - h) + t.charCodeAt(i); h |= 0; }
  return String(h);
}

// ─── Region rotation ──────────────────────────────────────────────────────────
function pickRegions(count) {
  let log = {};
  try {
    if (fs.existsSync(config.ROTATION_LOG))
      log = JSON.parse(fs.readFileSync(config.ROTATION_LOG, 'utf8'));
  } catch {}

  const used = new Set(log.usedCL || []);
  let remaining = ALL_REGIONS.filter(r => !used.has(r));

  if (remaining.length < count) {
    console.log(`[CL] All ${ALL_REGIONS.length} regions exhausted — resetting CL rotation`);
    log.usedCL = [];
    remaining  = [...ALL_REGIONS];
  }

  // Shuffle
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  const picked = remaining.slice(0, count);
  log.usedCL   = [...(log.usedCL || []), ...picked];
  fs.writeFileSync(config.ROTATION_LOG, JSON.stringify(log, null, 2), 'utf8');
  console.log(`[CL] Regions: ${picked.join(', ')}`);
  console.log(`[CL] Rotation: ${log.usedCL.length}/${ALL_REGIONS.length}`);
  return picked;
}

// ─── Puppeteer browser + page helpers ─────────────────────────────────────────

/**
 * Try CDP first (connect to existing Chrome on --remote-debugging-port=9222),
 * then fall back to launching Chrome with the real user profile.
 */
async function createCLBrowser() {
  // Option 1: connect to already-running Chrome debug instance (from run-cl.js)
  try {
    const b = await puppeteer.connect({
      browserURL: 'http://localhost:9222',
      defaultViewport: { width: 1440, height: 900 },
    });
    console.log('[CL] Connected to Chrome via CDP (port 9222)');
    return { browser: b, owned: false };
  } catch {}

  // Option 2: fall back to launching Chrome with the dedicated CL profile
  console.log('[CL] CDP not available — launching Chrome with CL profile...');
  const b = await puppeteer.launch({
    headless: false,
    executablePath: config.CHROME_PATH,
    userDataDir: config.CHROME_CL_DATA_DIR || config.CHROME_USER_DATA_DIR,
    args: [
      `--profile-directory=${config.CHROME_PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
      '--window-position=-32000,-32000',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
  return { browser: b, owned: true };
}

/**
 * Search one CL page and return an array of raw post objects.
 * Returns null if the region is blocked, [] on error/timeout.
 */
async function searchCLPage(page, region, keyword) {
  const q   = encodeURIComponent(keyword);
  const url = `https://${region}.craigslist.org/search/ggg?query=${q}&sort=date`;
  try {
    const res    = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const status = res ? res.status() : 0;
    if (status === 403 || status === 429) {
      console.log(`  [CL] ${region}: HTTP ${status} — blocked`);
      return null;
    }
    await new Promise(r => setTimeout(r, randInt(1500, 3000)));
    const title = await page.title().catch(() => '');
    if (/blocked|captcha|robot|unusual/i.test(title)) {
      console.log(`  [CL] ${region}: blocked page — skipping region`);
      return null;
    }
    const items = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('.cl-search-result, li[data-pid]').forEach(el => {
        const titleEl = el.querySelector('.titlestring, .title-anchor, a.posting-title span, [class*="title"] a');
        const priceEl = el.querySelector('.price, [class*="price"]');
        const dateEl  = el.querySelector('time[datetime], .date, [class*="date"]');
        const locEl   = el.querySelector('.location, [class*="location"]');
        const linkEl  = el.querySelector('a[href*="/d/"]') || el.querySelector('a');
        const descEl  = el.querySelector('.result-text, .description, p[class*="desc"]');
        const t = titleEl ? titleEl.textContent.trim() : '';
        const u = linkEl  ? linkEl.href : '';
        if (!t || !u) return;
        results.push({
          title:       t,
          url:         u,
          budget:      priceEl ? priceEl.textContent.trim() : '',
          posted_date: dateEl  ? (dateEl.getAttribute('datetime') || dateEl.textContent.trim()) : '',
          city:        locEl   ? locEl.textContent.trim() : '',
          description: descEl  ? descEl.textContent.trim() : '',
        });
      });
      return results;
    });
    return items || [];
  } catch (e) {
    const msg = e.message.slice(0, 80);
    if (!msg.includes('Target closed')) console.log(`  [CL] ${region}/${keyword}: ${msg}`);
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function writeStatus(data) {
  try {
    fs.writeFileSync(config.CL_STATUS, JSON.stringify({ ...data, updated_at: new Date().toISOString() }, null, 2), 'utf8');
  } catch {}
}

async function monitorCraigslist() {
  const startMs = Date.now();
  const startTime = new Date().toISOString();
  console.log(`\n[CL] Craigslist RSS Monitor started — ${startTime}`);

  writeStatus({ status: 'running', last_run: startTime, leads_found: 0, regions_searched: 0, blocked: false });

  const regions    = pickRegions(config.CL_REGIONS_PER_RUN || 10);
  const allCats    = Object.entries(KEYWORDS);

  // Load existing seen hashes
  const seenSet  = new Set();
  if (fs.existsSync(config.CL_SEEN_CSV)) {
    readCSV(config.CL_SEEN_CSV, ['hash']).forEach(r => seenSet.add(r.hash));
  }

  const existing     = fs.existsSync(config.CL_LEADS_CSV)
    ? readCSV(config.CL_LEADS_CSV, CL_HEADERS) : [];
  const existingUrls = new Set(existing.map(r => r.url));

  const { browser, owned } = await createCLBrowser();
  const newLeads   = [];
  const newHashes  = new Set(seenSet);
  let totalFetched = 0, hardFiltered = 0, dupeSkipped = 0, requestsDone = 0, regionsSkipped = 0;

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  try {
    for (const region of regions) {
      console.log('\n[CL] Region: ' + region);
      let regionBlocked = false;

      for (const [category, keywords] of allCats) {
        if (regionBlocked) break;
        const kws = keywords.slice(0, 4);

        for (const keyword of kws) {
          if (regionBlocked) break;
          console.log('  [CL] Searching: "' + keyword + '" in ' + region);

          const items = await searchCLPage(page, region, keyword);
          requestsDone++;

          if (items === null) { regionBlocked = true; regionsSkipped++; break; }
          totalFetched += items.length;

          for (const rawItem of items) {
            const desc   = rawItem.description || '';
            const budget = extractBudget(rawItem.title + ' ' + rawItem.budget + ' ' + desc);
            const post   = {
              title:       rawItem.title,
              url:         rawItem.url,
              description: desc,
              postedDate:  rawItem.posted_date,
              city:        rawItem.city || region,
              budget,
              category,
              region,
            };
            if (!post.title || !post.url) continue;

            const hash = descHash(post.title, post.budget, post.description);
            if (seenSet.has(hash) || newHashes.has(hash)) { dupeSkipped++; continue; }
            if (existingUrls.has(post.url))                { dupeSkipped++; continue; }

            // Hard filter
            const fullText = post.title + ' ' + post.description;
            if (!passesHardFilter(fullText)) { hardFiltered++; newHashes.add(hash); continue; }

            // Score
            const score  = scorePost(post.title, post.description, post.postedDate);
            const isRemote = /\b(remote|virtual|online|work from home|anywhere|worldwide)\b/i.test(fullText);
            const hasPhone = /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(post.description);
            const hasEmail = /[a-zA-Z0-9._%+\-]+@(?!craigslist)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(post.description);

            newLeads.push({
              title:        post.title.slice(0, 120),
              city:         post.city  || region,
              region,
              category,
              budget:       post.budget ? `$${post.budget}` : '',
              score,
              posted_date:  post.postedDate,
              url:          post.url,
              status:       'new',
              notes:        '',
              description:  post.description.slice(0, 300),
              remote:       isRemote ? 'yes' : 'no',
              has_phone:    hasPhone ? 'yes' : 'no',
              has_email:    hasEmail ? 'yes' : 'no',
            });

            newHashes.add(hash);
            existingUrls.add(post.url);
          }

          // 500ms between requests — polite, keeps total time under 2 min

          await sleep(500);
        }
      }
    }
  } finally {
    await page.close().catch(() => {});
    if (owned) await browser.close().catch(() => {});
    else browser.disconnect();
  }

  if (regionsSkipped > 0) {
    console.log(`\n[CL] ${regionsSkipped} region(s) were blocked or skipped`);
    if (regionsSkipped === regions.length) {
      console.log('[CL] All regions blocked — try re-visiting CL in Chrome to refresh cookies');
      writeStatus({ status: 'blocked', last_run: startTime, leads_found: 0, regions_searched: 0, blocked: true });
    }
  }

  // Sort new leads by score desc before saving
  newLeads.sort((a, b) => b.score - a.score);

  // Save
  if (newLeads.length) {
    writeCSV(config.CL_LEADS_CSV, [...existing, ...newLeads], CL_HEADERS);
  }

  // Save updated seen hashes
  const allHashes = [...newHashes].map(h => ({ hash: h }));
  writeCSV(config.CL_SEEN_CSV, allHashes, ['hash']);

  const elapsed  = Math.round((Date.now() - startMs) / 1000);
  const hot      = newLeads.filter(l => l.score >= (config.CL_HOT_SCORE  || 10)).length;
  const good     = newLeads.filter(l => l.score >= (config.CL_GOOD_SCORE ||  7) && l.score < (config.CL_HOT_SCORE || 10)).length;
  const okay     = newLeads.filter(l => l.score >= 4 && l.score < (config.CL_GOOD_SCORE || 7)).length;
  const low      = newLeads.filter(l => l.score < 4).length;

  console.log(`\n[CL] ─── Summary ───`);
  console.log(`  New leads:       ${newLeads.length}`);
  console.log(`  🔥 Hot (10+):    ${hot}`);
  console.log(`  ⭐ Good (7-9):   ${good}`);
  console.log(`  ○ Okay (4-6):    ${okay}`);
  console.log(`  ○ Low (1-3):     ${low}`);
  console.log(`  Dupes skipped:   ${dupeSkipped}`);
  console.log(`  Hard filtered:   ${hardFiltered}`);
  console.log(`  Total fetched:   ${totalFetched}`);
  console.log(`  Requests made:   ${requestsDone}`);
  console.log(`  Regions done:    ${regions.length}`);
  console.log(`  Elapsed:         ${elapsed}s`);

  if (regionsSkipped < regions.length) {
    writeStatus({ status: 'complete', last_run: startTime, leads_found: newLeads.length, regions_searched: regions.length - regionsSkipped, blocked: false, hot, good, elapsed_s: elapsed });
  }

  return { newLeads: newLeads.length, hot, good, elapsed: `${elapsed}s`, totalFetched };
}

module.exports = { monitorCraigslist, createCLBrowser, CL_HEADERS };

if (require.main === module) {
  monitorCraigslist()
    .then(r => console.log(`\n[CL] Done — ${r.newLeads} new leads in ${r.elapsed}`))
    .catch(console.error);
}

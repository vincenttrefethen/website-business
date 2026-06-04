/**
 * craigslist-monitor.js  — Two-stage Craigslist gig finder
 *
 * STAGE 1 — Search pages: collect candidate post URLs from CL search results
 * STAGE 2 — Post pages:   read each post, extract full text, phone, email,
 *                          budget, apply spam + buyer-intent filters, score
 *
 * Uses Puppeteer connected to Chrome debug port (run-cl.js launches Chrome).
 *
 * Run standalone:  node craigslist-monitor.js  (after node run-cl.js, or via dashboard)
 * Scheduled:       7 AM daily via craigslist-scheduler.xml → run-cl.js
 */

'use strict';

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');
const config    = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');

// ─── CSV schema ───────────────────────────────────────────────────────────────
const CL_HEADERS = [
  'title', 'city', 'region', 'category', 'budget', 'score', 'score_breakdown',
  'posted_date', 'url', 'status', 'notes', 'description',
  'remote', 'has_phone', 'has_email', 'phone_extracted', 'email_extracted',
];

// ─── Regions — 6 strategic cities, 1000-mile radius = full US coverage ────────
const REGIONS = [
  { name: 'miami',      zip: '33101' },  // Southeast
  { name: 'newyork',    zip: '10001' },  // Northeast
  { name: 'chicago',    zip: '60601' },  // Midwest
  { name: 'dallas',     zip: '75201' },  // South/Central
  { name: 'denver',     zip: '80201' },  // Mountain/West
  { name: 'losangeles', zip: '90001' },  // West Coast
];

// ─── Keywords ─────────────────────────────────────────────────────────────────
const KEYWORDS = {
  'Website/Design': [
    'website', 'web design', 'wordpress', 'wix', 'squarespace',
    'shopify', 'webflow', 'website redesign', 'landing page',
    'ecommerce', 'web developer', 'website help',
  ],
  'Marketing/SEO': [
    'SEO', 'search engine optimization', 'google ranking',
    'facebook ads', 'instagram ads', 'google ads', 'PPC',
    'social media marketing', 'email marketing', 'mailchimp',
  ],
  'Branding/Design': [
    'logo design', 'brand identity', 'graphic design',
    'business card', 'flyer design', 'banner design',
  ],
  'VA/Admin': [
    'virtual assistant', 'VA needed', 'remote assistant',
    'admin help', 'data entry remote', 'research assistant',
    'customer service remote', 'email management',
  ],
};

// ─── Stage-2 filters ──────────────────────────────────────────────────────────

const SPAM_SIGNALS = [
  'model', 'clinical study', 'clinical trial', 'paid study', 'research study',
  'sales rep', 'commission only', 'earn money', 'make money',
  'hiring full time', 'hiring part time', 'per hour', 'per year', 'salary',
  'must be local', 'local only', 'in person', 'in-person', 'on site', 'on-site',
  'come to our office', 'in our office', 'no experience required',
  'foreclosure leads', 'inpatient', 'outpatient', 'galleria',
  'real estate agent', 'insurance agent', 'mlm', 'multi level',
  'network marketing', 'pyramid', 'passive income',
  'drop shipping', 'dropshipping', 'amazon fba', 'crypto', 'nft',
  'photo model', 'acting', 'casting', 'nude', 'adult',
];

const BUYER_INTENT = [
  'need a website', 'need website', 'looking for', 'need help with',
  'need someone to', 'want to hire', 'quote', 'how much would',
  'what would it cost', 'budget', 'willing to pay', 'need a designer',
  'need a developer', 'need seo', 'need a logo', 'need a va',
  'need virtual', 'need someone who can', 'can anyone', 'does anyone',
  'seeking', 'wanted', 'request', 'project', 'build me', 'create for me',
  'redesign', 'fix my', 'update my', 'help me with', 'assist with',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function stripHtml(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

function extractBudgetValue(text) {
  const matches = [...(text.matchAll(/\$\s*([\d,]+)/g))];
  if (!matches.length) return null;
  const amounts = matches.map(m => parseInt(m[1].replace(/,/g, ''), 10)).filter(n => n > 0 && n < 100000);
  return amounts.length ? Math.max(...amounts) : null;
}

function extractPhones(text) {
  const re = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g;
  return [...new Set((text.match(re) || []).map(p => p.trim()))];
}

function extractEmails(text) {
  const re = /[a-zA-Z0-9._%+\-]+@(?!craigslist)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(re) || [])];
}

function extractName(text) {
  const patterns = [
    /(?:hi[,.]?\s*(?:my\s*name\s*is|i['']?m)\s*)([A-Z][a-z]+)/,
    /(?:thanks[,!.]?\s*)([A-Z][a-z]+)\s*$/m,
    /(?:[-—]\s*)([A-Z][a-z]+)\s*$/m,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1].length < 20) return m[1];
  }
  return '';
}

function passesSpamFilter(text) {
  const lower = text.toLowerCase();
  return !SPAM_SIGNALS.some(s => lower.includes(s));
}

function passesBuyerIntentFilter(text) {
  const lower = text.toLowerCase();
  return BUYER_INTENT.some(s => lower.includes(s));
}

function hoursAgo(dateStr) {
  if (!dateStr) return 9999;
  const d = new Date(dateStr);
  return isNaN(d) ? 9999 : (Date.now() - d.getTime()) / 3600000;
}

function scoreFullText(post) {
  const parts  = [];
  let   score  = 0;
  const text   = ((post.title || '') + ' ' + (post.fullText || '')).toLowerCase();
  const age    = hoursAgo(post.postedDate);

  // Recency
  if      (age < 24)   { score += 3; parts.push('+3 today'); }
  else if (age < 48)   { score += 2; parts.push('+2 <24h'); }
  else if (age < 168)  { score += 1; parts.push('+1 <7d'); }
  else if (age < 336)  { score -= 1; parts.push('-1 7-14d'); }
  else if (age < 720)  { score -= 2; parts.push('-2 14-30d'); }
  else                 { score -= 3; parts.push('-3 30d+'); }

  // Phone
  if (post.phones?.length) { score += 3; parts.push('+3 phone found'); }

  // Email
  if (post.emails?.length) { score += 2; parts.push('+2 email found'); }

  // Contact cue
  if (/call me|text me|email me directly|reach me at/i.test(text)) {
    score += 1; parts.push('+1 contact cue');
  }

  // Budget
  if (post.budget) {
    score += 2; parts.push('+2 budget mentioned');
    if (post.budget >= 300) { score += 2; parts.push('+2 $300+'); }
  } else {
    score -= 2; parts.push('-2 no budget');
  }

  // Remote
  if (/\b(remote|virtual|online|anywhere|work from home|worldwide|location flexible)\b/.test(text)) {
    score += 2; parts.push('+2 remote');
    post.remote = 'yes';
  }

  // Scope
  const words = (post.fullText || '').split(/\s+/).filter(w => w.length > 2).length;
  if      (words >= 100) { score += 1; parts.push('+1 detailed'); }
  else if (words <  50)  { score -= 1; parts.push('-1 vague'); }

  // Quick job signals
  if (/\bone[\s-]page\b|simple|quick|basic|small|landing page/i.test(text)) {
    score += 1; parts.push('+1 quick job');
  }

  return {
    score:     Math.max(1, Math.min(15, score)),
    breakdown: parts.join(', '),
  };
}

// ─── Seen-URL store (cross-run dedup with 30-day TTL) ─────────────────────────

const SEEN_HEADERS = ['url', 'seen_at'];
const SEEN_TTL_DAYS = 30;

function loadSeenUrls() {
  if (!fs.existsSync(config.CL_SEEN_CSV)) return new Map();
  const rows  = readCSV(config.CL_SEEN_CSV, SEEN_HEADERS);
  const cutoff = Date.now() - SEEN_TTL_DAYS * 86400000;
  const map   = new Map();
  for (const r of rows) {
    if (!r.url) continue;
    const ts = r.seen_at ? new Date(r.seen_at).getTime() : 0;
    if (ts >= cutoff) map.set(r.url, r.seen_at); // keep if < 30 days old
  }
  return map;
}

function saveSeenUrls(map) {
  const rows = [...map.entries()].map(([url, seen_at]) => ({ url, seen_at }));
  writeCSV(config.CL_SEEN_CSV, rows, SEEN_HEADERS);
}

// No rotation — all 6 regions run every morning for full US coverage

// ─── Puppeteer browser ────────────────────────────────────────────────────────
async function createCLBrowser() {
  try {
    const b = await puppeteer.connect({
      browserURL: 'http://localhost:9222',
      defaultViewport: { width: 1440, height: 900 },
    });
    console.log('[CL] Connected to Chrome via CDP (port 9222)');
    return { browser: b, owned: false };
  } catch {}

  console.log('[CL] CDP unavailable — launching Chrome with CL profile...');
  const b = await puppeteer.launch({
    headless: false,
    executablePath: config.CHROME_PATH,
    userDataDir: config.CHROME_CL_DATA_DIR || config.CHROME_USER_DATA_DIR,
    args: [
      `--profile-directory=${config.CHROME_PROFILE}`,
      '--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800', '--window-position=-32000,-32000',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
  return { browser: b, owned: true };
}

// ─── Stage 1: collect candidate URLs from search pages ───────────────────────
async function searchForURLs(page, region, keyword) {
  const q   = encodeURIComponent(keyword);
  // 1000-mile radius filter covers the entire US from each of the 6 hub cities
  const url = `https://${region.name}.craigslist.org/search/ggg?query=${q}&search_distance=1000&postal=${region.zip}&sort=date`;
  try {
    const res    = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const status = res ? res.status() : 0;
    if (status === 403 || status === 429) return null; // region blocked
    await sleep(randInt(1000, 2000));

    const pageTitle = await page.title().catch(() => '');
    if (/blocked|captcha|robot/i.test(pageTitle)) return null;

    return await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('.cl-search-result, li[data-pid]').forEach(el => {
        const titleEl = el.querySelector('.titlestring, a.posting-title span, [class*="title"] a');
        const linkEl  = el.querySelector('a[href*="/d/"]') || el.querySelector('a');
        const priceEl = el.querySelector('.price, [class*="price"]');
        const dateEl  = el.querySelector('time[datetime]');
        const locEl   = el.querySelector('.location, [class*="location"]');
        const t = titleEl ? titleEl.textContent.trim() : '';
        const u = linkEl  ? linkEl.href : '';
        if (!t || !u) return;
        results.push({
          title:        t,
          url:          u,
          budget_hint:  priceEl ? priceEl.textContent.trim() : '',
          date_hint:    dateEl  ? dateEl.getAttribute('datetime') : '',
          city:         locEl   ? locEl.textContent.trim() : '',
        });
      });
      return results;
    });
  } catch (e) {
    if (!e.message.includes('Target closed'))
      console.log(`  [CL] search error ${region.name}/${keyword}: ${e.message.slice(0, 60)}`);
    return [];
  }
}

// ─── Stage 2: read individual post pages ─────────────────────────────────────
async function readPostPage(page, candidate) {
  try {
    const res = await page.goto(candidate.url, {
      waitUntil: 'domcontentloaded',
      timeout:   10000,
    });
    if (!res || res.status() >= 400) return null;
    await sleep(randInt(500, 1200));

    const data = await page.evaluate(() => {
      // Full post body
      const bodyEl = document.querySelector('#postingbody, .postingbody, [id*="posting"]');
      const body   = bodyEl ? bodyEl.innerText.replace(/do NOT contact.*$/is, '').trim() : '';

      // Posted date from post header
      const dateEl = document.querySelector('time.date.timeago, .date, time[datetime]');
      const posted = dateEl
        ? (dateEl.getAttribute('datetime') || dateEl.textContent.trim())
        : '';

      // Location from post header
      const locEl  = document.querySelector('.mapaddress, .postingtitletext small');
      const loc    = locEl ? locEl.textContent.trim().replace(/[()]/g, '') : '';

      // Title (more accurate than search snippet)
      const titleEl = document.querySelector('#titletextonly, .postingtitletext #titletextonly');
      const title   = titleEl ? titleEl.textContent.trim() : '';

      return { body, posted, loc, title };
    });

    const fullText = data.body;
    if (!fullText || fullText.length < 20) return null;

    // Apply filters on full text
    if (!passesSpamFilter(fullText + ' ' + candidate.title)) return null;
    if (!passesBuyerIntentFilter(fullText + ' ' + candidate.title)) return null;

    // Extract structured fields
    const phones   = extractPhones(fullText);
    const emails   = extractEmails(fullText);
    const budget   = extractBudgetValue(fullText + ' ' + candidate.budget_hint);
    const name     = extractName(fullText);

    const enriched = {
      ...candidate,
      fullText,
      phones,
      emails,
      budget,
      name,
      postedDate: data.posted || candidate.date_hint,
      city:       data.loc    || candidate.city,
      title:      data.title  || candidate.title,
      remote:     'no',
    };

    const { score, breakdown } = scoreFullText(enriched);
    return { ...enriched, score, breakdown };
  } catch (e) {
    if (!e.message.includes('Target closed') && !e.message.includes('timeout'))
      console.log(`  [CL] page read error: ${e.message.slice(0, 60)}`);
    return null;
  }
}

// ─── Status file ─────────────────────────────────────────────────────────────
function writeStatus(data) {
  try {
    fs.writeFileSync(config.CL_STATUS,
      JSON.stringify({ ...data, updated_at: new Date().toISOString() }, null, 2), 'utf8');
  } catch {}
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function monitorCraigslist() {
  const startMs   = Date.now();
  const startTime = new Date().toISOString();
  console.log(`\n[CL] Craigslist Monitor started — ${startTime}`);
  writeStatus({ status: 'running', last_run: startTime, leads_found: 0, regions_searched: 0, blocked: false });

  const regions = REGIONS;  // all 6, every run — no rotation needed
  const allCats = Object.entries(KEYWORDS);
  console.log(`[CL] US Coverage: ${regions.length} regions × 1000mi radius = Full US`);
  console.log(`[CL] Regions: ${regions.map(r => r.name).join(', ')}`);

  // Load dedup state
  // seenMap: URL → seen_at timestamp (purged >30 days old on load)
  const seenMap      = loadSeenUrls();
  const prevRunSize  = seenMap.size;
  console.log(`[CL] Seen from previous runs: ${prevRunSize} URLs (${SEEN_TTL_DAYS}-day window)`);

  const existing     = fs.existsSync(config.CL_LEADS_CSV)
    ? readCSV(config.CL_LEADS_CSV, CL_HEADERS) : [];
  // Also block URLs already in leads.csv (avoids re-processing won/applied gigs)
  const leadsUrls    = new Set(existing.map(r => r.url));

  // Combined cross-run skip set
  const skipUrl = url => seenMap.has(url) || leadsUrls.has(url);

  // Within-run URL set (tracks what we've seen THIS run across all regions)
  const thisRunUrls  = new Set();
  let   dupWithinRun = 0;
  let   dupPrevRuns  = 0;

  const { browser, owned } = await createCLBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  // ── STAGE 1: collect all candidate URLs ────────────────────────────────────
  console.log('\n[CL] Stage 1 — collecting candidate URLs from search pages...');
  const candidates   = [];
  let   rssTotal     = 0;
  let   regionsSkipped = 0;

  try {
    for (const region of regions) {
      let regionBlocked = false;
      console.log(`  [CL] Searching ${region.name} (zip ${region.zip}, 1000mi radius)`);
      for (const [category, keywords] of allCats) {
        if (regionBlocked) break;
        for (const keyword of keywords.slice(0, 3)) {
          if (regionBlocked) break;
          const items = await searchForURLs(page, region, keyword);
          if (items === null) { regionBlocked = true; regionsSkipped++; break; }
          rssTotal += items.length;
          for (const item of items) {
            if (!item.url) continue;
            if (thisRunUrls.has(item.url)) { dupWithinRun++; continue; }
            if (skipUrl(item.url))         { dupPrevRuns++;  continue; }
            thisRunUrls.add(item.url);
            candidates.push({ ...item, category, region: region.name });
          }
          await sleep(500);
        }
      }
      if (regionBlocked) console.log(`  [CL] ${region.name}: blocked/skipped`);
    }
  } catch (e) {
    console.error('[CL] Stage 1 error:', e.message);
  }

  // candidates is already fully deduped (within-run + cross-run both handled above)
  const uniq = candidates;
  console.log(`[CL] Stage 1 complete: ${rssTotal} raw → ${dupWithinRun} dups this run → ${dupPrevRuns} seen before → ${uniq.length} new candidates`);

  // ── STAGE 2: read post pages (max 50) ─────────────────────────────────────
  const MAX_PAGES   = 50;
  const toRead      = uniq.slice(0, MAX_PAGES);

  console.log(`\n[CL] Stage 2 — reading ${toRead.length} post pages for full text...`);

  const newLeads     = [];
  const nowIso       = new Date().toISOString();
  let   pagesRead    = 0;
  let   spamFiltered = 0;

  try {
    for (const cand of toRead) {
      pagesRead++;
      process.stdout.write(`  [CL] (${pagesRead}/${toRead.length}) ${cand.title.slice(0, 55)}...\r`);

      const post = await readPostPage(page, cand);

      // Mark URL as seen regardless of outcome — prevents re-processing on next run
      seenMap.set(cand.url, nowIso);

      if (!post) {
        spamFiltered++;
        continue;
      }

      newLeads.push({
        title:           post.title.slice(0, 120),
        city:            post.city   || cand.region,
        region:          cand.region,
        category:        cand.category,
        budget:          post.budget ? `$${post.budget}` : '',
        score:           post.score,
        score_breakdown: post.breakdown,
        posted_date:     post.postedDate,
        url:             post.url,
        status:          'new',
        notes:           '',
        description:     post.fullText.slice(0, 400),
        remote:          post.remote || 'no',
        has_phone:       post.phones?.length ? 'yes' : 'no',
        has_email:       post.emails?.length ? 'yes' : 'no',
        phone_extracted: (post.phones || []).join(', '),
        email_extracted: (post.emails || []).join(', '),
      });

      await sleep(randInt(1000, 3000));
    }
  } finally {
    await page.close().catch(() => {});
    if (owned) await browser.close().catch(() => {});
    else browser.disconnect();
  }

  console.log(''); // clear the \r line

  // Sort by score
  newLeads.sort((a, b) => b.score - a.score);

  // Save leads
  if (newLeads.length)
    writeCSV(config.CL_LEADS_CSV, [...existing, ...newLeads], CL_HEADERS);

  // Save seen URLs (includes new ones stamped this run + purged old ones)
  saveSeenUrls(seenMap);
  const purgedCount = prevRunSize - (seenMap.size - pagesRead); // rough purge estimate
  console.log(`[CL] Seen file: ${seenMap.size} URLs saved (30-day window)`);
  if (purgedCount > 0) console.log(`[CL] Purged ${purgedCount} expired entries (>30 days)`);

  const elapsed   = Math.round((Date.now() - startMs) / 1000);
  const hot       = newLeads.filter(l => l.score >= (config.CL_HOT_SCORE  || 10)).length;
  const good      = newLeads.filter(l => l.score >= (config.CL_GOOD_SCORE ||  7) && l.score < (config.CL_HOT_SCORE || 10)).length;

  console.log(`\n[CL] ─── Summary ───────────────────────────────────────`);
  console.log(`  Total from search pages:          ${rssTotal}`);
  console.log(`  Duplicates (this run, cross-region):${dupWithinRun}`);
  console.log(`  Already seen (previous runs):     ${dupPrevRuns}`);
  console.log(`  New unique posts:                  ${uniq.length}`);
  console.log(`  Pages read:                       ${pagesRead}`);
  console.log(`  Filtered (spam / no buyer intent):${spamFiltered}`);
  console.log(`  New leads saved:                  ${newLeads.length}`);
  console.log(`  🔥 Hot (10+):             ${hot}`);
  console.log(`  ⭐ Good (7-9):            ${good}`);
  console.log(`  US Coverage:              ${regions.length} regions × 1000mi radius = Full US`);
  console.log(`  Regions skipped:          ${regionsSkipped}`);
  console.log(`  Elapsed:                  ${elapsed}s`);

  const blocked = regionsSkipped === regions.length;
  writeStatus({
    status:          blocked ? 'blocked' : 'complete',
    last_run:        startTime,
    leads_found:     newLeads.length,
    regions_searched: regions.length - regionsSkipped,
    blocked,
    hot, good,
    rss_total:       rssTotal,
    pages_read:      pagesRead,
    spam_filtered:   spamFiltered,
    elapsed_s:       elapsed,
  });

  return { newLeads: newLeads.length, hot, good, elapsed: `${elapsed}s`, rssTotal, pagesRead };
}

module.exports = { monitorCraigslist, createCLBrowser, CL_HEADERS };

if (require.main === module) {
  monitorCraigslist()
    .then(r => console.log(`\n[CL] Done — ${r.newLeads} leads in ${r.elapsed}`))
    .catch(console.error);
}

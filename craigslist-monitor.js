/**
 * craigslist-monitor.js
 *
 * Searches Craigslist gig postings across the entire US for freelance
 * work opportunities. Runs as a separate scheduled task at 7 AM.
 *
 * Features:
 *  • 65 US regions, rotated 10 per day via rotation-log.json
 *  • 5 keyword categories: Website/Design, Marketing/SEO, Branding, VA/Admin, Other Digital
 *  • Scoring system (max 15): budget, remote, recency, contact info, scope
 *  • Hard filters: blocks in-person, volunteer, spec work, etc.
 *  • Dedup by title+budget+description hash across regions
 *  • Stealth: random delays, rotating user agents, human-like behaviour
 *  • CAPTCHA detection with automatic cool-down
 *  • Output: craigslist-leads.csv + craigslist-seen.csv
 *
 * Run standalone: node craigslist-monitor.js
 * Scheduled:      Daily at 7 AM via craigslist-scheduler.xml
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

// ─── 65 US regions with representative zip codes ──────────────────────────────
const REGIONS = {
  // Northeast
  newyork:'10001', boston:'02101', philadelphia:'19102', baltimore:'21201',
  washington:'20001', providence:'02903', hartford:'06101', albany:'12207',
  buffalo:'14202', pittsburgh:'15222', newjersey:'07102', maine:'04101',
  vermont:'05401', newhampshire:'03301', connecticut:'06106',
  // Southeast
  miami:'33101', orlando:'32801', tampa:'33601', jacksonville:'32201',
  atlanta:'30301', charlotte:'28201', raleigh:'27601', richmond:'23218',
  nashville:'37201', memphis:'38101', louisville:'40201', charleston:'29401',
  savannah:'31401', columbia:'29201', birmingham:'35201', montgomery:'36101',
  neworleans:'70112', jackson:'39201', knoxville:'37902',
  // Midwest
  chicago:'60601', detroit:'48201', cleveland:'44101', columbus:'43201',
  cincinnati:'45202', indianapolis:'46201', milwaukee:'53201',
  minneapolis:'55401', stlouis:'63101', kansascity:'64101', omaha:'68101',
  desmoines:'50301', grandrapids:'49501', madison:'53701', peoria:'61601',
  dayton:'45401', toledo:'43601', akron:'44301', lansing:'48901',
  fortwayne:'46801',
  // Southwest
  dallas:'75201', houston:'77001', austin:'78701', sanantonio:'78201',
  phoenix:'85001', albuquerque:'87101', elpaso:'79901', tulsa:'74101',
  oklahoma:'73101', wichita:'67201', lubbock:'79401', amarillo:'79101',
  lasvegas:'89101', tucson:'85701',
  // West
  losangeles:'90001', sandiego:'92101', sfbay:'94102', sacramento:'95814',
  portland:'97201', seattle:'98101', denver:'80201', saltlake:'84101',
  spokane:'99201', fresno:'93701', bakersfield:'93301', inland:'92501',
  reno:'89501', boise:'83701', missoula:'59801', helena:'59601',
};

// ─── Keywords by category ─────────────────────────────────────────────────────
const KEYWORDS = {
  'Website/Design': [
    'website', 'web design', 'wordpress', 'wix', 'squarespace',
    'shopify', 'webflow', 'website redesign', 'landing page',
    'ecommerce website', 'web developer', 'fix my website',
    'update my website', 'website maintenance', 'website help',
  ],
  'Marketing/SEO': [
    'SEO', 'search engine optimization', 'google ranking',
    'facebook ads', 'instagram ads', 'google ads', 'PPC',
    'social media manager', 'digital marketing', 'email marketing',
    'social media marketing', 'content creator', 'mailchimp', 'klaviyo',
  ],
  'Branding/Design': [
    'logo design', 'brand identity', 'graphic design',
    'business card design', 'flyer design', 'banner design',
    'brochure design', 'marketing materials',
  ],
  'VA/Admin': [
    'virtual assistant', 'VA needed', 'virtual help', 'online assistant',
    'remote assistant', 'admin help', 'data entry remote',
    'research assistant', 'customer service remote', 'email management',
    'calendar management', 'virtual receptionist', 'online research',
  ],
  'Other Digital': [
    'app design', 'mobile app', 'UI design', 'copywriting', 'blog writing',
    'content writing', 'product photography', 'photo editing', 'video editing',
  ],
};

// ─── Hard filter phrases — auto-skip any post containing these ────────────────
const HARD_FILTERS = [
  'in person', 'in-person', 'on site', 'on-site', 'local only',
  'must be local', 'come to our office', 'in house', 'in-house',
  'local candidate', 'nearby', 'in our location', 'must be in',
  'must live in', 'will not consider remote', 'no remote',
  'local applicants only', 'in office', 'volunteer', 'unpaid',
  'internship', 'barter', 'trade for', 'exchange for',
  'commission only', 'spec work', 'for exposure',
];

// ─── Rotating user agents ─────────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900  },
  { width: 1366, height: 768  },
  { width: 1280, height: 800  },
];

const ACCEPT_LANGS   = ['en-US,en;q=0.9', 'en-GB,en;q=0.9', 'en-CA,en;q=0.8,en-US;q=0.9'];
const REFERERS       = ['https://www.google.com/', 'https://www.bing.com/', ''];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randItem(arr)     { return arr[Math.floor(Math.random() * arr.length)]; }
function sleep(ms)         { return new Promise(r => setTimeout(r, ms)); }

function pickUA()       { return randItem(USER_AGENTS); }
function pickViewport() { return randItem(VIEWPORTS); }

async function humanDelay(min = 3000, max = 8000) {
  await sleep(randInt(min, max));
}

function extractBudget(text) {
  const m = text.match(/\$\s*([\d,]+)/);
  if (!m) return null;
  return parseInt(m[1].replace(/,/g, ''), 10);
}

function hoursAgo(dateStr) {
  if (!dateStr) return 9999;
  const d = new Date(dateStr);
  if (isNaN(d)) return 9999;
  return (Date.now() - d.getTime()) / 3600000;
}

function descHash(post) {
  const t = (post.title + (post.budget || '') + post.description.slice(0, 50)).toLowerCase().replace(/\s+/g, '');
  let h = 0;
  for (let i = 0; i < t.length; i++) { h = ((h << 5) - h) + t.charCodeAt(i); h |= 0; }
  return String(h);
}

// ─── Hard filter check ────────────────────────────────────────────────────────
function passesHardFilter(text) {
  const lower = text.toLowerCase();
  return !HARD_FILTERS.some(phrase => lower.includes(phrase));
}

// ─── Scoring (max 15) ─────────────────────────────────────────────────────────
function scorePost(post) {
  let score = 0;
  const text = (post.title + ' ' + post.description).toLowerCase();

  // Budget
  const budget = extractBudget(text + ' ' + (post.budget || ''));
  if (budget) {
    score += 2;
    if (budget >= 300) score += 2;
  } else {
    score -= 2;
  }

  // Remote/virtual
  if (/\b(remote|virtual|online|work from home|anywhere|worldwide)\b/.test(text)) score += 2;

  // Recency
  const age = hoursAgo(post.posted_date);
  if      (age < 24)  score += 3;   // today
  else if (age < 48)  score += 2;
  else if (age < 72)  score += 1;
  else if (age > 336) score -= 5;   // 14+ days → essentially auto-skip
  else if (age > 168) score -= 2;   // 7+ days

  // Contact info in description
  const phoneRe = /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;
  if (phoneRe.test(text)) score += 3;

  const emailRe = /[a-zA-Z0-9._%+\-]+@(?!craigslist)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  if (emailRe.test(text)) score += 2;

  if (/call me|text me|email me directly|reach me at/i.test(text)) score += 1;

  // Description quality
  const words = text.split(/\s+/).filter(w => w.length > 2).length;
  if (words >= 50) score += 1;
  else if (words < 30) score -= 1;

  // Quick/simple project
  if (/\bone[\s-]page\b|single page|simple|quick|small|landing page|basic/i.test(text)) score += 1;

  return Math.max(0, Math.min(15, score));
}

function scoreLabel(score) {
  if (score >= config.CL_HOT_SCORE)  return '🔥 Hot Lead';
  if (score >= config.CL_GOOD_SCORE) return '⭐ Good Lead';
  return 'Okay Lead';
}

// ─── Craigslist scraping ──────────────────────────────────────────────────────

async function setupPage(browser) {
  const page = await browser.newPage();
  const vp   = pickViewport();
  await page.setViewport(vp);
  await page.setUserAgent(pickUA());
  await page.setExtraHTTPHeaders({
    'Accept-Language':  randItem(ACCEPT_LANGS),
    'Accept-Encoding':  'gzip, deflate, br',
    'Cache-Control':    Math.random() > 0.5 ? 'no-cache' : 'max-age=0',
    ...(Math.random() > 0.33 ? { 'Referer': randItem(REFERERS) } : {}),
  });
  // Hide webdriver
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] });
  });
  return page;
}

async function isCaptcha(page) {
  const title = await page.title().catch(() => '');
  const url   = page.url();
  return /captcha|blocked|robot|unusual traffic/i.test(title + url);
}

async function randomScroll(page) {
  const depth = randInt(25, 75);
  await page.evaluate(d => {
    window.scrollTo(0, document.body.scrollHeight * (d / 100));
  }, depth);
}

/**
 * Scrape one search results page for a keyword in one region.
 * Returns array of raw post objects.
 */
async function scrapeSearchPage(page, region, keyword, zip) {
  const q   = encodeURIComponent(keyword);
  const url = `https://${region}.craigslist.org/search/ggg?query=${q}&search_distance=1000&postal=${zip}`;

  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!res || res.status() >= 400) {
      console.log(`  [CL] ${res?.status()} on ${region}/${keyword} — skipping`);
      return [];
    }
  } catch (e) {
    console.log(`  [CL] Timeout on ${region}/${keyword} — skipping`);
    return [];
  }

  if (await isCaptcha(page)) return null; // signal CAPTCHA

  await randomScroll(page);
  await humanDelay(1500, 3500);

  // Extract posts — try modern and legacy selectors
  const posts = await page.evaluate(() => {
    const results = [];

    // Modern CL layout (2024+)
    const items = document.querySelectorAll('.cl-search-result, li[data-pid]');
    items.forEach(el => {
      const titleEl = el.querySelector('.titlestring, .title-anchor, [class*="title"] a, a.posting-title');
      if (!titleEl) return;

      const title = titleEl.textContent.trim();
      const href  = titleEl.href || el.querySelector('a')?.href || '';

      const priceEl = el.querySelector('.price, [class*="price"]');
      const budget  = priceEl ? priceEl.textContent.trim() : '';

      const dateEl  = el.querySelector('time, .date, [class*="date"]');
      const dateVal = dateEl ? (dateEl.getAttribute('datetime') || dateEl.textContent.trim()) : '';

      const locEl  = el.querySelector('.location, [class*="location"]');
      const city   = locEl ? locEl.textContent.trim() : '';

      results.push({ title, url: href, budget, posted_date: dateVal, city, description: '' });
    });

    return results;
  });

  // Deduplicate by URL within this page
  const seen = new Set();
  return posts.filter(p => {
    if (!p.title || !p.url) return false;
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
}

/**
 * Load individual post page to get description.
 */
async function scrapePostDetail(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await humanDelay(1200, 2800);

    if (await isCaptcha(page)) return null;

    return await page.evaluate(() => {
      const bodyEl = document.querySelector('#postingbody, .body, [id*="posting"]');
      if (!bodyEl) return '';
      return bodyEl.innerText.replace(/do NOT contact me with unsolicited services or offers[\s\S]*/i, '').trim();
    });
  } catch {
    return '';
  }
}

// ─── Region rotation ──────────────────────────────────────────────────────────
function pickRegions(count) {
  const allRegions = Object.keys(REGIONS);
  let log = {};
  try {
    if (fs.existsSync(config.ROTATION_LOG)) {
      log = JSON.parse(fs.readFileSync(config.ROTATION_LOG, 'utf8'));
    }
  } catch {}

  const usedCl = new Set(log.usedCL || []);
  let remaining = allRegions.filter(r => !usedCl.has(r));

  if (remaining.length < count) {
    console.log(`[CL] All ${allRegions.length} regions used — resetting CL rotation`);
    log.usedCL = [];
    remaining = [...allRegions];
  }

  // Shuffle and pick
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  const picked = remaining.slice(0, count);

  log.usedCL = [...(log.usedCL || []), ...picked];
  fs.writeFileSync(config.ROTATION_LOG, JSON.stringify(log, null, 2), 'utf8');

  console.log(`[CL] Regions: ${picked.join(', ')}`);
  console.log(`[CL] Rotation: ${log.usedCL.length}/${allRegions.length} used`);
  return picked;
}

// ─── Dedup helpers ────────────────────────────────────────────────────────────
function loadSeen() {
  if (!fs.existsSync(config.CL_SEEN_CSV)) return new Set();
  const rows = readCSV(config.CL_SEEN_CSV, ['hash']);
  return new Set(rows.map(r => r.hash));
}

function saveSeen(hashes) {
  const rows = [...hashes].map(h => ({ hash: h }));
  writeCSV(config.CL_SEEN_CSV, rows, ['hash']);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function monitorCraigslist() {
  const startMs = Date.now();
  console.log(`\n[CL] Craigslist Monitor started — ${new Date().toISOString()}`);

  // Pick today's regions
  const regions  = pickRegions(config.CL_REGIONS_PER_RUN);
  const seenHash = loadSeen();
  const allCats  = Object.entries(KEYWORDS);

  // Load existing leads to avoid exact URL dupes
  const existing    = readCSV(config.CL_LEADS_CSV, CL_HEADERS).catch
    ? [] : readCSV(config.CL_LEADS_CSV, CL_HEADERS);
  const existingUrls = new Set(existing.map(r => r.url));

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: config.CHROME_PATH,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins',
    ],
  });

  const newLeads   = [];
  const newHashes  = new Set(seenHash);
  let   totalFound = 0;
  let   autoSkipped = 0;
  let   captchaHits = 0;
  let   regionsDone = 0;
  let   regionsSkipped = 0;

  // Stats for report
  const comboStats = [];

  try {
    const page = await setupPage(browser);

    for (const region of regions) {
      const zip = REGIONS[region];
      let   regionCaptcha = false;

      console.log(`\n[CL] === Region: ${region} ===`);

      // Clear cookies between regions
      const cdp = await browser.createBrowserContext?.() || null;
      await page.deleteCookie(...(await page.cookies()));

      // Randomise UA for this region
      await page.setUserAgent(pickUA());

      for (const [category, keywords] of allCats) {
        if (regionCaptcha) break;

        // Pick a subset of keywords to avoid too many requests
        const kws = keywords.slice(0, 4); // 4 keywords per category per region

        for (const keyword of kws) {
          if (regionCaptcha) break;

          console.log(`  [CL] Searching: "${keyword}" in ${region} (delay: ${randInt(8,15)}s)`);
          await humanDelay(8000, 15000); // 8–15s between keywords

          const posts = await scrapeSearchPage(page, region, keyword, zip);

          if (posts === null) {
            // CAPTCHA
            captchaHits++;
            regionCaptcha = true;
            console.log(`  [CL] ⚠ CAPTCHA hit on ${region} — cooling 5-10 min then skipping region`);
            regionsSkipped++;
            await humanDelay(300000, 600000); // 5–10 min cool-down
            break;
          }

          console.log(`  [CL] Found: ${posts.length} results`);
          totalFound += posts.length;

          for (const post of posts) {
            // Already seen?
            const hash = descHash(post);
            if (seenHash.has(hash) || newHashes.has(hash)) continue;
            if (existingUrls.has(post.url)) continue;

            // Get description
            await humanDelay(3000, 8000);
            const description = await scrapePostDetail(page, post.url) || '';
            post.description = description;

            // Hard filter
            const fullText = post.title + ' ' + description;
            if (!passesHardFilter(fullText)) {
              newHashes.add(hash); // mark seen so we don't re-check
              continue;
            }

            // Age check (14+ days auto-skip, no need to score)
            if (hoursAgo(post.posted_date) > 336) {
              autoSkipped++;
              newHashes.add(hash);
              continue;
            }

            // Score
            const score = scorePost(post);
            if (score <= config.CL_SKIP_SCORE) {
              autoSkipped++;
              newHashes.add(hash);
              continue;
            }

            // Enrich
            const budget  = extractBudget(post.title + ' ' + description);
            const isRemote = /\b(remote|virtual|online|work from home|anywhere|worldwide)\b/i.test(fullText);
            const hasPhone = /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(description);
            const hasEmail = /[a-zA-Z0-9._%+\-]+@(?!craigslist)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(description);

            newLeads.push({
              title:        post.title.slice(0, 120),
              city:         post.city || region,
              region,
              category,
              budget:       budget ? `$${budget}` : '',
              score,
              posted_date:  post.posted_date,
              url:          post.url,
              status:       'new',
              notes:        '',
              description:  description.slice(0, 300),
              remote:       isRemote ? 'yes' : 'no',
              has_phone:    hasPhone ? 'yes' : 'no',
              has_email:    hasEmail ? 'yes' : 'no',
            });

            newHashes.add(hash);
            existingUrls.add(post.url);

            console.log(`  [CL] ✓ [${score}/15] ${post.title.slice(0,60)}`);
          }
        }

        if (!regionCaptcha) {
          // 20–45s between categories
          await humanDelay(20000, 45000);
        }
      }

      if (!regionCaptcha) regionsDone++;
      comboStats.push(`  ${region}: done (${regionCaptcha ? 'CAPTCHA' : 'ok'})`);

      // Between regions: 20–45s
      await humanDelay(20000, 45000);
    }
  } finally {
    await browser.close();
  }

  // Save new leads + update seen hashes
  if (newLeads.length) {
    const combined = [...(existing || []), ...newLeads];
    writeCSV(config.CL_LEADS_CSV, combined, CL_HEADERS);
    console.log(`\n[CL] Wrote ${newLeads.length} new leads to craigslist-leads.csv`);
  }
  saveSeen(newHashes);

  const elapsed = Math.round((Date.now() - startMs) / 1000);
  const hotCount  = newLeads.filter(l => l.score >= config.CL_HOT_SCORE).length;
  const goodCount = newLeads.filter(l => l.score >= config.CL_GOOD_SCORE && l.score < config.CL_HOT_SCORE).length;

  const summary = {
    newLeads:       newLeads.length,
    hot:            hotCount,
    good:           goodCount,
    autoSkipped,
    regionsDone,
    regionsSkipped,
    captchaHits,
    totalFound,
    elapsed:        `${elapsed}s`,
    regions:        comboStats.join('\n'),
  };

  console.log(`\n[CL] Summary:`);
  console.log(`  New leads:       ${newLeads.length}`);
  console.log(`  Hot (${config.CL_HOT_SCORE}+):        ${hotCount}`);
  console.log(`  Good (${config.CL_GOOD_SCORE}-${config.CL_HOT_SCORE-1}):       ${goodCount}`);
  console.log(`  Auto-skipped:    ${autoSkipped}`);
  console.log(`  Regions done:    ${regionsDone}/${regions.length}`);
  console.log(`  CAPTCHA hits:    ${captchaHits}`);
  console.log(`  Total found:     ${totalFound}`);
  console.log(`  Elapsed:         ${elapsed}s`);

  return summary;
}

module.exports = { monitorCraigslist, CL_HEADERS };

if (require.main === module) {
  monitorCraigslist()
    .then(r => console.log(`[CL] Done. ${r.newLeads} new leads.`))
    .catch(console.error);
}

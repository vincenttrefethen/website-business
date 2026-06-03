/**
 * SKILL 3 — find-contact.js
 *
 * Multi-strategy email finder for each lead in leads.csv.
 * Tries sources in order, stopping at first hit:
 *
 *   1. Google Maps listing → scrape linked website's contact pages
 *   2. Bing search → snippets + top 5 organic pages
 *   3. Yelp business page → contact section
 *   4. Facebook business page → About tab
 *   5. Domain pattern guess (info@, hello@, contact@) if domain known
 *
 * Run:         node find-contact.js
 * Force retry: node find-contact.js --fresh   (resets all no-email statuses)
 */

'use strict';

const puppeteer = require('puppeteer');
const fs  = require('fs');
const config = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');

const FRESH = process.argv.includes('--fresh');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const SKIP_DOMAINS = new Set([
  'sentry.io','wix.com','example.com','google.com','yelp.com',
  'facebook.com','squarespace.com','wordpress.com','instagram.com',
  'twitter.com','tiktok.com','maps.google','goo.gl','schema.org',
  'w3.org','microsoft.com','apple.com','adobe.com','amazonaws.com',
  'cloudflare.com','godaddy.com','namecheap.com','weebly.com',
]);

const SKIP_EXTS = /\.(png|jpg|jpeg|gif|svg|webp|pdf|zip|css|js)$/i;

function isValidEmail(email) {
  if (!email || email.length > 120) return false;
  const [local, domain] = email.split('@');
  if (!domain || domain.length < 4 || !domain.includes('.')) return false;
  if (SKIP_EXTS.test(domain)) return false;
  const base = domain.toLowerCase();
  for (const skip of SKIP_DOMAINS) if (base.includes(skip)) return false;
  // Skip obvious noise patterns (image filenames, asset paths)
  if (/^\d+x\d+/.test(local)) return false;
  return true;
}

function extractEmails(text) {
  const raw = text.match(EMAIL_RE) || [];
  return [...new Set(raw.filter(isValidEmail))];
}

function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(config.CONTACT_LOG, line);
}

async function safeFetch(page, url, timeout = 12000) {
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    if (!res || res.status() >= 400) return '';
    await new Promise(r => setTimeout(r, 1200));
    return await page.evaluate(() => document.body?.innerText || '');
  } catch {
    return '';
  }
}

// ─── Strategy 1: Google Maps → business website ───────────────────────────────

async function tryBusinessWebsite(page, lead) {
  log(`  [1/website] Looking up Google Maps listing`);
  try {
    const mapUrl = `https://www.google.com/maps/search/${encodeURIComponent(lead.name + ' ' + lead.city)}`;
    await page.goto(mapUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // Click first listing if on results list
    const first = await page.$('div[role="feed"] a[href*="/maps/place/"]');
    if (first) { await first.click(); await new Promise(r => setTimeout(r, 2500)); }

    const website = await page.evaluate(() => {
      const a = document.querySelector(
        'a[data-item-id="authority"], a[aria-label*="website" i], ' +
        'a[jsaction*="website"], a[href]:not([href*="google"]):not([href*="maps"])[data-value="Website"]'
      );
      return a ? a.href : null;
    });

    if (!website) { log(`  [1/website] No website on listing`); return null; }

    const domain = domainFromUrl(website);
    log(`  [1/website] Found website: ${website}`);

    // Try homepage + common contact pages
    for (const suffix of ['', '/contact', '/contact-us', '/about', '/about-us']) {
      const targetUrl = website.replace(/\/$/, '') + suffix;
      log(`  [1/website] Fetching: ${targetUrl}`);
      const text   = await safeFetch(page, targetUrl);
      const emails = extractEmails(text);
      if (emails.length) {
        log(`  [1/website] ✓ Email on ${suffix || 'homepage'}: ${emails[0]}`);
        return { email: emails[0], domain };
      }
    }
    log(`  [1/website] Site found (${domain}) but no email on any page`);
    return { email: null, domain };
  } catch (err) {
    log(`  [1/website] Error: ${err.message}`);
    return null;
  }
}

// ─── Strategy 2: Bing search ─────────────────────────────────────────────────

async function tryBing(page, lead) {
  log(`  [2/bing] Searching Bing`);
  try {
    const q    = encodeURIComponent(`"${lead.name}" ${lead.city} FL email contact`);
    const text = await safeFetch(page, `https://www.bing.com/search?q=${q}`, 15000);

    // Check snippets first (fast path)
    const snippetEmails = extractEmails(text);
    if (snippetEmails.length) {
      log(`  [2/bing] ✓ Found in snippet: ${snippetEmails[0]}`);
      return { email: snippetEmails[0] };
    }

    // Visit up to 5 organic results
    const links = await page.$$eval('li.b_algo h2 a, li.b_algo .b_title a', els =>
      els.slice(0, 5).map(e => e.href)
        .filter(h => h && h.startsWith('http') &&
          !h.includes('bing.com') && !h.includes('google.com') &&
          !h.includes('facebook.com') && !h.includes('yelp.com'))
    ).catch(() => []);

    for (const link of links) {
      log(`  [2/bing] Visiting: ${link.slice(0, 80)}`);
      const pageText = await safeFetch(page, link);
      const emails   = extractEmails(pageText);
      if (emails.length) {
        log(`  [2/bing] ✓ Found: ${emails[0]}`);
        const domain = domainFromUrl(link);
        return { email: emails[0], domain };
      }
      await new Promise(r => setTimeout(r, 600));
    }

    // Also try with just the phone number to find their website
    if (lead.phone) {
      const q2 = encodeURIComponent(`"${lead.phone.replace(/\D/g,'')}" site contact email`);
      const t2 = await safeFetch(page, `https://www.bing.com/search?q=${q2}`, 10000);
      const e2 = extractEmails(t2);
      if (e2.length) { log(`  [2/bing] ✓ Found via phone search: ${e2[0]}`); return { email: e2[0] }; }
    }

    log(`  [2/bing] No email found`);
    return null;
  } catch (err) {
    log(`  [2/bing] Error: ${err.message}`);
    return null;
  }
}

// ─── Strategy 3: Yelp ────────────────────────────────────────────────────────

async function tryYelp(page, lead) {
  log(`  [3/yelp] Searching Yelp`);
  try {
    const q   = encodeURIComponent(lead.name);
    const loc = encodeURIComponent(`${lead.city}, FL`);
    await page.goto(
      `https://www.yelp.com/search?find_desc=${q}&find_loc=${loc}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );
    await new Promise(r => setTimeout(r, 1500));

    // Look for email in results page
    const listText = await page.evaluate(() => document.body?.innerText || '');
    const listEmails = extractEmails(listText);
    if (listEmails.length) { log(`  [3/yelp] ✓ Found on list: ${listEmails[0]}`); return { email: listEmails[0] }; }

    // Try clicking into the first biz page
    const bizLink = await page.$('a[href*="/biz/"]');
    if (bizLink) {
      const href = await page.evaluate(el => el.href, bizLink);
      const bizText = await safeFetch(page, href);
      const bizEmails = extractEmails(bizText);
      if (bizEmails.length) { log(`  [3/yelp] ✓ Found on biz page: ${bizEmails[0]}`); return { email: bizEmails[0] }; }

      // Try their website link on the Yelp biz page
      const externalLink = await page.$('a[href*="biz_website"]').catch(() => null);
      if (externalLink) {
        const extUrl  = await page.evaluate(el => el.href, externalLink);
        const extText = await safeFetch(page, extUrl);
        const extEmails = extractEmails(extText);
        if (extEmails.length) {
          log(`  [3/yelp] ✓ Found via Yelp→website: ${extEmails[0]}`);
          return { email: extEmails[0], domain: domainFromUrl(extUrl) };
        }
      }
    }
    log(`  [3/yelp] No email found`);
    return null;
  } catch (err) {
    log(`  [3/yelp] Error: ${err.message}`);
    return null;
  }
}

// ─── Strategy 4: Facebook ────────────────────────────────────────────────────

async function tryFacebook(page, lead) {
  log(`  [4/facebook] Searching Facebook`);
  try {
    const q    = encodeURIComponent(`${lead.name} ${lead.city}`);
    const text = await safeFetch(
      page, `https://www.facebook.com/search/pages/?q=${q}`, 15000
    );
    const fbEmails = extractEmails(text);
    if (fbEmails.length) { log(`  [4/facebook] ✓ Found: ${fbEmails[0]}`); return { email: fbEmails[0] }; }

    // Try About page of first page result
    const pageLink = await page.$('a[href*="facebook.com/"]:not([href*="search"])').catch(() => null);
    if (pageLink) {
      const base = await page.evaluate(el => el.href, pageLink);
      const aboutUrl = base.replace(/\/$/, '') + '/about';
      const aboutText = await safeFetch(page, aboutUrl);
      const aboutEmails = extractEmails(aboutText);
      if (aboutEmails.length) { log(`  [4/facebook] ✓ Found on About: ${aboutEmails[0]}`); return { email: aboutEmails[0] }; }
    }
    log(`  [4/facebook] No email found`);
    return null;
  } catch (err) {
    log(`  [4/facebook] Error: ${err.message}`);
    return null;
  }
}

// ─── Strategy 5: Domain pattern guess ────────────────────────────────────────

function tryEmailPatterns(domain) {
  if (!domain) return null;
  log(`  [5/pattern] Guessing email for domain: ${domain}`);
  // info@ is the single most common small-business email prefix
  const guess = `info@${domain}`;
  log(`  [5/pattern] Best guess: ${guess} (unverified)`);
  return { email: guess, source: 'pattern-guess' };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function searchForEmail(page, lead) {
  let domain = null;

  const s1 = await tryBusinessWebsite(page, lead);
  if (s1?.email)   return { email: s1.email, source: 'website' };
  if (s1?.domain)  domain = s1.domain;

  const s2 = await tryBing(page, lead);
  if (s2?.email)   return { email: s2.email, source: 'bing' };
  if (s2?.domain && !domain) domain = s2.domain;

  const s3 = await tryYelp(page, lead);
  if (s3?.email)   return { email: s3.email, source: 'yelp' };
  if (s3?.domain && !domain) domain = s3.domain;

  const s4 = await tryFacebook(page, lead);
  if (s4?.email)   return { email: s4.email, source: 'facebook' };

  // Only pattern-guess if we found their actual domain somewhere
  if (domain) return tryEmailPatterns(domain);

  return null;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function findContact() {
  const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);

  // --fresh: clear stale no-email status so all leads get retried
  if (FRESH) {
    let cleared = 0;
    leads.forEach(r => { if (r.status === 'no-email') { r.status = ''; cleared++; } });
    if (cleared) {
      writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
      log(`[find-contact] --fresh: cleared no-email status on ${cleared} leads`);
    }
  }

  const needEmail = leads.filter(
    r => !r.email && r.status !== 'no-email' && r.status !== 'drafted' && r.status !== 'error'
  );

  if (needEmail.length === 0) {
    console.log('[find-contact] No leads need email lookup. Use --fresh to retry no-email leads.');
    return 0;
  }

  log(`[find-contact] Starting — ${needEmail.length} lead(s) to check`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: config.CHROME_PATH,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled',
    ],
  });

  let found = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    for (const lead of needEmail) {
      log(`\n[find-contact] ── ${lead.name} (${lead.city}) ──`);

      const result = await searchForEmail(page, lead);

      if (result) {
        const tag = result.source === 'pattern-guess' ? ' (unverified guess)' : '';
        log(`[find-contact] ✓ ${result.source.toUpperCase()}: ${result.email}${tag}`);
        lead.email = result.email;
        found++;
      } else {
        log(`[find-contact] ✗ No email found after all strategies`);
        lead.status = 'no-email';
      }

      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
    await browser.close();
  }

  writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
  log(`\n[find-contact] Done. ${found}/${needEmail.length} emails found.`);
  return found;
}

module.exports = { findContact };

if (require.main === module) {
  findContact()
    .then(n => console.log(`[find-contact] Done. ${n} emails found.`))
    .catch(console.error);
}

/**
 * SKILL 5 — draft-outreach.js
 *
 * WhatsApp outreach:
 *   • Reads leads.csv — skips rows without phone or demo_url
 *   • Formats US numbers → +1XXXXXXXXXX
 *   • Builds wa.me links with a personalised message
 *   • Saves every link to whatsapp-queue.txt (labelled, timestamped)
 *   • Auto-opens the first 3 links in the default browser
 *
 * Gmail outreach:
 *   • For leads that have an email and a demo_url
 *   • Skips rows already marked drafted/error
 *   • Saves Gmail drafts via Puppeteer (reuses existing Chrome session)
 *   • Marks status = 'drafted' in leads.csv
 */

'use strict';

const puppeteer = require('puppeteer');
const { exec }  = require('child_process');
const fs        = require('fs');
const path      = require('path');
const config    = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');

const WHATSAPP_QUEUE = path.join(__dirname, 'whatsapp-queue.txt');

const WA_MESSAGE_TEMPLATE =
  'Hi! We built a free website preview for {name}. ' +
  'Take a look: {url} — No commitment, completely free. ' +
  "Let us know if you'd like to keep it! — DemoReady.co";

// ─── Phone helpers ─────────────────────────────────────────────────────────────

/** Returns digits only, or null if the number is unusable. */
function normalisePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '1' + digits;   // US local → E.164-ish
  if (digits.length === 11 && digits[0] === '1') return digits;
  if (digits.length > 7)   return digits;           // international — keep as-is
  return null;                                       // too short to be useful
}

function buildWaUrl(phone, name, demoUrl) {
  const msg = WA_MESSAGE_TEMPLATE
    .replace('{name}', name)
    .replace('{url}', demoUrl);
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

// ─── Open a URL in the default browser (Windows) ──────────────────────────────

function openInBrowser(url) {
  // "start" with an empty title string handles URLs that contain special chars
  exec(`start "" "${url}"`);
}

// ─── WhatsApp outreach ─────────────────────────────────────────────────────────

function processWhatsApp(leads) {
  const eligible = leads.filter(r => r.phone && r.demo_url);

  if (eligible.length === 0) {
    console.log('[draft-outreach:wa] No leads with phone + demo_url — skipping.');
    return 0;
  }

  const now    = new Date().toISOString();
  const lines  = [`# DemoReady WhatsApp Queue — ${now}`, ''];
  const toOpen = [];

  eligible.forEach((lead, i) => {
    const phone = normalisePhone(lead.phone);
    if (!phone) {
      console.warn(`[draft-outreach:wa] Skipping ${lead.name} — unrecognised phone: ${lead.phone}`);
      return;
    }

    const url = buildWaUrl(phone, lead.name, lead.demo_url);
    lines.push(`[${i + 1}] ${lead.name} | +${phone}`);
    lines.push(`    ${url}`);
    lines.push('');

    if (toOpen.length < 3) toOpen.push(url);
  });

  fs.writeFileSync(WHATSAPP_QUEUE, lines.join('\n'), 'utf8');
  console.log(`[draft-outreach:wa] Wrote ${eligible.length} link(s) to whatsapp-queue.txt`);

  // Open first 3 in browser with a short delay between each
  toOpen.forEach((url, i) => {
    setTimeout(() => {
      console.log(`[draft-outreach:wa] Opening link ${i + 1}: ${url.slice(0, 80)}...`);
      openInBrowser(url);
    }, i * 1500);
  });

  return eligible.length;
}

// ─── Gmail draft helpers ───────────────────────────────────────────────────────

function buildEmailBody(lead, template) {
  return template
    .replace(/{{business_name}}/g, lead.name)
    .replace(/{{category}}/g,      lead.category)
    .replace(/{{city}}/g,          lead.city)
    .replace(/{{demo_url}}/g,      lead.demo_url)
    .replace(/{{phone}}/g,         lead.phone || '');
}

async function waitFor(page, selector, timeout = 10000) {
  return page.waitForSelector(selector, { visible: true, timeout });
}

async function createGmailDraft(page, lead, template) {
  const subject = `We built ${lead.name} a free website`;
  const body    = buildEmailBody(lead, template);

  // Click "Compose"
  await waitFor(page, '[gh="cm"]', 8000);
  await page.click('[gh="cm"]');
  await new Promise(r => setTimeout(r, 2000));

  // To field
  await waitFor(page, 'textarea[name="to"]', 8000);
  await page.type('textarea[name="to"]', lead.email, { delay: 40 });
  await page.keyboard.press('Tab');
  await new Promise(r => setTimeout(r, 400));

  // Subject
  await page.type('input[name="subjectbox"]', subject, { delay: 30 });
  await new Promise(r => setTimeout(r, 300));

  // Body
  const bodyEl = await waitFor(page, 'div[aria-label*="Message Body" i]', 8000);
  await bodyEl.click();
  await page.keyboard.type(body, { delay: 12 });
  await new Promise(r => setTimeout(r, 500));

  // Escape saves as draft in Gmail
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 1500));
}

// ─── Gmail outreach ────────────────────────────────────────────────────────────

async function processEmail(leads) {
  const template = fs.existsSync(config.EMAIL_TEMPLATE)
    ? fs.readFileSync(config.EMAIL_TEMPLATE, 'utf8')
    : '';

  if (!template) {
    console.warn('[draft-outreach:email] email-template.txt not found — skipping email drafts.');
    return 0;
  }

  const ready = leads.filter(
    r => r.demo_url && r.email && r.status !== 'drafted' && r.status !== 'error'
  );

  if (ready.length === 0) {
    console.log('[draft-outreach:email] No leads ready for email drafting.');
    return 0;
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: config.CHROME_PATH,
    userDataDir:    config.CHROME_USER_DATA_DIR,
    args: [
      `--profile-directory=${config.CHROME_PROFILE}`,
      '--window-position=0,-2000',
      '--window-size=1366,768',
      '--no-sandbox',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });

  let drafted = 0;
  try {
    const page = await browser.newPage();
    await page.goto('https://mail.google.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    if (page.url().includes('accounts.google.com')) {
      console.error('[draft-outreach:email] Gmail not logged in — open Chrome, sign in, then re-run.');
      return 0;
    }

    for (const lead of ready) {
      console.log(`[draft-outreach:email] Drafting: ${lead.name} <${lead.email}>`);
      try {
        await createGmailDraft(page, lead, template);
        lead.status = 'drafted';
        drafted++;
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`[draft-outreach:email]   Error: ${err.message}`);
        lead.status = 'error';
      }
    }
  } finally {
    await browser.close();
  }

  return drafted;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function draftOutreach() {
  const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);

  // WhatsApp (sync — just builds URLs and opens browser tabs)
  const waSent = processWhatsApp(leads);

  // Gmail drafts (async — Puppeteer)
  const emailDrafted = await processEmail(leads);

  // Persist any status changes (drafted / error)
  writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);

  const log = path.join(__dirname, 'contact-log.txt');
  const entry = `[${new Date().toISOString()}] WhatsApp: ${waSent} queued | Email: ${emailDrafted} drafted\n`;
  fs.appendFileSync(log, entry);

  console.log(`[draft-outreach] Done. WhatsApp: ${waSent} | Email drafts: ${emailDrafted}`);
  return { waSent, emailDrafted };
}

module.exports = { draftOutreach };

if (require.main === module) {
  draftOutreach()
    .then(r => console.log(`[draft-outreach] WhatsApp: ${r.waSent} | Email: ${r.emailDrafted}`))
    .catch(console.error);
}

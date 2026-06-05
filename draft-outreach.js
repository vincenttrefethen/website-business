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
const fs        = require('fs');
const path      = require('path');
const config    = require('./config');
const { readCSV, writeCSV }  = require('./csv-utils');
const { getWaTemplate }      = require('./message-templates');

const WHATSAPP_QUEUE = path.join(__dirname, 'whatsapp-queue.txt');

// ─── Phone helpers ─────────────────────────────────────────────────────────────

/**
 * Cleans any phone string into a wa.me-ready digit string (no + needed in URL).
 * Handles:  (305) 555-1234  |  305-555-1234  |  +1 305 555 1234  |  13055551234
 * Returns digits-only string ready to append after wa.me/, or null if unusable.
 */
function normalisePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Strip everything except digits and leading +
  const digits = raw.replace(/[^\d]/g, '');

  if (digits.length === 10) {
    // Standard US local: 3055551234 → 13055551234
    return '1' + digits;
  }
  if (digits.length === 11 && digits[0] === '1') {
    // Already has country code: 13055551234
    return digits;
  }
  if (digits.length > 11) {
    // Some international format — use as-is but warn
    console.warn(`[outreach:phone] Unusual length (${digits.length} digits) for: ${raw}`);
    return digits;
  }

  // Too short to be a real number
  console.warn(`[outreach:phone] Skipping invalid phone (${digits.length} digits): "${raw}"`);
  return null;
}

function buildSmsUrl(phone, text) {
  // sms: scheme opens Windows Phone Link with pre-filled message
  return `sms:+${phone}?body=${encodeURIComponent(text)}`;
}

function buildWaUrl(phone, lead) {
  const { text, version } = getWaTemplate(lead);
  lead._msgVersion = version;
  return {
    smsUrl: buildSmsUrl(phone, text),   // primary — Phone Link on Windows
    waUrl:  `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,  // backup
    version,
    text,
  };
}


// ─── WhatsApp HTML dashboard ──────────────────────────────────────────────────

function buildWaHtml(entries, generatedAt) {
  const count = entries.length;
  const rows  = entries.map((e, i) => `
      <div class="card" id="card-${i}">
        <div class="card-left">
          <div class="biz-name">${e.name}</div>
          <div class="biz-meta">
            <span class="tag">${e.city || '—'}</span>
            <span class="tag tag-cat">${e.category || '—'}</span>
            ${e.rating  ? `<span class="tag tag-gold">⭐ ${e.rating}</span>` : ''}
            ${e.reviews ? `<span class="tag">${e.reviews} reviews</span>` : ''}
          </div>
          <div class="biz-phone">${e.phone}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:.5rem;align-items:flex-end">
          <a class="btn-wa" href="${e.smsUrl}" target="_blank" rel="noopener"
             onclick="markSent(${i})" style="background:#2563eb">
            📱 Send SMS
          </a>
          <a href="${e.waUrl}" target="_blank" rel="noopener"
             style="font-size:.72rem;color:rgba(37,211,102,.7);text-decoration:underline;text-decoration-color:rgba(37,211,102,.3)">
            💬 WhatsApp backup
          </a>
        </div>
      </div>`).join('\n');

  const allUrls = JSON.stringify(entries.map(e => e.smsUrl));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>DemoReady — SMS Outreach (${count} leads)</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#060C1A;color:#fff;min-height:100vh;padding:0 0 60px;
      -webkit-font-smoothing:antialiased;
    }
    :root{
      --gold:#D4AF37;--gold2:#EDD060;--navy2:#0A0F1E;--navy3:#0F1629;
      --green:#25D366;--green2:#1da851;
      --border:rgba(255,255,255,.08);--r:14px;
    }
    /* Header */
    .header{
      background:linear-gradient(to bottom,#0A0F1E,#060C1A);
      border-bottom:1px solid var(--border);
      padding:2.2rem 1.5rem 1.8rem;
    }
    .header-inner{max-width:860px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem}
    .logo{font-size:1.2rem;font-weight:800;letter-spacing:-.03em}
    .logo span{color:var(--gold)}
    .header-right{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
    .count-badge{
      padding:.35rem 1rem;border-radius:99px;
      background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.35);
      font-size:.8rem;font-weight:600;color:var(--gold2);white-space:nowrap;
    }
    .btn-open-all{
      display:inline-flex;align-items:center;gap:.5rem;
      padding:.65rem 1.4rem;border-radius:99px;
      background:#2563eb;color:#fff;
      font-size:.9rem;font-weight:700;border:none;cursor:pointer;
      transition:background .2s,transform .15s;white-space:nowrap;
    }
    .btn-open-all:hover{background:var(--green2);transform:scale(1.04)}
    .btn-open-all:active{transform:scale(.97)}
    .generated{font-size:.72rem;color:rgba(255,255,255,.28);margin-top:.5rem;max-width:860px;margin-left:auto;margin-right:auto;padding:0 1.5rem}
    /* List */
    .list{max-width:860px;margin:2rem auto 0;padding:0 1.5rem;display:flex;flex-direction:column;gap:1rem}
    .card{
      display:flex;align-items:center;justify-content:space-between;gap:1.5rem;
      background:rgba(255,255,255,.04);
      border:1px solid var(--border);border-radius:var(--r);
      padding:1.25rem 1.5rem;
      transition:border-color .2s,background .2s;
      flex-wrap:wrap;
    }
    .card.sent{border-color:rgba(37,211,102,.35);background:rgba(37,211,102,.04)}
    .card-left{flex:1;min-width:0}
    .biz-name{font-size:1.05rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.55rem}
    .biz-meta{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.6rem}
    .tag{
      font-size:.68rem;padding:2px 9px;border-radius:99px;
      background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
      color:rgba(255,255,255,.5);text-transform:capitalize;
    }
    .tag-cat{border-color:rgba(108,142,255,.3);color:#8aabff}
    .tag-gold{border-color:rgba(212,175,55,.35);color:var(--gold2)}
    .biz-phone{font-size:.88rem;color:rgba(255,255,255,.45);font-variant-numeric:tabular-nums}
    /* WhatsApp button */
    .btn-wa{
      display:inline-flex;align-items:center;gap:.55rem;
      padding:.7rem 1.4rem;border-radius:99px;
      background:#2563eb;color:#fff;
      font-size:.88rem;font-weight:700;text-decoration:none;white-space:nowrap;
      transition:background .2s,transform .15s,opacity .2s;flex-shrink:0;
    }
    .btn-wa:hover{background:var(--green2);transform:scale(1.04)}
    .btn-wa:active{transform:scale(.97)}
    .btn-wa.done{background:rgba(37,211,102,.25);color:rgba(37,211,102,.8);pointer-events:none}
    /* Empty state */
    .empty{text-align:center;padding:72px 24px;color:rgba(255,255,255,.3);font-size:1rem}
    @media(max-width:500px){
      .header-inner{flex-direction:column;align-items:flex-start}
      .card{flex-direction:column;align-items:flex-start}
      .btn-wa{width:100%;justify-content:center}
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-inner">
      <div class="logo">Demo<span>Ready</span>.co</div>
      <div class="header-right">
        <div class="count-badge">📱 ${count} lead${count === 1 ? '' : 's'} ready</div>
        ${count > 0 ? `<button class="btn-open-all" onclick="openAll()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.532 5.857L0 24l6.335-1.509A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.368l-.36-.214-3.732.889.917-3.636-.235-.374A9.818 9.818 0 1112 21.818z"/>
          </svg>
          Send All SMS (${count})
        </button>` : ''}
      </div>
    </div>
    <div class="generated">Generated ${generatedAt}</div>
  </header>

  <div class="list">
    ${count === 0
      ? '<div class="empty">No leads with phone numbers yet — run the morning pipeline first.</div>'
      : rows
    }
  </div>

  <script>
    const ALL_URLS = ${allUrls};

    function markSent(i) {
      const card = document.getElementById('card-' + i);
      if (!card) return;
      setTimeout(() => {
        card.classList.add('sent');
        const btn = card.querySelector('.btn-wa');
        if (btn) { btn.classList.add('done'); btn.textContent = '✓ Sent'; }
      }, 800);
    }

    function openAll() {
      ALL_URLS.forEach((url, i) => {
        setTimeout(() => window.open(url, '_blank'), i * 2000);
      });
      // Mark all as sent after they've all opened
      setTimeout(() => {
        ALL_URLS.forEach((_, i) => markSent(i));
      }, ALL_URLS.length * 2000 + 500);
    }
  </script>
</body>
</html>`;
}

// ─── WhatsApp outreach ──────────────────────────────────────────────────────────

function processWhatsApp(leads) {
  const eligible = leads.filter(r => r.phone && r.demo_url);

  if (eligible.length === 0) {
    console.log('[draft-outreach:wa] No leads with phone + demo_url — skipping.');
    return 0;
  }

  const now     = new Date().toISOString();
  const txtLines = [`# DemoReady WhatsApp Queue — ${now}`, ''];
  const entries  = [];

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  eligible.forEach((lead, i) => {
    const phone = normalisePhone(lead.phone);
    if (!phone) {
      console.warn(`[draft-outreach:wa] ✗ INVALID  ${lead.name} — bad phone: "${lead.phone}" → marking skip`);
      lead.status = 'skip'; // bad number — remove from queue permanently
      return;
    }
    const { smsUrl, waUrl, version } = buildWaUrl(phone, lead);
    console.log(`[draft-outreach:wa] ✓ ${lead.name} +${phone} [${version}]`);
    txtLines.push(`[${i + 1}] ${lead.name} | +${phone} | ${version}`);
    txtLines.push(`    SMS: ${smsUrl}`);
    txtLines.push(`    WA:  ${waUrl}`);
    txtLines.push('');
    entries.push({ ...lead, phone: `+${phone}`, smsUrl, waUrl });

    // Record message version — status stays 'new' until user clicks "Mark Sent" in dashboard
    lead.message_version = version;
  });

  // Write plain-text queue file
  fs.writeFileSync(WHATSAPP_QUEUE, txtLines.join('\n'), 'utf8');
  console.log(`[draft-outreach:wa] ${entries.length} WA links written to whatsapp-queue.txt`);
  console.log('[draft-outreach:wa] No tabs auto-opened — use dashboard to send');

  // Write HTML dashboard (for standalone use)
  const htmlPath = path.join(__dirname, 'whatsapp-queue.html');
  const genAt    = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  fs.writeFileSync(htmlPath, buildWaHtml(entries, genAt), 'utf8');
  console.log('[draft-outreach:wa] Wrote whatsapp-queue.html');

  return entries.length;
}

// ─── Gmail draft helpers ───────────────────────────────────────────────────────

function buildEmailBody(lead, template) {
  return template
    .replace(/{{business_name}}/g, lead.name)
    .replace(/{{category}}/g,      lead.category)
    .replace(/{{city}}/g,          lead.city)
    .replace(/{{demo_url}}/g,      lead.demo_url)
    .replace(/{{phone}}/g,         lead.phone        || '')
    .replace(/{{rating}}/g,        lead.rating       || 'highly rated')
    .replace(/{{review_count}}/g,  lead.reviews      || 'many');
}

async function waitFor(page, selector, timeout = 10000) {
  return page.waitForSelector(selector, { visible: true, timeout });
}

async function createGmailDraft(page, lead, template) {
  const subject = `I built ${lead.name} a free website`;
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

  // Use a dedicated Puppeteer profile so it never locks or conflicts with
  // the user's open Chrome windows.
  //
  // First run: Chrome opens visibly at Gmail so you can log in, then close
  // it. The session is saved in .chrome-puppeteer/ and reused from then on.
  const profileDir = config.PUPPETEER_USER_DATA_DIR;
  fs.mkdirSync(profileDir, { recursive: true });

  const isFirstRun = !fs.existsSync(
    path.join(profileDir, config.PUPPETEER_PROFILE, 'Cookies')
  );

  if (isFirstRun) {
    console.log('[draft-outreach:email] First run — Chrome will open so you can sign into Gmail.');
    console.log('[draft-outreach:email] Sign in, then close the browser window to continue.');
  }

  const browser = await puppeteer.launch({
    headless: false,                           // always visible — avoids detection
    executablePath: config.CHROME_PATH,
    userDataDir:    profileDir,                // isolated from your real Chrome
    args: [
      `--profile-directory=${config.PUPPETEER_PROFILE}`,
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-default-apps',
      '--window-size=1366,768',
      // Position off-screen when not first run so it doesn't interrupt work
      ...(isFirstRun ? [] : ['--window-position=0,-2000']),
    ],
    defaultViewport: { width: 1366, height: 768 },
  });

  let drafted = 0;
  try {
    const page = await browser.newPage();
    await page.goto('https://mail.google.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    if (page.url().includes('accounts.google.com')) {
      console.error(
        '[draft-outreach:email] Not logged in to Gmail in the Puppeteer profile.\n' +
        '  Close Chrome, then run:  node draft-outreach.js\n' +
        '  Chrome will open — sign into Gmail — close it — re-run.'
      );
      await browser.close();
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

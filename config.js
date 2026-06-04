const path = require('path');
const os = require('os');

module.exports = {
  // ─── Chrome ───────────────────────────────────────────────────────────────
  CHROME_PATH: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',

  // Dedicated Puppeteer profile — never conflicts with your open Chrome tabs.
  // First run: Chrome opens visibly so you can sign into Gmail, then close it.
  // Every run after that reuses the saved session silently.
  PUPPETEER_USER_DATA_DIR: path.join(__dirname, '.chrome-puppeteer'),
  PUPPETEER_PROFILE: 'Default',

  // Legacy — kept so other scripts that reference it don't break
  CHROME_USER_DATA_DIR: path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
  CHROME_PROFILE: 'Default',

  // ─── GitHub / Vercel ──────────────────────────────────────────────────────
  // Set GITHUB_REPO_PATH to wherever you ran "git init" (can be this folder)
  GITHUB_REPO_PATH: 'C:\\Users\\vintr\\OneDrive\\Documents\\website-business',
  // Base URL after Vercel deploys your repo (update after connecting Vercel)
  VERCEL_BASE_URL: 'https://demoready.co',

  // ─── File paths ───────────────────────────────────────────────────────────
  ROOT: path.join(__dirname),
  SITES_FOLDER:      path.join(__dirname, 'sites'),
  LEADS_CSV:         path.join(__dirname, 'leads.csv'),
  ARCHIVE_CSV:       path.join(__dirname, 'leads-archive.csv'),
  DEPLOY_LOG:        path.join(__dirname, 'deploy-log.txt'),
  CONTACT_LOG:       path.join(__dirname, 'contact-log.txt'),
  MORNING_REPORT:    path.join(__dirname, 'morning-report.txt'),
  EMAIL_TEMPLATE:    path.join(__dirname, 'email-template.txt'),
  WHATSAPP_QUEUE:    path.join(__dirname, 'whatsapp-queue.txt'),
  TARGETS_FILE:      path.join(__dirname, 'targets.json'),
  SITE_TEMPLATE:     path.join(__dirname, 'site-template.html'),
  STATS_LOG:         path.join(__dirname, 'stats-log.csv'),
  CL_LEADS_CSV:      path.join(__dirname, 'craigslist-leads.csv'),
  CL_SEEN_CSV:       path.join(__dirname, 'craigslist-seen.csv'),
  CRM_DATA:          path.join(__dirname, 'crm-data.json'),
  REMINDERS:         path.join(__dirname, 'reminders.json'),
  CL_STATUS:         path.join(__dirname, 'cl-status.json'),
  PIPELINE_STATUS:   path.join(__dirname, 'pipeline-status.json'),

  ROTATION_LOG: path.join(__dirname, 'rotation-log.json'),

  // ─── Behaviour ────────────────────────────────────────────────────────────
  MAX_LEADS_PER_RUN:    100, // hard cap — keep pulling combos until this is hit
  COMBOS_PER_RUN:         5, // parallel combos per batch
  MAX_LEADS_PER_COMBO:   20, // max leads to collect per combo
  MAX_COMBO_BATCHES:     20, // safety ceiling — never run more than this many batches
  VERCEL_DEPLOY_WAIT_MS: 15000,
  PUPPETEER_TIMEOUT:     30000,
  FOLLOWUP_DAYS:          3, // days after "sent" before follow-up is due
  CL_REGIONS_PER_RUN:    10, // Craigslist regions to search each morning
  CL_HOT_SCORE:          10, // score threshold for "Hot Lead 🔥"
  CL_GOOD_SCORE:          7, // score threshold for "Good Lead ⭐"
  CL_SKIP_SCORE:          3, // auto-skip if score <= this
  ARCHIVE_AFTER_DAYS:    30, // move sent/followedup/skip leads older than this to archive

  // ── Status lifecycle ──────────────────────────────────────────────────────
  // new        → just scraped, never touched
  // opened     → WA link opened in dashboard
  // sent       → owner confirmed they sent the message
  // followedup → follow-up message sent
  // connected  → lead replied / owner made contact
  // converted  → paying customer
  // skip       → manually skipped, never show again
  // no-email   → email search exhausted
  // error      → pipeline error

  // CSV column order (keep stable so rows stay aligned)
  CSV_HEADERS: [
    'name', 'category', 'phone', 'address', 'hours',
    'rating', 'reviews', 'city', 'website_found',
    'email', 'demo_url', 'status', 'outreach_date', 'followup_date',
    'message_version', 'crm', 'crm_status', 'revenue', 'source_channel', 'notes',
  ],

  STATS_HEADERS: [
    'date', 'leads_scraped', 'leads_with_phones',
    'wa_opened', 'wa_sent', 'connected', 'followups_sent',
    'combos_used', 'cities_searched', 'categories_searched',
  ],
};

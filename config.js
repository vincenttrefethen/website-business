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

  // ─── Behaviour ────────────────────────────────────────────────────────────
  MAX_LEADS_PER_RUN: 10,
  VERCEL_DEPLOY_WAIT_MS: 15000,
  PUPPETEER_TIMEOUT: 30000,

  // CSV column order (keep stable so rows stay aligned)
  CSV_HEADERS: [
    'name', 'category', 'phone', 'address', 'hours',
    'rating', 'reviews', 'city', 'website_found',
    'email', 'demo_url', 'status', 'outreach_date',
  ],

  FOLLOWUP_DAYS: 3,   // days after outreach before a follow-up is sent
};

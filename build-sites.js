/**
 * SKILL 2 — build-sites.js
 * Generates demo HTML sites, pushes to GitHub, records Vercel URLs.
 * After every build run it also:
 *   • Patches the stats count in the public index.html
 *   • Refreshes the SITES array so demo cards rebuild automatically
 *   • Commits and pushes the updated index.html so Vercel picks it up
 */

'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const config = require('./config');
const { readCSV, writeCSV }       = require('./csv-utils');
const { generateSite, slugify }   = require('./fill-template');
const { generateIndex, updatePublicIndex } = require('./generate-index');

function git(cmd) {
  return execSync(cmd, {
    cwd: config.GITHUB_REPO_PATH,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(config.DEPLOY_LOG, line);
}

async function buildSites() {
  const leads   = readCSV(config.LEADS_CSV, config.CSV_HEADERS);
  const pending = leads.filter(r => !r.demo_url && r.status !== 'error');

  if (pending.length === 0) {
    console.log('[build-sites] No pending sites to build.');
    return 0;
  }

  fs.mkdirSync(config.SITES_FOLDER, { recursive: true });
  let built = 0;

  for (const lead of pending) {
    try {
      log(`Building site for: ${lead.name}`);

      // 1. Generate HTML
      const { slug, outPath } = generateSite(lead);
      log(`  Generated: ${outPath}`);

      // 2. Git commit & push the new demo site
      try {
        git(`git add "sites/${slug}"`);
        git(`git commit -m "Add demo site: ${lead.name.replace(/"/g, '')}"`);
        git(`git push`);
        log(`  Pushed to GitHub`);
      } catch (gitErr) {
        if (!gitErr.message.includes('nothing to commit')) throw gitErr;
        log(`  Git: nothing new to commit`);
      }

      // 3. Wait for Vercel to deploy
      log(`  Waiting ${config.VERCEL_DEPLOY_WAIT_MS / 1000}s for Vercel...`);
      await new Promise(r => setTimeout(r, config.VERCEL_DEPLOY_WAIT_MS));

      // 4. Record the live URL
      lead.demo_url = `${config.VERCEL_BASE_URL}/sites/${slug}/index.html`;
      log(`  Live at: ${lead.demo_url}`);
      built++;
    } catch (err) {
      log(`  ERROR for ${lead.name}: ${err.message}`);
      lead.status = 'error';
    }
  }

  // 5. Persist updated CSV
  writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);

  // 6. Regenerate internal dashboard
  generateIndex();

  // 7. Patch public index.html — update stat count + SITES array
  updatePublicIndex();

  // 8. Commit & push updated index.html so Vercel reflects the new count/cards
  try {
    git(`git add index.html dashboard.html`);
    git(`git commit -m "chore: update site count and demo cards [${built} new]"`);
    git(`git push`);
    log(`[build-sites] Pushed updated index.html to GitHub`);
  } catch (gitErr) {
    if (!gitErr.message.includes('nothing to commit')) {
      log(`[build-sites] Warning — could not push index.html: ${gitErr.message}`);
    }
  }

  log(`[build-sites] Done. ${built} site(s) built.`);
  return built;
}

module.exports = { buildSites };

if (require.main === module) {
  buildSites()
    .then(n => console.log(`[build-sites] Done. ${n} sites built.`))
    .catch(console.error);
}

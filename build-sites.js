/**
 * SKILL 2 — build-sites.js
 * Generates demo HTML sites, pushes to GitHub, records Vercel URLs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');
const { generateSite, slugify } = require('./fill-template');

function git(cmd, cwd) {
  return execSync(cmd, { cwd: cwd || config.GITHUB_REPO_PATH, encoding: 'utf8', stdio: 'pipe' });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(config.DEPLOY_LOG, line);
}

async function buildSites() {
  const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);
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

      // 2. Git commit & push
      try {
        git(`git add sites/${slug}`, config.GITHUB_REPO_PATH);
        git(`git commit -m "Add demo site: ${lead.name.replace(/"/g, '')}"`, config.GITHUB_REPO_PATH);
        git(`git push`, config.GITHUB_REPO_PATH);
        log(`  Pushed to GitHub`);
      } catch (gitErr) {
        // If nothing to commit, that's fine
        if (!gitErr.message.includes('nothing to commit')) {
          throw gitErr;
        }
        log(`  Git: nothing new to commit`);
      }

      // 3. Wait for Vercel to deploy
      log(`  Waiting ${config.VERCEL_DEPLOY_WAIT_MS / 1000}s for Vercel...`);
      await new Promise(r => setTimeout(r, config.VERCEL_DEPLOY_WAIT_MS));

      // 4. Record the live URL
      const demoUrl = `${config.VERCEL_BASE_URL}/sites/${slug}/index.html`;
      lead.demo_url = demoUrl;
      log(`  Live at: ${demoUrl}`);
      built++;
    } catch (err) {
      log(`  ERROR for ${lead.name}: ${err.message}`);
      lead.status = 'error';
    }
  }

  writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
  log(`[build-sites] Done. ${built} sites built.`);
  return built;
}

module.exports = { buildSites };

if (require.main === module) {
  buildSites().then(n => console.log(`[build-sites] Done. ${n} sites built.`)).catch(console.error);
}

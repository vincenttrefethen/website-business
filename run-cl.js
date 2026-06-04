/**
 * run-cl.js — Craigslist monitor launcher
 *
 * Sequence:
 *   1. Check if .chrome-cl/setup-complete.txt exists:
 *        NO  → first-run: open visible Chrome at CL for manual session setup,
 *              wait for user to close it, write flag, exit.
 *        YES → normal run: launch Chrome minimised, wait 3s, run monitor, close Chrome.
 *   2. Puppeteer (craigslist-monitor.js) connects via CDP on port 9222.
 *   3. Kill debug Chrome when done.
 *
 * Run standalone:   node run-cl.js
 * Called by:        scheduled task (craigslist-scheduler.xml)
 *                   server.js SSE endpoint (/api/run?skill=run-cl)
 */

'use strict';

const { spawn } = require('child_process');
const fs     = require('fs');
const path   = require('path');
const config = require('./config');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const SETUP_FLAG = path.join(config.CHROME_CL_DATA_DIR, 'setup-complete.txt');

async function runCL() {
  const clDataDir  = config.CHROME_CL_DATA_DIR;
  fs.mkdirSync(clDataDir, { recursive: true });

  const setupDone = fs.existsSync(SETUP_FLAG);

  if (!setupDone) {
    // ── FIRST RUN: visible Chrome so user can establish CL session ────────────
    console.log('[run-cl] ─── FIRST RUN SETUP ──────────────────────────────────');
    console.log('[run-cl] Chrome will open at craigslist.org.');
    console.log('[run-cl] Browse around for ~10 seconds so CL can set cookies.');
    console.log('[run-cl] Then CLOSE the Chrome window to continue.');
    console.log('[run-cl] This only happens once — all future runs are automatic.');
    console.log('[run-cl] ────────────────────────────────────────────────────────');

    const chrome = spawn(config.CHROME_PATH, [
      '--remote-debugging-port=9222',
      `--user-data-dir=${clDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      '--window-position=100,50',
      'https://craigslist.org',
    ], { stdio: 'ignore', detached: false });

    chrome.on('error', e => console.error('[run-cl] Chrome error:', e.message));

    console.log('[run-cl] Waiting for you to close Chrome...');
    await new Promise(resolve => chrome.on('close', resolve));

    // Write setup flag so next run skips this entirely
    fs.writeFileSync(SETUP_FLAG,
      `Setup completed: ${new Date().toISOString()}\n`, 'utf8');

    console.log('[run-cl] ✓ Setup complete. Run again to start monitoring.');
    return { newLeads: 0, elapsed: '0s', note: 'first-run-setup' };
  }

  // ── NORMAL RUN: launch Chrome minimised in background ─────────────────────
  console.log('[run-cl] Step 1 — Launching Chrome debug instance (background)...');

  const chrome = spawn(config.CHROME_PATH, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${clDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--window-size=1,1',              // near-invisible window
    '--window-position=-32000,-32000', // off-screen — no visual interruption
  ], { stdio: 'ignore', detached: false });

  chrome.on('error', e => console.error('[run-cl] Chrome spawn error:', e.message));

  // ── Step 2: Wait for debug port to be ready ────────────────────────────────
  console.log('[run-cl] Waiting 3s for Chrome debug port to be ready...');
  await sleep(3000);
  console.log('[run-cl] Chrome ready — starting Craigslist monitor...');

  // ── Step 3: Run the monitor ────────────────────────────────────────────────
  let result = { newLeads: 0, elapsed: '0s' };
  try {
    const { monitorCraigslist } = require('./craigslist-monitor');
    result = await monitorCraigslist();
    console.log(`\n[run-cl] Complete — ${result.newLeads} leads found in ${result.elapsed}`);
  } catch (err) {
    console.error('[run-cl] Monitor error:', err.message);
  } finally {
    // ── Step 4: Close debug Chrome ───────────────────────────────────────────
    console.log('[run-cl] Closing debug Chrome...');
    try { chrome.kill('SIGTERM'); } catch {}
    await sleep(800);
  }

  return result;
}

runCL()
  .then(r => {
    if (r?.note === 'first-run-setup') return;
    console.log(`[run-cl] Done. ${r.newLeads} leads.`);
  })
  .catch(err => {
    console.error('[run-cl] Fatal:', err.message);
    process.exit(1);
  });

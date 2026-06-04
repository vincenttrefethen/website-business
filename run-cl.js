/**
 * run-cl.js — Craigslist monitor launcher
 *
 * Sequence:
 *   1. Launch Chrome with --remote-debugging-port=9222 in a dedicated
 *      data directory (.chrome-cl/) so it never conflicts with the user's
 *      open Chrome windows
 *   2. Wait 3 seconds for the debug port to become available
 *   3. Run craigslist-monitor.js (which connects via CDP)
 *   4. Kill the debug Chrome instance when done
 *
 * First run: Chrome opens at craigslist.org — sign in manually once,
 *   then close the window. Future runs are fully automatic.
 *
 * Run standalone:   node run-cl.js
 * Called by:        scheduled task (craigslist-scheduler.xml)
 *                   server.js SSE endpoint (/api/run?skill=run-cl)
 */

'use strict';

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const config = require('./config');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runCL() {
  const clDataDir  = config.CHROME_CL_DATA_DIR;
  const cookiePath = path.join(clDataDir, 'Default', 'Cookies');
  const isFirstRun = !fs.existsSync(cookiePath);

  if (isFirstRun) {
    console.log('[run-cl] ─── FIRST RUN SETUP ─────────────────────────────');
    console.log('[run-cl] Chrome will open at craigslist.org.');
    console.log('[run-cl] Sign into your Craigslist account (if you have one),');
    console.log('[run-cl] then browse around briefly so CL sets session cookies.');
    console.log('[run-cl] Close Chrome when done — future runs are automatic.');
    console.log('[run-cl] ─────────────────────────────────────────────────');
  }

  fs.mkdirSync(clDataDir, { recursive: true });

  // ── Step 1: Launch Chrome debug instance ───────────────────────────────────
  console.log('[run-cl] Step 1 — Launching Chrome with remote debug port 9222...');
  const chromeArgs = [
    '--remote-debugging-port=9222',
    `--user-data-dir=${clDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--window-size=1280,800',
    '--window-position=100,50',
    'https://craigslist.org',          // open CL so cookies are fresh
  ];

  const chrome = spawn(config.CHROME_PATH, chromeArgs, {
    stdio: 'ignore',
    detached: false,
  });

  chrome.on('error', e => console.error('[run-cl] Chrome spawn error:', e.message));

  if (isFirstRun) {
    // Wait for user to sign in and manually close Chrome
    console.log('[run-cl] Waiting for you to close Chrome...');
    await new Promise(resolve => chrome.on('close', resolve));
    console.log('[run-cl] Chrome closed. Session cookies saved. Re-run to start monitoring.');
    return { newLeads: 0, elapsed: '0s', note: 'first-run-setup' };
  }

  // ── Step 2: Wait for debug port ─────────────────────────────────────────────
  console.log('[run-cl] Waiting 3s for Chrome debug port to be ready...');
  await sleep(3000);
  console.log('[run-cl] Chrome ready — starting Craigslist monitor...');

  // ── Step 3: Run the monitor ─────────────────────────────────────────────────
  let result = { newLeads: 0, elapsed: '0s' };
  try {
    const { monitorCraigslist } = require('./craigslist-monitor');
    result = await monitorCraigslist();
    console.log(`\n[run-cl] Complete — ${result.newLeads} leads found in ${result.elapsed}`);
  } catch (err) {
    console.error('[run-cl] Monitor error:', err.message);
  } finally {
    // ── Step 4: Close debug Chrome ───────────────────────────────────────────
    console.log('[run-cl] Closing debug Chrome instance...');
    try { chrome.kill('SIGTERM'); } catch {}
    // Give it a moment to shut down cleanly
    await sleep(1000);
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

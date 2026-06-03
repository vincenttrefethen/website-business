/**
 * rotation.js
 *
 * Manages city + category combination rotation so every morning
 * picks a fresh set of combos and never repeats until exhausted.
 *
 * rotation-log.json shape:
 *   { "used": ["Miami|handyman", "Doral|locksmith", ...] }
 *
 * Flow:
 *   1. Build every possible city × category pair
 *   2. Filter out already-used ones
 *   3. Randomly pick N
 *   4. Add them to used list and save
 *   5. If all exhausted, reset and start fresh
 */

'use strict';

const fs   = require('fs');
const config = require('./config');

function allCombinations(targets) {
  const combos = [];
  for (const city of targets.cities) {
    for (const cat of targets.categories) {
      combos.push(`${city}|${cat}`);
    }
  }
  return combos;
}

function loadLog() {
  try {
    if (fs.existsSync(config.ROTATION_LOG)) {
      return JSON.parse(fs.readFileSync(config.ROTATION_LOG, 'utf8'));
    }
  } catch { /* ignore parse errors */ }
  return { used: [] };
}

function saveLog(log) {
  fs.writeFileSync(config.ROTATION_LOG, JSON.stringify(log, null, 2), 'utf8');
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick `count` combos that haven't been used yet.
 * Returns array of { city, category } objects.
 * Automatically resets when all combos have been exhausted.
 */
function pickCombos(targets, count) {
  const all  = allCombinations(targets);
  const log  = loadLog();
  const used = new Set(log.used);

  let remaining = all.filter(c => !used.has(c));

  if (remaining.length < count) {
    const pct = Math.round((used.size / all.length) * 100);
    console.log(
      `[rotation] All ${all.length} combinations used (${pct}%) — resetting rotation log`
    );
    log.used = [];
    saveLog(log);
    remaining = [...all];
  }

  shuffle(remaining);
  const picked = remaining.slice(0, count);

  log.used = [...log.used, ...picked];
  saveLog(log);

  const progress = Math.round((log.used.length / all.length) * 100);
  console.log(
    `[rotation] Picked ${picked.length} combos | ` +
    `${log.used.length}/${all.length} used (${progress}%)`
  );

  return picked.map(key => {
    const [city, category] = key.split('|');
    return { city, category };
  });
}

function rotationStats(targets) {
  const all = allCombinations(targets);
  const log = loadLog();
  return {
    total:     all.length,
    used:      log.used.length,
    remaining: all.length - log.used.length,
    daysLeft:  Math.floor((all.length - log.used.length) / config.COMBOS_PER_RUN),
  };
}

module.exports = { pickCombos, rotationStats };

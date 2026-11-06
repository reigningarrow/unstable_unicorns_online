'use strict';
/**
 * art.js — automatic card artwork from a folder.
 *
 * Drop images into the project's `art/` folder (or wherever ART_DIR points) and every card whose
 * name matches a file gets that picture automatically — no importing, nothing stored in the
 * browser. Subfolders are fine (e.g. art/dragons/…), so artwork can be organised however you like.
 *
 * Matching is forgiving about punctuation, case and common file-naming habits:
 *     "Alluring Narwhal.png"           → Alluring Narwhal
 *     "neigh_m_lord.jpg"               → Neigh, M'Lord
 *     "Baby Unicorn (Red).webp"        → Baby Unicorn (Red)
 *     "001 - Baby Unicorn (Pink).png"  → Baby Unicorn (Pink)      (leading index number)
 *     "Dragon's Blessing@2x.png"       → Dragon's Blessing        (trailing @2x / front / art ...)
 * An exact (normalised) name always beats a loose one, regardless of the order files are found in.
 */
const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg']);
const MAX_DEPTH = 4;
const MAX_FILES = 5000;

// Lower-case, punctuation → spaces, whitespace collapsed. "Neigh, M'Lord" and "neigh_m_lord" agree.
function normalizeText(s) {
  return String(s)
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Candidate lookup keys for a file name, best first: the exact normalised name, then progressively
// looser readings (index prefix removed, trailing descriptors removed, trailing counter removed).
function candidateKeys(baseName) {
  const keys = [];
  const add = k => { if (k && !keys.includes(k)) keys.push(k); };
  let k = normalizeText(baseName);
  add(k);
  k = k.replace(/^\d+\s+/, '');                                   // "001 narwhal unicorn"
  add(k);
  let prev;
  do {                                                            // "... front", "... 2x", "... art"
    prev = k;
    k = k.replace(/\s+(front|back|art|artwork|card|image|img|illustration|full|hd|\dx)$/, '');
  } while (k !== prev);
  add(k);
  add(k.replace(/\s+\d+$/, ''));                                  // "narwhal unicorn 2"
  return keys;
}

function walk(root) {
  const out = [];
  const visit = (dir, rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      const relPath = rel ? path.posix.join(rel, e.name) : e.name;
      if (e.isDirectory()) { if (depth < MAX_DEPTH) visit(full, relPath, depth + 1); continue; }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      let mtime = 0;
      try { mtime = Math.floor(fs.statSync(full).mtimeMs); } catch { /* ignore */ }
      out.push({ rel: relPath, base: path.basename(e.name, path.extname(e.name)), mtime });
    }
  };
  visit(root, '', 0);
  return out;
}

// The file name we tell people to use for a card: its own name, minus the characters no file system
// allows. Matching is forgiving (case, punctuation, extension all ignored), but this is the one
// spelling that is guaranteed to work, so it's what the Art Manager shows for cards with no art.
function expectedFileName(cardName) {
  const base = String(cardName).replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim();
  return (base || 'card') + '.png';
}

// Cards that ended up with no art, each with the file name to use and — to help spot a typo — up to
// two unmatched files in the folder that share enough words with the card name to be a near miss.
function buildMissing(cards, haveArt, unmatchedFiles) {
  const tok = s => new Set(normalizeText(s).split(' ').filter(Boolean));
  const unmatchedToks = unmatchedFiles.map(rel => ({ rel, t: tok(path.basename(rel, path.extname(rel))) }));
  const out = [];
  for (const c of cards) {
    if (haveArt.has(c.name)) continue;
    const ct = tok(c.name);
    const near = [];
    for (const u of unmatchedToks) {
      let inter = 0; for (const w of u.t) if (ct.has(w)) inter++;
      const union = new Set([...u.t, ...ct]).size;
      const score = union ? inter / union : 0;
      if (inter >= 1 && score >= 0.4) near.push({ rel: u.rel, score });
    }
    near.sort((a, b) => b.score - a.score);
    out.push({ name: c.name, expansion: c.expansion || null, expected: expectedFileName(c.name), nearMiss: near.slice(0, 2).map(n => n.rel) });
  }
  return out;
}

/**
 * Scan `artDir` and match images against `cardNames` (strings, or {name, expansion} objects).
 * Returns { art: { [cardName]: url }, matched, totalCards, unmatched: [file], duplicates: [{card, used, ignored}],
 *           missing: [{name, expansion, expected, nearMiss: [file]}], folderFound }
 */
function buildManifest(artDir, cardNames, { urlPrefix = '/art' } = {}) {
  const byKey = new Map();   // normalised name -> { name, expansion }
  for (const c of cardNames) {
    const entry = typeof c === 'string' ? { name: c } : c;
    const k = normalizeText(entry.name); if (!byKey.has(k)) byKey.set(k, entry);
  }
  const cards = [...byKey.values()];

  const result = { art: {}, matched: 0, totalCards: byKey.size, unmatched: [], duplicates: [], missing: [], folderFound: false };
  try { result.folderFound = fs.statSync(artDir).isDirectory(); } catch { result.missing = buildMissing(cards, new Set(), []); return result; }
  if (!result.folderFound) { result.missing = buildMissing(cards, new Set(), []); return result; }

  const best = new Map(); // card name -> { tier, file, others: [] }
  for (const file of walk(artDir)) {
    const keys = candidateKeys(file.base);
    let hit = null;
    for (let tier = 0; tier < keys.length && !hit; tier++) {
      const card = byKey.get(keys[tier])?.name;
      if (card) hit = { card, tier };
    }
    if (!hit) { result.unmatched.push(file.rel); continue; }
    const cur = best.get(hit.card);
    if (!cur) best.set(hit.card, { tier: hit.tier, file, others: [] });
    else if (hit.tier < cur.tier) { cur.others.push(cur.file.rel); cur.tier = hit.tier; cur.file = file; }
    else cur.others.push(file.rel);   // equal or worse tier: the earlier (sorted) path wins
  }

  for (const [card, { file, others }] of best) {
    const url = urlPrefix + '/' + file.rel.split('/').map(encodeURIComponent).join('/') + '?v=' + file.mtime;
    result.art[card] = url;
    if (others.length) result.duplicates.push({ card, used: file.rel, ignored: others });
  }
  result.matched = best.size;
  result.missing = buildMissing(cards, new Set(best.keys()), result.unmatched);
  return result;
}

module.exports = { buildManifest, normalizeText, candidateKeys, expectedFileName, IMAGE_EXT };

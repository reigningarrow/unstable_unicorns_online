'use strict';
/**
 * test_art_folder.js — automatic artwork: every card with a matching file in the art folder gets it.
 * Run: node test_art_folder.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildManifest, normalizeText, expectedFileName } = require('./art');
const { createDeck } = require('./cards');
const { EXPANSIONS } = require('./expansions');

let passed = 0, failed = 0;
const pass = l => { console.log(`✅ ${l}`); passed++; };
const fail = (l, d) => { console.log(`❌ ${l} — ${d}`); failed++; process.exitCode = 1; };
const check = (cond, label, detail = '') => cond ? pass(label) : fail(label, detail);

const names = [...new Set([...createDeck(), ...Object.values(EXPANSIONS).flatMap(e => e.cards())].map(c => c.name))];

function tmpArt(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-art-'));
  for (const f of files) {
    const full = path.join(dir, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
  }
  return dir;
}

console.log('\n── Automatic artwork folder ──');

{ // the naming styles people actually use
  const dir = tmpArt([
    'Alluring Narwhal.png',
    'neigh_m_lord.jpg',
    'Baby Unicorn (Red).webp',
    '001 - Baby Unicorn (Pink).png',
    'Rainbow Aura@2x.png',
    "dragons/Dragon's Blessing.png",
    'notes.txt',
    'Not A Real Card.png',
    '.hidden.png',
  ]);
  const m = buildManifest(dir, names);
  check(m.folderFound, 'folder is found');
  check(m.art['Alluring Narwhal']?.startsWith('/art/Alluring%20Narwhal.png'), 'plain name matches', m.art['Alluring Narwhal']);
  check(!!m.art["Neigh, M'Lord"], "punctuation-free name matches \"Neigh, M'Lord\"", Object.keys(m.art).join('|'));
  check(!!m.art['Baby Unicorn (Red)'], 'brackets in the filename match', '');
  check(!!m.art['Baby Unicorn (Pink)'], 'a leading index number ("001 - ") is ignored', '');
  check(!!m.art['Rainbow Aura'], 'a trailing @2x is ignored', '');
  check(m.art["Dragon's Blessing"]?.includes('/art/dragons/'), 'subfolders are searched', m.art["Dragon's Blessing"]);
  check(m.unmatched.length === 1 && m.unmatched[0] === 'Not A Real Card.png', 'only the genuinely unmatched IMAGE is reported (not .txt / dotfiles)', JSON.stringify(m.unmatched));
  check(m.matched === 6, 'matched count is right', String(m.matched));
  fs.rmSync(dir, { recursive: true });
}

{ // an exact name beats a loose one no matter what order files are discovered in
  const dir = tmpArt(['aaa/Classy Narwhal front.png', 'zzz/Classy Narwhal.png']);
  const m = buildManifest(dir, names);
  check(m.art['Classy Narwhal']?.includes('zzz'), 'exact match beats a looser one even if the loose file sorts first', m.art['Classy Narwhal']);
  check(m.duplicates.length === 1 && m.duplicates[0].ignored.length === 1, 'the ignored duplicate is reported', JSON.stringify(m.duplicates));
  fs.rmSync(dir, { recursive: true });
}

{ // two files for the same card: deterministic, and reported
  const dir = tmpArt(['Neigh.png', 'neigh.jpg']);
  const a = buildManifest(dir, names), b = buildManifest(dir, names);
  check(JSON.stringify(a.art) === JSON.stringify(b.art) && a.duplicates.length === 1, 'duplicate files resolve deterministically and are reported');
  fs.rmSync(dir, { recursive: true });
}

{ // missing folder is not an error
  const m = buildManifest(path.join(os.tmpdir(), 'uu-art-does-not-exist-' + Date.now()), names);
  check(m.folderFound === false && Object.keys(m.art).length === 0, 'a missing art folder just means no art');
}

{ // every REAL card is found from a file named after it with ALL punctuation turned into underscores
  const files = names.map(n => n.replace(/[^A-Za-z0-9]+/g, '_') + '.png');
  const dir = tmpArt([...new Set(files)]);
  const m = buildManifest(dir, names);
  const missing = names.filter(n => !m.art[n]);
  check(missing.length === 0, `all ${names.length} real card names are found from punctuation-mangled filenames`, missing.slice(0, 8).join(' | '));
  fs.rmSync(dir, { recursive: true });
}

{ // and from the exact card name too (what most people will do)
  const files = names.map(n => n.replace(/[\\/:*?"<>|]/g, '') + '.jpg');   // only characters a filesystem forbids removed
  const dir = tmpArt([...new Set(files)]);
  const m = buildManifest(dir, names);
  const missing = names.filter(n => !m.art[n]);
  check(missing.length === 0, 'all real card names are found from their exact names as filenames', missing.slice(0, 8).join(' | '));
  fs.rmSync(dir, { recursive: true });
}

check(normalizeText("Neigh, M'Lord") === normalizeText('neigh_m_lord'), 'normalisation agrees between card names and file names');

console.log('\n── Cards with no art are reported (for troubleshooting) ──');
{ // missing = every card without art, each with the file name to use; near-miss files are suggested
  const dir = tmpArt(['Alluring Narwhal.png', 'Rainbow Aura Upgrade.png', 'random notes.png']);
  const m = buildManifest(dir, [{ name:'Alluring Narwhal', expansion:'base' }, { name:'Rainbow Aura', expansion:'base' }, { name:"Neigh, M'Lord", expansion:'x' }]);
  const names2 = m.missing.map(x => x.name).sort();
  check(JSON.stringify(names2) === JSON.stringify(["Neigh, M'Lord", 'Rainbow Aura']), 'missing lists exactly the cards without art', JSON.stringify(names2));
  const aura = m.missing.find(x => x.name === 'Rainbow Aura');
  check(aura?.expected === 'Rainbow Aura.png', 'each missing card shows the file name to use', aura?.expected);
  check(m.missing.find(x => x.name === "Neigh, M'Lord")?.expected === "Neigh, M'Lord.png", 'punctuation that file systems allow is kept in the expected name');
  check(JSON.stringify(aura?.nearMiss) === JSON.stringify(['Rainbow Aura Upgrade.png']), 'a near-miss file in the folder is suggested', JSON.stringify(aura?.nearMiss));
  check(m.missing.find(x => x.name === "Neigh, M'Lord")?.nearMiss.length === 0, 'unrelated files are not suggested');
  check(aura?.expansion === 'base', 'expansion is carried through');
  check(m.matched + m.missing.length === m.totalCards, 'matched + missing = total cards', `${m.matched}+${m.missing.length} vs ${m.totalCards}`);
  fs.rmSync(dir, { recursive: true });
}
{ const m = buildManifest('/definitely/not/a/folder', ['A One', 'B Two']);
  check(!m.folderFound && m.missing.length === 2, 'no art folder at all → every card is listed as missing', JSON.stringify(m.missing)); }
{ const dir = tmpArt([]);
  const all = buildManifest(dir, names);
  const files = all.missing.map(x => x.expected);
  const roundtrip = tmpArt(files);   // dropping a file called exactly what we told the user to call it...
  const m = buildManifest(roundtrip, names);
  check(m.missing.length === 0, 'following the "expected" file names for every real card gives full coverage', m.missing.slice(0, 5).map(x => x.name).join(' | '));
  check(expectedFileName('What?!/ Unicorn: 2') === 'What! Unicorn 2.png', 'characters no file system allows are stripped from the expected name', expectedFileName('What?!/ Unicorn: 2'));
  fs.rmSync(dir, { recursive: true }); fs.rmSync(roundtrip, { recursive: true }); }

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) console.log('Fix the ❌ failures above.');

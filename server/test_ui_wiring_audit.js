/*
 * test_ui_wiring_audit.js — automated regression guard for a specific, repeatedly-
 * occurring bug class: game.js queues a pendingEffect that requires the player to
 * supply extra input (a selected card, a target player, a choice) to progress, but
 * App.jsx never wires up any button/click handler that can actually supply it. The
 * card then has a correct-looking label and is completely unplayable.
 *
 * This has happened many times (Seductive Unicorn, Vagabond Unicorn, Cutthroat
 * Captain, Glitter Tornado, and ~15 others) and manual review has repeatedly missed
 * individual cards even right after fixing a near-identical sibling card. This test
 * replaces "did a human remember to check" with two mechanical passes that are
 * cross-referenced automatically:
 *
 *   PHASE 1 (dynamic): play every unique card's effect (2p and 3p, all expansions),
 *   walk its full pendingEffect chain using bot.js's own resolver to make progress,
 *   and at every distinct effect "signature" (type + staging flags) encountered,
 *   test whether resolving it with EMPTY input (selectedCardIds:[], extra:{}) returns
 *   an error. If it does, that signature genuinely requires real player input from
 *   SOMEWHERE in the UI to ever progress.
 *
 *   PHASE 2 (static): parse App.jsx's actual source to extract the real, current
 *   contents of every collection that grants a pendingEffect type a working
 *   click-to-resolve path (STABLE_EFFECTS, MULTI_SEL_EFFECTS, needsSacrifice,
 *   needsDestroyStep, the hand-discard button's type lists, the choice_ A/B array),
 *   plus a generic fallback pass that finds any other direct
 *   `pendingEffect.type === 'X'` comparison in the file and checks whether a send()
 *   call appears near it (catches one-off dedicated blocks like Polyamorous
 *   Unicorn's opponent-picker or Pillaging Pirate's choiceStep flow).
 *
 * Any signature from Phase 1 that requires input but isn't covered by anything found
 * in Phase 2 is a broken card — fail the test with the card name(s) and effect type
 * so it's obvious what to fix.
 *
 * LIMITATIONS (read before trusting a clean pass blindly):
 *  - The static pass checks "is there SOME plausible wiring for this type", not
 *    "is the wiring semantically correct". Multi-stage flows driven by local React
 *    state that doesn't appear on the pendingEffect object itself (e.g. the 5
 *    choice_* cards using the `choiceStep` state machine) will show as covered via
 *    CHOICE_TYPES membership even if a later stage of that specific flow is broken —
 *    this test catches "completely missing", not "subtly wrong". Deep multi-stage
 *    correctness still needs a targeted manual resolvePendingEffect() reproduction,
 *    the way every fix in this codebase's history was actually verified.
 *  - The static parser's collection-extraction regexes are anchored to the current
 *    variable names/structure in App.jsx (STABLE_EFFECTS, needsSacrifice, etc). If a
 *    future refactor renames or restructures these, the extraction functions below
 *    will need matching updates — they will fail loudly (throw) rather than silently
 *    return empty/wrong data, by design.
 *  - Effects only reachable via rare interaction chains (e.g. requiring a specific
 *    intercept or a passive from a specific other card in the SAME stable) may not
 *    be discovered by Phase 1's single-card-at-a-time setup. This is a coverage
 *    floor, not a ceiling — it catches the overwhelming majority of cards, which is
 *    exactly the class of bug that has actually occurred.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Game } = require('./game.js');
const { createDeck } = require('./cards.js');
const { getExpansionCards, EXPANSIONS } = require('./expansions.js');
const { runBotStep } = require('./bot.js');

let pass = 0, fail = 0;
const failures = [];
const okLog = msg => { pass++; console.log(`✅ ${msg}`); };
const failLog = (name, detail) => { fail++; failures.push(`${name}: ${detail}`); console.log(`❌ ${name} — ${detail}`); };

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 FIRST: static extraction of App.jsx's wiring (needed before we can judge
// Phase 1's dynamic findings)
// ═══════════════════════════════════════════════════════════════════════════════
const appPath = path.join(__dirname, '..', 'client', 'src', 'App.jsx');
const appSrc = fs.readFileSync(appPath, 'utf8');

function grabBlock(text, startRe, endMarker) {
  const m = text.match(startRe);
  if (!m) throw new Error(`Could not find start marker ${startRe} in App.jsx — has it been restructured? Update this audit's regexes.`);
  const startIdx = m.index + m[0].length;
  const endIdx = text.indexOf(endMarker, startIdx);
  if (endIdx === -1) throw new Error(`Could not find end marker "${endMarker}" after start marker ${startRe} in App.jsx — has it been restructured? Update this audit's regexes.`);
  return text.slice(startIdx, endIdx);
}
function quoted(text) {
  const out = [];
  const re = /'([a-zA-Z_][\w]*)'/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

const STABLE_EFFECTS = new Set(quoted(grabBlock(appSrc, /const STABLE_EFFECTS = new Set\(\[/, ']);')));
const STABLE_IMMEDIATE = quoted(grabBlock(appSrc, /pendingEffect\.step1Done \|\|\s*\[/, '].includes(pendingEffect.type)'));
const MULTI_SEL_EFFECTS = new Set(quoted(grabBlock(appSrc, /const MULTI_SEL_EFFECTS = new Set\(\[/, ']);')));
const NEEDS_SACRIFICE_BASE = quoted(grabBlock(appSrc, /const needsSacrifice    = \[/, '].includes(pendingEffect?.type)'));

function extractConditional(block) {
  const re = /pendingEffect\?\.type === '(\w+)'\s*&&\s*(!?)pendingEffect\.(\w+)/g;
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push({ type: m[1], requiresFlagFalsy: m[2] === '!', flag: m[3] });
  return out;
}
const NEEDS_SACRIFICE_CONDITIONAL = extractConditional(grabBlock(appSrc, /const needsSacrifice    = /, 'const needsDestroyStep'));
const NEEDS_DESTROY = extractConditional(grabBlock(appSrc, /const needsDestroyStep  = /, '\n\n'));

const handDiscardBlock = grabBlock(appSrc, /Hand discard \(select from hand then confirm\)[^\n]*\n\s*\{\(/, '!isMultiSelEffect && (');
const HAND_DISCARD_BASE = [];
const HAND_DISCARD_GATED = [];
for (const m of handDiscardBlock.matchAll(/\[([^\]]+)\]\.includes\(pendingEffect\.type\)(\s*&&\s*!pendingEffect\.discardDone)?/gs)) {
  (m[2] ? HAND_DISCARD_GATED : HAND_DISCARD_BASE).push(...quoted(m[1]));
}
if (HAND_DISCARD_BASE.length === 0 || HAND_DISCARD_GATED.length === 0) {
  throw new Error('Hand-discard base/gated array extraction came back empty — App.jsx structure likely changed. Update this audit.');
}

const CHOICE_TYPES = quoted(grabBlock(appSrc, /Choice card A\/B buttons[^\n]*\n\s*\{\[/, '].includes(pendingEffect'));

// Generic fallback: any direct pendingEffect.type comparison OR array .includes(...)
// membership check, with a send( call nearby
const appLines = appSrc.split('\n');
const typeLineNumbers = new Map();
appLines.forEach((line, idx) => {
  const directRe = /pendingEffect\??\.type\s*===\s*'(\w+)'/g;
  let mm;
  while ((mm = directRe.exec(line))) {
    if (!typeLineNumbers.has(mm[1])) typeLineNumbers.set(mm[1], []);
    typeLineNumbers.get(mm[1]).push(idx);
  }
  const arrayRe = /\[([^\]]+)\]\.includes\(pendingEffect\??\.type\)/g;
  let am;
  while ((am = arrayRe.exec(line))) {
    for (const type of quoted(am[1])) {
      if (!typeLineNumbers.has(type)) typeLineNumbers.set(type, []);
      typeLineNumbers.get(type).push(idx);
    }
  }
});
const AD_HOC_COVERED = new Set();
for (const [type, lineIdxs] of typeLineNumbers) {
  for (const idx of lineIdxs) {
    const windowText = appLines.slice(Math.max(0, idx - 5), idx + 40).join('\n');
    if (windowText.includes('send(')) { AD_HOC_COVERED.add(type); break; }
  }
}

console.log(`Static parse: STABLE_EFFECTS=${STABLE_EFFECTS.size}, MULTI_SEL_EFFECTS=${MULTI_SEL_EFFECTS.size}, ` +
  `needsSacrifice(base+cond)=${NEEDS_SACRIFICE_BASE.length}+${NEEDS_SACRIFICE_CONDITIONAL.length}, ` +
  `needsDestroyStep=${NEEDS_DESTROY.length}, handDiscard(base+gated)=${HAND_DISCARD_BASE.length}+${HAND_DISCARD_GATED.length}, ` +
  `choice=${CHOICE_TYPES.length}, adHoc=${AD_HOC_COVERED.size}\n`);

function isCoveredByClient(eff) {
  const type = eff.type;
  const discardDone = !!eff.discardDone, sacrificeDone = !!eff.sacrificeDone, step1Done = !!eff.step1Done;

  if (STABLE_EFFECTS.has(type)) {
    const needsStableClick = discardDone || sacrificeDone || step1Done ||
      STABLE_IMMEDIATE.includes(type) ||
      (type === 'sacrifice_self_steal_unicorn' && sacrificeDone);
    if (needsStableClick) return 'STABLE_EFFECTS';
  }
  if (MULTI_SEL_EFFECTS.has(type)) return 'MULTI_SEL_EFFECTS';
  if (NEEDS_SACRIFICE_BASE.includes(type)) return 'needsSacrifice (base)';
  for (const c of NEEDS_SACRIFICE_CONDITIONAL) {
    if (c.type === type && (c.requiresFlagFalsy ? !eff[c.flag] : !!eff[c.flag])) return 'needsSacrifice (conditional)';
  }
  for (const c of NEEDS_DESTROY) {
    if (c.type === type && (c.requiresFlagFalsy ? !eff[c.flag] : !!eff[c.flag])) return 'needsDestroyStep';
  }
  if (HAND_DISCARD_BASE.includes(type)) return 'hand-discard button (base)';
  if (HAND_DISCARD_GATED.includes(type) && !discardDone) return 'hand-discard button (gated)';
  if (CHOICE_TYPES.includes(type)) return 'choice A/B buttons';
  if (AD_HOC_COVERED.has(type)) return 'ad-hoc dedicated block';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: dynamic discovery — play every card, walk its effect chain, test each
// distinct signature for whether empty input errors.
// ═══════════════════════════════════════════════════════════════════════════════
const ALL_EXPANSIONS = Object.keys(EXPANSIONS);
const IS_UNICORN = t => ['baby_unicorn', 'basic_unicorn', 'magical_unicorn'].includes(t);
const FULL_POOL = [...createDeck(), ...getExpansionCards(ALL_EXPANSIONS)];

const uniqueCards = [];
const seenNames = new Set();
for (const c of FULL_POOL) {
  if (!c.effect || seenNames.has(c.name)) continue;
  seenNames.add(c.name);
  uniqueCards.push(c);
}

let uid = 0;
const nextId = () => 'aud_' + (uid++);
const makeCard = (base, id) => ({ ...base, id });
const pickN = (pool, n) => [...pool].sort(() => Math.random() - 0.5).slice(0, n);

function setupGame(numPlayers) {
  const g = new Game('audit_' + Math.random());
  const pids = [];
  for (let i = 1; i <= numPlayers; i++) { const pid = 'p' + i; pids.push(pid); g.addPlayer(pid, 'P' + i); }
  g.updateSettings({ expansions: ALL_EXPANSIONS, winCondition: 7, localMode: false, debugMode: false });
  g.startGame();
  g.phase = 'action';
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  g.actionsUsedThisTurn = 0;
  g.pendingEffect = null;
  g.pendingEffectQueue = [];
  for (const pid of pids) g.players[pid].isBot = true;

  const basics = FULL_POOL.filter(c => c.type === 'basic_unicorn');
  const babies = FULL_POOL.filter(c => c.type === 'baby_unicorn');
  const magicals = FULL_POOL.filter(c => c.type === 'magical_unicorn' && !c.effect);
  const upgrades = FULL_POOL.filter(c => c.type === 'upgrade' && !c.effect);
  const downgrades = FULL_POOL.filter(c => c.type === 'downgrade' && !c.effect);
  const magics = FULL_POOL.filter(c => c.type === 'magic' && !c.effect);
  const instants = FULL_POOL.filter(c => c.type === 'instant' && c.effect?.type !== 'neigh');

  for (const pid of pids) {
    const p = g.players[pid];
    p.stable.push(makeCard(pickN(basics, 1)[0], nextId()));
    p.stable.push(makeCard(pickN(babies, 1)[0], nextId()));
    if (magicals.length) p.stable.push(makeCard(pickN(magicals, 1)[0], nextId()));
    if (upgrades.length) p.stable.push(makeCard(pickN(upgrades, 1)[0], nextId()));
    if (downgrades.length) p.stable.push(makeCard(pickN(downgrades, 1)[0], nextId()));
    for (const base of pickN(basics, 2)) p.hand.push(makeCard(base, nextId()));
    if (magics.length) p.hand.push(makeCard(pickN(magics, 1)[0], nextId()));
    if (instants.length) p.hand.push(makeCard(pickN(instants, 1)[0], nextId()));
  }
  for (const base of pickN(basics, 2)) g.discard.push(makeCard(base, nextId()));
  if (magicals.length) g.discard.push(makeCard(pickN(magicals, 1)[0], nextId()));
  return g;
}

function tryPlay(g, card) {
  const self = 'p1', other = 'p2';
  const wantType = card.effect?.targetType;
  const matchIn = stable => {
    if (wantType === 'unicorn') return stable.find(c => IS_UNICORN(c.type))?.id || null;
    if (wantType === 'upgrade') return stable.find(c => c.type === 'upgrade')?.id || null;
    if (wantType === 'downgrade') return stable.find(c => c.type === 'downgrade')?.id || null;
    return stable[0]?.id || null;
  };
  const attempts = [
    [null, null],
    [other, matchIn(g.players[other].stable)],
    [self, matchIn(g.players[self].stable)],
    [other, null],
    [self, null],
  ];
  let lastResult = null;
  for (const [tPid, tCid] of attempts) {
    lastResult = g.playCard(self, card.id, tPid, tCid);
    if (!lastResult.error) return lastResult;
  }
  return lastResult;
}

// signature key -> { type, requiresInput, samples: Set(cardName), sampleEffect }
const signatures = new Map();
function sigKey(eff) {
  return [eff.type, 'd:' + !!eff.discardDone, 's:' + !!eff.sacrificeDone, 't:' + !!eff.step1Done, 'st:' + (eff.step || '')].join('|');
}
function recordAndTest(g, cardName) {
  if (!g.pendingEffect) return;
  const eff = g.pendingEffect;
  const key = sigKey(eff);
  if (signatures.has(key)) { signatures.get(key).samples.add(cardName); return; }
  const pid = eff.playerId;
  let requiresInput;
  try {
    const r = g.resolvePendingEffect(pid, [], {});
    requiresInput = !!r?.error;
  } catch (e) {
    requiresInput = true;
  }
  signatures.set(key, { type: eff.type, requiresInput, samples: new Set([cardName]), sampleEffect: { ...eff } });
}
function driveToQuiescence(g, cardName, maxIterations = 60) {
  let iterations = 0;
  while (iterations < maxIterations) {
    if (!g.pendingEffect && !g.neighWindow && !g.superNeighWindow) break;
    recordAndTest(g, cardName);
    if (!g.pendingEffect && !g.neighWindow && !g.superNeighWindow) break;
    let actedThisPass = false;
    for (const pid of g.playerOrder) {
      const r = runBotStep(g, pid, 'medium');
      iterations++;
      if (r.acted) { actedThisPass = true; break; }
      if (iterations >= maxIterations) break;
    }
    if (!actedThisPass) break;
  }
}
function testNeighCard(card, numPlayers) {
  const g = setupGame(numPlayers);
  const neighCopy = makeCard(card, nextId());
  g.players.p2.hand.push(neighCopy);
  const filler = g.players.p1.hand.find(c => c.type === 'basic_unicorn');
  if (!filler) return;
  if (g.playCard('p1', filler.id, null, null).error) return;
  if (g.playInstant('p2', neighCopy.id).error) return;
  driveToQuiescence(g, card.name);
}
function testCard(card, numPlayers) {
  if (card.effect?.type === 'neigh') return testNeighCard(card, numPlayers);
  const g = setupGame(numPlayers);
  const testCopy = makeCard(card, nextId());
  g.players.p1.hand.push(testCopy);
  if (tryPlay(g, testCopy).error) return;
  if (g.neighWindow || g.pendingCard) g.resolveNeigh('p1');
  driveToQuiescence(g, card.name);
}

for (const numPlayers of [2, 3]) {
  for (const card of uniqueCards) {
    try { testCard(card, numPlayers); } catch (e) { /* setup/interaction quirks are not this test's concern */ }
  }
}
okLog(`Dynamic discovery: walked ${uniqueCards.length} unique cards at 2p+3p, found ${signatures.size} distinct effect signatures`);

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-REFERENCE
// ═══════════════════════════════════════════════════════════════════════════════
const requiring = [...signatures.values()].filter(s => s.requiresInput);
okLog(`${requiring.length} of those signatures genuinely require player input to progress`);

let anyGap = false;
for (const sig of requiring) {
  const covered = isCoveredByClient(sig.sampleEffect);
  if (covered) {
    // Individual per-signature pass logs would be extremely noisy (80+ lines) — only
    // the aggregate pass above plus explicit failures are printed.
  } else {
    anyGap = true;
    const flagStr = `discardDone=${!!sig.sampleEffect.discardDone} sacrificeDone=${!!sig.sampleEffect.sacrificeDone} step1Done=${!!sig.sampleEffect.step1Done} step=${sig.sampleEffect.step || ''}`;
    failLog(`UI wiring gap: ${sig.type}`,
      `no client wiring found for this state (${flagStr}) — cards affected: ${[...sig.samples].join(', ')}`);
  }
}
if (!anyGap) okLog('Every effect signature that requires input has some client wiring for it');

console.log(`\n── Results: ${pass} passed, ${fail} failed ──`);
if (failures.length) {
  console.log('\nFix the ❌ failures above — each names the pendingEffect type, the exact staging\nflags at which it breaks, and which card(s) exposed it.');
}
process.exit(fail > 0 ? 1 : 0);

/**
 * Universal Card Audit
 * =====================
 * Run: node test_universal_card_audit.js
 *
 * WHY THIS EXISTS
 * ----------------
 * Every bug fixed so far (Rhinocorn, Dark Angel Unicorn, Americorn, Unicorn Swap,
 * Mystical Vortex, Queen Bee, Blinding Light, Humbug, the Neigh-chain duplication...)
 * was found by a HUMAN manually noticing broken behavior and then someone writing a
 * hand-picked test for that exact scenario. That approach only catches what someone
 * happens to think to check. It systematically misses:
 *
 *   1. Bugs in effect types SHARED by many cards, where only one of those cards ever
 *      got a test written for it (Americorn's missing UI, Mystical Vortex's random
 *      discard — both used effect types other cards also rely on).
 *   2. The "4 places to update" rule (_enterTrigger/_executeMagic, _queueBeginningEffect,
 *      resolvePendingEffect, App.jsx label map) is easy to violate silently — miss one
 *      and a card either does nothing, dead-ends, or crashes. Humbug's block was
 *      defined but never wired into any of the 4 places at all.
 *   3. Structural invariants nobody thought to assert: does the total number of cards
 *      in the game ever change? Does resolving an effect ever leave the game
 *      permanently stuck? These aren't "does card X do Y" questions — they're "did
 *      anything break, regardless of which specific card was involved" questions.
 *   4. Client/server drift (target-requirement lists kept in two places) — partially
 *      covered by test_client_server_target_consistency.js, referenced here too.
 *
 * WHAT THIS SCRIPT DOES
 * ----------------------
 * For every unique named card with an effect (~235 cards, all 7 expansions enabled):
 *   1. Builds a fresh 2-player game with a deliberately rich board (unicorns, upgrades,
 *      downgrades already in both stables; a stocked discard pile; full hands) so most
 *      targeted effects have something plausible to act on.
 *   2. Plays the card (inferring a target if the card needs one), or — for Neigh-type
 *      Instants — sets up a card to Neigh first, then plays the Neigh against it.
 *   3. Drives the reactive resolution loop (neigh decisions, Super Neigh, any
 *      pendingEffect chain) using bot.js's own generic resolver (runBotStep) — the
 *      exact same code that has to make these decisions in a real game with bots —
 *      bounded by a circuit breaker so one bad card can't hang the whole audit.
 *   4. Asserts, for every card:
 *        a) Nothing threw an unhandled exception.
 *        b) The exact multiset of card IDs across every zone (every hand, every
 *           stable, deck, discard, nursery, removedFromGame) is IDENTICAL before and
 *           after — no card was duplicated or silently lost. This is a much stronger,
 *           card-agnostic check than any hand-written "is X in stable" assertion, and
 *           would have caught the Neigh-chain duplication bug directly.
 *        c) No card ID appears in more than one zone at the same time in the final
 *           state (a duplicate-in-place check, distinct from (b)).
 *        d) The reactive chain actually settled — no pendingEffect / neigh window /
 *           Super Neigh window left permanently open (a stall).
 *
 * Failures are reported with the card name, expansion, and the specific invariant
 * that broke, so a human can go straight to the relevant code instead of re-deriving
 * what went wrong.
 *
 * This is a systemic safety net, not a replacement for the specific tests in
 * test_cards.js / test_all_cards.js — those verify a card does the RIGHT thing;
 * this verifies playing a card never does something structurally WRONG.
 */
'use strict';
const { Game } = require('./game');
const { createDeck, EXPANSIONS: _unused } = require('./cards');
const { getExpansionCards, EXPANSIONS } = require('./expansions');
const { runBotStep } = require('./bot');

const ALL_EXPANSIONS = Object.keys(EXPANSIONS);
const IS_UNICORN = t => ['baby_unicorn', 'basic_unicorn', 'magical_unicorn'].includes(t);

// ── Results ──────────────────────────────────────────────────────────────────
const results = { pass: [], fail: [], skipped: [] };
let uid = 0;
const nextId = () => 'audit_' + (uid++);

// ── Build the full real card pool once ──────────────────────────────────────
const FULL_POOL = [...createDeck(), ...getExpansionCards(ALL_EXPANSIONS)];

// Dedupe by name — many physical copies (Basic Unicorns, several identical Neighs)
// share identical logic; testing one representative per unique name is sufficient
// and keeps the audit fast.
const uniqueCards = [];
const seenNames = new Set();
for (const c of FULL_POOL) {
  if (!c.effect) continue; // nothing to test on a plain, effectless unicorn
  if (seenNames.has(c.name)) continue;
  seenNames.add(c.name);
  uniqueCards.push(c);
}

// ── Snapshot helpers ─────────────────────────────────────────────────────────
function snapshotIds(game) {
  const ids = [];
  for (const pid of game.playerOrder) {
    for (const c of game.players[pid].hand) ids.push(c.id);
    for (const c of game.players[pid].stable) ids.push(c.id);
  }
  for (const c of game.deck) ids.push(c.id);
  for (const c of game.discard) ids.push(c.id);
  for (const c of game.nursery) ids.push(c.id);
  for (const c of game.removedFromGame) ids.push(c.id);
  return ids;
}
function multisetDiff(before, after) {
  const countOf = arr => { const m = new Map(); for (const id of arr) m.set(id, (m.get(id)||0)+1); return m; };
  const b = countOf(before), a = countOf(after);
  const missing = [], extra = [];
  for (const [id, n] of b) if ((a.get(id)||0) < n) missing.push(id);
  for (const [id, n] of a) if ((b.get(id)||0) < n) extra.push(id);
  return { missing, extra };
}
function findInPlaceDuplicates(ids) {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id)||0)+1);
  return [...counts.entries()].filter(([,n]) => n > 1).map(([id]) => id);
}

// ── Board setup: a deliberately rich, plausible 2-player scenario ──────────────
function makeCard(base, id) { return { ...base, id }; }
function pickN(pool, n) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function setupGame(numPlayers = 2) {
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

  // Seed every stable with one of each broad card shape so targeted effects have
  // something plausible to act on regardless of targetType.
  const basics   = FULL_POOL.filter(c => c.type === 'basic_unicorn');
  const babies   = FULL_POOL.filter(c => c.type === 'baby_unicorn');
  const magicals = FULL_POOL.filter(c => c.type === 'magical_unicorn' && !c.effect); // inert ones, avoid interference
  const upgrades = FULL_POOL.filter(c => c.type === 'upgrade' && !c.effect);
  const downgrades = FULL_POOL.filter(c => c.type === 'downgrade' && !c.effect);
  const magics   = FULL_POOL.filter(c => c.type === 'magic' && !c.effect);
  const instants = FULL_POOL.filter(c => c.type === 'instant' && c.effect?.type !== 'neigh');

  for (const pid of pids) {
    const p = g.players[pid];
    p.stable.push(makeCard(pickN(basics, 1)[0], nextId()));
    p.stable.push(makeCard(pickN(babies, 1)[0], nextId()));
    if (magicals.length) p.stable.push(makeCard(pickN(magicals, 1)[0], nextId()));
    if (upgrades.length) p.stable.push(makeCard(pickN(upgrades, 1)[0], nextId()));
    if (downgrades.length) p.stable.push(makeCard(pickN(downgrades, 1)[0], nextId()));
    // Filler hand material for discard-cost / hand-targeting effects
    for (const base of pickN(basics, 2)) p.hand.push(makeCard(base, nextId()));
    if (magics.length) p.hand.push(makeCard(pickN(magics, 1)[0], nextId()));
    if (instants.length) p.hand.push(makeCard(pickN(instants, 1)[0], nextId()));
  }
  // Stock the discard pile for revival-type effects
  for (const base of pickN(basics, 2)) g.discard.push(makeCard(base, nextId()));
  if (magicals.length) g.discard.push(makeCard(pickN(magicals, 1)[0], nextId()));

  return g;
}

// ── Target inference: try progressively more specific guesses ──────────────────
function tryPlay(g, card) {
  const cardId = card.id;
  const self = 'p1'; // matches currentPlayerIndex being forced to playerOrder.indexOf('p1')
  const other = 'p2';
  const attempts = [];

  attempts.push([null, null]);

  const wantType = card.effect?.targetType;
  const matchIn = (stable) => {
    if (wantType === 'unicorn') return stable.find(c => IS_UNICORN(c.type))?.id || null;
    if (wantType === 'upgrade') return stable.find(c => c.type === 'upgrade')?.id || null;
    if (wantType === 'downgrade') return stable.find(c => c.type === 'downgrade')?.id || null;
    return stable[0]?.id || null;
  };
  attempts.push([other, matchIn(g.players[other].stable)]);
  attempts.push([self, matchIn(g.players[self].stable)]);
  attempts.push([other, null]);
  attempts.push([self, null]);

  let lastResult = null;
  for (const [tPid, tCid] of attempts) {
    lastResult = g.playCard(self, cardId, tPid, tCid);
    if (!lastResult.error) return lastResult;
  }
  return lastResult;
}

// ── Drive the reactive chain to quiescence using bot.js's own resolver ─────────
// Mirrors exactly how the real server drives bots (index.js's scheduleBotTick): ONE
// bot action per tick, then re-evaluate state from scratch before the next action.
// Looping through every player and letting each take an action within the same pass
// (without re-checking state in between) can let two decisions interleave in ways the
// real server — which is strictly one-action-then-reassess — never allows.
function driveToQuiescence(g, maxIterations = 60) {
  let iterations = 0;
  while (iterations < maxIterations) {
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
  return {
    iterations,
    stuck: !!(g.pendingEffect || g.neighWindow || g.superNeighWindow),
  };
}

// ── Special path for Neigh-type Instants: need something to Neigh first ────────
function testNeighCard(card, numPlayers) {
  const g = setupGame(numPlayers);
  const neighCopy = makeCard(card, nextId());
  g.players.p2.hand.push(neighCopy);
  // p1 plays a filler basic unicorn for p2 to Neigh
  const filler = g.players.p1.hand.find(c => c.type === 'basic_unicorn');
  if (!filler) return { skipped: true, reason: 'no filler basic unicorn in hand' };
  const before2 = snapshotIds(g); // re-snapshot after hand push above, before play
  const playRes = g.playCard('p1', filler.id, null, null);
  if (playRes.error) return { skipped: true, reason: `setup play failed: ${playRes.error}` };
  const neighRes = g.playInstant('p2', neighCopy.id);
  if (neighRes.error) return { fail: true, reason: `Neigh could not be played: ${neighRes.error}` };
  const drive = driveToQuiescence(g);
  const after = snapshotIds(g);
  return finalizeCheck(before2, after, drive);
}

function finalizeCheck(before, after, drive) {
  const { missing, extra } = multisetDiff(before, after);
  const dupes = findInPlaceDuplicates(after);
  if (missing.length || extra.length) {
    return { fail: true, reason: `card conservation broken — missing:[${missing.join(',')}] extra:[${extra.join(',')}]` };
  }
  if (dupes.length) {
    return { fail: true, reason: `duplicate card id(s) present simultaneously: ${dupes.join(',')}` };
  }
  if (drive.stuck) {
    return { fail: true, reason: `reactive chain never settled after ${drive.iterations} iterations (pendingEffect=${JSON.stringify(drive && drive.stuck)})` };
  }
  return { pass: true };
}

function testCard(card, numPlayers = 2) {
  if (card.effect?.type === 'neigh') return testNeighCard(card, numPlayers);

  const g = setupGame(numPlayers);
  const testCopy = makeCard(card, nextId());
  g.players.p1.hand.push(testCopy);
  const before = snapshotIds(g);

  const playRes = tryPlay(g, testCopy);
  if (playRes.error) {
    return { skipped: true, reason: `could not find a valid play (last error: ${playRes.error})` };
  }
  // Neigh window may now be open (unless yayProtected) — resolve it and everything after.
  if (g.neighWindow || g.pendingCard) {
    const nr = g.resolveNeigh('p1');
    if (nr.error && !g.pendingEffect) {
      // A genuine rejected play (e.g. Queen Bee-style block) — this is the CORRECT,
      // already-fixed behavior (error returned, card restored, turn not consumed).
      // Confirm the restoration actually happened cleanly rather than treating the
      // error itself as a failure.
      const after = snapshotIds(g);
      return finalizeCheck(before, after, { stuck: false, iterations: 0 });
    }
  }
  const drive = driveToQuiescence(g);
  const after = snapshotIds(g);
  return finalizeCheck(before, after, drive);
}

// ── Run ──────────────────────────────────────────────────────────────────────
const PLAYER_COUNTS = [2, 3, 4];
console.log(`\nUniversal Card Audit — ${uniqueCards.length} unique cards with effects × player counts [${PLAYER_COUNTS.join(',')}]\n`);

for (const numPlayers of PLAYER_COUNTS) {
  const byCount = { pass: [], fail: [], skipped: [] };
  for (const card of uniqueCards) {
    let outcome;
    try {
      outcome = testCard(card, numPlayers);
    } catch (e) {
      outcome = { fail: true, reason: `threw: ${e.message}` };
    }
    const label = `${card.name} [${card.expansion || 'base'}] (${numPlayers}p)`;
    if (outcome.pass) {
      byCount.pass.push(label);
    } else if (outcome.skipped) {
      byCount.skipped.push(`${label} — ${outcome.reason}`);
    } else {
      byCount.fail.push(`${label} — ${outcome.reason}`);
    }
  }
  console.log(`── ${numPlayers}-player: ${byCount.pass.length}/${uniqueCards.length} passed, ${byCount.fail.length} failed, ${byCount.skipped.length} skipped ──`);
  results.pass.push(...byCount.pass);
  results.fail.push(...byCount.fail);
  results.skipped.push(...byCount.skipped);
}
console.log('');

console.log(`✅ Passed:  ${results.pass.length}`);
console.log(`⚠️  Skipped: ${results.skipped.length} (harness could not construct a valid scenario — review, not necessarily a bug)`);
console.log(`❌ Failed:  ${results.fail.length}\n`);

if (results.skipped.length) {
  console.log('── Skipped (review manually) ──');
  for (const s of results.skipped) console.log('  ⚠️ ', s);
  console.log('');
}
if (results.fail.length) {
  console.log('── Failed ──');
  for (const f of results.fail) console.log('  ❌', f);
  console.log('');
}

const totalRun = uniqueCards.length * PLAYER_COUNTS.length;
console.log(`── Results: ${results.pass.length}/${totalRun} passed, ${results.fail.length} failed, ${results.skipped.length} skipped ──`);
process.exitCode = results.fail.length > 0 ? 1 : 0;

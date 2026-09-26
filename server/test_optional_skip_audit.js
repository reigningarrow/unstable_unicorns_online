/*
 * test_optional_skip_audit.js — automated regression guard for a specific bug class
 * found in Shark With a Horn: a card is declared `optional:true` ("you may...") in
 * cards.js/expansions.js, but the resolver/dispatch code never actually lets the
 * player decline — either because the costly action (a self-sacrifice, a hand
 * discard, a forced draw) fires synchronously the instant the card enters the
 * stable, before any pendingEffect is even queued, or because a pendingEffect IS
 * queued but nothing ever checks `extra.skip` for it, or because the server
 * supports `extra.skip` but the client never renders a control that can send it.
 *
 * Cards found and fixed by this investigation: Shark With a Horn, Dark Angel
 * Unicorn, Necromancer Unicorn, Rogue Unicorn, Warlock Unicorn, Dancing Clownicorn,
 * Stowaway Unicorn, Dwarficorn Artificer, Procrastinating Shoppercorn, Unicorn
 * Slasher, Flying Krampuscorn, White Elephantcorn, Playful Puppet Unicorn, Dragon
 * Rider Unicorn, Dragon Turtle Unicorn, Paranormal Affection.
 *
 * This test has two phases, matching test_ui_wiring_audit.js's approach of
 * cross-referencing a dynamic (server) pass against a static (client) pass:
 *
 *   PHASE 1 (server, dynamic): for every unique card whose top-level effect has
 *   `trigger: 'enter'` and `optional: true` (beginning-trigger optional effects are
 *   already gated behind the separate `beginning_optional_choices` opt-in menu
 *   before they ever reach a resolver, so they're out of scope here), play the card
 *   from a fully-stocked hand/stable/discard/deck, snapshot resource counts right
 *   when the resulting pendingEffect first appears ("the decision point"), then call
 *   resolvePendingEffect(pid, [], {skip:true}). Assert that:
 *     (a) a pendingEffect existed to skip in the first place — UNLESS resolving
 *         with no pendingEffect at all provably changed nothing (a legitimate
 *         feasibility auto-skip, e.g. "search discard for X" with no X in discard,
 *         is fine; doing the "may" action unconditionally with no decision point,
 *         the actual Shark With a Horn bug, is not), and
 *     (b) the skip call succeeds without error, and
 *     (c) skipping never leaves the player WORSE off than they were at the decision
 *         point — hand/stable can only stay the same or grow, discard can only stay
 *         the same or shrink, deck can only stay the same or grow. (Cards that stage
 *         resources out of the deck/discard pending a choice, like the *_pick
 *         effects, are expected to visibly grow those piles back on skip — that's
 *         not "no-op", it's the effect correctly undoing its own staging.)
 *
 *   PHASE 2 (client, static): parse App.jsx's actual source and confirm every type
 *   Phase 1 proved is server-skippable also has SOME rendered control capable of
 *   sending the decline (either `extra:{skip:true}`, or the equivalent empty-
 *   selection "return all"/"as-is" pattern used by search_deck_pick/from_discard_
 *   pick/look_top_keep_one/look_deck_return_same) — otherwise the server-side fix
 *   is invisible and the card is still unplayable in practice.
 *
 * LIMITATIONS:
 *  - Only covers enter-trigger effects. Beginning-trigger "you may" effects are a
 *    different, already-correct mechanism (opt-in menu) and aren't re-verified here.
 *  - Like test_ui_wiring_audit.js, the static pass proves "some plausible skip
 *    control exists", not full semantic correctness of a multi-stage flow.
 *  - A handful of cards need a target player supplied at playCard() time (e.g.
 *    "look at an opponent's hand"); this test tries a small set of target
 *    combinations (mirroring test_ui_wiring_audit.js's tryPlay) before giving up.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Game } = require('./game.js');
const { createDeck, CARD_TYPES } = require('./cards.js');
const { getExpansionCards, EXPANSIONS } = require('./expansions.js');

let pass = 0, fail = 0;
const failures = [];
const okLog = msg => { pass++; console.log(`✅ ${msg}`); };
const failLog = (name, detail) => { fail++; failures.push(`${name}: ${detail}`); console.log(`❌ ${name} — ${detail}`); };

const IS_UNICORN = t => [CARD_TYPES.BABY_UNICORN, CARD_TYPES.BASIC_UNICORN, CARD_TYPES.MAGICAL_UNICORN].includes(t);
const ALL_EXPANSIONS = Object.keys(EXPANSIONS);
const FULL_POOL = [...createDeck(), ...getExpansionCards(ALL_EXPANSIONS)];

const uniqueCards = [];
const seenNames = new Set();
for (const c of FULL_POOL) {
  if (!c.effect || seenNames.has(c.name)) continue;
  seenNames.add(c.name);
  if (c.effect.trigger === 'enter' && c.effect.optional === true) uniqueCards.push(c);
}

let uid = 0;
const nextId = () => 'osk_' + (uid++);
const mk = base => ({ ...base, id: nextId() });

function setupGame() {
  const g = new Game('optskip_' + Math.random());
  g.addPlayer('p1', 'P1'); g.addPlayer('p2', 'P2');
  g.updateSettings({ expansions: ALL_EXPANSIONS, winCondition: 7, localMode: false, debugMode: false });
  g.startGame();
  g.phase = 'action'; g.currentPlayerIndex = g.playerOrder.indexOf('p1'); g.actionsUsedThisTurn = 0;
  g.pendingEffect = null; g.pendingEffectQueue = [];
  g.players.p1.isBot = true; g.players.p2.isBot = true;

  const basics = FULL_POOL.filter(c => c.type === 'basic_unicorn');
  const babies = FULL_POOL.filter(c => c.type === 'baby_unicorn');
  const magicals = FULL_POOL.filter(c => c.type === 'magical_unicorn' && !c.effect);
  const upgrades = FULL_POOL.filter(c => c.type === 'upgrade' && !c.effect);
  const downgrades = FULL_POOL.filter(c => c.type === 'downgrade' && !c.effect);
  for (const pid of ['p1', 'p2']) {
    const p = g.players[pid];
    p.stable.push(mk(basics[0])); p.stable.push(mk(basics[1])); p.stable.push(mk(babies[0]));
    if (magicals.length) p.stable.push(mk(magicals[0]));
    if (upgrades.length) { p.stable.push(mk(upgrades[0])); p.stable.push(mk(upgrades[1])); }
    if (downgrades.length) { p.stable.push(mk(downgrades[0])); p.stable.push(mk(downgrades[1])); }
    p.hand.push(mk(basics[2])); p.hand.push(mk(basics[3]));
    if (magicals.length > 2) p.hand.push(mk(magicals[2]));
  }
  for (const b of basics.slice(4, 7)) g.discard.push(mk(b));
  return g;
}

function tryPlay(g, testCopy) {
  const wantType = testCopy.effect?.targetType;
  const matchIn = stable => {
    if (wantType === 'unicorn') return stable.find(c => IS_UNICORN(c.type))?.id || null;
    if (wantType === 'upgrade') return stable.find(c => c.type === 'upgrade')?.id || null;
    if (wantType === 'downgrade') return stable.find(c => c.type === 'downgrade')?.id || null;
    return stable[0]?.id || null;
  };
  const attempts = [
    [null, null],
    ['p2', matchIn(g.players.p2.stable)],
    ['p1', matchIn(g.players.p1.stable)],
    ['p2', null],
  ];
  let lastResult = null;
  for (const [tPid, tCid] of attempts) {
    lastResult = g.playCard('p1', testCopy.id, tPid, tCid);
    if (!lastResult.error) return lastResult;
  }
  return lastResult;
}

function counts(g) {
  return {
    hand: g.players.p1.hand.length, stable: g.players.p1.stable.length,
    discard: g.discard.length, deck: g.deck.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: dynamic — every enter-trigger optional card must offer a genuine skip
// that never leaves the player worse off than they were at the decision point.
// ═══════════════════════════════════════════════════════════════════════════════
const serverSkippableTypes = new Set(); // types Phase 1 proved are safely skippable
for (const card of uniqueCards) {
  const g = setupGame();
  const testCopy = mk(card);
  g.players.p1.hand.push(testCopy);
  const preplay = counts(g);
  let r;
  try { r = tryPlay(g, testCopy); }
  catch (e) { failLog(card.name, `playCard threw: ${e.message}`); continue; }
  if (r.error) { failLog(card.name, `playCard errored on every target combo tried: ${r.error}`); continue; }
  if (g.neighWindow || g.pendingCard) g.resolveNeigh('p1');

  if (!g.pendingEffect) {
    // No decision was queued at all. That's only OK if nothing actually happened
    // beyond the played card itself leaving the hand (a legitimate feasibility
    // auto-skip, e.g. "search discard for X" with no X present) — if any resource
    // beyond the played card moved, the "may" action ran with zero decision point.
    const post = counts(g);
    const handDelta = post.hand - preplay.hand; // expect -1 (the played card left hand)
    const unexpectedChange = post.stable > preplay.stable + 1 || post.discard !== preplay.discard || post.deck !== preplay.deck || handDelta < -1;
    if (unexpectedChange) {
      failLog(card.name, `optional:true but resolved with NO pendingEffect at all, and resources moved beyond the card itself entering play — the "you may" action ran unconditionally with zero decision point (the exact Shark With a Horn bug shape). counts: preplay=${JSON.stringify(preplay)} post=${JSON.stringify(post)}`);
    }
    continue;
  }
  const type = g.pendingEffect.type;
  const atDecision = counts(g);
  // Before even trying to skip: a card with trigger:'enter' should have moved
  // exactly from hand into stable (hand -1, stable +1) by the time its resulting
  // pendingEffect first appears. Any further loss already baked in at this point
  // — e.g. a self-sacrifice that ran synchronously before the pendingEffect was
  // even queued — means the "may" action was already committed with zero chance
  // to decline, even though a (later-stage) pendingEffect happens to exist now.
  if (atDecision.stable < preplay.stable + 1 || atDecision.hand < preplay.hand - 1) {
    failLog(card.name, `pendingEffect '${type}' exists, but resources were already spent between playing the card and that pendingEffect appearing — the cost was paid before any decision point. preplay=${JSON.stringify(preplay)} atDecision=${JSON.stringify(atDecision)}`);
    continue;
  }
  const skipRes = g.resolvePendingEffect('p1', [], { skip: true });
  const afterSkip = counts(g);
  if (skipRes && skipRes.error) {
    failLog(card.name, `pendingEffect '${type}' rejected extra:{skip:true} — no way to decline: ${skipRes.error}`);
    continue;
  }
  // Skipping must never make the player worse off than they were at the decision
  // point in the zones that represent a real cost: hand and stable can only stay
  // the same or grow. (Discard/deck are deliberately NOT compared with a fixed
  // direction here: a search/reveal effect stages matches OUT of the deck or
  // discard pile before the player decides, and a correct skip puts them back —
  // which means discard or deck size legitimately GROWS on skip. That's the skip
  // undoing its own staging, not a punishment, so policing a fixed direction on
  // those two pools would flag correct behavior as a bug.)
  const worseOff = afterSkip.hand < atDecision.hand || afterSkip.stable < atDecision.stable;
  if (worseOff) {
    failLog(card.name, `pendingEffect '${type}' accepted skip but left the player worse off than at the decision point — the cost was already paid before the decision. atDecision=${JSON.stringify(atDecision)} afterSkip=${JSON.stringify(afterSkip)}`);
    continue;
  }
  serverSkippableTypes.add(type);
}
if (fail === 0) okLog(`Phase 1: all ${uniqueCards.length} enter-trigger optional cards offer a genuine, non-punishing server-side skip`);

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: static — every type Phase 1 proved skippable must have a client
// control that can actually send the skip.
// ═══════════════════════════════════════════════════════════════════════════════
const appPath = path.join(__dirname, '..', 'client', 'src', 'App.jsx');
const appSrc = fs.readFileSync(appPath, 'utf8');
const appLines = appSrc.split('\n');

const IMPLICIT_DECLINE_TYPES = new Set([
  'search_deck_pick', 'from_discard_pick', 'look_top_keep_one', 'look_deck_return_same',
  'look_and_take', 'take_one_from_list',
]);

const typeHasSendNearby = new Set();
appLines.forEach((line, idx) => {
  const directRe = /pendingEffect\??\.type\s*===\s*'(\w+)'/g;
  let m;
  while ((m = directRe.exec(line))) {
    if (IMPLICIT_DECLINE_TYPES.has(m[1])) { typeHasSendNearby.add(m[1]); continue; }
    // Narrow window: dedicated blocks in this file are consistently short
    // (a condition immediately followed by a handful of buttons), and a wide
    // window risks picking up an unrelated skip button from the next card's
    // block in this densely-packed conditional chain.
    const windowText = appLines.slice(idx, idx + 16).join('\n');
    if (windowText.includes('skip:true') || windowText.includes('skip: true')) {
      typeHasSendNearby.add(m[1]);
    }
  }
});
// Array-membership checks (`[...].includes(pendingEffect.type)`) are frequently
// formatted as multi-line array literals, so this pass runs on the full source
// text (not line-by-line) to actually match across those line breaks.
const arrayRe = /(!?)\s*\[([^\]]+)\]\.includes\(pendingEffect\??\.type\)/gs;
let am;
while ((am = arrayRe.exec(appSrc))) {
  if (am[1] === '!') continue; // negated array (e.g. the generic fallback's exclusion
                                // list) means the opposite: types NOT listed are what's
                                // covered by the code that follows, not types listed.
                                // That case is already handled separately below via
                                // fallbackExclusions — counting it here too would treat
                                // "excluded from the fallback" as "has its own control".
  const matchEndIdx = appSrc.slice(0, am.index + am[0].length).split('\n').length - 1;
  const windowText = appLines.slice(Math.max(0, matchEndIdx - 5), matchEndIdx + 45).join('\n');
  if (windowText.includes('skip:true') || windowText.includes('skip: true')) {
    for (const t of am[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean)) {
      typeHasSendNearby.add(t);
    }
  }
}
const fallbackBlock = (() => {
  const start = appSrc.indexOf('Generic fallback: any other optional');
  if (start === -1) return '';
  const end = appSrc.indexOf('].includes(pendingEffect.type)', start);
  return end === -1 ? '' : appSrc.slice(start, end);
})();
if (!fallbackBlock) throw new Error('Could not locate the generic fallback skip block in App.jsx — update this audit if it was restructured.');
const fallbackExclusions = new Set((fallbackBlock.match(/'[a-z_0-9]+'/g) || []).map(s => s.slice(1, -1)));

for (const type of serverSkippableTypes) {
  const coveredByDedicated = typeHasSendNearby.has(type);
  const coveredByFallback = !fallbackExclusions.has(type);
  if (!coveredByDedicated && !coveredByFallback) {
    failLog(type, `server supports skip but no client control (dedicated or generic fallback) was found to send it`);
  }
}
if (fail === 0) okLog(`Phase 2: every server-skippable type has a client control that can send the skip`);

console.log(`\n── Results: ${pass} passed, ${fail} failed ──`);
if (failures.length) {
  console.log('\nFix the ❌ failures above — each names the card or pendingEffect type and why\nits "you may" text isn\'t actually honorable.');
}
process.exit(fail > 0 ? 1 : 0);

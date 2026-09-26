/**
 * test_multiplayer.js — 3+ player mechanics coverage
 * ====================================================
 * Run: node test_multiplayer.js
 *
 * WHY THIS EXISTS
 * ----------------
 * Almost every hand-written test in this project (test_cards.js, test_all_cards.js)
 * uses a 2-player setup, because most card effects don't behave differently at 3+
 * players. But several core MECHANICS do — turn order, extra turns, hand-limit
 * enforcement, "choose an opponent" effects, and the Neigh/Super Neigh windows all
 * have logic that's only actually exercised when there's more than one possible
 * "other player". A 2-player-only test suite can't tell the difference between
 * "correctly targets the other player" and "hardcoded to the second player" — this
 * file specifically probes that difference.
 *
 * test_universal_card_audit.js complements this: it fuzzes every card across 2/3/4
 * players and checks structural invariants (no crash, no duplication, no stall). This
 * file instead hand-picks specific multiplayer-only mechanics and asserts the
 * PRECISE correct outcome (e.g. "the player who goes again is the SAME one", not just
 * "someone eventually acted").
 *
 * Run: node test_multiplayer.js  →  all lines should begin with ✅
 */
'use strict';
const { Game }                          = require('./game');
const { createDeck }                    = require('./cards');
const { getExpansionCards, EXPANSIONS } = require('./expansions');
const { runBotStep }                    = require('./bot');

const ALL = [...createDeck(), ...getExpansionCards(Object.keys(EXPANSIONS))];

let passed = 0, failed = 0;
const pass = label        => { process.stdout.write(`✅ ${label}\n`); passed++; };
const fail = (label, det) => { process.stdout.write(`❌ ${label} — ${det}\n`); failed++; process.exitCode = 1; };

function setup(n, exps = []) {
  const g = new Game('t' + Math.random());
  for (let i = 1; i <= n; i++) g.addPlayer('p' + i, 'P' + i);
  g.updateSettings({ expansions: exps, winCondition: 7, localMode: false, debugMode: false });
  g.startGame();
  g.phase = 'action';
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  return g;
}
const find = name => ALL.find(c => c.name === name);
const injS = (g, pid, c, id) => g.players[pid].stable.push({ ...c, id });
const injH = (g, pid, c, id) => g.players[pid].hand.push({ ...c, id });
const uni  = () => ({ id: 'u' + Math.random(), type: 'basic_unicorn', name: 'BU', emoji: '🦄', effect: null, description: '', expansion: null });
const neighCard = () => ALL.find(c => c.effect?.type === 'neigh' && !c.effect?.super);

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── 1. Turn order across 3 and 4 players ──');

// Turn order should visit every player exactly once per lap, in playerOrder sequence,
// and wrap back around to the first player.
for (const n of [3, 4]) {
  const g = setup(n);
  const seen = [g.currentPlayer];
  for (let i = 0; i < n; i++) { g.phase = 'end'; g._endPhase(); seen.push(g.currentPlayer); }
  const startIdx = g.playerOrder.indexOf('p1');
  const expected = [];
  for (let i = 0; i <= n; i++) expected.push(g.playerOrder[(startIdx + i) % n]);
  seen.join(',') === expected.join(',')
    ? pass(`Turn order (${n}p): visits every player once and wraps around correctly`)
    : fail(`Turn order (${n}p)`, `seen=${seen.join(',')} expected=${expected.join(',')}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── 2. Extra turns with 3+ players ──');

// An extra-turn effect must give the SAME player another turn, not advance to the
// next player in line — this was a real, previously-fixed bug specific to 3+ players
// (with only 2 players, "next player" and "same player after a skipped opponent" can
// look identical by coincidence, which is exactly why this needs a 3+ player check).
for (const n of [3, 4]) {
  const g = setup(n);
  const cur = g.currentPlayer;
  g.extraTurns[cur] = 1;
  g.phase = 'end';
  g._endPhase();
  g.currentPlayer === cur
    ? pass(`Extra turn (${n}p): same player goes again, not the next one`)
    : fail(`Extra turn (${n}p)`, `expected ${cur}, got ${g.currentPlayer}`);
  // and after the extra turn is consumed, it should now correctly advance
  g.phase = 'end';
  g._endPhase();
  g.currentPlayer !== cur
    ? pass(`Extra turn (${n}p): advances normally once the extra turn is consumed`)
    : fail(`Extra turn (${n}p) consumed`, 'turn did not advance after extra turn used up');
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── 3. Hand-limit enforcement iterates every player, in turn order ──');

for (const n of [3, 4]) {
  const g = setup(n);
  // Push every player well over the 7-card hand limit
  for (const pid of g.playerOrder) {
    g.players[pid].hand = Array.from({ length: 10 }, (_, i) => uni());
  }
  g.phase = 'end';
  g._endPhase();
  // The FIRST player in playerOrder should be the one prompted first
  g.pendingEffect?.type === 'end_discard' && g.pendingEffect.playerId === g.playerOrder[0]
    ? pass(`Hand limit (${n}p): first over-limit player (in turn order) is prompted first`)
    : fail(`Hand limit (${n}p) first`, JSON.stringify(g.pendingEffect));
  // Resolve each player's discard in turn and confirm every single one gets prompted,
  // in order, none skipped, before the turn actually advances.
  let iterations = 0;
  const promptedOrder = [];
  while (g.pendingEffect?.type === 'end_discard' && iterations < n + 2) {
    promptedOrder.push(g.pendingEffect.playerId);
    const pid = g.pendingEffect.playerId;
    const need = g.pendingEffect.amount;
    const sel = g.players[pid].hand.slice(0, need).map(c => c.id);
    g.resolvePendingEffect(pid, sel, {});
    iterations++;
  }
  promptedOrder.join(',') === g.playerOrder.join(',')
    ? pass(`Hand limit (${n}p): every over-limit player prompted exactly once, in turn order`)
    : fail(`Hand limit (${n}p) order`, `prompted=${promptedOrder.join(',')} expected=${g.playerOrder.join(',')}`);
  g.playerOrder.every(pid => g.players[pid].hand.length <= 7)
    ? pass(`Hand limit (${n}p): every player is back at or under the limit afterward`)
    : fail(`Hand limit (${n}p) final`, g.playerOrder.map(pid => `${pid}:${g.players[pid].hand.length}`).join(' '));
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── 4. "Choose an opponent" effects offer every other player, not just one ──');

// Annoying Flying Unicorn: with 3+ possible targets, the acting player must be able to
// choose ANY of them (not hardcoded to "the next player" or "player 2").
for (const n of [3, 4]) {
  const g = setup(n);
  const afu = find('Annoying Flying Unicorn');
  injH(g, 'p1', afu, 'afu1');
  g.playCard('p1', 'afu1', null, null);
  g.resolveNeigh('p1');
  g.pendingEffect?.type === 'choose_opponent_discard'
    ? pass(`AFU (${n}p): queues choose_opponent_discard instead of auto-picking a target`)
    : fail(`AFU (${n}p) queue`, g.pendingEffect?.type);
  // Reject targeting self
  const selfErr = g.resolvePendingEffect('p1', [], { targetPlayerId: 'p1' });
  selfErr.error
    ? pass(`AFU (${n}p): rejects targeting yourself`)
    : fail(`AFU (${n}p) self-target`, 'no error');
  // Accept targeting the LAST non-p1 player in order (proves every opponent is a
  // legal target, not just "the next one") — must explicitly exclude p1 since
  // playerOrder is shuffled and could otherwise coincidentally pick p1 itself.
  const otherPids = g.playerOrder.filter(p => p !== 'p1');
  const lastPid = otherPids[otherPids.length - 1];
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId: lastPid });
  !r.error && g.pendingEffect?.type === 'target_discard' && g.pendingEffect.playerId === lastPid
    ? pass(`AFU (${n}p): can target the LAST player in turn order, not just the next one`)
    : fail(`AFU (${n}p) last-target`, JSON.stringify(r) + ' ' + JSON.stringify(g.pendingEffect));
}

// Americorn: same principle, via choose_opponent_pull_random
for (const n of [3, 4]) {
  const g = setup(n);
  const am = find('Americorn');
  injH(g, 'p1', am, 'am1');
  g.playCard('p1', 'am1', null, null);
  g.resolveNeigh('p1');
  const otherPids = g.playerOrder.filter(p => p !== 'p1');
  const lastPid = otherPids[otherPids.length - 1];
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId: lastPid });
  !r.error
    ? pass(`Americorn (${n}p): can pull from the LAST player in turn order`)
    : fail(`Americorn (${n}p)`, JSON.stringify(r));
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── 5. Neigh / Super Neigh with 3+ players ──');

// With 3 players, EITHER of the two non-playing players should be able to Neigh —
// not just a hardcoded "player 2".
for (const n of [3, 4]) {
  const g = setup(n);
  const target = uni();
  injH(g, 'p1', target, 'nt1');
  const lastPid = g.playerOrder[g.playerOrder.length - 1];
  injH(g, lastPid, neighCard(), 'nc1');
  g.playCard('p1', 'nt1', null, null);
  const r = g.playInstant(lastPid, 'nc1');
  !r.error && g.superNeighWindow
    ? pass(`Neigh (${n}p): the LAST player in turn order (not just "player 2") can Neigh`)
    : fail(`Neigh (${n}p) last-player`, JSON.stringify(r));
}

// Super Neigh: a THIRD, previously-uninvolved player should be able to jump in and
// Super Neigh — not just the original player or the neigher.
if (true) {
  const g = setup(3);
  const target = uni();
  injH(g, 'p1', target, 'nt2');
  injH(g, 'p2', neighCard(), 'nc2');
  injH(g, 'p3', neighCard(), 'nc3'); // p3 was not involved in the original play at all
  g.playCard('p1', 'nt2', null, null);
  g.playInstant('p2', 'nc2'); // p2 neighs p1's card
  const r = g.playInstant('p3', 'nc3'); // p3 (uninvolved third party) Super Neighs
  !r.error
    ? pass('Super Neigh (3p): an uninvolved third player can Super Neigh')
    : fail('Super Neigh (3p) third-party', JSON.stringify(r));
  g.resolveNeigh('p3'); // p3 (top of chain) confirms nobody Neighs again
  g.players['p1'].stable.some(c => c.id === 'nt2')
    ? pass('Super Neigh (3p): original card resolves normally after a third-party Super Neigh')
    : fail('Super Neigh (3p) resolve', 'original card did not enter stable');
  g.discard.some(c => c.id === 'nc2') && g.discard.some(c => c.id === 'nc3')
    ? pass('Super Neigh (3p): both Neigh cards (original + Super Neigh) end up discarded, no duplication')
    : fail('Super Neigh (3p) discard', g.discard.map(c => c.id).join(','));
}

// Only the ORIGINAL card's player should be able to resolve "nobody neighed" — not a
// bystander — regardless of player count.
for (const n of [3, 4]) {
  const g = setup(n);
  const target = uni();
  injH(g, 'p1', target, 'nt3');
  g.playCard('p1', 'nt3', null, null);
  const otherPids = g.playerOrder.filter(p => p !== 'p1');
  const lastPid = otherPids[otherPids.length - 1];
  const r = g.resolveNeigh(lastPid);
  r.error
    ? pass(`Neigh window (${n}p): a bystander cannot resolve someone else's pending card`)
    : fail(`Neigh window (${n}p) bystander`, 'no error, resolved by wrong player');
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── 6. Win condition correctness with 3+ players ──');

for (const n of [3, 4]) {
  const g = setup(n);
  // Give every player fewer than target unicorns except the last player in order
  const target = g.settings.winCondition || 7;
  for (const pid of g.playerOrder) g.players[pid].stable = [];
  const winnerPid = g.playerOrder[g.playerOrder.length - 1];
  for (let i = 0; i < target; i++) injS(g, winnerPid, uni(), 'w' + i);
  const w = g._checkWin();
  w === winnerPid
    ? pass(`Win condition (${n}p): correctly identifies the actual winner, not player 1 by default`)
    : fail(`Win condition (${n}p)`, `expected ${winnerPid}, got ${w}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── 7. ALL_DISCARD (Llamacorn) queues every player, in turn order, 3+ players ──');

for (const n of [3, 4]) {
  const g = setup(n);
  for (const pid of g.playerOrder) injH(g, pid, uni(), 'filler_' + pid);
  const ll = find('Llamacorn');
  injH(g, 'p1', ll, 'll1');
  g.playCard('p1', 'll1', null, null);
  g.resolveNeigh('p1');
  const promptedOrder = [];
  let iterations = 0;
  while (g.pendingEffect?.type === 'discard_choice' && iterations < n + 2) {
    promptedOrder.push(g.pendingEffect.playerId);
    const pid = g.pendingEffect.playerId;
    const cid = g.players[pid].hand[0]?.id;
    g.resolvePendingEffect(pid, cid ? [cid] : [], {});
    iterations++;
  }
  promptedOrder.join(',') === g.playerOrder.join(',')
    ? pass(`Llamacorn (${n}p): every player prompted exactly once, in turn order`)
    : fail(`Llamacorn (${n}p)`, `prompted=${promptedOrder.join(',')} expected=${g.playerOrder.join(',')}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── 8. Cross-player passive checks scope correctly to the right player ──');

// Queen Bee owned by p2 should block p3's and p4's basics too, not just p1's — i.e.
// the block passive is global-to-others, not hardcoded to a single relationship.
for (const n of [3, 4]) {
  const g = setup(n);
  injS(g, 'p2', find('Queen Bee Unicorn'), 'qb1');
  for (const pid of g.playerOrder) {
    if (pid === 'p2') continue;
    g.currentPlayerIndex = g.playerOrder.indexOf(pid);
    g.phase = 'action'; g.actionsUsedThisTurn = 0; g.pendingEffect = null;
    const bu = uni();
    injH(g, pid, bu, 'bu_' + pid);
    const r = g.playCard(pid, 'bu_' + pid, null, null);
    const nr = r.error ? r : g.resolveNeigh(pid);
    nr.error
      ? pass(`Queen Bee (${n}p): blocks ${pid}'s Basic Unicorn too, not just player 1's`)
      : fail(`Queen Bee (${n}p) ${pid}`, 'basic was not blocked');
  }
  // And Queen Bee's own owner should be unaffected
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  g.phase = 'action'; g.actionsUsedThisTurn = 0; g.pendingEffect = null;
  const bu2 = uni();
  injH(g, 'p2', bu2, 'bu_p2_own');
  const r2 = g.playCard('p2', 'bu_p2_own', null, null);
  const nr2 = r2.error ? r2 : g.resolveNeigh('p2');
  !nr2.error && g.players['p2'].stable.some(c => c.id === 'bu_p2_own')
    ? pass(`Queen Bee (${n}p): does not block its own owner's Basic Unicorns`)
    : fail(`Queen Bee (${n}p) owner`, JSON.stringify(nr2));
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── 9. Full bot-vs-bot game conservation check (3p and 4p, all expansions) ──');

function snapshotIds(g) {
  const ids = [];
  for (const pid of g.playerOrder) {
    for (const c of g.players[pid].hand) ids.push(c.id);
    for (const c of g.players[pid].stable) ids.push(c.id);
  }
  for (const c of g.deck) ids.push(c.id);
  for (const c of g.discard) ids.push(c.id);
  for (const c of g.nursery) ids.push(c.id);
  for (const c of g.removedFromGame) ids.push(c.id);
  // Cards can legitimately sit in a pendingEffect's options mid-resolution (e.g.
  // search_deck_pick, look_top_keep_one) — transiently outside the normal zones but
  // still part of the closed card system, especially relevant if the game ends
  // (a winner is declared) while a secondary effect is still queued. Exception:
  // take_one_from_list's options are a live reference into cards ALREADY sitting in
  // this.discard (a valid "here's what got discarded, take one back" design, not an
  // extraction) — counting those separately would double-count them.
  const collectOptions = eff => { if (eff?.options && eff.type !== 'take_one_from_list') for (const c of eff.options) ids.push(c.id); };
  collectOptions(g.pendingEffect);
  if (Array.isArray(g.pendingEffectQueue)) for (const eff of g.pendingEffectQueue) collectOptions(eff);
  // Note: pendingCard.card / superNeighPendingCard.card are NOT included here — they're
  // live references into a card still sitting in the owning player's hand (playCard()
  // doesn't splice it out until the neigh window actually resolves), so counting them
  // separately would double-count a card the normal hand scan above already captured.
  return ids;
}
function multisetEqual(a, b) {
  const countOf = arr => { const m = new Map(); for (const id of arr) m.set(id, (m.get(id)||0)+1); return m; };
  const ma = countOf(a), mb = countOf(b);
  if (ma.size !== mb.size) return false;
  for (const [id, n] of ma) if (mb.get(id) !== n) return false;
  return true;
}

for (const n of [3, 4]) {
  const g = setup(n, Object.keys(EXPANSIONS));
  for (const pid of g.playerOrder) g.players[pid].isBot = true;
  const before = snapshotIds(g);
  let steps = 0, noProgress = 0;
  const maxSteps = 4000;
  while (!g.winner && steps < maxSteps) {
    let acted = false;
    for (const pid of g.playerOrder) {
      const r = runBotStep(g, pid, 'medium');
      steps++;
      if (r.acted) { acted = true; break; }
    }
    if (!acted) { noProgress++; if (noProgress > 30) break; } else noProgress = 0;
    if (steps >= maxSteps) break;
  }
  const after = snapshotIds(g);
  const stuck = !g.winner && noProgress > 30;
  const timedOut = !g.winner && steps >= maxSteps;
  (!stuck)
    ? pass(`Full game (${n}p, all expansions): completes or times out without ever stalling (${steps} steps, winner=${g.winner||'none/timeout'})`)
    : fail(`Full game (${n}p) stuck`, `stuck after ${steps} steps`);
  multisetEqual(before, after)
    ? pass(`Full game (${n}p): card conservation holds across the ENTIRE game (every hand, stable, deck, discard, nursery, removedFromGame)`)
    : fail(`Full game (${n}p) conservation`, `card set changed over the course of the game`);
  if (g.winner) {
    const target = g.settings.winCondition || 7;
    const winnerCount = g._unicornCount ? g._unicornCount(g.winner) : null;
    pass(`Full game (${n}p): reached a winner (${g.winner}) after ${steps} steps${timedOut?' (should not happen — timedOut and winner both set)':''}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) console.log('Fix the ❌ failures above.');

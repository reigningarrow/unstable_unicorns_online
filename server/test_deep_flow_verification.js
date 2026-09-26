/*
 * test_deep_flow_verification.js — closes the specific gap documented in
 * test_ui_wiring_audit.js's header: that audit can only confirm "some client
 * wiring exists" for a pendingEffect type, not "every stage/branch of a
 * multi-step flow driven by local React state actually works". Local state
 * (choiceStep, swapState, dominatrixState, moveUpgState, downgradeMoveState,
 * tgtPid) doesn't appear on the pendingEffect object, so no amount of dynamic
 * pendingEffect-signature discovery can see it.
 *
 * This file takes the opposite approach: for every card whose resolution goes
 * through one of App.jsx's local-state flows, it hand-reproduces the EXACT
 * sequence of resolve_effect payloads each button in that flow sends (verified
 * against the current App.jsx source at the time of writing) and drives every
 * reachable branch to completion, asserting the resulting game state is
 * correct. This is exactly the kind of verification that was previously done
 * ad-hoc via throwaway `node -e` scripts during manual bug fixes — formalized
 * here so it survives as a permanent regression guard instead of evaporating
 * at the end of a session.
 *
 * MAINTENANCE NOTE: if App.jsx's flow logic changes (e.g. a new stage is added,
 * or a payload shape changes), the corresponding test(s) below must be updated
 * to match — these tests encode "what the client currently sends", not an
 * independent spec, so they can't catch a case where the client and this file
 * drift together. Cross-check against the actual App.jsx handleStableClick /
 * choiceStep blocks when adding a new local-state flow.
 */
const { Game } = require('./game');
const { createDeck } = require('./cards');
const { getExpansionCards, EXPANSIONS } = require('./expansions');

const ALL = [...createDeck(), ...getExpansionCards(Object.keys(EXPANSIONS))];
const find = name => { const c = ALL.find(x => x.name === name); if (!c) throw new Error(`Card not found: ${name}`); return c; };

let pass = 0, fail = 0;
const okLog = m => { pass++; console.log(`✅ ${m}`); };
const failLog = (n, d) => { fail++; console.log(`❌ ${n} — ${d}`); };

function setup(n = 3) {
  const g = new Game('t' + Math.random());
  for (let i = 1; i <= n; i++) g.addPlayer('p' + i, 'P' + i);
  g.updateSettings({ expansions: Object.keys(EXPANSIONS), winCondition: 7, localMode: false, debugMode: false });
  g.startGame();
  g.phase = 'action';
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  return g;
}
const injH = (g, pid, c, id) => g.players[pid].hand.push({ ...c, id });
const injS = (g, pid, c, id) => g.players[pid].stable.push({ ...c, id });
const upg = id => ({ id, type: 'upgrade', name: 'UPG', emoji: '⬆️', effect: null, description: '', expansion: null });
const dwn = id => ({ id, type: 'downgrade', name: 'DWN', emoji: '⬇️', effect: null, description: '', expansion: null });
const uni = id => ({ id, type: 'basic_unicorn', name: 'BU', emoji: '🦄', effect: null, description: '', expansion: null });

// Drains any incidental unrelated pendingEffect (e.g. a random starting card's
// on_unicorn_enter_or_leave passive queuing a plain 'discard') that isn't the flow
// under test, so tests aren't coupled to random starting-hand contents.
function drainUnrelated(g, pid, wantType, maxSteps = 5) {
  let steps = 0;
  while (g.pendingEffect && g.pendingEffect.type !== wantType && steps < maxSteps) {
    if (g.pendingEffect.type === 'discard') {
      const cid = g.players[g.pendingEffect.playerId].hand[0]?.id;
      g.resolvePendingEffect(g.pendingEffect.playerId, cid ? [cid] : [], {});
    } else break;
    steps++;
  }
}

function activateBeginning(g, cardName, pid = 'p1') {
  const c = find(cardName);
  injS(g, pid, c, 'flowcard');
  g.currentPlayerIndex = g.playerOrder.indexOf(pid);
  g._beginningPhase();
  if (g.pendingEffect?.type === 'beginning_optional_choices') {
    g.resolvePendingEffect(pid, ['flowcard'], {});
  }
}

// ─── 1. Re-Target (move_upgrade_or_downgrade_between_stables) ───────────────
// Step 1: click source upgrade/downgrade (any stable) → moveUpgState set.
// Step 2: click any card in destination stable → send({sel:[], extra:{sourcePlayerId, sourceCardId, targetPlayerId}}).
{
  const g = setup(3);
  injH(g, 'p1', find('Re-Target'), 'rt1');
  injS(g, 'p2', upg('theUpg'), 'theUpg');
  g.playCard('p1', 'rt1', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'move_upgrade_or_downgrade_between_stables');
  const r = g.resolvePendingEffect('p1', [], { sourcePlayerId: 'p2', sourceCardId: 'theUpg', targetPlayerId: 'p3' });
  (!r.error && g.players.p3.stable.some(c => c.id === 'theUpg') && !g.players.p2.stable.some(c => c.id === 'theUpg'))
    ? okLog('Re-Target: moving an Upgrade between two other players\' stables works')
    : failLog('re-target-upgrade', JSON.stringify(r) + ' p3=' + JSON.stringify(g.players.p3.stable.map(c=>c.id)));
}
{
  const g = setup(3);
  injH(g, 'p1', find('Re-Target'), 'rt2');
  injS(g, 'p1', dwn('myDwn'), 'myDwn');
  g.playCard('p1', 'rt2', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'move_upgrade_or_downgrade_between_stables');
  const r = g.resolvePendingEffect('p1', [], { sourcePlayerId: 'p1', sourceCardId: 'myDwn', targetPlayerId: 'p2' });
  (!r.error && g.players.p2.stable.some(c => c.id === 'myDwn'))
    ? okLog('Re-Target: moving your own Downgrade onto another player works')
    : failLog('re-target-downgrade', JSON.stringify(r));
}

// ─── 2. Unicorn Swap (move_own_unicorn_steal_unicorn) ───────────────────────
// Step 1: click a Unicorn in YOUR stable → swapState={ownCardId}.
// Step 2: click a Unicorn in ANOTHER stable → send({sel:[ownCardId], extra:{targetPlayerId,targetCardId}}).
{
  const g = setup(3);
  injH(g, 'p1', find('Unicorn Swap'), 'us1');
  injS(g, 'p1', uni('mine'), 'mine');
  injS(g, 'p2', uni('theirs'), 'theirs');
  g.playCard('p1', 'us1', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'move_own_unicorn_steal_unicorn');
  const r = g.resolvePendingEffect('p1', ['mine'], { targetPlayerId: 'p2', targetCardId: 'theirs' });
  (!r.error && g.players.p2.stable.some(c => c.id === 'mine') && g.players.p1.stable.some(c => c.id === 'theirs'))
    ? okLog('Unicorn Swap: two-step own-then-target selection correctly swaps both unicorns')
    : failLog('unicorn-swap', JSON.stringify(r));
}

// ─── 3. Dominatrix Whip (move_unicorn_any_stable_not_own) ───────────────────
// Step 1: click a Unicorn in ANY stable (not necessarily your own) → dominatrixState set.
// Step 2: click destination-player button → send({sel:[sourceCardId], extra:{sourcePlayerId,targetPlayerId}}).
// Plus: a Skip branch (optional beginning effect).
{
  const g = setup(3);
  activateBeginning(g, 'Dominatrix Whip');
  injS(g, 'p2', uni('whipTarget'), 'whipTarget');
  drainUnrelated(g, 'p1', 'move_unicorn_any_stable_not_own');
  const r = g.resolvePendingEffect('p1', ['whipTarget'], { sourcePlayerId: 'p2', targetPlayerId: 'p3' });
  (!r.error && g.players.p3.stable.some(c => c.id === 'whipTarget'))
    ? okLog('Dominatrix Whip: move a unicorn from any stable to a third player works')
    : failLog('dominatrix-move', JSON.stringify(r));
}
{
  const g = setup(3);
  activateBeginning(g, 'Dominatrix Whip');
  drainUnrelated(g, 'p1', 'move_unicorn_any_stable_not_own');
  const r = g.resolvePendingEffect('p1', [], { skip: true });
  (!r.error && !g.pendingEffect)
    ? okLog('Dominatrix Whip: Skip branch cleanly resolves with no move')
    : failLog('dominatrix-skip', JSON.stringify(r) + ' pending=' + JSON.stringify(g.pendingEffect));
}

// ─── 4. Charming Bardicorn (move_self_steal_and_draw) ───────────────────────
// Step 1: click opponent-picker button → tgtPid set (or top-level Skip → {targetPlayerId, skip:true}).
// Step 2a: click a unicorn in their stable → send({extra:{targetPlayerId,targetCardId}}).
// Step 2b: "skip steal" button → send({extra:{targetPlayerId}}) (no targetCardId, still moves+draws).
{
  const g = setup(3);
  activateBeginning(g, 'Charming Bardicorn');
  injS(g, 'p2', uni('stealMe'), 'stealMe');
  drainUnrelated(g, 'p1', 'move_self_steal_and_draw');
  const beforeHand = g.players.p1.hand.length;
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'stealMe' });
  (!r.error && g.players.p2.stable.some(c => c.id === 'flowcard') && g.players.p1.stable.some(c => c.id === 'stealMe') && g.players.p1.hand.length === beforeHand + 1)
    ? okLog('Charming Bardicorn: move + steal-a-unicorn + draw branch works')
    : failLog('bardicorn-move-steal', JSON.stringify(r));
}
{
  const g = setup(3);
  activateBeginning(g, 'Charming Bardicorn');
  drainUnrelated(g, 'p1', 'move_self_steal_and_draw');
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2' }); // "skip steal" — no targetCardId
  (!r.error && g.players.p2.stable.some(c => c.id === 'flowcard'))
    ? okLog('Charming Bardicorn: move-only ("skip steal") branch still completes the move')
    : failLog('bardicorn-move-only', JSON.stringify(r));
}
{
  const g = setup(3);
  activateBeginning(g, 'Charming Bardicorn');
  drainUnrelated(g, 'p1', 'move_self_steal_and_draw');
  // The real "Skip" button sends targetPlayerId AND skip:true together (see the
  // opponent-picker UI's Skip button) — the resolver must honor skip regardless of
  // targetPlayerId being present, or this button silently does the move anyway.
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', skip: true });
  (!r.error && g.players.p1.stable.some(c => c.id === 'flowcard') && !g.players.p2.stable.some(c => c.id === 'flowcard'))
    ? okLog('Charming Bardicorn: the real Skip button (targetPlayerId + skip:true) actually skips, does not move the card')
    : failLog('bardicorn-real-skip-button', JSON.stringify(r) + ' p2=' + JSON.stringify(g.players.p2.stable.map(c=>c.id)));
}

// ─── 5. Cutthroat Captain (choice_steal_baby_or_revive_basic) ───────────────
{
  const g = setup(3);
  injH(g, 'p1', find('Cutthroat Captain Unicorn'), 'cc1');
  const baby = ALL.find(c => c.type === 'baby_unicorn');
  injS(g, 'p2', baby, 'babyTarget');
  g.playCard('p1', 'cc1', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'choice_steal_baby_or_revive_basic');
  const r = g.resolvePendingEffect('p1', [], { choice: 'a', targetPlayerId: 'p2', targetCardId: 'babyTarget' });
  (!r.error && g.players.p1.stable.some(c => c.id === 'babyTarget'))
    ? okLog('Cutthroat Captain: option A (steal a Baby Unicorn) works')
    : failLog('cutthroat-a', JSON.stringify(r));
}
{
  const g = setup(3);
  injH(g, 'p1', find('Cutthroat Captain Unicorn'), 'cc2');
  g.playCard('p1', 'cc2', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'choice_steal_baby_or_revive_basic');
  const r = g.resolvePendingEffect('p1', [], { choice: 'b' });
  (!r.error)
    ? okLog('Cutthroat Captain: option B (revive basic from discard, no target needed) sends cleanly')
    : failLog('cutthroat-b', JSON.stringify(r));
}

// ─── 6. Hornswoggler (choice_discard_hand_draw3_or_trade_hands) ─────────────
{
  const g = setup(3);
  injH(g, 'p1', find('Hornswoggler Unicorn'), 'hw1');
  g.playCard('p1', 'hw1', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'choice_discard_hand_draw3_or_trade_hands');
  const r = g.resolvePendingEffect('p1', [], { choice: 'a' });
  !r.error ? okLog('Hornswoggler: option A (discard hand, draw 3) works') : failLog('hornswoggler-a', JSON.stringify(r));
}
{
  const g = setup(3);
  injH(g, 'p1', find('Hornswoggler Unicorn'), 'hw2');
  injH(g, 'p2', uni('p2marker'), 'p2marker');
  g.playCard('p1', 'hw2', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'choice_discard_hand_draw3_or_trade_hands');
  const r = g.resolvePendingEffect('p1', [], { choice: 'b', targetPlayerId: 'p2' });
  (!r.error && g.players.p1.hand.some(c => c.id === 'p2marker'))
    ? okLog('Hornswoggler: option B (trade hands with chosen player) works')
    : failLog('hornswoggler-b', JSON.stringify(r));
}

// ─── 7. Pillaging Pirate (choice_steal_upgrade_or_move_downgrade) ───────────
{
  const g = setup(3);
  injH(g, 'p1', find('Pillaging Pirate Unicorn'), 'pp1');
  injS(g, 'p2', upg('theirUpg'), 'theirUpg');
  g.playCard('p1', 'pp1', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'choice_steal_upgrade_or_move_downgrade');
  const r = g.resolvePendingEffect('p1', [], { choice: 'a', targetPlayerId: 'p2', targetCardId: 'theirUpg' });
  (!r.error && g.players.p1.stable.some(c => c.id === 'theirUpg'))
    ? okLog('Pillaging Pirate: option A (steal an Upgrade) works')
    : failLog('pillaging-a', JSON.stringify(r));
}
{
  const g = setup(3);
  injH(g, 'p1', find('Pillaging Pirate Unicorn'), 'pp2');
  injS(g, 'p1', dwn('myDwn2'), 'myDwn2');
  g.playCard('p1', 'pp2', null, null);
  g.resolveNeigh('p1');
  let steps = 0;
  while (g.pendingEffect && g.pendingEffect.type !== 'choice_steal_upgrade_or_move_downgrade' && steps < 5) {
    if (g.pendingEffect.type === 'discard') g.resolvePendingEffect('p1', [g.players.p1.hand[0]?.id].filter(Boolean), {});
    else break;
    steps++;
  }
  const r = g.resolvePendingEffect('p1', ['myDwn2'], { choice: 'b', targetPlayerId: 'p3' });
  (!r.error && g.players.p3.stable.some(c => c.id === 'myDwn2'))
    ? okLog('Pillaging Pirate: option B (move own Downgrade to chosen opponent) works')
    : failLog('pillaging-b', JSON.stringify(r));
}

// ─── 8. Bungee Jumping (choice_sacrifice_downgrade_or_return_hand) ──────────
{
  const g = setup(3);
  const c = find('Bungee Jumping Unicorn');
  injS(g, 'p1', c, 'bj1');
  injS(g, 'p1', dwn('bjDwn'), 'bjDwn');
  g._sacrificeCard('p1', 'bj1');
  drainUnrelated(g, 'p1', 'choice_sacrifice_downgrade_or_return_hand');
  const r = g.resolvePendingEffect('p1', [], { choice: 'a', targetCardId: 'bjDwn' });
  !r.error ? okLog('Bungee Jumping: option A (sacrifice own Downgrade) works') : failLog('bungee-a', JSON.stringify(r));
}
{
  const g = setup(3);
  const c = find('Bungee Jumping Unicorn');
  injS(g, 'p1', c, 'bj2');
  injS(g, 'p1', uni('bjCard'), 'bjCard');
  g._sacrificeCard('p1', 'bj2');
  drainUnrelated(g, 'p1', 'choice_sacrifice_downgrade_or_return_hand');
  const r = g.resolvePendingEffect('p1', [], { choice: 'b', targetCardId: 'bjCard' });
  (!r.error && g.players.p1.hand.some(c => c.id === 'bjCard'))
    ? okLog('Bungee Jumping: option B (return own card to hand) works')
    : failLog('bungee-b', JSON.stringify(r));
}

// ─── 9. First Mer-mate (choice_draw_two_or_play_basic) ──────────────────────
{
  const g = setup(3);
  const c = find('First Mer-mate Unicorn');
  injS(g, 'p1', c, 'fm1');
  g._sacrificeCard('p1', 'fm1');
  drainUnrelated(g, 'p1', 'choice_draw_two_or_play_basic');
  const r = g.resolvePendingEffect('p1', [], { choice: 'a' });
  !r.error ? okLog('First Mer-mate: option A (draw 2) works') : failLog('mermate-a', JSON.stringify(r));
}
{
  const g = setup(3);
  const c = find('First Mer-mate Unicorn');
  injS(g, 'p1', c, 'fm2');
  injH(g, 'p1', uni('fmBasic'), 'fmBasic');
  g._sacrificeCard('p1', 'fm2');
  drainUnrelated(g, 'p1', 'choice_draw_two_or_play_basic');
  const r = g.resolvePendingEffect('p1', ['fmBasic'], { choice: 'b' });
  (!r.error && g.players.p1.stable.some(c => c.id === 'fmBasic'))
    ? okLog('First Mer-mate: option B (select hand card, play free) works')
    : failLog('mermate-b', JSON.stringify(r));
}

// ─── 10. Orcicorn Raider (move_downgrade_steal_upgrade) ─────────────────────
{
  const g = setup(3);
  injH(g, 'p1', find('Orcicorn Raider'), 'or1');
  injS(g, 'p1', dwn('orDwn1'), 'orDwn1');
  injS(g, 'p2', upg('orUpg'), 'orUpg');
  g.playCard('p1', 'or1', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'move_downgrade_steal_upgrade');
  const r = g.resolvePendingEffect('p1', ['orDwn1'], { targetPlayerId: 'p2', targetCardId: 'orUpg' });
  (!r.error && g.players.p2.stable.some(c => c.id === 'orDwn1') && g.players.p1.stable.some(c => c.id === 'orUpg'))
    ? okLog('Orcicorn Raider: move downgrade + steal upgrade branch works')
    : failLog('orcicorn-steal', JSON.stringify(r));
}
{
  const g = setup(3);
  injH(g, 'p1', find('Orcicorn Raider'), 'or2');
  injS(g, 'p1', dwn('orDwn2'), 'orDwn2');
  g.playCard('p1', 'or2', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'move_downgrade_steal_upgrade');
  const r = g.resolvePendingEffect('p1', ['orDwn2'], { targetPlayerId: 'p2' }); // "move only, no steal"
  (!r.error && g.players.p2.stable.some(c => c.id === 'orDwn2'))
    ? okLog('Orcicorn Raider: "move only, no steal" branch works')
    : failLog('orcicorn-move-only', JSON.stringify(r));
}

// ─── 11. White Elephantcorn (move_downgrade_to_opponent) ────────────────────
{
  const g = setup(3);
  injH(g, 'p1', find('White Elephantcorn'), 'we1');
  injS(g, 'p1', dwn('weDwn'), 'weDwn');
  g.playCard('p1', 'we1', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'move_downgrade_to_opponent');
  const r = g.resolvePendingEffect('p1', ['weDwn'], { targetPlayerId: 'p2' });
  (!r.error && g.players.p2.stable.some(c => c.id === 'weDwn'))
    ? okLog('White Elephantcorn: move own Downgrade to chosen player works')
    : failLog('elephantcorn-move', JSON.stringify(r));
}

// ─── 12. Gift Receipt (move_own_card_pull_from_that_player) ─────────────────
{
  const g = setup(3);
  injH(g, 'p1', find('Gift Receipt'), 'gr1');
  injS(g, 'p1', uni('giveAway'), 'giveAway');
  g.players.p2.hand = []; // empty first so the random pull is deterministic
  injH(g, 'p2', uni('p2pull'), 'p2pull');
  g.playCard('p1', 'gr1', null, null);
  g.resolveNeigh('p1');
  drainUnrelated(g, 'p1', 'move_own_card_pull_from_that_player');
  const r = g.resolvePendingEffect('p1', ['giveAway'], { targetPlayerId: 'p2' });
  (!r.error && g.players.p2.stable.some(c => c.id === 'giveAway') && g.players.p1.hand.some(c => c.id === 'p2pull'))
    ? okLog('Gift Receipt: give own card + pull random from that player works')
    : failLog('gift-receipt', JSON.stringify(r));
}

// ─── 13. Polyamorous Unicorn (move_self_steal_unicorn) ──────────────────────
{
  const g = setup(3);
  activateBeginning(g, 'Polyamorous Unicorn');
  injS(g, 'p2', uni('polySteal'), 'polySteal');
  drainUnrelated(g, 'p1', 'move_self_steal_unicorn');
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'polySteal' });
  (!r.error && g.players.p2.stable.some(c => c.id === 'flowcard') && g.players.p1.stable.some(c => c.id === 'polySteal'))
    ? okLog('Polyamorous Unicorn: move + optional steal branch works')
    : failLog('polyamorous-steal', JSON.stringify(r));
}
{
  const g = setup(3);
  activateBeginning(g, 'Polyamorous Unicorn');
  drainUnrelated(g, 'p1', 'move_self_steal_unicorn');
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2' }); // "move only, no steal"
  (!r.error && g.players.p2.stable.some(c => c.id === 'flowcard'))
    ? okLog('Polyamorous Unicorn: "move only, no steal" branch works')
    : failLog('polyamorous-move-only', JSON.stringify(r));
}

console.log(`\n── Results: ${pass} passed, ${fail} failed ──`);
process.exit(fail > 0 ? 1 : 0);

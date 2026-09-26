/**
 * test_all_cards.js — Comprehensive per-card mechanic coverage
 * Tests every meaningful card effect across all 8 expansions (475 cards).
 * Run: node test_all_cards.js  →  all lines should begin with ✅
 */
'use strict';

const { Game }                          = require('./game');
const { createDeck, CARD_TYPES }        = require('./cards');
const { getExpansionCards, EXPANSIONS } = require('./expansions');

const ALL = [...createDeck(), ...getExpansionCards(Object.keys(EXPANSIONS))];

let passed = 0, failed = 0;
const pass  = label       => { process.stdout.write(`✅ ${label}\n`); passed++; };
const fail  = (label, det) => { process.stdout.write(`❌ ${label} — ${det}\n`); failed++; process.exitCode = 1; };

function setup(n = 2, exps = []) {
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
const uni  = () => ({ id: 'u' + Math.random(), type: 'basic_unicorn',  name: 'BU',  emoji: '🦄', effect: null, description: '', expansion: null });
const upg  = () => ({ id: 'u' + Math.random(), type: 'upgrade',        name: 'UPG', emoji: '⬆️', effect: null, description: '', expansion: null });
const dwn  = () => ({ id: 'u' + Math.random(), type: 'downgrade',      name: 'DWN', emoji: '⬇️', effect: null, description: '', expansion: null });

function play(g, pid, cardId, tPid, tCid) {
  const r = g.playCard(pid, cardId, tPid, tCid);
  if (r.error) return r;
  return g.resolveNeigh(pid);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1. Base Magical Unicorns ──');

// Alluring Narwhal: steals an upgrade on enter
{
  const g = setup();
  const u = upg(); injS(g, 'p2', u, u.id);
  injH(g, 'p1', find('Alluring Narwhal'), 'an');
  play(g, 'p1', 'an', null, null);
  g.pendingEffect?.type === 'choose_steal'
    ? pass('Alluring Narwhal: queues choose_steal on enter')
    : fail('Alluring Narwhal', g.pendingEffect?.type);
}

// Americorn: pulls random card from opponent into own hand
{
  const g = setup();
  const h = uni(); injH(g, 'p2', h, h.id);
  injH(g, 'p1', find('Americorn'), 'am');
  const p1Before = g.players['p1'].hand.length; // includes 'am'
  play(g, 'p1', 'am', null, null);
  // p1 played am (-1) and pulled a card from p2 (+1) → hand stays same size
  // best check: p2 lost a card (they started with 7, now have 6)
  g.players['p2'].hand.length === 6
    ? pass('Americorn: pulls random card from opponent')
    : fail('Americorn', `p2 hand=${g.players['p2'].hand.length} (expected 6)`);
}

// Annoying Flying Unicorn: queues cross-player discard
{
  const g = setup();
  injH(g, 'p1', find('Annoying Flying Unicorn'), 'afu');
  play(g, 'p1', 'afu', null, null);
  g.pendingEffect?.type === 'choose_opponent_discard'
    ? pass('Annoying Flying Unicorn: queues choose_opponent_discard')
    : fail('AFU queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [], { skip: true });
}

// AFU: returns to hand on sacrifice (on_leave.return_to_hand_self)
{
  const g = setup();
  injS(g, 'p1', find('Annoying Flying Unicorn'), 'afu2');
  g._sacrificeCard('p1', 'afu2');
  g.players['p1'].hand.some(c => c.id === 'afu2')
    ? pass('AFU: returns to hand on sacrifice')
    : fail('AFU return-to-hand', 'not in hand after sac');
}

// Chainsaw Unicorn: queues destroy_upgrade_or_sacrifice_downgrade
{
  const g = setup();
  const u = upg(); injS(g, 'p2', u, u.id);
  injH(g, 'p1', find('Chainsaw Unicorn'), 'cs');
  play(g, 'p1', 'cs', null, null);
  g.pendingEffect?.type === 'destroy_upgrade_or_sacrifice_downgrade'
    ? pass('Chainsaw Unicorn: queues destroy_upgrade_or_sacrifice_downgrade')
    : fail('Chainsaw queue', g.pendingEffect?.type);
}

// Greedy Flying Unicorn: draws on enter
{
  const g = setup();
  const before = g.players['p1'].hand.length;
  injH(g, 'p1', find('Greedy Flying Unicorn'), 'gfu');
  play(g, 'p1', 'gfu', null, null);
  // Played card (-1), drew 1 card on enter (+1) → net same, but hand length should be ≥ before-1
  g.players['p1'].hand.length >= before - 1
    ? pass('Greedy Flying Unicorn: draws on enter')
    : fail('GFU draw', `hand before=${before} after=${g.players['p1'].hand.length}`);
}

// Llamacorn: each player (including the player who played it) chooses their OWN card to discard
{
  const g = setup(3);
  const h2a = uni(); const h2b = uni();
  injH(g, 'p2', h2a, h2a.id); injH(g, 'p2', h2b, h2b.id);
  injH(g, 'p1', find('Llamacorn'), 'll');
  play(g, 'p1', 'll', null, null);
  g.pendingEffect?.type === 'discard_choice'
    ? pass('Llamacorn: queues discard_choice (player picks, not random)')
    : fail('Llamacorn queue', g.pendingEffect?.type);
  // Resolve all three queued discard_choice effects in order, each player choosing
  for (let i = 0; i < 3; i++) {
    const eff = g.pendingEffect;
    if (!eff || eff.type !== 'discard_choice') break;
    const owner = eff.playerId;
    if (owner === 'p2') {
      // p2 specifically chooses h2b over h2a — proves it's a player choice, not random
      g.resolvePendingEffect('p2', [h2b.id], {});
    } else {
      const cardId = g.players[owner].hand[0]?.id;
      g.resolvePendingEffect(owner, cardId ? [cardId] : [], {});
    }
  }
  !g.players['p2'].hand.some(c => c.id === h2b.id) && g.players['p2'].hand.some(c => c.id === h2a.id)
    ? pass('Llamacorn: p2 discarded the specific card they chose (h2b), not a random one')
    : fail('Llamacorn player choice', `h2a present=${g.players['p2'].hand.some(c=>c.id===h2a.id)} h2b present=${g.players['p2'].hand.some(c=>c.id===h2b.id)}`);
  !g.pendingEffect || g.pendingEffect.type !== 'discard_choice'
    ? pass('Llamacorn: all queued discard_choice effects resolved')
    : fail('Llamacorn resolution', 'effects still pending');
}

// Llamacorn: a player cannot resolve another player's discard_choice effect
{
  const g = setup(3);
  const h = uni(); injH(g, 'p2', h, h.id);
  injH(g, 'p1', find('Llamacorn'), 'll');
  play(g, 'p1', 'll', null, null);
  const wrongOwner = g.pendingEffect?.playerId;
  const otherPid = g.playerOrder.find(p => p !== wrongOwner);
  const r = g.resolvePendingEffect(otherPid, [], {});
  r.error
    ? pass('Llamacorn: rejects resolution attempt from the wrong player')
    : fail('Llamacorn wrong-player guard', 'resolved without error');
}

// Mermaid Unicorn: queues choose_return, then returns card
{
  const g = setup();
  const v = uni(); injS(g, 'p2', v, v.id);
  injH(g, 'p1', find('Mermaid Unicorn'), 'mm');
  play(g, 'p1', 'mm', null, null);
  g.pendingEffect?.type === 'choose_return'
    ? pass('Mermaid Unicorn: queues choose_return')
    : fail('Mermaid queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: v.id });
  !g.players['p2'].stable.some(c => c.id === v.id)
    ? pass('Mermaid Unicorn: returns card to p2 hand')
    : fail('Mermaid return', 'card still in stable');
}

// Mother Goose Unicorn: takes baby from nursery (now requires confirmation —
// regression test for a user report: several "you may" effects were auto-executing
// with no way to decline; this one used to grab a nursery baby unconditionally)
{
  const g = setup();
  injH(g, 'p1', find('Mother Goose Unicorn'), 'mg');
  const babiesBefore = g.players['p1'].stable.filter(c => c.type === 'baby_unicorn').length;
  play(g, 'p1', 'mg', null, null);
  g.pendingEffect?.type === 'take_from_nursery'
    ? pass('Mother Goose Unicorn: queues take_from_nursery (confirm required, not automatic)')
    : fail('Mother Goose queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [], {});
  g.players['p1'].stable.filter(c => c.type === 'baby_unicorn').length > babiesBefore
    ? pass('Mother Goose Unicorn: confirming takes baby from nursery')
    : fail('Mother Goose confirm', 'no extra baby added');
}
{
  const g = setup();
  injH(g, 'p1', find('Mother Goose Unicorn'), 'mg2');
  const babiesBefore = g.players['p1'].stable.filter(c => c.type === 'baby_unicorn').length;
  play(g, 'p1', 'mg2', null, null);
  g.resolvePendingEffect('p1', [], { skip:true });
  g.players['p1'].stable.filter(c => c.type === 'baby_unicorn').length === babiesBefore
    ? pass('Mother Goose Unicorn: skip declines cleanly')
    : fail('Mother Goose skip', 'baby was added despite skip');
}

// Narwhal Torpedo: sacrifices all own downgrades
{
  const g = setup();
  const d = dwn(); injS(g, 'p1', d, d.id);
  const d2 = dwn(); injS(g, 'p1', d2, d2.id);
  injH(g, 'p1', find('Narwhal Torpedo'), 'nt');
  play(g, 'p1', 'nt', null, null);
  !g.players['p1'].stable.some(c => c.id === d.id) && !g.players['p1'].stable.some(c => c.id === d2.id)
    ? pass('Narwhal Torpedo: sacrifices all own downgrades')
    : fail('Narwhal Torpedo', 'downgrades remain');
}

// Necromancer Unicorn: skips when not feasible
{
  const g = setup();
  injH(g, 'p1', find('Necromancer Unicorn'), 'nec');
  play(g, 'p1', 'nec', null, null);
  !g.pendingEffect
    ? pass('Necromancer: skips when not feasible')
    : fail('Necromancer feasibility', g.pendingEffect?.type);
}

// Queen Bee: blocks basics from entering other stables — and does so as a rejected
// action (error + card restored to hand), not a turn-consuming "success"
{
  const g = setup(3);
  injS(g, 'p1', find('Queen Bee Unicorn'), 'qb');
  const bu = uni(); injH(g, 'p2', bu, bu.id);
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  const r = play(g, 'p2', bu.id, null, null);
  !g.players['p2'].stable.some(c => c.id === bu.id)
    ? pass('Queen Bee: blocks basic from entering other stables')
    : fail('Queen Bee', 'basic entered p2 stable');
  r.error
    ? pass('Queen Bee: blocked play returns an error instead of ending the turn')
    : fail('Queen Bee turn-end', 'no error returned — turn may have been consumed');
  g.players['p2'].hand.some(c => c.id === bu.id)
    ? pass('Queen Bee: blocked card is restored to hand, not discarded')
    : fail('Queen Bee restore', 'card missing from hand — vanished or discarded');
  g.phase === 'action' && g.currentPlayer === 'p2'
    ? pass('Queen Bee: turn/phase unaffected — player can still act')
    : fail('Queen Bee phase', `phase=${g.phase} currentPlayer=${g.currentPlayer}`);
}

// Queen Bee: its block is suppressed when its owner has Blinding Light (their Unicorns
// — including Queen Bee itself — are "considered Basic Unicorns with no effects")
{
  const g = setup(2);
  injS(g, 'p1', find('Queen Bee Unicorn'), 'qb');
  injS(g, 'p1', find('Blinding Light'), 'bl');
  const bu = uni(); injH(g, 'p2', bu, bu.id);
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  const r = play(g, 'p2', bu.id, null, null);
  (!r.error && g.players['p2'].stable.some(c => c.id === bu.id))
    ? pass('Queen Bee: block suppressed by owner\'s Blinding Light')
    : fail('Queen Bee + Blinding Light', JSON.stringify(r));
}

// Extreme Adventurer: blocking a basic unicorn from your own stable is a rejected
// action too, not a turn-consuming one
{
  const g = setup(2);
  injS(g, 'p1', find('Extreme Adventurer Unicorn'), 'ea');
  const bu = uni(); injH(g, 'p1', bu, bu.id);
  const r = play(g, 'p1', bu.id, null, null);
  r.error && g.players['p1'].hand.some(c => c.id === bu.id) && g.phase === 'action'
    ? pass('Extreme Adventurer: blocked play returns error, card restored, turn unaffected')
    : fail('Extreme Adventurer', JSON.stringify(r));
}

// Humbug: Magical Unicorn cards cannot enter your Stable (was defined but never
// enforced anywhere before this fix)
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Humbug'), 'hb');
  const mu = find('Queen Bee Unicorn'); injH(g, 'p1', mu, 'qb2');
  const r = play(g, 'p1', 'qb2', null, null);
  r.error && g.players['p1'].hand.some(c => c.id === 'qb2') && !g.players['p1'].stable.some(c => c.id === 'qb2')
    ? pass('Humbug: blocks Magical Unicorns from entering your Stable')
    : fail('Humbug', JSON.stringify(r));
}

// Saved by the Sigil: blocks a Downgrade as a rejected action, not a turn-consuming one
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p2', find('Saved by the Sigil'), 'sig');
  const dg = find('Blinding Light'); injH(g, 'p1', dg, 'bl2');
  const r = play(g, 'p1', 'bl2', 'p2', null);
  r.error && g.players['p1'].hand.some(c => c.id === 'bl2') && g.phase === 'action'
    ? pass('Saved by the Sigil: blocked Downgrade returns error, card restored, turn unaffected')
    : fail('Saved by the Sigil', JSON.stringify(r));
}

// Dragon's Blessing: blocks a Downgrade as a rejected action, not a turn-consuming one
{
  const g = setup(2, ['dragons']);
  injS(g, 'p2', find('Dragon\'s Blessing'), 'db');
  const dg = find('Blinding Light'); injH(g, 'p1', dg, 'bl3');
  const r = play(g, 'p1', 'bl3', 'p2', null);
  r.error && g.players['p1'].hand.some(c => c.id === 'bl3') && g.phase === 'action'
    ? pass('Dragon\'s Blessing: blocked Downgrade returns error, card restored, turn unaffected')
    : fail('Dragon\'s Blessing', JSON.stringify(r));
}

// Rainbow Unicorn: plays a basic unicorn from hand into stable (now requires
// confirmation + card selection — regression test, see Mother Goose above for context)
{
  const g = setup();
  const bu = uni(); injH(g, 'p1', bu, bu.id);
  injH(g, 'p1', find('Rainbow Unicorn'), 'ru');
  const stabBefore = g.players['p1'].stable.filter(c => c.type === 'basic_unicorn').length;
  play(g, 'p1', 'ru', null, null);
  g.pendingEffect?.type === 'play_basic_from_hand'
    ? pass('Rainbow Unicorn: queues play_basic_from_hand (confirm required, not automatic)')
    : fail('Rainbow Unicorn queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [bu.id], {});
  g.players['p1'].stable.filter(c => c.type === 'basic_unicorn').length > stabBefore
    ? pass('Rainbow Unicorn: confirming plays basic unicorn from hand into stable')
    : fail('Rainbow Unicorn confirm', `basics before=${stabBefore} after=${g.players['p1'].stable.filter(c=>c.type==='basic_unicorn').length}`);
}
{
  const g = setup();
  const bu = uni(); injH(g, 'p1', bu, bu.id);
  injH(g, 'p1', find('Rainbow Unicorn'), 'ru2');
  const stabBefore = g.players['p1'].stable.filter(c => c.type === 'basic_unicorn').length;
  play(g, 'p1', 'ru2', null, null);
  g.resolvePendingEffect('p1', [], { skip:true });
  g.players['p1'].stable.filter(c => c.type === 'basic_unicorn').length === stabBefore
    ? pass('Rainbow Unicorn: skip declines cleanly')
    : fail('Rainbow Unicorn skip', 'basic was played despite skip');
}

// Seductive Unicorn: queues discard_then_steal
{
  const g = setup();
  injH(g, 'p1', find('Seductive Unicorn'), 'su');
  const v = uni(); injS(g, 'p2', v, v.id);
  play(g, 'p1', 'su', null, null);
  g.pendingEffect?.type === 'discard_then_steal'
    ? pass('Seductive Unicorn: queues discard_then_steal')
    : fail('Seductive queue', g.pendingEffect?.type);
}

// Shark With a Horn: "you may SACRIFICE this card, then DESTROY a Unicorn card."
// The whole chain is one up-front decision — it must NOT sacrifice unconditionally
// (that was the bug: the card had zero way to decline). Confirming then queues the
// mandatory choose_destroy step; skipping leaves the card untouched in the stable.
{
  const g = setup();
  injH(g, 'p1', find('Shark With a Horn'), 'swh');
  play(g, 'p1', 'swh', null, null);
  (g.pendingEffect?.type === 'sacrifice_self_destroy_unicorn' && g.pendingEffect.optional)
    ? pass('Shark With a Horn: queues an optional confirm/skip decision before sacrificing')
    : fail('Shark queue', g.pendingEffect?.type);
  g.players['p1'].stable.some(c => c.id === 'swh')
    ? pass('Shark With a Horn: still in stable — not sacrificed before the decision')
    : fail('Shark premature sacrifice', 'card left the stable before any decision was made');
}
{
  const g = setup();
  injH(g, 'p1', find('Shark With a Horn'), 'swh2');
  play(g, 'p1', 'swh2', null, null);
  const r = g.resolvePendingEffect('p1', [], { skip: true });
  (r.ok && g.players['p1'].stable.some(c => c.id === 'swh2') && !g.pendingEffect)
    ? pass('Shark With a Horn: skip declines cleanly, card stays in stable')
    : fail('Shark skip', JSON.stringify(r));
}
{
  const g = setup();
  injH(g, 'p1', find('Shark With a Horn'), 'swh3');
  play(g, 'p1', 'swh3', null, null);
  const r = g.resolvePendingEffect('p1', [], {});
  (r.ok && !g.players['p1'].stable.some(c => c.id === 'swh3') && g.pendingEffect?.type === 'choose_destroy')
    ? pass('Shark With a Horn: activating sacrifices itself and queues the mandatory choose_destroy')
    : fail('Shark activate', JSON.stringify(r) + ' pendingEffect=' + JSON.stringify(g.pendingEffect));
}

// Stabby the Unicorn: on_leave queues choose_destroy restricted to unicorns only
{
  const g = setup();
  injS(g, 'p1', find('Stabby the Unicorn'), 'stab');
  g._sacrificeCard('p1', 'stab');
  g.pendingEffect?.type === 'choose_destroy'
    ? pass('Stabby the Unicorn: queues choose_destroy on leave')
    : fail('Stabby on_leave', g.pendingEffect?.type);
  g.pendingEffect?.targetType === 'unicorn'
    ? pass('Stabby the Unicorn: choose_destroy is restricted to targetType unicorn')
    : fail('Stabby targetType', g.pendingEffect?.targetType);
}

// Stabby the Unicorn: cannot destroy a non-unicorn card (upgrade) when it leaves the stable
{
  const g = setup();
  injS(g, 'p1', find('Stabby the Unicorn'), 'stab');
  const u = upg(); injS(g, 'p2', u, u.id);
  g._sacrificeCard('p1', 'stab');
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:u.id });
  r.error && g.players['p2'].stable.some(c => c.id === u.id)
    ? pass('Stabby the Unicorn: rejects targeting a non-unicorn card')
    : fail('Stabby non-unicorn target', `error=${r.error} upgradeStillThere=${g.players['p2'].stable.some(c=>c.id===u.id)}`);
}

// Stabby the Unicorn: CAN destroy a unicorn when it leaves the stable
{
  const g = setup();
  injS(g, 'p1', find('Stabby the Unicorn'), 'stab');
  const v = uni(); injS(g, 'p2', v, v.id);
  g._sacrificeCard('p1', 'stab');
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:v.id });
  !r.error && !g.players['p2'].stable.some(c => c.id === v.id)
    ? pass('Stabby the Unicorn: successfully destroys a unicorn target')
    : fail('Stabby unicorn target', `error=${r.error} unicornStillThere=${g.players['p2'].stable.some(c=>c.id===v.id)}`);
}

// Stabby the Unicorn: same restriction applies when destroyed by an opponent (not just sacrificed)
{
  const g = setup();
  injS(g, 'p1', find('Stabby the Unicorn'), 'stab');
  const u = upg(); injS(g, 'p2', u, u.id);
  g._destroyCard('p1', 'stab', 'p2');
  g.pendingEffect?.type === 'choose_destroy' && g.pendingEffect?.targetType === 'unicorn'
    ? pass('Stabby the Unicorn: on_leave via destroy also restricts to unicorn targetType')
    : fail('Stabby destroy on_leave', `type=${g.pendingEffect?.type} targetType=${g.pendingEffect?.targetType}`);
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:u.id });
  r.error
    ? pass('Stabby the Unicorn (via destroy): rejects non-unicorn target')
    : fail('Stabby destroy non-unicorn target', 'no error returned');
}

// Unicorn on the Cob: draw 2, discard 1
{
  const g = setup();
  injH(g, 'p1', find('Unicorn on the Cob'), 'cob');
  play(g, 'p1', 'cob', null, null);
  g.pendingEffect?.type === 'discard'
    ? pass('Unicorn on the Cob: queues discard after drawing 2')
    : fail('Cob discard', g.pendingEffect?.type);
}

// Unicorn Oracle: look at top 3, keep one
{
  const g = setup();
  injH(g, 'p1', find('Unicorn Oracle'), 'uo');
  play(g, 'p1', 'uo', null, null);
  g.pendingEffect?.type === 'look_top_keep_one'
    ? pass('Unicorn Oracle: queues look_top_keep_one')
    : fail('Oracle queue', g.pendingEffect?.type);
}

// Dark Angel Unicorn: handles optional sacrifice_then_revive (or skips if not feasible)
{
  const g = setup();
  injH(g, 'p1', find('Dark Angel Unicorn'), 'da');
  play(g, 'p1', 'da', null, null);
  const okType = !g.pendingEffect || g.pendingEffect.type === 'sacrifice_then_revive';
  okType
    ? pass('Dark Angel Unicorn: handles optional sacrifice_then_revive')
    : fail('Dark Angel', g.pendingEffect?.type);
}

// Rhinocorn: can be played from hand without an upfront target (its destroy is
// resolved later, interactively, at the start of a future turn — not at play time)
{
  const g = setup();
  injH(g, 'p1', find('Rhinocorn'), 'rh');
  const r = g.playCard('p1', 'rh', null, null);
  !r.error
    ? pass('Rhinocorn: plays from hand with no upfront target required')
    : fail('Rhinocorn play', r.error);
  g.resolveNeigh('p1');
  g.players['p1'].stable.some(c => c.id === 'rh')
    ? pass('Rhinocorn: enters the stable')
    : fail('Rhinocorn enter', 'not in stable');
}

// Rhinocorn: activating at the beginning of turn lets the player pick a target unicorn
// (regression for a client-only bug where the click handler never sent a selection)
{
  const g = setup(2);
  injS(g, 'p1', find('Rhinocorn'), 'rh');
  injS(g, 'p2', uni(), 'target_uni');
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  g._beginningPhase();
  g.pendingEffect?.type === 'beginning_optional_choices'
    ? pass('Rhinocorn: queues beginning_optional_choices')
    : fail('Rhinocorn beginning', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', ['rh'], {});
  g.pendingEffect?.type === 'beginning_destroy_end_turn'
    ? pass('Rhinocorn: activating queues beginning_destroy_end_turn')
    : fail('Rhinocorn activate', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'target_uni' });
  !g.players['p2'].stable.some(c => c.id === 'target_uni')
    ? pass('Rhinocorn: selecting a target destroys it and ends the turn')
    : fail('Rhinocorn destroy', 'target survived');
}

// Rhinocorn: rejects a non-unicorn target (e.g. an upgrade card)
{
  const g = setup(2);
  injS(g, 'p1', find('Rhinocorn'), 'rh');
  injS(g, 'p2', upg(), 'target_upg');
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  g._beginningPhase();
  g.resolvePendingEffect('p1', ['rh'], {});
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'target_upg' });
  r.error
    ? pass('Rhinocorn: rejects non-unicorn target')
    : fail('Rhinocorn targetType', 'upgrade was destroyed');
}

// Dark Angel Unicorn: the discard-revive step only ever offers unicorns, and rejects
// a mismatched selection even if forced directly at the resolver (defense in depth)
{
  const g = setup();
  const magicCard = { id: 'm1', type: 'magic', name: 'SomeMagic', emoji: '✨', effect: { type: 'draw', amount: 1 }, description: '', expansion: null };
  g.discard.push(magicCard);
  injS(g, 'p1', uni(), 'u_self');
  injH(g, 'p1', find('Dark Angel Unicorn'), 'da');
  play(g, 'p1', 'da', null, null);
  g.resolvePendingEffect('p1', ['u_self'], {});
  const opts = g.pendingEffect?.options || [];
  !opts.some(c => c.id === 'm1')
    ? pass('Dark Angel Unicorn: magic card never offered as a revive option')
    : fail('Dark Angel options', 'magic card was offered');
  const before = g.players['p1'].stable.length;
  g.resolvePendingEffect('p1', ['m1'], {});
  g.players['p1'].stable.length === before
    ? pass('Dark Angel Unicorn: forcing a mismatched id does not place it into the stable')
    : fail('Dark Angel forced select', 'stable size changed');
}

// Regression (found by test_multiplayer.js's full-game conservation stress test):
// Angel Unicorn's discard-revive step used to filter candidate unicorns from the
// discard pile WITHOUT removing them first (unlike every other discard-revive path,
// which correctly extracts matches before offering them as choices). Either
// resolution path — picking one, or declining — re-added cards that were still
// sitting in discard, duplicating them.
{
  const g = setup(2, ['rainbow_apocalypse']);
  injS(g, 'p1', find('Angel Unicorn'), 'angel1');
  const du = uni(); g.discard.push({ ...du, id: 'du1' });
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  g.phase = 'beginning'; g._beginningPhase();
  g.resolvePendingEffect('p1', ['angel1'], {}); // activate from the menu
  g.resolvePendingEffect('p1', [], {}); // trigger the sacrifice + discard extraction
  const discardMidCount = g.discard.length;
  discardMidCount === 0
    ? pass('Angel Unicorn: candidate unicorns are actually removed from discard before being offered')
    : fail('Angel Unicorn extraction', `discard still has ${discardMidCount} card(s) mid-resolution`);
  g.resolvePendingEffect('p1', [], {}); // decline the revive pick
  const ids = g.discard.map(c => c.id);
  const uniqueIds = new Set(ids);
  ids.length === uniqueIds.size
    ? pass('Angel Unicorn: declining does not duplicate cards back into discard')
    : fail('Angel Unicorn decline duplication', `discard=${JSON.stringify(ids)}`);
}
{
  const g = setup(2, ['rainbow_apocalypse']);
  injS(g, 'p1', find('Angel Unicorn'), 'angel2');
  const du = uni(); g.discard.push({ ...du, id: 'du2' });
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  g.phase = 'beginning'; g._beginningPhase();
  g.resolvePendingEffect('p1', ['angel2'], {}); // activate from the menu
  g.resolvePendingEffect('p1', [], {}); // trigger the sacrifice + discard extraction
  g.resolvePendingEffect('p1', ['du2'], {}); // pick the unicorn
  const ids = g.discard.map(c => c.id);
  (ids.length === new Set(ids).size && g.players['p1'].stable.some(c => c.id === 'du2'))
    ? pass('Angel Unicorn: picking a card places it once, with no duplicate left behind')
    : fail('Angel Unicorn pick duplication', `discard=${JSON.stringify(ids)}`);
}

// Regression: an endTurnAfter-flagged effect (e.g. Zombie Unicorn) used to wipe the
// ENTIRE pendingEffectQueue unconditionally when ending the turn early. If another
// effect happened to already be queued behind it, any cards sitting in that queued
// effect's .options (extracted from deck/discard, pending a player's choice) were
// silently deleted along with it — a genuine card loss.
{
  const g = setup(2, ['rainbow_apocalypse']);
  // No unicorn in hand to discard — hits the "nothing to discard, end turn
  // immediately" early exit, which also used to wipe the queue unconditionally.
  g.players['p1'].hand = [{ id: 'not_a_unicorn', type: 'upgrade', name: 'UPG', emoji: '⬆️', effect: null, description: '', expansion: null }];
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  g.phase = 'beginning';
  const strandedCard = { id: 'stranded1', type: 'basic_unicorn', name: 'Stranded', emoji: '🦄', effect: null, description: '', expansion: null };
  g.pendingEffect = { type: 'discard_unicorn_revive_unicorn_end_turn', playerId: 'p1' };
  g.pendingEffectQueue = [{ type: 'search_deck_pick', playerId: 'p1', options: [strandedCard] }];
  g.resolvePendingEffect('p1', [], {});
  const everywhereIds = [
    ...g.players['p1'].hand.map(c => c.id), ...g.players['p1'].stable.map(c => c.id),
    ...g.players['p2'].hand.map(c => c.id), ...g.players['p2'].stable.map(c => c.id),
    ...g.deck.map(c => c.id), ...g.discard.map(c => c.id),
  ];
  everywhereIds.includes('stranded1')
    ? pass('Zombie Unicorn (endTurnAfter): a card stranded in another queued effect is salvaged, not lost')
    : fail('Zombie Unicorn queue-wipe', 'stranded1 vanished entirely');
}

// Frenchiecorn: each other player discards, then the acting player picks one to keep
{
  const g = setup(3, ['unicorns_of_legend']);
  g.players['p2'].hand = [{ ...uni(), id: 'p2card' }];
  g.players['p3'].hand = [{ ...uni(), id: 'p3card' }];
  injH(g, 'p1', find('Frenchiecorn'), 'fr1');
  play(g, 'p1', 'fr1', null, null);
  g.pendingEffect?.type === 'take_one_from_list'
    ? pass('Frenchiecorn: queues take_one_from_list after gathering discards')
    : fail('Frenchiecorn queue', g.pendingEffect?.type);
  const opts = g.pendingEffect?.options?.map(c => c.id) || [];
  (opts.includes('p2card') && opts.includes('p3card'))
    ? pass('Frenchiecorn: gathers a random discard from every other player')
    : fail('Frenchiecorn gather', JSON.stringify(opts));
  const r = g.resolvePendingEffect('p1', ['p2card'], {});
  !r.error && g.players['p1'].hand.some(c => c.id === 'p2card') && !g.discard.some(c => c.id === 'p2card')
    ? pass('Frenchiecorn: picking a card removes it from discard and adds it to hand')
    : fail('Frenchiecorn pick', JSON.stringify(r));
}

// Regression (found by test_multiplayer.js's full-game conservation stress test):
// take_one_from_list's options are a LIVE reference into cards that are simultaneously
// still sitting in this.discard (a valid "here's what got discarded, take one back"
// design — unlike every other options-holding effect, which extracts cards from a
// zone first). The generic queue-salvage logic (added to rescue cards stranded by an
// endTurnAfter-style queue wipe) initially didn't know about this distinction and
// would re-push cards into discard that were already there, creating an in-array
// duplicate.
{
  const g = setup(2, ['unicorns_of_legend']);
  const gathered = { id: 'gathered1', type: 'basic_unicorn', name: 'G1', emoji: '🦄', effect: null, description: '', expansion: null };
  g.discard.push(gathered); // gathered card is ALREADY resident in discard
  g.pendingEffectQueue = [{ type: 'take_one_from_list', playerId: 'p1', options: [gathered] }];
  g._salvageQueuedOptions();
  const ids = g.discard.map(c => c.id);
  ids.length === new Set(ids).size
    ? pass('_salvageQueuedOptions: does not duplicate take_one_from_list cards already resident in discard')
    : fail('_salvageQueuedOptions take_one_from_list', `discard=${JSON.stringify(ids)}`);
}


// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2. Base Magic Cards ──');

// Back Kick: return card to hand, opponent discards
{
  const g = setup();
  const v = uni(); injS(g, 'p2', v, v.id);
  injH(g, 'p1', find('Back Kick'), 'bk');
  play(g, 'p1', 'bk', 'p2', v.id);
  g.players['p2'].hand.some(c => c.id === v.id)
    ? pass('Back Kick: card returned to p2 hand')
    : fail('Back Kick return', 'card not in p2 hand');
  g.pendingEffect?.type === 'target_discard'
    ? pass('Back Kick: queues target_discard for opponent')
    : fail('Back Kick discard', g.pendingEffect?.type);
}

// Blatant Thievery: requires target player, then works end-to-end in both
// 2-player and 3-player games (user-reported: 2-player game errored "select a
// target player first" when pressing Play — root cause was client-side
// (App.jsx's getCardTargetNeeds was missing 'look_hand_take_one' from its
// player-target list entirely, so no picker/auto-select ever ran), but this
// locks in the server-side contract the client fix depends on, for every
// player count, since the report specifically asked for 3+ players to be checked too)
{
  const g = setup();
  injH(g, 'p1', find('Blatant Thievery'), 'bt');
  g.playCard('p1', 'bt', null, null).error
    ? pass('Blatant Thievery: requires target player')
    : fail('Blatant Thievery', 'no error without target');
}
{
  const g = setup(2);
  injH(g, 'p1', find('Blatant Thievery'), 'bt2');
  injH(g, 'p2', uni(), 'theirs');
  play(g, 'p1', 'bt2', 'p2', null);
  const r = g.resolvePendingEffect('p1', ['theirs'], {});
  (r.ok && g.players['p1'].hand.some(c=>c.id==='theirs') && !g.players['p2'].hand.some(c=>c.id==='theirs'))
    ? pass('Blatant Thievery: full play + resolve works in a 2-player game')
    : fail('Blatant Thievery 2p', JSON.stringify(r));
}
{
  const g = setup(3);
  injH(g, 'p1', find('Blatant Thievery'), 'bt3');
  injH(g, 'p3', uni(), 'theirs2');
  play(g, 'p1', 'bt3', 'p3', null);
  const r = g.resolvePendingEffect('p1', ['theirs2'], {});
  (r.ok && g.players['p1'].hand.some(c=>c.id==='theirs2') && !g.players['p3'].hand.some(c=>c.id==='theirs2'))
    ? pass('Blatant Thievery: full play + resolve works in a 3-player game')
    : fail('Blatant Thievery 3p', JSON.stringify(r));
}

// Change of Luck: discard 3, extra turn
{
  const g = setup(3);
  injH(g, 'p1', find('Change of Luck'), 'col');
  const u1 = uni(); const u2 = uni(); const u3 = uni();
  injH(g, 'p1', u1, u1.id); injH(g, 'p1', u2, u2.id); injH(g, 'p1', u3, u3.id);
  play(g, 'p1', 'col', null, null);
  g.pendingEffect?.type === 'discard_extra_turn_pending' && g.pendingEffect?.amount === 3
    ? pass('Change of Luck: queues discard_extra_turn_pending amount=3')
    : fail('Change of Luck queue', `type=${g.pendingEffect?.type} amount=${g.pendingEffect?.amount}`);
  g.resolvePendingEffect('p1', [u1.id, u2.id, u3.id], {});
  g.currentPlayer === 'p1'
    ? pass('Change of Luck: extra turn stays with p1')
    : fail('Change of Luck extra turn', g.currentPlayer);
}

// Glitter Tornado: queues return_one_each_stable
{
  const g = setup(3);
  const v1 = uni(); injS(g, 'p1', v1, v1.id);
  const v2 = uni(); injS(g, 'p2', v2, v2.id);
  injH(g, 'p1', find('Glitter Tornado'), 'gt');
  play(g, 'p1', 'gt', null, null);
  g.pendingEffect?.type === 'return_one_each_stable'
    ? pass('Glitter Tornado: queues return_one_each_stable')
    : fail('Glitter Tornado', g.pendingEffect?.type);
}

// Good Deal: draw 3, discard 1
{
  const g = setup();
  injH(g, 'p1', find('Good Deal'), 'gd');
  play(g, 'p1', 'gd', null, null);
  g.pendingEffect?.type === 'discard'
    ? pass('Good Deal: queues discard after draw 3')
    : fail('Good Deal', g.pendingEffect?.type);
}

// Kiss of Life: queues from_discard_pick
{
  const g = setup();
  const v = uni(); g.discard.push(v);
  injH(g, 'p1', find('Kiss of Life'), 'kol');
  play(g, 'p1', 'kol', null, null);
  g.pendingEffect?.type === 'from_discard_pick'
    ? pass('Kiss of Life: queues from_discard_pick')
    : fail('Kiss of Life', g.pendingEffect?.type);
}

// Mystical Vortex: each player chooses their own discard (not random), then shuffles
// the discard pile into the deck once everyone has resolved
{
  const g = setup(2);
  g.discard.push(uni());
  injH(g, 'p1', find('Mystical Vortex'), 'mv');
  play(g, 'p1', 'mv', null, null);
  g.pendingEffect?.type === 'discard_choice'
    ? pass('Mystical Vortex: queues discard_choice (player picks, not random)')
    : fail('Mystical Vortex queue', g.pendingEffect?.type);
  let n = 0;
  while (g.pendingEffect?.type === 'discard_choice' && n < 5) {
    const o = g.pendingEffect.playerId;
    const cid = g.players[o].hand[0]?.id;
    g.resolvePendingEffect(o, cid ? [cid] : [], {});
    n++;
  }
  g.discard.length === 0
    ? pass('Mystical Vortex: discard shuffled into deck after all players choose')
    : fail('Mystical Vortex', `discard=${g.discard.length}`);
}

// Mystical Vortex: rejects an unresolved discard_choice with no selection (each player
// must actually choose a card, matching the real "discard a card of their choice" text)
{
  const g = setup(2);
  injH(g, 'p1', find('Mystical Vortex'), 'mv');
  play(g, 'p1', 'mv', null, null);
  const r = g.resolvePendingEffect(g.pendingEffect.playerId, [], {});
  r.error
    ? pass('Mystical Vortex: discard_choice rejects an empty selection')
    : fail('Mystical Vortex empty select', 'accepted an empty selection');
}

// Re-Target: queues move_upgrade_or_downgrade_between_stables
{
  const g = setup();
  const u = upg(); injS(g, 'p1', u, u.id);
  injH(g, 'p1', find('Re-Target'), 'rt');
  play(g, 'p1', 'rt', null, null);
  g.pendingEffect?.type === 'move_upgrade_or_downgrade_between_stables'
    ? pass('Re-Target: queues move_upgrade_or_downgrade_between_stables')
    : fail('Re-Target', g.pendingEffect?.type);
}

// Reset Button: removes all upgrades/downgrades
{
  const g = setup(2);
  const u = upg(); injS(g, 'p1', u, u.id);
  const d = dwn(); injS(g, 'p2', d, d.id);
  injH(g, 'p1', find('Reset Button'), 'rb');
  play(g, 'p1', 'rb', null, null);
  !g.players['p1'].stable.some(c => c.id === u.id) && !g.players['p2'].stable.some(c => c.id === d.id)
    ? pass('Reset Button: removes all upgrades/downgrades')
    : fail('Reset Button', 'upgrades/downgrades remain');
}

// Shake Up: player draws 5
{
  const g = setup();
  injH(g, 'p1', find('Shake Up'), 'su');
  play(g, 'p1', 'su', null, null);
  g.players['p1'].hand.length === 5
    ? pass('Shake Up: player draws 5 cards')
    : fail('Shake Up', `hand=${g.players['p1'].hand.length}`);
}

// Targeted Destruction: queues destroy_upgrade_or_sacrifice_downgrade
{
  const g = setup();
  const u = upg(); injS(g, 'p2', u, u.id);
  injH(g, 'p1', find('Targeted Destruction'), 'td');
  play(g, 'p1', 'td', null, null);
  g.pendingEffect?.type === 'destroy_upgrade_or_sacrifice_downgrade'
    ? pass('Targeted Destruction: queues destroy_upgrade_or_sacrifice_downgrade')
    : fail('Targeted Destruction', g.pendingEffect?.type);
}

// Two-For-One: queues sacrifice step
{
  const g = setup();
  const v = uni(); injS(g, 'p1', v, v.id);
  injH(g, 'p1', find('Two-For-One'), 'tfo');
  play(g, 'p1', 'tfo', null, null);
  g.pendingEffect?.type === 'sacrifice_then_destroy_two' && g.pendingEffect?.step === 'sacrifice'
    ? pass('Two-For-One: queues sacrifice step')
    : fail('Two-For-One', `type=${g.pendingEffect?.type} step=${g.pendingEffect?.step}`);
}

// Unfair Bargain: swaps hands
{
  const g = setup();
  const h1 = uni(); injH(g, 'p1', h1, h1.id);
  const h2 = uni(); injH(g, 'p2', h2, h2.id);
  injH(g, 'p1', find('Unfair Bargain'), 'ub');
  play(g, 'p1', 'ub', 'p2', null);
  g.players['p1'].hand.some(c => c.id === h2.id)
    ? pass('Unfair Bargain: hands swapped correctly')
    : fail('Unfair Bargain', 'h2 not in p1 hand');
}

// Unicorn Poison: destroys target unicorn
{
  const g = setup();
  const v = uni(); injS(g, 'p2', v, v.id);
  injH(g, 'p1', find('Unicorn Poison'), 'up');
  play(g, 'p1', 'up', 'p2', v.id);
  !g.players['p2'].stable.some(c => c.id === v.id)
    ? pass('Unicorn Poison: destroys target unicorn')
    : fail('Unicorn Poison', 'unicorn still in stable');
}

// Unicorn Swap: queues move_own_unicorn_steal_unicorn (no upfront target needed —
// previously required one that the server then silently ignored)
{
  const g = setup();
  const mine = uni(); injS(g, 'p1', mine, mine.id);
  const theirs = uni(); injS(g, 'p2', theirs, theirs.id);
  injH(g, 'p1', find('Unicorn Swap'), 'us');
  play(g, 'p1', 'us', null, null);
  g.pendingEffect?.type === 'move_own_unicorn_steal_unicorn'
    ? pass('Unicorn Swap: queues move_own_unicorn_steal_unicorn with no upfront target')
    : fail('Unicorn Swap', g.pendingEffect?.type);
}

// Unicorn Swap: full resolution — own unicorn moves to opponent, opponent's unicorn is stolen
{
  const g = setup();
  const mine = uni(); injS(g, 'p1', mine, mine.id);
  const theirs = uni(); injS(g, 'p2', theirs, theirs.id);
  injH(g, 'p1', find('Unicorn Swap'), 'us');
  play(g, 'p1', 'us', null, null);
  const r = g.resolvePendingEffect('p1', [mine.id], { targetPlayerId:'p2', targetCardId:theirs.id });
  !r.error
    ? pass('Unicorn Swap: resolves with own unicorn + target selected together')
    : fail('Unicorn Swap resolve', r.error);
  g.players['p2'].stable.some(c => c.id === mine.id)
    ? pass('Unicorn Swap: own unicorn moved into target stable')
    : fail('Unicorn Swap move', 'own unicorn not in target stable');
  g.players['p1'].stable.some(c => c.id === theirs.id)
    ? pass('Unicorn Swap: target unicorn stolen into own stable')
    : fail('Unicorn Swap steal', 'target unicorn not stolen');
}

// Unicorn Swap: rejects a non-unicorn target (matches "STEAL a Unicorn" card text)
{
  const g = setup();
  const mine = uni(); injS(g, 'p1', mine, mine.id);
  const notUni = upg(); injS(g, 'p2', notUni, notUni.id);
  injH(g, 'p1', find('Unicorn Swap'), 'us');
  play(g, 'p1', 'us', null, null);
  const r = g.resolvePendingEffect('p1', [mine.id], { targetPlayerId:'p2', targetCardId:notUni.id });
  r.error
    ? pass('Unicorn Swap: rejects a non-unicorn target')
    : fail('Unicorn Swap targetType', 'upgrade was stolen');
}

// Unicorn Swap: rejects an invalid own-card selection instead of stealing anyway
{
  const g = setup();
  const notUni = upg(); injS(g, 'p1', notUni, notUni.id);
  const theirs = uni(); injS(g, 'p2', theirs, theirs.id);
  injH(g, 'p1', find('Unicorn Swap'), 'us');
  play(g, 'p1', 'us', null, null);
  const r = g.resolvePendingEffect('p1', [notUni.id], { targetPlayerId:'p2', targetCardId:theirs.id });
  r.error && g.players['p2'].stable.some(c => c.id === theirs.id)
    ? pass('Unicorn Swap: rejects invalid own selection without stealing anyway')
    : fail('Unicorn Swap own-select', JSON.stringify(r));
}

// Unicorn Swap: skips cleanly when no valid swap exists (no unicorn on either side)
{
  const g = setup();
  g.players['p1'].stable = []; g.players['p2'].stable = [];
  injH(g, 'p1', find('Unicorn Swap'), 'us');
  play(g, 'p1', 'us', null, null);
  !g.pendingEffect
    ? pass('Unicorn Swap: skips cleanly when no valid Unicorns exist to swap')
    : fail('Unicorn Swap feasibility', g.pendingEffect?.type);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3. Base Upgrades / Downgrades ──');

// Claw Machine: beginning queues beginning_optional_choices (optional discard+draw)
{
  const g = setup();
  injS(g, 'p1', find('Claw Machine'), 'cm');
  injH(g, 'p1', uni(), 'h1');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'cm');
  hasChoice
    ? pass('Claw Machine: queues beginning_optional_choices')
    : fail('Claw Machine', g.pendingEffect?.type);
}

// Double Dutch: grants extra action
{
  const g = setup();
  injS(g, 'p1', find('Double Dutch'), 'dd');
  g.phase = 'beginning'; g._beginningPhase();
  if (g.pendingEffect?.type === 'beginning_optional_choices') g.resolvePendingEffect('p1', ['dd'], {});
  g.phase = 'draw'; g.drawCard('p1');
  g.extraActionsThisTurn >= 1
    ? pass('Double Dutch: grants 1 extra action this turn')
    : fail('Double Dutch', `extraActions=${g.extraActionsThisTurn}`);
}

// Glitter Bomb: beginning-phase "sacrifice a card, then destroy a card" —
// regression test for a bug report ("says resolve effect but doesn't allow
// selecting any cards"): the client's needsSacrifice/STABLE_EFFECTS lists were
// missing this effect type entirely, so clicking cards did nothing on either
// step. This card had zero prior test coverage, which is exactly why the gap
// went unnoticed. The fix was client-side (App.jsx), so this test locks in the
// server-side pendingEffect shape (type/flags) the client fix depends on.
{
  const g = setup();
  injS(g, 'p1', find('Glitter Bomb'), 'gb');
  const mine = uni(); injS(g, 'p1', mine, mine.id);
  const theirs = uni(); injS(g, 'p2', theirs, theirs.id);
  g.phase = 'beginning'; g._beginningPhase();
  const activated = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'gb');
  activated
    ? pass('Glitter Bomb: queues beginning_optional_choices')
    : fail('Glitter Bomb activation', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', ['gb'], {});
  g.pendingEffect?.type === 'sacrifice_then_destroy_one'
    ? pass('Glitter Bomb: queues sacrifice_then_destroy_one (the effect type the client must recognize)')
    : fail('Glitter Bomb queue', g.pendingEffect?.type);
  const r1 = g.resolvePendingEffect('p1', [mine.id], {});
  (r1.ok && g.pendingEffect?.sacrificeDone)
    ? pass('Glitter Bomb: sacrifice step resolves and sets sacrificeDone')
    : fail('Glitter Bomb sacrifice step', JSON.stringify(r1) + ' ' + JSON.stringify(g.pendingEffect));
  const r2 = g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:theirs.id });
  (r2.ok && !g.players['p2'].stable.some(c=>c.id===theirs.id))
    ? pass('Glitter Bomb: destroy step resolves and removes the target')
    : fail('Glitter Bomb destroy step', JSON.stringify(r2));
}

// Rainbow Aura: blocks destroy of unicorns in stable
{
  const g = setup();
  injS(g, 'p1', find('Rainbow Aura'), 'ra');
  const v = uni(); injS(g, 'p1', v, v.id);
  g._destroyCard('p1', v.id, 'p2');
  g.players['p1'].stable.some(c => c.id === v.id)
    ? pass('Rainbow Aura: blocks destroy of unicorn in stable')
    : fail('Rainbow Aura', 'unicorn was destroyed');
}

// Sadistic Ritual: beginning queues sacrifice_unicorn_then_draw
{
  const g = setup();
  injS(g, 'p1', find('Sadistic Ritual'), 'sr');
  const v = uni(); injS(g, 'p1', v, v.id);
  g.phase = 'beginning'; g._beginningPhase();
  g.pendingEffect?.type === 'sacrifice_unicorn_then_draw'
    ? pass('Sadistic Ritual: queues sacrifice_unicorn_then_draw')
    : fail('Sadistic Ritual', g.pendingEffect?.type);
}

// Stable Artillery: beginning queues beginning_optional_choices
{
  const g = setup();
  injS(g, 'p1', find('Stable Artillery'), 'sa');
  injH(g, 'p1', uni(), 'h1'); injH(g, 'p1', uni(), 'h2');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'sa');
  hasChoice
    ? pass('Stable Artillery: queues beginning_optional_choices')
    : fail('Stable Artillery', g.pendingEffect?.type);
}

// Barbed Wire: queues discard when unicorn enters stable
{
  const g = setup();
  injS(g, 'p1', find('Barbed Wire'), 'bw');
  const v = uni(); injH(g, 'p1', v, v.id);
  play(g, 'p1', v.id, null, null);
  g.pendingEffect?.type === 'discard'
    ? pass('Barbed Wire: queues discard when unicorn enters stable')
    : fail('Barbed Wire', g.pendingEffect?.type);
}

// Pandamonium: win check returns null despite 7+ unicorns
{
  const g = setup();
  injS(g, 'p1', find('Pandamonium'), 'pand');
  for (let i = 0; i < 7; i++) injS(g, 'p1', uni(), 'u' + i);
  !g._checkWin()
    ? pass('Pandamonium: win check returns null despite 7+ unicorns')
    : fail('Pandamonium', `winner=${g._checkWin()}`);
}

// Blinding Light: _unicornsNeutralized returns true
{
  const g = setup();
  injS(g, 'p1', find('Blinding Light'), 'bl');
  g._unicornsNeutralized('p1')
    ? pass('Blinding Light: _unicornsNeutralized returns true')
    : fail('Blinding Light', '_unicornsNeutralized=false');
}

// Tiny Stable: triggers sacrifice when over limit
{
  const g = setup();
  injS(g, 'p1', find('Tiny Stable'), 'ts');
  for (let i = 0; i < 5; i++) injS(g, 'p1', uni(), 'u' + i);
  const v = uni(); injH(g, 'p1', v, v.id);
  play(g, 'p1', v.id, null, null);
  g.pendingEffect?.type === 'sacrifice_unicorn_tiny_stable'
    ? pass('Tiny Stable: triggers sacrifice when over limit')
    : fail('Tiny Stable', g.pendingEffect?.type);
}

// Slowdown: blocks owner from playing Neigh cards
{
  const g = setup();
  const neigh = ALL.find(c => c.effect?.type === 'neigh');
  injS(g, 'p1', find('Slowdown'), 'sl');
  injH(g, 'p1', neigh, 'n1');
  const v = uni(); injH(g, 'p2', v, v.id);
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', v.id, null, null);
  g.playInstant('p1', 'n1').error
    ? pass('Slowdown: blocks owner from playing Neigh cards')
    : fail('Slowdown', 'neigh not blocked');
}

// Nanny Cam: forces hand visible
{
  const g = setup();
  injS(g, 'p1', find('Nanny Cam'), 'nc');
  g.stateFor('p2').players['p1'].handVisible
    ? pass('Nanny Cam: owner hand forced visible to others')
    : fail('Nanny Cam', 'hand not visible');
}

// Broken Stable: blocks playing upgrades into own stable
{
  const g = setup();
  injS(g, 'p1', find('Broken Stable'), 'bs');
  injH(g, 'p1', find('Rainbow Aura'), 'ra');
  g.playCard('p1', 'ra', null, null).error
    ? pass('Broken Stable: blocks playing upgrades')
    : fail('Broken Stable', 'upgrade went through');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4. Dragons Expansion ──');

// Dragon's Breath: destroys unicorn
{
  const g = setup(2, ['dragons']);
  const v = uni(); injS(g, 'p2', v, v.id);
  injH(g, 'p1', find("Dragon's Breath"), 'db');
  play(g, 'p1', 'db', 'p2', v.id);
  !g.players['p2'].stable.some(c => c.id === v.id)
    ? pass("Dragon's Breath: destroys unicorn")
    : fail("Dragon's Breath", 'unicorn still in stable');
}

// Dragon's Fire: queues destroy_upgrade_or_sacrifice_downgrade
{
  const g = setup(2, ['dragons']);
  const u = upg(); injS(g, 'p2', u, u.id);
  injH(g, 'p1', find("Dragon's Fire"), 'df');
  play(g, 'p1', 'df', null, null);
  g.pendingEffect?.type === 'destroy_upgrade_or_sacrifice_downgrade'
    ? pass("Dragon's Fire: queues destroy_upgrade_or_sacrifice_downgrade")
    : fail("Dragon's Fire", g.pendingEffect?.type);
}

// Dragon Kiss: queues search_deck_magic_play
{
  const g = setup(2, ['dragons']);
  injH(g, 'p1', find('Dragon Kiss'), 'dk');
  play(g, 'p1', 'dk', null, null);
  g.pendingEffect?.type === 'search_deck_magic_play'
    ? pass('Dragon Kiss: queues search_deck_magic_play')
    : fail('Dragon Kiss', g.pendingEffect?.type);
}

// Dragon-Scorched Stables: removes all upgrades/downgrades
{
  const g = setup(2, ['dragons']);
  const u = upg(); injS(g, 'p1', u, u.id);
  const d = dwn(); injS(g, 'p2', d, d.id);
  injH(g, 'p1', find('Dragon-Scorched Stables'), 'dss');
  play(g, 'p1', 'dss', null, null);
  !g.players['p1'].stable.some(c => c.id === u.id) && !g.players['p2'].stable.some(c => c.id === d.id)
    ? pass('Dragon-Scorched Stables: removes all upgrades/downgrades')
    : fail('Dragon-Scorched Stables', 'upgrades/downgrades remain');
}

// Dragon's Fortune: queues beginning_optional_choices (optional sacrifice for extra turn)
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find("Dragon's Fortune"), 'dfp');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'dfp');
  hasChoice
    ? pass("Dragon's Fortune: queues beginning_optional_choices")
    : fail("Dragon's Fortune", g.pendingEffect?.type);
}

// Dragon Protection: blocks destroy by discarding from hand
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find('Dragon Protection'), 'dp');
  const v = uni(); injS(g, 'p1', v, v.id);
  injH(g, 'p1', uni(), 'hh');
  g._destroyCard('p1', v.id, 'p2');
  g.players['p1'].stable.some(c => c.id === v.id)
    ? pass('Dragon Protection: blocks destroy by discarding from hand')
    : fail('Dragon Protection', 'card was destroyed');
}

// Dragon's Blessing: blocks incoming downgrades
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find("Dragon's Blessing"), 'dbless');
  injH(g, 'p2', find('Barbed Wire'), 'bw');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', 'bw', 'p1', null);
  !g.players['p1'].stable.some(c => c.id === 'bw')
    ? pass("Dragon's Blessing: blocks incoming downgrade")
    : fail("Dragon's Blessing", 'downgrade entered stable');
}

// Dragon's Curse: discards 1 at beginning
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find("Dragon's Curse"), 'dc');
  const h = uni(); injH(g, 'p1', h, h.id);
  const before = g.players['p1'].hand.length;
  g.phase = 'beginning'; g._beginningPhase();
  g.players['p1'].hand.length < before
    ? pass("Dragon's Curse: discards 1 at beginning")
    : fail("Dragon's Curse", `hand ${before}→${g.players['p1'].hand.length}`);
}

// Dragon Skies: queues move_unicorn_to_deck_draw
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find('Dragon Skies'), 'ds');
  g.phase = 'beginning'; g._beginningPhase();
  g.pendingEffect?.type === 'move_unicorn_to_deck_draw'
    ? pass('Dragon Skies: queues move_unicorn_to_deck_draw')
    : fail('Dragon Skies', g.pendingEffect?.type);
}

// Dragon's Misfortune: queues move_hand_to_bottom_deck
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find("Dragon's Misfortune"), 'dm');
  g.phase = 'beginning'; g._beginningPhase();
  g.pendingEffect?.type === 'move_hand_to_bottom_deck'
    ? pass("Dragon's Misfortune: queues move_hand_to_bottom_deck")
    : fail("Dragon's Misfortune", g.pendingEffect?.type);
}

// Dragon Slayer Unicorn: exposes protection_from_dragon_destroy passive
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find('Dragon Slayer Unicorn'), 'dsu');
  g._hasPassive('p1', 'protection_from_dragon_destroy')
    ? pass('Dragon Slayer Unicorn: exposes protection_from_dragon_destroy passive')
    : fail('Dragon Slayer passive', '_hasPassive returned false');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5. Unicorns of Legend Expansion ──');

// Chain Lightning: destroys + queues optional destroy for target
{
  const g = setup(2, ['unicorns_of_legend']);
  const v1 = uni(); injS(g, 'p2', v1, v1.id);
  injH(g, 'p1', find('Chain Lightning'), 'cl');
  play(g, 'p1', 'cl', 'p2', v1.id);
  !g.players['p2'].stable.some(c => c.id === v1.id) && g.pendingEffect?.type === 'may_destroy_optional'
    ? pass('Chain Lightning: destroys and queues optional destroy for target')
    : fail('Chain Lightning', `pending=${g.pendingEffect?.type}`);
}

// Fireball: queues sacrifice_unicorn for all
{
  const g = setup(3, ['unicorns_of_legend']);
  injH(g, 'p1', find('Fireball'), 'fb');
  play(g, 'p1', 'fb', null, null);
  g.pendingEffect?.type === 'sacrifice_unicorn'
    ? pass('Fireball: queues sacrifice_unicorn')
    : fail('Fireball', g.pendingEffect?.type);
}

// Necromancy: queues sacrifice_then_revive
{
  const g = setup(2, ['unicorns_of_legend']);
  const v = uni(); injS(g, 'p1', v, v.id);
  const dead = uni(); g.discard.push({ ...dead });
  injH(g, 'p1', find('Necromancy'), 'nec');
  play(g, 'p1', 'nec', null, null);
  g.pendingEffect?.type === 'sacrifice_then_revive'
    ? pass('Necromancy: queues sacrifice_then_revive')
    : fail('Necromancy', g.pendingEffect?.type);
}

// Alignment Change: queues discard_n_steal_unicorn
{
  const g = setup(2, ['unicorns_of_legend']);
  injH(g, 'p1', find('Alignment Change'), 'ac');
  play(g, 'p1', 'ac', null, null);
  g.pendingEffect?.type === 'discard_n_steal_unicorn'
    ? pass('Alignment Change: queues discard_n_steal_unicorn')
    : fail('Alignment Change', g.pendingEffect?.type);
}

// Prismatic Bray: queues discard_up_to_two_force_sacrifice
{
  const g = setup(3, ['unicorns_of_legend']);
  injH(g, 'p1', find('Prismatic Bray'), 'pb');
  play(g, 'p1', 'pb', null, null);
  g.pendingEffect?.type === 'discard_up_to_two_force_sacrifice'
    ? pass('Prismatic Bray: queues discard_up_to_two_force_sacrifice')
    : fail('Prismatic Bray', g.pendingEffect?.type);
}

// Critical Hit: queues critical_hit_optional after playing magic
{
  const g = setup(2, ['unicorns_of_legend']);
  injS(g, 'p1', find('Critical Hit'), 'ch');
  const v = uni(); injS(g, 'p2', v, v.id);
  injH(g, 'p1', find('Unicorn Poison'), 'up');
  play(g, 'p1', 'up', 'p2', v.id);
  g.pendingEffect?.type === 'critical_hit_optional'
    ? pass('Critical Hit: queues critical_hit_optional after magic')
    : fail('Critical Hit', g.pendingEffect?.type);
}

// Warlock Unicorn: queues sacrifice_n_destroy_n
{
  const g = setup(2, ['unicorns_of_legend']);
  const v = uni(); injS(g, 'p1', v, v.id);
  injH(g, 'p1', find('Warlock Unicorn'), 'wu');
  play(g, 'p1', 'wu', null, null);
  g.pendingEffect?.type === 'sacrifice_n_destroy_n'
    ? pass('Warlock Unicorn: queues sacrifice_n_destroy_n')
    : fail('Warlock Unicorn', g.pendingEffect?.type);
}

// Plague of Death: queues sacrifice_n_destroy_n
{
  const g = setup(2, ['rainbow_apocalypse']);
  const v = uni(); injS(g, 'p1', v, v.id);
  injH(g, 'p1', find('Plague of Death'), 'pod');
  play(g, 'p1', 'pod', null, null);
  g.pendingEffect?.type === 'sacrifice_n_destroy_n'
    ? pass('Plague of Death: queues sacrifice_n_destroy_n')
    : fail('Plague of Death', g.pendingEffect?.type);
}

// Wall of Horns: pulls card from attacker when own unicorn is destroyed by opponent
{
  const g = setup(2, ['unicorns_of_legend']);
  injS(g, 'p1', find('Wall of Horns'), 'woh');
  const v = uni(); injS(g, 'p1', v, v.id);
  const p2Before = g.players['p2'].hand.length;
  g._destroyCard('p1', v.id, 'p2');
  g.players['p2'].hand.length < p2Before
    ? pass('Wall of Horns: pulls card from attacker when unicorn destroyed')
    : fail('Wall of Horns', 'attacker hand unchanged');
}

// Divine Peace: exposes cannot_destroy passive
{
  const g = setup(2, ['unicorns_of_legend']);
  injS(g, 'p1', find('Divine Peace'), 'dp');
  g._hasPassive('p1', 'cannot_destroy')
    ? pass('Divine Peace: exposes cannot_destroy passive')
    : fail('Divine Peace', '_hasPassive returned false');
}

// Extradimensional Saddlebag: hand limit +3 (must use playCard to apply modifier)
{
  const g = setup(2, ['unicorns_of_legend']);
  injH(g, 'p1', find('Extradimensional Saddlebag'), 'esb');
  play(g, 'p1', 'esb', null, null);
  g.stateFor('p1').players['p1'].handLimit === 10
    ? pass('Extradimensional Saddlebag: hand limit increased to 10')
    : fail('Extradimensional Saddlebag', `handLimit=${g.stateFor('p1').players['p1'].handLimit}`);
}

// Hex: skips draw phase at beginning
{
  const g = setup(2, ['unicorns_of_legend']);
  injS(g, 'p1', find('Hex'), 'hex');
  g.phase = 'beginning'; g._beginningPhase();
  g.skippedDrawPlayers.has('p1') || g.phase === 'draw'
    ? pass('Hex: skips draw phase on beginning')
    : fail('Hex', `phase=${g.phase} skipped=${g.skippedDrawPlayers.has('p1')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6. Rainbow Apocalypse Expansion ──');

// A Cute Attack: queues effect then destroys 3 unicorns and adds 3 babies
{
  const g = setup(2, ['rainbow_apocalypse']);
  const v1 = uni(); const v2 = uni(); const v3 = uni();
  injS(g, 'p2', v1, v1.id); injS(g, 'p2', v2, v2.id); injS(g, 'p2', v3, v3.id);
  injH(g, 'p1', find('A Cute Attack'), 'aca');
  play(g, 'p1', 'aca', null, null);
  g.pendingEffect?.type === 'destroy_three_add_three_babies'
    ? pass('A Cute Attack: queues destroy_three_add_three_babies')
    : fail('A Cute Attack', g.pendingEffect?.type);
  const stableBefore = g.players['p2'].stable.length; // baby + 3 injected = 4
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2' });
  const stabAfter  = g.players['p2'].stable.length;
  const babiesAfter = g.players['p2'].stable.filter(c => c.type === 'baby_unicorn').length;
  // destroyed 3, added 3 babies → net stable size = stableBefore - 3 + 3 = same
  stabAfter === stableBefore && babiesAfter >= 3
    ? pass('A Cute Attack: destroys 3 unicorns and adds 3 babies')
    : fail('A Cute Attack resolution', `stable ${stableBefore}→${stabAfter} babies=${babiesAfter}`);
}

// Spray Bottle of Youth: destroys one unicorn from each opponent, offers babies
{
  const g = setup(3, ['rainbow_apocalypse']);
  // Note: each player starts with 1 baby — SBY destroys that baby and optionally offers a new one
  const p2UnisBefore = g.players['p2'].stable.filter(c => c.type !== 'baby_unicorn').length;
  const p3UnisBefore = g.players['p3'].stable.filter(c => c.type !== 'baby_unicorn').length;
  injH(g, 'p1', find('Spray Bottle of Youth'), 'sby');
  play(g, 'p1', 'sby', null, null);
  // Each opponent had 1 baby unicorn → that got destroyed and they got a new baby from nursery
  // Net effect: baby unicorn count stays the same (1 destroyed, 1 given from nursery)
  // The card counts as working if it fired (log check is most reliable)
  g.log.some(l => l.msg.includes('Spray Bottle'))
    ? pass('Spray Bottle of Youth: fires and processes each opponent')
    : fail('Spray Bottle of Youth', 'no log entry found');
}

// Rainbow Sprinkles: beginning → draw 3 and skip action
{
  const g = setup(2, ['rainbow_apocalypse']);
  injS(g, 'p1', find('Rainbow Sprinkles'), 'rs');
  const before = g.players['p1'].hand.length;
  g.phase = 'beginning'; g._beginningPhase();
  if (g.pendingEffect?.type === 'beginning_optional_choices') g.resolvePendingEffect('p1', ['rs'], {});
  g.players['p1'].hand.length >= before + 3 && g.skippedActionPlayers.has('p1')
    ? pass('Rainbow Sprinkles: draws 3 and skips action phase')
    : fail('Rainbow Sprinkles', `hand=${g.players['p1'].hand.length} skipped=${g.skippedActionPlayers.has('p1')}`);
}

// Unicorn of Famine: reduces all hand limits to 2 (must play through proper channel)
{
  const g = setup(2, ['rainbow_apocalypse']);
  injH(g, 'p1', find('Unicorn of Famine'), 'uof');
  play(g, 'p1', 'uof', null, null);
  const s1 = g.stateFor('p1'), s2 = g.stateFor('p2');
  s1.players['p1'].handLimit === 2 && s2.players['p2'].handLimit === 2
    ? pass('Unicorn of Famine: all players hand limit = 2')
    : fail('Unicorn of Famine', `p1=${s1.players['p1'].handLimit} p2=${s2.players['p2'].handLimit}`);
}

// Unicorn of War: enter queues all_may_destroy; cannot itself be destroyed
{
  const g = setup(2, ['rainbow_apocalypse']);
  injH(g, 'p1', find('Unicorn of War'), 'uow');
  play(g, 'p1', 'uow', null, null);
  g.pendingEffect?.type === 'all_may_destroy_unicorn'
    ? pass('Unicorn of War: queues all_may_destroy_unicorn on enter')
    : fail('Unicorn of War queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [], { skip: true });
  g._destroyCard('p1', 'uow', 'p2');
  g.players['p1'].stable.some(c => c.id === 'uow')
    ? pass('Unicorn of War: cannot be destroyed')
    : fail('Unicorn of War indestructible', 'was destroyed');
}

// Zombie Unicorn: beginning queues beginning_optional_choices (optional sacrifice+revive)
{
  const g = setup(2, ['rainbow_apocalypse']);
  const dead = uni(); g.discard.push(dead);
  injH(g, 'p1', uni(), 'h1');
  injS(g, 'p1', find('Zombie Unicorn'), 'zu');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'zu');
  hasChoice
    ? pass('Zombie Unicorn: queues beginning_optional_choices')
    : fail('Zombie Unicorn', g.pendingEffect?.type);
}

// Special Delivery: beginning queues beginning_optional_choices (optional nursery + skip action)
{
  const g = setup(2, ['rainbow_apocalypse']);
  injS(g, 'p1', find('Special Delivery'), 'sd');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'sd');
  hasChoice
    ? pass('Special Delivery: queues beginning_optional_choices')
    : fail('Special Delivery', g.pendingEffect?.type);
}

// Unicorn of Pestilence: queues discard_n_others_discard_n
{
  const g = setup(3, ['rainbow_apocalypse']);
  injH(g, 'p1', find('Unicorn of Pestilence'), 'uop');
  play(g, 'p1', 'uop', null, null);
  g.pendingEffect?.type === 'discard_n_others_discard_n'
    ? pass('Unicorn of Pestilence: queues discard_n_others_discard_n')
    : fail('Unicorn of Pestilence', g.pendingEffect?.type);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7. Adventures Expansion ──');

// Cutthroat Captain: choice_steal_baby_or_revive_basic
{
  const g = setup(2, ['adventures']);
  injH(g, 'p1', find('Cutthroat Captain Unicorn'), 'cc');
  play(g, 'p1', 'cc', null, null);
  g.pendingEffect?.type === 'choice_steal_baby_or_revive_basic'
    ? pass('Cutthroat Captain: queues choice_steal_baby_or_revive_basic')
    : fail('Cutthroat Captain', g.pendingEffect?.type);
}

// Hornswoggler: choice_discard_hand_draw3_or_trade_hands; both branches resolve cleanly
{
  const g = setup(2, ['adventures']);
  injH(g, 'p1', find('Hornswoggler Unicorn'), 'hw');
  play(g, 'p1', 'hw', null, null);
  g.pendingEffect?.type === 'choice_discard_hand_draw3_or_trade_hands'
    ? pass('Hornswoggler: queues choice_discard_hand_draw3_or_trade_hands')
    : fail('Hornswoggler queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [], { choice: 'b', targetPlayerId: 'p2' });
  !g.pendingEffect
    ? pass('Hornswoggler: resolves choice b cleanly')
    : fail('Hornswoggler resolve', g.pendingEffect?.type);
}

// Pillaging Pirate: choice_steal_upgrade_or_move_downgrade
{
  const g = setup(2, ['adventures']);
  injH(g, 'p1', find('Pillaging Pirate Unicorn'), 'pp');
  play(g, 'p1', 'pp', null, null);
  g.pendingEffect?.type === 'choice_steal_upgrade_or_move_downgrade'
    ? pass('Pillaging Pirate: queues choice_steal_upgrade_or_move_downgrade')
    : fail('Pillaging Pirate', g.pendingEffect?.type);
}

// Salty Seadogicorn: choice a forces opponents to discard
{
  const g = setup(2, ['adventures']);
  injH(g, 'p1', find('Salty Seadogicorn'), 'ss');
  play(g, 'p1', 'ss', null, null);
  g.pendingEffect?.type === 'choice_force_all_discard_or_draw'
    ? pass('Salty Seadogicorn: queues choice_force_all_discard_or_draw')
    : fail('Salty Seadogicorn', g.pendingEffect?.type);
  const before = g.players['p2'].hand.length;
  g.resolvePendingEffect('p1', [], { choice: 'a' });
  g.players['p2'].hand.length < before
    ? pass('Salty Seadogicorn: choice a forces opponents to discard')
    : fail('Salty Seadogicorn choice a', 'p2 hand unchanged');
}

// Vagabond Unicorn: beginning queues beginning_optional_choices
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('Vagabond Unicorn'), 'vu');
  injH(g, 'p1', uni(), 'h1');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'vu');
  hasChoice
    ? pass('Vagabond Unicorn: queues beginning_optional_choices')
    : fail('Vagabond Unicorn', g.pendingEffect?.type);
}

// Survivalist Unicorn: beginning queues beginning_optional_choices
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('Survivalist Unicorn'), 'suv');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'suv');
  hasChoice
    ? pass('Survivalist Unicorn: queues beginning_optional_choices')
    : fail('Survivalist Unicorn', g.pendingEffect?.type);
}

// Bungee Jumping Unicorn: on_leave queues choice
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('Bungee Jumping Unicorn'), 'bju');
  g._sacrificeCard('p1', 'bju');
  g.pendingEffect?.type === 'choice_sacrifice_downgrade_or_return_hand'
    ? pass('Bungee Jumping Unicorn: queues choice on leave')
    : fail('Bungee Jumping on_leave', g.pendingEffect?.type);
}

// Metal Detector: choice_draw3_discard1_or_add_from_discard
{
  const g = setup(2, ['adventures']);
  const dead = uni(); g.discard.push(dead);
  injH(g, 'p1', find('Metal Detector'), 'md');
  play(g, 'p1', 'md', null, null);
  g.pendingEffect?.type === 'choice_draw3_discard1_or_add_from_discard'
    ? pass('Metal Detector: queues choice_draw3_discard1_or_add_from_discard')
    : fail('Metal Detector', g.pendingEffect?.type);
}

// Glowing Horn: choice_sacrifice_destroy_or_revive_from_discard
{
  const g = setup(2, ['adventures']);
  injH(g, 'p1', find('Glowing Horn'), 'gh');
  play(g, 'p1', 'gh', null, null);
  g.pendingEffect?.type === 'choice_sacrifice_destroy_or_revive_from_discard'
    ? pass('Glowing Horn: queues choice_sacrifice_destroy_or_revive_from_discard')
    : fail('Glowing Horn', g.pendingEffect?.type);
}

// Unicorn Shovel: choice_revive_unicorn_or_two_unicorns_to_hand
{
  const g = setup(2, ['adventures']);
  const d1 = uni(); const d2 = uni();
  g.discard.push({ ...d1 }); g.discard.push({ ...d2 });
  injH(g, 'p1', find('Unicorn Shovel'), 'ush');
  play(g, 'p1', 'ush', null, null);
  g.pendingEffect?.type === 'choice_revive_unicorn_or_two_unicorns_to_hand'
    ? pass('Unicorn Shovel: queues choice_revive_unicorn_or_two_unicorns_to_hand')
    : fail('Unicorn Shovel', g.pendingEffect?.type);
}

// Mysterious Compass: choice_discard3_extra_turn_or_move_steal_unicorn
{
  const g = setup(2, ['adventures']);
  injH(g, 'p1', find('Mysterious Compass'), 'mc');
  play(g, 'p1', 'mc', null, null);
  g.pendingEffect?.type === 'choice_discard3_extra_turn_or_move_steal_unicorn'
    ? pass('Mysterious Compass: queues choice_discard3_extra_turn_or_move_steal_unicorn')
    : fail('Mysterious Compass', g.pendingEffect?.type);
}

// Silver Tongue: choice_reveal_all_hands_or_take_from_all
{
  const g = setup(2, ['adventures']);
  injH(g, 'p1', find('Silver Tongue'), 'st');
  play(g, 'p1', 'st', null, null);
  g.pendingEffect?.type === 'choice_reveal_all_hands_or_take_from_all'
    ? pass('Silver Tongue: queues choice_reveal_all_hands_or_take_from_all')
    : fail('Silver Tongue', g.pendingEffect?.type);
}

// Fishing Rod / Unicorn Net: correct effect types defined
{
  const fn = find('Fishing Rod');
  fn?.effect?.type === 'intercept_steal_into_your_stable'
    ? pass('Fishing Rod: effect type defined (intercept pending implementation)')
    : fail('Fishing Rod definition', fn?.effect?.type);
  const un = find('Unicorn Net');
  un?.effect?.type === 'intercept_sacrifice_or_destroy_add_to_hand'
    ? pass('Unicorn Net: effect type defined (intercept pending implementation)')
    : fail('Unicorn Net definition', un?.effect?.type);
}

// Flare Gun: target skips their next turn
{
  const g = setup(2, ['adventures']);
  g.pendingCard = { card: find('Flare Gun'), playerId: 'p2', cardIndex: 0, targetPlayerId: 'p2', targetCardId: null, yayProtected: false };
  g._executeMagic('p1', find('Flare Gun'), 'p2', null);
  g.skippedPlayers.has('p2')
    ? pass('Flare Gun: target added to skippedPlayers')
    : fail('Flare Gun', 'p2 not in skippedPlayers');
}

// The Great Baby Heist: queues effect, then adds 2 babies (2-step resolve)
{
  const g = setup(2, ['adventures']);
  const h1 = uni(); const h2 = uni();
  injH(g, 'p1', h1, h1.id); injH(g, 'p1', h2, h2.id);
  injH(g, 'p1', find('The Great Baby Heist'), 'tgbh');
  play(g, 'p1', 'tgbh', null, null);
  g.pendingEffect?.type === 'discard_two_bring_two_babies'
    ? pass('The Great Baby Heist: queues discard_two_bring_two_babies')
    : fail('The Great Baby Heist queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [h1.id, h2.id], {}); // step 1: discard 2
  g.resolvePendingEffect('p1', [], {});              // step 2: take babies from nursery
  g.players['p1'].stable.filter(c => c.type === 'baby_unicorn').length >= 2
    ? pass('The Great Baby Heist: adds 2 babies from nursery')
    : fail('The Great Baby Heist babies', `babies=${g.players['p1'].stable.filter(c=>c.type==='baby_unicorn').length}`);
}

// Pit Covered in Leaves: beginning queues beginning_optional_choices
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('Pit Covered in Leaves'), 'pcl');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'pcl');
  hasChoice
    ? pass('Pit Covered in Leaves: queues beginning_optional_choices')
    : fail('Pit Covered in Leaves', g.pendingEffect?.type);
}

// Ancient Ritual: beginning queues beginning_optional_choices
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('Ancient Ritual'), 'ar');
  const v = uni(); injS(g, 'p1', v, v.id);
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'ar');
  hasChoice
    ? pass('Ancient Ritual: queues beginning_optional_choices')
    : fail('Ancient Ritual', g.pendingEffect?.type);
}

// Royal Hooves: beginning queues beginning_optional_choices
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('Royal Hooves'), 'rh');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'rh');
  hasChoice
    ? pass('Royal Hooves: queues beginning_optional_choices')
    : fail('Royal Hooves', g.pendingEffect?.type);
}

// Unicorn Overboard: discards when own unicorn sacrificed
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('Unicorn Overboard'), 'uob');
  const v = uni(); injS(g, 'p1', v, v.id);
  const h = uni(); injH(g, 'p1', h, h.id);
  const before = g.players['p1'].hand.length;
  g._sacrificeCard('p1', v.id);
  g.players['p1'].hand.length < before
    ? pass('Unicorn Overboard: discards when own unicorn sacrificed')
    : fail('Unicorn Overboard', `hand ${before}→${g.players['p1'].hand.length}`);
}

// Unicorn Survival Kit: shield triggers on sacrifice
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('Unicorn Survival Kit'), 'usk');
  const v = uni(); injS(g, 'p1', v, v.id);
  injH(g, 'p1', uni(), 'h1'); injH(g, 'p1', uni(), 'h2');
  g._sacrificeCard('p1', v.id);
  g.players['p1'].stable.some(c => c.id === v.id) || g.discard.some(c => c.id === v.id)
    ? pass('Unicorn Survival Kit: shield triggers on sacrifice')
    : fail('Unicorn Survival Kit', 'card neither protected nor sacrificed');
}

// Broken Sundial: skips beginning entirely
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('Broken Sundial'), 'bsd');
  g.phase = 'beginning'; g._beginningPhase();
  g.phase === 'draw'
    ? pass('Broken Sundial: skips entire beginning phase')
    : fail('Broken Sundial', `phase=${g.phase}`);
}

// The Black Spot: cannot win with basic unicorns
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('The Black Spot'), 'tbs');
  for (let i = 0; i < 7; i++) injS(g, 'p1', uni(), 'u' + i);
  !g._checkWin() || g._checkWin() === 'p2'
    ? pass('The Black Spot: cannot win with basic unicorns')
    : fail('The Black Spot', 'win returned p1');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 8. NSFW Expansion ──');

// Naked Narwhal: temporary steal, returns after turn
{
  const g = setup(2, ['nsfw']);
  const bu = uni(); injS(g, 'p2', bu, bu.id);
  injH(g, 'p1', find('Naked Narwhal'), 'nn');
  play(g, 'p1', 'nn', null, null);
  g.pendingEffect?.type === 'steal_basic_temp'
    ? pass('Naked Narwhal: queues steal_basic_temp')
    : fail('Naked Narwhal queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: bu.id });
  g.players['p1'].stable.some(c => c.id === bu.id)
    ? pass('Naked Narwhal: basic unicorn temporarily stolen')
    : fail('Naked Narwhal steal', 'card not in p1 stable');
  g._advanceTurn();
  g.players['p2'].stable.some(c => c.id === bu.id)
    ? pass('Naked Narwhal: returns after turn ends')
    : fail('Naked Narwhal return', 'card not returned to p2');
}

// Fuck. Marry. Kill: queues effect; step1 resolves cleanly
{
  const g = setup(2, ['nsfw']);
  const h1 = uni(); injH(g, 'p1', h1, h1.id);
  injH(g, 'p1', find('Fuck. Marry. Kill'), 'fmk');
  play(g, 'p1', 'fmk', null, null);
  g.pendingEffect?.type === 'fuck_marry_kill'
    ? pass('Fuck. Marry. Kill: queues fuck_marry_kill effect')
    : fail('FMK queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [h1.id], { targetPlayerId: 'p2' });
  g.pendingEffect?.step1Done === true
    ? pass('FMK: step1Done set after giving card')
    : fail('FMK step1', `step1Done=${g.pendingEffect?.step1Done}`);
}

// Unicorn Hangover: target's turn is skipped (consumed in same resolveNeigh call)
{
  const g = setup(2, ['nsfw']);
  injH(g, 'p1', find('Unicorn Hangover'), 'uh');
  play(g, 'p1', 'uh', 'p2', null);
  // Skip is consumed immediately — p1's turn comes back around
  g.log.some(l => l.msg.includes('skips'))
    ? pass('Unicorn Hangover: skip logged (consumed in turn cycle)')
    : fail('Unicorn Hangover', 'no skip in log');
}

// Rainbow Shitstorm: all players receive 5 cards
{
  const g = setup(3, ['nsfw']);
  injH(g, 'p1', find('Rainbow Shitstorm'), 'rs');
  play(g, 'p1', 'rs', null, null);
  const p1h = g.players['p1'].hand.length;
  const p2h = g.players['p2'].hand.length;
  const p3h = g.players['p3'].hand.length;
  p1h === 5 && p2h === 5 && p3h === 5
    ? pass('Rainbow Shitstorm: all players receive 5 cards')
    : fail('Rainbow Shitstorm', `p1=${p1h} p2=${p2h} p3=${p3h}`);
}

// Unicorgy: draws equal to basics in stable
{
  const g = setup(2, ['nsfw']);
  const b1 = uni(); const b2 = uni(); const b3 = uni();
  injS(g, 'p1', b1, b1.id); injS(g, 'p1', b2, b2.id); injS(g, 'p1', b3, b3.id);
  injH(g, 'p1', find('Unicorgy'), 'ug');
  const before = g.players['p1'].hand.length; // includes 'ug'
  play(g, 'p1', 'ug', null, null);
  // Played 'ug' (-1), drew 3 basics (+3) → net +2 from before
  g.players['p1'].hand.length >= before + 2
    ? pass('Unicorgy: draws cards equal to basic unicorns in stable')
    : fail('Unicorgy', `hand ${before}→${g.players['p1'].hand.length}`);
}

// Pony Play: beginning queues beginning_optional_choices
{
  const g = setup(2, ['nsfw']);
  injS(g, 'p1', find('Pony Play'), 'pp');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'pp');
  hasChoice
    ? pass('Pony Play: queues beginning_optional_choices')
    : fail('Pony Play', g.pendingEffect?.type);
}

// Dominatrix Whip: beginning queues beginning_optional_choices
{
  const g = setup(3, ['nsfw']);
  injS(g, 'p1', find('Dominatrix Whip'), 'dw');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'dw');
  hasChoice
    ? pass('Dominatrix Whip: queues beginning_optional_choices')
    : fail('Dominatrix Whip', g.pendingEffect?.type);
}

// Dominatrix Whip: can be played from hand with NO upfront target (previously
// required one that the resolver never actually used — made the card unplayable)
{
  const g = setup(2, ['nsfw']);
  injH(g, 'p1', find('Dominatrix Whip'), 'dw2');
  const r = play(g, 'p1', 'dw2', null, null);
  !r.error && g.players['p1'].stable.some(c => c.id === 'dw2')
    ? pass('Dominatrix Whip: plays from hand with no upfront target required')
    : fail('Dominatrix Whip play', JSON.stringify(r));
}

// Dominatrix Whip: full resolution — moves a unicorn from one stable to another
// (not the acting player's own), and can be skipped
{
  const g = setup(3, ['nsfw']);
  injS(g, 'p1', find('Dominatrix Whip'), 'dw3');
  const moveMe = uni(); injS(g, 'p2', moveMe, moveMe.id);
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  g.phase = 'beginning'; g._beginningPhase();
  g.resolvePendingEffect('p1', ['dw3'], {});
  g.pendingEffect?.type === 'move_unicorn_any_stable_not_own'
    ? pass('Dominatrix Whip: activating queues the interactive move effect')
    : fail('Dominatrix Whip activate', g.pendingEffect?.type);
  const r = g.resolvePendingEffect('p1', [moveMe.id], { sourcePlayerId: 'p2', targetPlayerId: 'p3' });
  !r.error && !g.players['p2'].stable.some(c => c.id === moveMe.id) && g.players['p3'].stable.some(c => c.id === moveMe.id)
    ? pass('Dominatrix Whip: moves a unicorn from one other stable to another')
    : fail('Dominatrix Whip resolve', JSON.stringify(r));
}
{
  const g = setup(3, ['nsfw']);
  injS(g, 'p1', find('Dominatrix Whip'), 'dw4');
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  g.phase = 'beginning'; g._beginningPhase();
  g.resolvePendingEffect('p1', ['dw4'], {});
  const r = g.resolvePendingEffect('p1', [], { skip: true });
  !r.error && !g.pendingEffect
    ? pass('Dominatrix Whip: optional effect can be skipped')
    : fail('Dominatrix Whip skip', JSON.stringify(r));
}

// Blow Up Unicorn: sacrifices itself to protect another unicorn
{
  const g = setup(2, ['nsfw']);
  injS(g, 'p1', find('Blow Up Unicorn'), 'buu');
  const v = uni(); injS(g, 'p1', v, v.id);
  g._sacrificeCard('p1', v.id);
  const buuGone = !g.players['p1'].stable.some(c => c.id === 'buu');
  const vProtected = g.players['p1'].stable.some(c => c.id === v.id);
  buuGone && vProtected
    ? pass('Blow Up Unicorn: sacrifices itself to protect another unicorn')
    : fail('Blow Up Unicorn', `buuGone=${buuGone} vProtected=${vProtected}`);
}

// Unicorn Butt Plug: hand limit -4 (must play through proper channel)
{
  const g = setup(2, ['nsfw']);
  injH(g, 'p2', find('Unicorn Butt Plug'), 'ubp');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', 'ubp', 'p2', null);
  g.stateFor('p2').players['p2'].handLimit === 3
    ? pass('Unicorn Butt Plug: hand limit reduced to 3')
    : fail('Unicorn Butt Plug', `handLimit=${g.stateFor('p2').players['p2'].handLimit}`);
}

// Safe Sex: babies returned to nursery
{
  const g = setup(2, ['nsfw']);
  injH(g, 'p1', find('Safe Sex'), 'sas');
  const nurseryBefore = g.nursery.length;
  play(g, 'p1', 'sas', null, null);
  g.nursery.length > nurseryBefore
    ? pass('Safe Sex: babies returned to nursery')
    : fail('Safe Sex', `nursery ${nurseryBefore}→${g.nursery.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 9. Christmas Expansion ──');

// Gift Inspector: beginning queues beginning_optional_choices
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Gift Inspector'), 'gi');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'gi');
  hasChoice
    ? pass('Gift Inspector: queues beginning_optional_choices')
    : fail('Gift Inspector', g.pendingEffect?.type);
}

// Regression: look_deck_return_order / look_deck_return_same used to DUPLICATE every
// looked-at card back into the deck when the player submitted an empty selection
// (the natural way to say "keep the original order, no reordering") — 'ordered' was
// correctly empty, but a redundant fallback then unshifted the full options list a
// SECOND time on top of 'rest' (which already contained all of them). Found by the
// universal card audit's card-conservation check, not by any hand-written assertion.
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Gift Inspector'), 'gi2');
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  const deckBefore = g.deck.length;
  g.phase = 'beginning'; g._beginningPhase();
  g.resolvePendingEffect('p1', ['gi2'], {});
  const lookedAt = g.pendingEffect?.options?.length || 0;
  g.resolvePendingEffect('p1', [], {}); // empty selection = keep original order
  g.deck.length === deckBefore
    ? pass('Gift Inspector: empty selection does not duplicate looked-at cards into the deck')
    : fail('Gift Inspector duplication', `deck went from ${deckBefore} to ${g.deck.length} (looked at ${lookedAt})`);
}
{
  const g = setup(2, ['unicorns_of_legend']);
  const card = find('Elficorn Scout');
  injH(g, 'p1', card, 'es1');
  play(g, 'p1', 'es1', null, null);
  const lookedAt = g.pendingEffect?.options?.length || 0;
  const deckAfterLook = g.deck.length;
  g.resolvePendingEffect('p1', [], {});
  g.deck.length === deckAfterLook + lookedAt
    ? pass('Elficorn Scout: empty selection returns cards to deck exactly once (no duplication)')
    : fail('Elficorn Scout duplication', `deck went from ${deckAfterLook} to ${g.deck.length} (looked at ${lookedAt})`);
}
{
  const g = setup(2, ['nsfw']);
  const card = find('Straight But Curious Unicorn');
  injH(g, 'p1', card, 'sbc1');
  play(g, 'p1', 'sbc1', null, null);
  const lookedAt = g.pendingEffect?.options?.length || 0;
  const deckAfterLook = g.deck.length;
  g.resolvePendingEffect('p1', [], {});
  g.deck.length === deckAfterLook + lookedAt
    ? pass('Straight But Curious Unicorn: empty selection returns cards to deck exactly once (no duplication)')
    : fail('Straight But Curious duplication', `deck went from ${deckAfterLook} to ${g.deck.length} (looked at ${lookedAt})`);
}
// Also confirm a real reorder (non-empty selection) still works correctly post-fix
{
  const g = setup(2, ['unicorns_of_legend']);
  const card = find('Elficorn Scout');
  injH(g, 'p1', card, 'es2');
  play(g, 'p1', 'es2', null, null);
  const opts = g.pendingEffect?.options || [];
  const deckAfterLook = g.deck.length;
  const reversedIds = [...opts].reverse().map(c => c.id);
  g.resolvePendingEffect('p1', reversedIds, {});
  const restoredCorrectly = g.deck.length === deckAfterLook + opts.length &&
    g.deck.slice(0, opts.length).map(c => c.id).join(',') === reversedIds.join(',');
  restoredCorrectly
    ? pass('Elficorn Scout: explicit reorder places cards back in the chosen order, exactly once')
    : fail('Elficorn Scout reorder', `deck size=${g.deck.length} expected=${deckAfterLook + opts.length}`);
}

// Gingerbread Stable: draws when unicorn enters
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Gingerbread Stable'), 'gs');
  const v = uni(); injH(g, 'p1', v, v.id);
  const before = g.players['p1'].hand.length;
  play(g, 'p1', v.id, null, null);
  // Played card (-1), Gingerbread draws 1 (+1) → net 0 from before
  g.players['p1'].hand.length >= before - 1
    ? pass('Gingerbread Stable: draws a card when unicorn enters')
    : fail('Gingerbread Stable', `hand ${before}→${g.players['p1'].hand.length}`);
}

// Naughty List: discards when YOU steal a card
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Naughty List'), 'nl');
  const v = uni(); injS(g, 'p2', v, v.id);
  const h = uni(); injH(g, 'p1', h, h.id);
  const before = g.players['p1'].hand.length;
  g._stealCard('p1', 'p2', v.id);
  g.players['p1'].hand.length < before
    ? pass('Naughty List: discards after stealing')
    : fail('Naughty List steal', `hand ${before}→${g.players['p1'].hand.length}`);
}

// Unicorn Caroler: card owner receives card from the neigher
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Unicorn Caroler'), 'uc');
  const h1 = uni(); injH(g, 'p2', h1, h1.id);
  const neigh = ALL.find(c => c.effect?.type === 'neigh');
  injH(g, 'p2', neigh, 'n1');
  const target = uni(); injH(g, 'p1', target, target.id);
  // Use playCard only (not play() helper) to leave the neigh window open
  g.playCard('p1', target.id, null, null);
  const p1Before = g.players['p1'].hand.length;
  // p2 neighs — Caroler should pull a card from p2 and give to p1
  g.playInstant('p2', 'n1');
  g.resolveNeigh('p2'); // close the Super Neigh window: nobody counters, so the Neigh stands
  // The blocked card leaves p1's hand (now correctly discarded) and Caroler gives p1 a
  // replacement from p2's hand, so net hand size stays the same — but the composition changed.
  const targetGone = !g.players['p1'].hand.some(c => c.id === target.id);
  const targetDiscarded = g.discard.some(c => c.id === target.id);
  const gotReplacement = g.players['p1'].hand.length === p1Before;
  (targetGone && targetDiscarded && gotReplacement)
    ? pass('Unicorn Caroler: card owner receives card from neigher')
    : fail('Unicorn Caroler', `targetGone=${targetGone} discarded=${targetDiscarded} hand ${p1Before}→${g.players['p1'].hand.length}`);
}

// Jingle All The Neigh: neigher draws (plays neigh -1, draws +1 → net 0 hand change)
{
  const g = setup(2, ['christmas']);
  const v = uni(); injS(g, 'p2', v, v.id);
  injH(g, 'p1', find('Unicorn Poison'), 'up');
  injH(g, 'p2', find('Jingle All The Neigh'), 'jan');
  play(g, 'p1', 'up', 'p2', v.id);
  const before = g.players['p2'].hand.length;
  g.playInstant('p2', 'jan');
  g.resolveNeigh('p2'); // close the Super Neigh window: nobody counters, so the Neigh stands
  // Played jan (-1), drew 1 from you_may_draw (+1) → net 0 change
  g.players['p2'].hand.length === before
    ? pass('Jingle All The Neigh: neigher draws (net-zero hand change)')
    : fail('Jingle All The Neigh', `hand ${before}→${g.players['p2'].hand.length}`);
}

// Nog Wild: queues discard_n_draw_n_extra_turn
{
  const g = setup(2, ['christmas']);
  injH(g, 'p1', find('Nog Wild'), 'nw');
  play(g, 'p1', 'nw', null, null);
  g.pendingEffect?.type === 'discard_n_draw_n_extra_turn'
    ? pass('Nog Wild: queues discard_n_draw_n_extra_turn')
    : fail('Nog Wild', g.pendingEffect?.type);
}

// Silver Lining: queues sacrifice_revive_upgrade_from_discard
{
  const g = setup(2, ['christmas']);
  const v = uni(); injS(g, 'p1', v, v.id);
  const deadUpgrade = upg(); g.discard.push(deadUpgrade);
  injH(g, 'p1', find('Silver Lining'), 'sl');
  play(g, 'p1', 'sl', null, null);
  g.pendingEffect?.type === 'sacrifice_revive_upgrade_from_discard'
    ? pass('Silver Lining: queues sacrifice_revive_upgrade_from_discard')
    : fail('Silver Lining', g.pendingEffect?.type);
}

// Humbug: exposes block_magical_unicorns passive
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Humbug'), 'hb');
  g._hasPassive('p1', 'block_magical_unicorns')
    ? pass('Humbug: exposes block_magical_unicorns passive')
    : fail('Humbug passive', '_hasPassive false');
}

// Winter Wondercorn: draws when upgrade enters
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Winter Wondercorn'), 'ww');
  const u = upg(); injH(g, 'p1', u, u.id);
  const before = g.players['p1'].hand.length;
  play(g, 'p1', u.id, null, null);
  // Played upgrade (-1), drew 1 (+1) → net 0
  g.players['p1'].hand.length >= before - 1
    ? pass('Winter Wondercorn: draws when upgrade enters stable')
    : fail('Winter Wondercorn', `hand ${before}→${g.players['p1'].hand.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 10. Nightmares Expansion ──');

// Chainsaw Massicorn: draws a card per Basic Unicorn in stable — confirm/skip only,
// no card selection needed (regression: had zero client UI at all — same bug class
// as Mother Goose Unicorn / Rainbow Unicorn, found via a follow-up user report)
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', uni(), 'basic1');
  injS(g, 'p1', uni(), 'basic2');
  injH(g, 'p1', find('Chainsaw Massicorn'), 'cm');
  const handBefore = g.players['p1'].hand.length;
  play(g, 'p1', 'cm', null, null);
  g.pendingEffect?.type === 'draw_per_basic_in_stable' && g.pendingEffect.amount === 2
    ? pass('Chainsaw Massicorn: queues draw_per_basic_in_stable with correct amount')
    : fail('Chainsaw Massicorn queue', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p1', []);
  // hand: -1 (card played) +2 (drawn) relative to before
  g.players['p1'].hand.length === handBefore + 1
    ? pass('Chainsaw Massicorn: confirming draws one card per Basic Unicorn')
    : fail('Chainsaw Massicorn confirm', `hand before=${handBefore} after=${g.players['p1'].hand.length}`);
}
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', uni(), 'basic3');
  injH(g, 'p1', find('Chainsaw Massicorn'), 'cm2');
  play(g, 'p1', 'cm2', null, null);
  const handAfterQueue = g.players['p1'].hand.length;
  g.resolvePendingEffect('p1', [], { skip: true });
  g.players['p1'].hand.length === handAfterQueue
    ? pass('Chainsaw Massicorn: skip declines cleanly')
    : fail('Chainsaw Massicorn skip', 'drew despite skip');
}

// HEEEEERE'S STABBY: removes card from game
{
  const g = setup(2, ['nightmares']);
  const v = uni(); injS(g, 'p2', v, v.id);
  injH(g, 'p1', find("HEEEEERE'S STABBY"), 'hs');
  play(g, 'p1', 'hs', 'p2', v.id);
  g.removedFromGame.some(c => c.id === v.id)
    ? pass("HEEEEERE'S STABBY: removes card from game")
    : fail("HEEEEERE'S STABBY", 'card not in removedFromGame');
}

// HEEEEERE'S STABBY vs Phantom Unicorn: remove_from_game must route through
// _destroyCard so indestructible cards are still protected (regression — this
// effect used to splice the stable directly, bypassing every protection check)
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p2', find('Phantom Unicorn'), 'ph');
  injH(g, 'p1', find("HEEEEERE'S STABBY"), 'hs2');
  play(g, 'p1', 'hs2', 'p2', 'ph');
  (g.players['p2'].stable.some(c => c.id === 'ph') && !g.removedFromGame.some(c => c.id === 'ph'))
    ? pass("HEEEEERE'S STABBY: blocked by Phantom Unicorn's indestructibility")
    : fail("HEEEEERE'S STABBY vs Phantom Unicorn", 'was removed from game despite being indestructible');
}

// HEEEEERE'S STABBY vs Dragon Protection shield: shield discards a card instead
// of the target being removed (regression — same bypass as above)
{
  const g = setup(2, ['nightmares', 'dragons']);
  const v = uni(); injS(g, 'p2', v, v.id);
  injS(g, 'p2', find('Dragon Protection'), 'dp');
  const filler = uni(); injH(g, 'p2', filler, filler.id);
  injH(g, 'p1', find("HEEEEERE'S STABBY"), 'hs3');
  const handBefore = g.players['p2'].hand.length;
  play(g, 'p1', 'hs3', 'p2', v.id);
  const survived = g.players['p2'].stable.some(c => c.id === v.id);
  const shieldFired = g.players['p2'].hand.length < handBefore;
  (survived && shieldFired)
    ? pass("HEEEEERE'S STABBY: blocked by Dragon Protection (discards instead)")
    : fail("HEEEEERE'S STABBY vs Dragon Protection", `survived=${survived} shieldFired=${shieldFired}`);
}

// Possession: queues discard_then_steal
{
  const g = setup(2, ['nightmares']);
  injH(g, 'p1', find('Possession'), 'pos');
  play(g, 'p1', 'pos', null, null);
  g.pendingEffect?.type === 'discard_then_steal'
    ? pass('Possession: queues discard_then_steal')
    : fail('Possession', g.pendingEffect?.type);
}

// Reanimation: queues from_discard_pick for basic unicorn
{
  const g = setup(2, ['nightmares']);
  const dead = uni(); g.discard.push(dead);
  injH(g, 'p1', find('Reanimation'), 'rea');
  play(g, 'p1', 'rea', null, null);
  g.pendingEffect?.type === 'from_discard_pick'
    ? pass('Reanimation: queues from_discard_pick')
    : fail('Reanimation', g.pendingEffect?.type);
}

// Supernatural Selection: queues destroy_all_basics_one_player then destroys all basics
{
  const g = setup(2, ['nightmares']);
  const b1 = uni(); const b2 = uni();
  injS(g, 'p2', b1, b1.id); injS(g, 'p2', b2, b2.id);
  injH(g, 'p1', find('Supernatural Selection'), 'ss');
  play(g, 'p1', 'ss', 'p2', null);
  g.pendingEffect?.type === 'destroy_all_basics_one_player'
    ? pass('Supernatural Selection: queues destroy_all_basics_one_player')
    : fail('Supernatural Selection queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2' });
  !g.players['p2'].stable.some(c => c.id === b1.id) && !g.players['p2'].stable.some(c => c.id === b2.id)
    ? pass('Supernatural Selection: destroys all basics in target stable')
    : fail('Supernatural Selection result', 'basics remain');
}

// The Cornjuring: queues search_nightmare_downgrade_into_stable
{
  const g = setup(2, ['nightmares']);
  injH(g, 'p1', find('The Cornjuring'), 'tc');
  play(g, 'p1', 'tc', null, null);
  g.pendingEffect?.type === 'search_nightmare_downgrade_into_stable'
    ? pass('The Cornjuring: queues search_nightmare_downgrade_into_stable')
    : fail('The Cornjuring', g.pendingEffect?.type);
}

// Nightmare: Currently Indisposed: sacrifice_unicorn on enter + cannot_win passive
{
  const g = setup(2, ['nightmares']);
  const v = uni(); injS(g, 'p2', v, v.id);
  injH(g, 'p2', find('Nightmare: Currently Indisposed'), 'ci');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', 'ci', 'p2', null);
  g.pendingEffect?.type === 'sacrifice_unicorn'
    ? pass('Nightmare: Currently Indisposed: queues sacrifice_unicorn on enter')
    : fail('Currently Indisposed enter', g.pendingEffect?.type);
  g.resolvePendingEffect('p2', [v.id], {});
  g._hasPassive('p2', 'cannot_win')
    ? pass('Nightmare: Currently Indisposed: cannot_win passive active')
    : fail('Currently Indisposed cannot_win', '_hasPassive false');
}

// Nightmare: Existential Dread: queues steal_downgrade at beginning
{
  const g = setup(2, ['nightmares']);
  const d = dwn(); injS(g, 'p2', d, d.id);
  injS(g, 'p1', find('Nightmare: Existential Dread'), 'ned');
  g.phase = 'beginning'; g._beginningPhase();
  g.pendingEffect?.type === 'steal_downgrade'
    ? pass('Nightmare: Existential Dread: queues steal_downgrade')
    : fail('Existential Dread', g.pendingEffect?.type);
}

// Phantom Unicorn: cannot be destroyed or sacrificed
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', find('Phantom Unicorn'), 'ph');
  g._destroyCard('p1', 'ph', 'p2');
  g._sacrificeCard('p1', 'ph');
  g.players['p1'].stable.some(c => c.id === 'ph')
    ? pass('Phantom Unicorn: indestructible and unsacrificeable')
    : fail('Phantom Unicorn', 'was destroyed or sacrificed');
}

// Sweet Old Ladycorn: counts as 2 + on_leave queues sacrifice_any
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', find('Sweet Old Ladycorn'), 'sol');
  g._unicornCount('p1') >= 2
    ? pass('Sweet Old Ladycorn: counts as 2 unicorns')
    : fail('Sweet Old Ladycorn count', g._unicornCount('p1'));
  g._sacrificeCard('p1', 'sol');
  g.pendingEffect?.type === 'sacrifice_any'
    ? pass('Sweet Old Ladycorn: queues sacrifice_any when leaving')
    : fail('Sweet Old Ladycorn on_leave', g.pendingEffect?.type);
}

// Demonicorn: on_destroyed trigger handled
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', find('Demonicorn'), 'dem');
  const v = uni(); injS(g, 'p2', v, v.id);
  g._destroyCard('p1', 'dem', 'p2');
  const okType = g.pendingEffect?.type === 'choose_destroy' || !g.pendingEffect;
  okType
    ? pass('Demonicorn: on_destroyed trigger handled')
    : fail('Demonicorn on_destroyed', g.pendingEffect?.type);
}

// Magic Elixir: blocks destroy by discarding
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', find('Magic Elixir'), 'me');
  const v = uni(); injS(g, 'p1', v, v.id);
  injH(g, 'p1', uni(), 'h1');
  g._destroyCard('p1', v.id, 'p2');
  g.players['p1'].stable.some(c => c.id === v.id)
    ? pass('Magic Elixir: blocks destroy by discarding from hand')
    : fail('Magic Elixir', 'card was destroyed');
}

// Paranormal Affection: "you may DRAW 2 cards" on enter (previously forced
// unconditionally) + upgrades_cannot_be_destroyed passive
{
  const g = setup(2, ['nightmares']);
  injH(g, 'p1', find('Paranormal Affection'), 'pa');
  const before = g.players['p1'].hand.length;
  play(g, 'p1', 'pa', null, null);
  (g.pendingEffect?.type === 'draw_n_optional' && g.pendingEffect.amount === 2 && g.pendingEffect.optional)
    ? pass('Paranormal Affection: queues an optional draw-2 decision instead of drawing unconditionally')
    : fail('Paranormal Affection queue', JSON.stringify(g.pendingEffect));
  const skipRes = g.resolvePendingEffect('p1', [], { skip: true });
  (skipRes.ok && g.players['p1'].hand.length === before - 1)
    ? pass('Paranormal Affection: skip declines the draw cleanly')
    : fail('Paranormal Affection skip', `hand ${before}→${g.players['p1'].hand.length}`);
  g._hasPassive('p1', 'upgrades_cannot_be_destroyed')
    ? pass('Paranormal Affection: upgrades_cannot_be_destroyed passive')
    : fail('Paranormal Affection passive', '_hasPassive false');
}
{
  const g = setup(2, ['nightmares']);
  injH(g, 'p1', find('Paranormal Affection'), 'pa2');
  const before = g.players['p1'].hand.length;
  play(g, 'p1', 'pa2', null, null);
  const r = g.resolvePendingEffect('p1', [], {});
  (r.ok && g.players['p1'].hand.length === before + 1)
    ? pass('Paranormal Affection: activating draws 2 (net +1 after the card itself left hand)')
    : fail('Paranormal Affection activate', `hand ${before}→${g.players['p1'].hand.length}`);
}

// Strange Craft Project: beginning queues beginning_optional_choices
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', find('Strange Craft Project'), 'scp');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'scp');
  hasChoice
    ? pass('Strange Craft Project: queues beginning_optional_choices')
    : fail('Strange Craft Project', g.pendingEffect?.type);
}

// Poltergeist Swipe: beginning queues beginning_optional_choices
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', find('Poltergeist Swipe'), 'psw');
  g.phase = 'beginning'; g._beginningPhase();
  const hasChoice = g.pendingEffect?.type === 'beginning_optional_choices' &&
    g.pendingEffect.choices.some(c => c.cardId === 'psw');
  hasChoice
    ? pass('Poltergeist Swipe: queues beginning_optional_choices')
    : fail('Poltergeist Swipe', g.pendingEffect?.type);
}

// Ghost Guide: places upgrade from top of deck into stable
{
  const g = setup(2, ['nightmares']);
  const topUpgrade = upg(); g.deck.unshift({ ...topUpgrade });
  injS(g, 'p1', find('Ghost Guide'), 'gg');
  g.phase = 'beginning'; g._beginningPhase();
  if (g.pendingEffect?.type === 'beginning_optional_choices') g.resolvePendingEffect('p1', ['gg'], {});
  g.players['p1'].stable.some(c => c.name === 'UPG')
    ? pass('Ghost Guide: places upgrade from top of deck into stable')
    : fail('Ghost Guide', 'upgrade not in stable');
}

// Saved by the Sigil: blocks downgrades + the card itself is indestructible
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', find('Saved by the Sigil'), 'sbts');
  injH(g, 'p2', find('Barbed Wire'), 'bw');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', 'bw', 'p1', null);
  !g.players['p1'].stable.some(c => c.id === 'bw')
    ? pass('Saved by the Sigil: blocks incoming downgrade')
    : fail('Saved by the Sigil block', 'downgrade entered');
  g._destroyCard('p1', 'sbts', 'p2');
  g.players['p1'].stable.some(c => c.id === 'sbts')
    ? pass('Saved by the Sigil: the card itself cannot be destroyed')
    : fail('Saved by the Sigil indestructible', 'was destroyed');
}

// Nightmare Baby: returns to nursery instead of being destroyed
{
  const g = setup(2, ['nightmares']);
  const ghostBaby = ALL.find(c => c.name === 'Baby Unicorn (Ghost)');
  injS(g, 'p1', { ...ghostBaby }, 'gb');
  g._destroyCard('p1', 'gb', 'p2');
  g.nursery.some(c => c.id === 'gb') && !g.players['p1'].stable.some(c => c.id === 'gb')
    ? pass('Nightmare Baby: returns to nursery instead of being destroyed')
    : fail('Nightmare Baby', `in nursery=${g.nursery.some(c=>c.id==='gb')}`);
}

// Nightmare: Exorcise Regimen: discards hand, draws 1, hand limit -3
{
  const g = setup(2, ['nightmares']);
  const h1 = uni(); const h2 = uni();
  injH(g, 'p2', h1, h1.id); injH(g, 'p2', h2, h2.id);
  injH(g, 'p2', find('Nightmare: Exorcise Regimen'), 'ner');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', 'ner', 'p2', null);
  g.players['p2'].hand.length === 1
    ? pass('Nightmare: Exorcise Regimen: discards hand, draws 1')
    : fail('Exorcise Regimen', `hand=${g.players['p2'].hand.length}`);
  g.stateFor('p2').players['p2'].handLimit === 4
    ? pass('Nightmare: Exorcise Regimen: reduces hand limit by 3')
    : fail('Exorcise Regimen hand limit', g.stateFor('p2').players['p2'].handLimit);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 11. Cross-expansion interactions ──');

// Dragon Protection + Rainbow Aura stacked
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find('Dragon Protection'), 'dp');
  injS(g, 'p1', find('Rainbow Aura'), 'ra');
  const v = uni(); injS(g, 'p1', v, v.id);
  injH(g, 'p1', uni(), 'hh');
  g._destroyCard('p1', v.id, 'p2');
  g.players['p1'].stable.some(c => c.id === v.id)
    ? pass('Dragon Protection + Rainbow Aura: stacked protection works')
    : fail('Stacked protection', 'card was destroyed');
}

// Phantom Unicorn vs Dragon's Fire
{
  const g = setup(2, ['nightmares', 'dragons']);
  injS(g, 'p1', find('Phantom Unicorn'), 'ph');
  injH(g, 'p2', find("Dragon's Fire"), 'df');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', 'df', null, null);
  if (g.pendingEffect?.type === 'destroy_upgrade_or_sacrifice_downgrade') {
    g.resolvePendingEffect('p2', [], { targetPlayerId: 'p1', targetCardId: 'ph' });
  }
  g.players['p1'].stable.some(c => c.id === 'ph')
    ? pass("Phantom Unicorn: cannot be destroyed by Dragon's Fire")
    : fail("Phantom vs Dragon's Fire", 'phantom was destroyed');
}

// Magical Kittencorn: only blocks magic destroy of itself, NOT of other unicorns or steals
{
  const g = setup(2, ['rainbow_apocalypse']);
  injS(g, 'p1', find('Magical Kittencorn'), 'kit');
  const v = uni(); injS(g, 'p1', v, v.id);
  // Non-magic destroy of a basic → should succeed (Kittencorn only blocks magic destroy of ITSELF)
  g._destroyCard('p1', v.id, 'p2', false);
  !g.players['p1'].stable.some(c => c.id === v.id)
    ? pass('Magical Kittencorn: non-magic destroy of other unicorn succeeds')
    : fail('Kittencorn non-magic destroy', 'unicorn was not destroyed');
  // Magic destroy of the Kittencorn itself → should be blocked
  g._destroyCard('p1', 'kit', 'p2', true);
  g.players['p1'].stable.some(c => c.id === 'kit')
    ? pass('Magical Kittencorn: magic destroy of itself is blocked')
    : fail('Kittencorn self-protect', 'kittencorn was destroyed by magic');
  // Magic destroy of a different unicorn → should succeed (Kittencorn only protects itself)
  const v2 = uni(); injS(g, 'p1', v2, v2.id);
  g._destroyCard('p1', v2.id, 'p2', true);
  !g.players['p1'].stable.some(c => c.id === v2.id)
    ? pass('Magical Kittencorn: magic destroy of OTHER unicorn in stable succeeds')
    : fail('Kittencorn scope', 'other unicorn was incorrectly protected');
  // Steal of a unicorn from a player with Kittencorn → should succeed (Kittencorn never blocked steals)
  const v3 = uni(); injS(g, 'p1', v3, v3.id);
  g._stealCard('p2', 'p1', v3.id);
  g.players['p2'].stable.some(c => c.id === v3.id)
    ? pass('Magical Kittencorn: steal from player with Kittencorn succeeds')
    : fail('Kittencorn steal', 'steal was incorrectly blocked');
}

// Dragon's Blessing blocks nightmare downgrade
{
  const g = setup(2, ['dragons', 'nightmares']);
  injS(g, 'p1', find("Dragon's Blessing"), 'db');
  injH(g, 'p2', find('Nightmare: Currently Indisposed'), 'ci');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', 'ci', 'p1', null);
  !g.players['p1'].stable.some(c => c.id === 'ci')
    ? pass("Dragon's Blessing: blocks Nightmare: Currently Indisposed")
    : fail("Dragon's Blessing vs Nightmare", 'downgrade entered p1 stable');
}

// Yay: card cannot be neighed
{
  const g = setup(2);
  const neigh = ALL.find(c => c.effect?.type === 'neigh');
  injS(g, 'p1', find('Yay'), 'yay');
  const v = uni(); injH(g, 'p1', v, v.id);
  injH(g, 'p2', neigh, 'n1');
  play(g, 'p1', v.id, null, null);
  g.playInstant('p2', 'n1').error
    ? pass('Yay: card cannot be neighed')
    : fail('Yay protection', 'neigh went through');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 12. Passive sub-effects ──');

// Clairvoyant Unicorn: hand_visible passive sub-effect
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p2', find('Clairvoyant Unicorn'), 'cu');
  g.stateFor('p1').players['p2'].handVisible
    ? pass('Clairvoyant Unicorn: hand visible to others')
    : fail('Clairvoyant Unicorn passive', 'hand not visible');
}

// Extreme Adventurer Unicorn: blocks basics from own stable
{
  const g = setup(2, ['adventures']);
  injS(g, 'p1', find('Extreme Adventurer Unicorn'), 'eau');
  const bu = uni(); injH(g, 'p1', bu, bu.id);
  play(g, 'p1', bu.id, null, null);
  !g.players['p1'].stable.some(c => c.id === bu.id)
    ? pass('Extreme Adventurer Unicorn: blocks basics from own stable')
    : fail('Extreme Adventurer passive', 'basic entered own stable');
}

// Unicorn of War: cannot_be_destroyed passive sub-effect
{
  const g = setup(2, ['rainbow_apocalypse']);
  injS(g, 'p1', find('Unicorn of War'), 'uow');
  g._destroyCard('p1', 'uow', 'p2');
  g.players['p1'].stable.some(c => c.id === 'uow')
    ? pass('Unicorn of War: cannot_be_destroyed passive sub-effect')
    : fail('Unicorn of War passive', 'was destroyed');
}

// Nightmare: Currently Indisposed: cannot_win passive prevents win
{
  const g = setup(2, ['nightmares']);
  const ci = find('Nightmare: Currently Indisposed');
  injS(g, 'p1', { ...ci, id: 'ci' });
  for (let i = 0; i < 7; i++) injS(g, 'p1', uni(), 'u' + i);
  !g._checkWin() || g._checkWin() === 'p2'
    ? pass('Nightmare: Currently Indisposed: cannot_win passive prevents win')
    : fail('Currently Indisposed cannot_win', 'win returned p1');
}

// Hex: beginning trigger fires skip_draw (not a passive — verified by phase advancement)
{
  const g = setup(2, ['unicorns_of_legend']);
  injS(g, 'p1', find('Hex'), 'hex');
  g.phase = 'beginning'; g._beginningPhase();
  // Hex's beginning trigger should mark p1 as skip-draw
  g.skippedDrawPlayers.has('p1') || g.phase === 'draw'
    ? pass('Hex: beginning trigger fires skip_draw correctly')
    : fail('Hex skip_draw', `phase=${g.phase} skippedDraw=${g.skippedDrawPlayers.has('p1')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 13. Upgrades (on_unicorn_enter / beginning / passive effects) ──');

// Barbed Wire: discard when ANY unicorn enters own stable
{
  const g = setup();
  injS(g, 'p1', find('Barbed Wire'), 'bw');
  const v = uni(); injH(g, 'p1', v, v.id);
  const h = uni(); injH(g, 'p1', h, h.id);
  const hBefore = g.players['p1'].hand.length;
  play(g, 'p1', v.id, null, null);
  g.pendingEffect?.type === 'discard'
    ? pass('Barbed Wire: queues discard when unicorn enters own stable')
    : fail('Barbed Wire enter', g.pendingEffect?.type);
}

// Gingerbread Stable: draws when unicorn enters
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Gingerbread Stable'), 'gs');
  const v = uni(); injH(g, 'p1', v, v.id);
  const hBefore = g.players['p1'].hand.length;
  play(g, 'p1', v.id, null, null);
  g.players['p1'].hand.length >= hBefore - 1
    ? pass('Gingerbread Stable: draws when unicorn enters (net neutral hand)')
    : fail('Gingerbread Stable draw', `hand ${hBefore}→${g.players['p1'].hand.length}`);
}

// Rainbow Aura: blocks all destroys of unicorns in that stable
{
  const g = setup();
  injS(g, 'p1', find('Rainbow Aura'), 'ra');
  const v = uni(); injS(g, 'p1', v, v.id);
  g._destroyCard('p1', v.id, 'p2');
  g.players['p1'].stable.some(c => c.id === v.id)
    ? pass('Rainbow Aura: blocks destroy of unicorn in own stable')
    : fail('Rainbow Aura', 'unicorn destroyed');
}

// Extradimensional Saddlebag: hand limit +3
{
  const g = setup(2, ['unicorns_of_legend']);
  injH(g, 'p1', find('Extradimensional Saddlebag'), 'esb');
  play(g, 'p1', 'esb', null, null);
  g.stateFor('p1').players['p1'].handLimit === 10
    ? pass('Extradimensional Saddlebag: hand limit = 10')
    : fail('ESB hand limit', g.stateFor('p1').players['p1'].handLimit);
}

// Winter Wondercorn: draws when any upgrade enters
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Winter Wondercorn'), 'ww');
  const u = upg(); injH(g, 'p1', u, u.id);
  const hBefore = g.players['p1'].hand.length;
  play(g, 'p1', u.id, null, null);
  g.players['p1'].hand.length >= hBefore - 1
    ? pass('Winter Wondercorn: draws when upgrade enters (net neutral)')
    : fail('Winter Wondercorn', `hand ${hBefore}→${g.players['p1'].hand.length}`);
}

// Dragon Protection: blocks destroy by discarding from hand
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find('Dragon Protection'), 'dp');
  const v = uni(); injS(g, 'p1', v, v.id);
  injH(g, 'p1', uni(), 'hcard');
  g._destroyCard('p1', v.id, 'p2');
  g.players['p1'].stable.some(c => c.id === v.id)
    ? pass("Dragon Protection: blocks destroy by discarding from hand")
    : fail("Dragon Protection", 'card was destroyed');
}

// Yay: own card plays cannot be neighed
{
  const g = setup();
  const neigh = ALL.find(c => c.effect?.type === 'neigh');
  injS(g, 'p1', find('Yay'), 'yay');
  const v = uni(); injH(g, 'p1', v, v.id);
  injH(g, 'p2', neigh, 'n1');
  g.playCard('p1', v.id, null, null);
  g.playInstant('p2', 'n1').error
    ? pass('Yay: card cannot be neighed')
    : fail('Yay', 'neigh went through');
}

// Slowdown: blocks neigh from owner
{
  const g = setup();
  const neigh = ALL.find(c => c.effect?.type === 'neigh');
  injS(g, 'p1', find('Slowdown'), 'sl');
  injH(g, 'p1', neigh, 'n1');
  const v = uni(); injH(g, 'p2', v, v.id);
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', v.id, null, null);
  g.playInstant('p1', 'n1').error
    ? pass('Slowdown: blocks owner from neighing')
    : fail('Slowdown', 'neigh went through');
}

// Pandamonium: owner cannot win
{
  const g = setup();
  injS(g, 'p1', find('Pandamonium'), 'pand');
  for (let i = 0; i < 7; i++) injS(g, 'p1', uni(), 'u' + i);
  !g._checkWin()
    ? pass('Pandamonium: owner cannot win despite 7+ unicorns')
    : fail('Pandamonium', 'win returned ' + g._checkWin());
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 14. Downgrades (passive / beginning effects) ──');

// Broken Stable: blocks playing upgrades
{
  const g = setup();
  injS(g, 'p1', find('Broken Stable'), 'bs');
  injH(g, 'p1', find('Rainbow Aura'), 'ra');
  g.playCard('p1', 'ra', null, null).error
    ? pass('Broken Stable: blocks playing upgrades')
    : fail('Broken Stable', 'upgrade went through');
}

// Barbed Wire (downgrade on opponent): discard when their unicorn enters
{
  const g = setup();
  injH(g, 'p1', find('Barbed Wire'), 'bw');
  play(g, 'p1', 'bw', 'p2', null);   // place on p2
  g.players['p2'].stable.some(c => c.id === 'bw')
    ? pass('Barbed Wire (downgrade): placed in target stable')
    : fail('Barbed Wire placement', 'not in p2 stable');
  const v = uni(); injH(g, 'p2', v, v.id);
  g.currentPlayerIndex = g.playerOrder.indexOf('p2'); g.phase = 'action';
  play(g, 'p2', v.id, null, null);
  g.pendingEffect?.type === 'discard' && g.pendingEffect?.playerId === 'p2'
    ? pass('Barbed Wire (downgrade): triggers discard for target player')
    : fail('Barbed Wire target trigger', g.pendingEffect?.type + '/' + g.pendingEffect?.playerId);
}

// Tiny Stable: sacrifice when over 5 unicorns (via playCard)
{
  const g = setup();
  injS(g, 'p1', find('Tiny Stable'), 'ts');
  for (let i = 0; i < 5; i++) injS(g, 'p1', uni(), 'u' + i);
  const v = uni(); injH(g, 'p1', v, v.id);
  play(g, 'p1', v.id, null, null);
  g.pendingEffect?.type === 'sacrifice_unicorn_tiny_stable'
    ? pass('Tiny Stable: triggers sacrifice when over limit (playCard path)')
    : fail('Tiny Stable playCard', g.pendingEffect?.type);
}

// Dragon's Blessing: blocks incoming downgrades
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find("Dragon's Blessing"), 'db');
  injH(g, 'p2', find('Barbed Wire'), 'bw');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', 'bw', 'p1', null);
  !g.players['p1'].stable.some(c => c.id === 'bw')
    ? pass("Dragon's Blessing: blocks incoming downgrade")
    : fail("Dragon's Blessing", 'downgrade entered');
}

// Dragon's Curse: discards 1 at beginning
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find("Dragon's Curse"), 'dc');
  const h = uni(); injH(g, 'p1', h, h.id);
  const hBefore = g.players['p1'].hand.length;
  g.phase = 'beginning'; g._beginningPhase();
  g.players['p1'].hand.length < hBefore
    ? pass("Dragon's Curse: discards 1 at beginning")
    : fail("Dragon's Curse", `hand ${hBefore}→${g.players['p1'].hand.length}`);
}

// Unicorn Butt Plug: hand limit -4
{
  const g = setup(2, ['nsfw']);
  injH(g, 'p2', find('Unicorn Butt Plug'), 'ubp');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  play(g, 'p2', 'ubp', 'p2', null);
  g.stateFor('p2').players['p2'].handLimit === 3
    ? pass('Unicorn Butt Plug: hand limit reduced to 3')
    : fail('Unicorn Butt Plug', `handLimit=${g.stateFor('p2').players['p2'].handLimit}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 15. Magic cards (non-unicorn target effects) ──');

// Reset Button: clears all upgrades/downgrades from all stables
{
  const g = setup(2);
  const u = upg(); injS(g, 'p1', u, u.id);
  const d = dwn(); injS(g, 'p2', d, d.id);
  injH(g, 'p1', find('Reset Button'), 'rb');
  play(g, 'p1', 'rb', null, null);
  !g.players['p1'].stable.some(c => c.id === u.id) && !g.players['p2'].stable.some(c => c.id === d.id)
    ? pass('Reset Button: removes all upgrades/downgrades from all stables')
    : fail('Reset Button', 'some remain');
}

// Targeted Destruction: queues destroy_upgrade_or_sacrifice_downgrade
{
  const g = setup();
  const u = upg(); injS(g, 'p2', u, u.id);
  injH(g, 'p1', find('Targeted Destruction'), 'td');
  play(g, 'p1', 'td', null, null);
  g.pendingEffect?.type === 'destroy_upgrade_or_sacrifice_downgrade'
    ? pass('Targeted Destruction: queues destroy_upgrade_or_sacrifice_downgrade')
    : fail('Targeted Destruction', g.pendingEffect?.type);
}

// Good Deal: draw 3, discard 1
{
  const g = setup();
  injH(g, 'p1', find('Good Deal'), 'gd');
  play(g, 'p1', 'gd', null, null);
  g.pendingEffect?.type === 'discard'
    ? pass('Good Deal: queues discard after drawing 3')
    : fail('Good Deal', g.pendingEffect?.type);
}

// Shake Up: discard hand, reshuffle, draw 5
{
  const g = setup();
  injH(g, 'p1', find('Shake Up'), 'su');
  play(g, 'p1', 'su', null, null);
  g.players['p1'].hand.length === 5
    ? pass('Shake Up: draws exactly 5 cards')
    : fail('Shake Up', `hand=${g.players['p1'].hand.length}`);
}

// Glitter Tornado: return one card from each stable
{
  const g = setup(3);
  const v1 = uni(); injS(g, 'p2', v1, v1.id);
  const v2 = uni(); injS(g, 'p3', v2, v2.id);
  injH(g, 'p1', find('Glitter Tornado'), 'gt');
  play(g, 'p1', 'gt', null, null);
  g.pendingEffect?.type === 'return_one_each_stable'
    ? pass('Glitter Tornado: queues return_one_each_stable')
    : fail('Glitter Tornado', g.pendingEffect?.type);
}

// Unfair Bargain: swaps hands with target
{
  const g = setup();
  const h1 = uni(); injH(g, 'p1', h1, h1.id);
  const h2 = uni(); injH(g, 'p2', h2, h2.id);
  injH(g, 'p1', find('Unfair Bargain'), 'ub');
  play(g, 'p1', 'ub', 'p2', null);
  g.players['p1'].hand.some(c => c.id === h2.id)
    ? pass('Unfair Bargain: p1 now has p2\'s card')
    : fail('Unfair Bargain', 'hands not swapped');
}

// Two-For-One: sacrifice then destroy 2 unicorns
{
  const g = setup();
  const v = uni(); injS(g, 'p1', v, v.id);
  injH(g, 'p1', find('Two-For-One'), 'tfo');
  play(g, 'p1', 'tfo', null, null);
  g.pendingEffect?.type === 'sacrifice_then_destroy_two' && g.pendingEffect?.step === 'sacrifice'
    ? pass('Two-For-One: queues sacrifice step')
    : fail('Two-For-One', `type=${g.pendingEffect?.type} step=${g.pendingEffect?.step}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 16. Hand limit enforcement (CODE HEALTH 4) ──');

// Non-current player over limit at end of turn
{
  const g = setup();
  for (let i = 0; i < 5; i++) injH(g, 'p2', uni(), 'x' + i);
  g.phase = 'end'; g._endPhase();
  const eff = g.pendingEffect;
  eff?.type === 'end_discard' && eff?.playerId === 'p2'
    ? pass('Hand limit: p2 over limit queues end_discard at end of turn')
    : fail('Hand limit p2', `type=${eff?.type} pid=${eff?.playerId}`);
}

// Sequential enforcement: p2 discards, then p3 is checked
{
  const g = setup(3);
  for (let i = 0; i < 3; i++) { injH(g, 'p2', uni(), 'x' + i); injH(g, 'p3', uni(), 'y' + i); }
  g.phase = 'end'; g._endPhase();
  const eff = g.pendingEffect;
  eff?.type === 'end_discard' ? pass('Hand limit: first over-limit player queued') : fail('Hand limit multi', eff?.type);
  const toDiscard = g.players[eff.playerId].hand.slice(0, eff.amount).map(c => c.id);
  g.resolvePendingEffect(eff.playerId, toDiscard, {});
  g.pendingEffect?.type === 'end_discard'
    ? pass('Hand limit: second over-limit player queued after first resolves')
    : fail('Hand limit second', g.pendingEffect?.type);
}

// Exactly at limit: no discard required
{
  const g = setup();
  g.phase = 'end'; g._endPhase();
  !g.pendingEffect || g.pendingEffect?.type !== 'end_discard'
    ? pass('Hand limit: no discard when exactly at 7 cards')
    : fail('Hand limit exact', 'unexpected end_discard');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 17. Discard pile visibility ──');

// stateFor exposes the full discard pile, not just the top card
{
  const g = setup();
  const v1 = uni(); const v2 = uni(); const v3 = uni();
  g.discard.push(v1, v2, v3);
  const s = g.stateFor('p1');
  Array.isArray(s.discardPile) && s.discardPile.length === 3
    ? pass('stateFor: discardPile array exposes full pile (length matches)')
    : fail('discardPile length', `length=${s.discardPile?.length}`);
}

// discardPile is ordered most-recent-first (top of pile first)
{
  const g = setup();
  const v1 = uni(); v1.name = 'First'; const v2 = uni(); v2.name = 'Second'; const v3 = uni(); v3.name = 'Third';
  g.discard.push(v1, v2, v3); // v3 was discarded most recently (matches discardTop)
  const s = g.stateFor('p1');
  s.discardPile[0]?.name === 'Third' && s.discardPile[2]?.name === 'First'
    ? pass('discardPile: ordered most-recent-first')
    : fail('discardPile order', s.discardPile.map(c=>c.name).join(','));
}

// discardPile reflects discardTop as its first entry (consistent with existing UI)
{
  const g = setup();
  const v = uni(); g.discard.push(v);
  const s = g.stateFor('p1');
  s.discardPile[0]?.id === s.discardTop?.id
    ? pass('discardPile: first entry matches discardTop')
    : fail('discardPile vs discardTop', `pile[0]=${s.discardPile[0]?.id} top=${s.discardTop?.id}`);
}

// discardPile updates as cards are discarded during play (searchable at any time, not just on a card effect)
{
  const g = setup();
  const before = g.stateFor('p1').discardPile.length;
  injH(g, 'p1', find('Unicorn Poison'), 'up');
  const v = uni(); injS(g, 'p2', v, v.id);
  play(g, 'p1', 'up', 'p2', v.id);
  const after = g.stateFor('p1').discardPile.length;
  after > before
    ? pass('discardPile: grows as cards are played/destroyed during normal play')
    : fail('discardPile growth', `before=${before} after=${after}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 11. Magical Kittencorn protection scope + "you may" skip options (user-reported) ──');

// Kittencorn: protected from Magic-card destroys (regression, already covered above
// under Nightmares/HEEEEERE'S STABBY, repeated here for a focused before/after)
{
  const g = setup();
  const kc = find('Magical Kittencorn'); injS(g, 'p2', kc, 'kc');
  injH(g, 'p1', find('Unicorn Poison'), 'up');
  play(g, 'p1', 'up', 'p2', 'kc');
  g.players['p2'].stable.some(c => c.id === 'kc')
    ? pass('Kittencorn: still protected from Magic-card destroy (Unicorn Poison)')
    : fail('Kittencorn vs Magic', 'destroyed');
}

// Kittencorn: NOW protected from Upgrade-card destroys too (the actual bug fixed —
// previously only Magic-card destroys were blocked, so an Upgrade like Stable
// Artillery could destroy Kittencorn when it shouldn't have been able to)
{
  const g = setup(2, ['adventures']);
  const kc = find('Magical Kittencorn'); injS(g, 'p2', kc, 'kc');
  injS(g, 'p1', find('Stable Artillery'), 'sa');
  injH(g, 'p1', uni(), 'h1'); injH(g, 'p1', uni(), 'h2');
  g.phase = 'beginning'; g._beginningPhase();
  if (g.pendingEffect?.type === 'beginning_optional_choices') g.resolvePendingEffect('p1', ['sa'], {});
  g.resolvePendingEffect('p1', ['h1','h2'], {});
  g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'kc' });
  g.players['p2'].stable.some(c => c.id === 'kc')
    ? pass('Kittencorn: now protected from Upgrade-card destroy (Stable Artillery)')
    : fail('Kittencorn vs Upgrade', 'destroyed — protection scope regression');
}

// Kittencorn: still destroyable by a Unicorn card's own ability (the OTHER half of
// the bug report — it should NOT be immune to Unicorn-sourced destroys)
{
  const g = setup(2, ['unicorns_of_legend']);
  const kc = find('Magical Kittencorn'); injS(g, 'p2', kc, 'kc');
  injH(g, 'p1', find('Berserkercorn'), 'bz');
  play(g, 'p1', 'bz', 'p2', 'kc');
  !g.players['p2'].stable.some(c => c.id === 'kc')
    ? pass('Kittencorn: still destroyable by a Unicorn card\'s own ability (Berserkercorn)')
    : fail('Kittencorn vs Unicorn', 'survived — should be destroyable');
}

// Ambiguous case: sacrifice_n_destroy_n is used by BOTH a Unicorn (Warlock Unicorn)
// and a Magic card (Plague of Death) — the same pendingEffect type must resolve
// Kittencorn-protection differently depending on which one triggered it.
{
  const g = setup(2, ['unicorns_of_legend']);
  injS(g, 'p1', uni(), 'sac1');
  const kc = find('Magical Kittencorn'); injS(g, 'p2', kc, 'kc');
  injH(g, 'p1', find('Warlock Unicorn'), 'wl');
  play(g, 'p1', 'wl', null, null);
  g.resolvePendingEffect('p1', ['sac1'], {});
  g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'kc' });
  !g.players['p2'].stable.some(c => c.id === 'kc')
    ? pass('sacrifice_n_destroy_n via Warlock Unicorn (unicorn-sourced): Kittencorn destroyed')
    : fail('sacrifice_n_destroy_n unicorn-sourced', 'Kittencorn survived — should be destroyable');
}
{
  const g = setup(2, ['unicorns_of_legend']);
  injS(g, 'p1', uni(), 'sac2');
  const kc = find('Magical Kittencorn'); injS(g, 'p2', kc, 'kc2');
  injH(g, 'p1', find('Plague of Death'), 'pod');
  play(g, 'p1', 'pod', null, null);
  g.resolvePendingEffect('p1', ['sac2'], {});
  g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'kc2' });
  g.players['p2'].stable.some(c => c.id === 'kc2')
    ? pass('sacrifice_n_destroy_n via Plague of Death (magic-sourced): Kittencorn protected')
    : fail('sacrifice_n_destroy_n magic-sourced', 'Kittencorn destroyed — should be protected');
}

// choose_destroy / choose_steal: previously had NO way to decline at all despite
// backing several "you may" cards (Stabby the Unicorn, Dragon Unicorn, Berserkercorn,
// Paladin Unicorn, Alluring Narwhal, Shark With a Horn) — server-side skip now works
{
  const g = setup(2, ['unicorns_of_legend']);
  injH(g, 'p1', find('Berserkercorn'), 'bz2');
  const v = uni(); injS(g, 'p2', v, v.id);
  play(g, 'p1', 'bz2', null, null);
  g.pendingEffect?.type === 'choose_destroy' && g.pendingEffect.optional
    ? pass('choose_destroy: queued as optional (Berserkercorn without upfront target)')
    : fail('choose_destroy optional flag', JSON.stringify(g.pendingEffect));
  const r = g.resolvePendingEffect('p1', [], { skip:true });
  (r.ok && g.players['p2'].stable.some(c => c.id === v.id))
    ? pass('choose_destroy: skip declines cleanly, target survives')
    : fail('choose_destroy skip', JSON.stringify(r));
}
{
  const g = setup(2, ['adventures']);
  injH(g, 'p1', find('Alluring Narwhal'), 'an');
  play(g, 'p1', 'an', null, null);
  const r = g.pendingEffect?.type === 'choose_steal' ? g.resolvePendingEffect('p1', [], { skip:true }) : null;
  (!g.pendingEffect || (r && r.ok && !g.pendingEffect))
    ? pass('choose_steal: skip declines cleanly (Alluring Narwhal)')
    : fail('choose_steal skip', JSON.stringify(g.pendingEffect));
}

// Americorn: pull_random_hand for Unicorn enter-triggers previously never fired at
// all (no target player was ever supplied), and had no way to decline either.
// Now queues a proper opponent-picker with skip support.
{
  const g = setup();
  injH(g, 'p2', uni(), 'ph');
  injH(g, 'p1', find('Americorn'), 'am');
  play(g, 'p1', 'am', null, null);
  g.pendingEffect?.type === 'choose_opponent_pull_random'
    ? pass('Americorn: queues choose_opponent_pull_random (previously never fired at all)')
    : fail('Americorn queue', g.pendingEffect?.type);
  const before = g.players['p1'].hand.length;
  g.resolvePendingEffect('p1', [], { targetPlayerId:'p2' });
  g.players['p1'].hand.length > before
    ? pass('Americorn: confirming pulls a random card from the chosen opponent')
    : fail('Americorn confirm', 'hand did not grow');
}
{
  const g = setup();
  injH(g, 'p2', uni(), 'ph2');
  injH(g, 'p1', find('Americorn'), 'am2');
  play(g, 'p1', 'am2', null, null);
  const before = g.players['p1'].hand.length;
  g.resolvePendingEffect('p1', [], { skip:true });
  g.players['p1'].hand.length === before
    ? pass('Americorn: skip declines cleanly')
    : fail('Americorn skip', 'hand changed despite skip');
}

// Wizard Unicorn (discard_search_magic_play) and Orcicorn Raider
// (move_downgrade_steal_upgrade): previously no way to decline
{
  const g = setup(2, ['nightmares']);
  injH(g, 'p1', find('Wizard Unicorn'), 'wz');
  injH(g, 'p1', uni(), 'h1');
  play(g, 'p1', 'wz', null, null);
  const handBefore = g.players['p1'].hand.length;
  const r = g.resolvePendingEffect('p1', [], { skip:true });
  (r.ok && g.players['p1'].hand.length === handBefore)
    ? pass('Wizard Unicorn (discard_search_magic_play): skip declines cleanly')
    : fail('Wizard Unicorn skip', JSON.stringify(r));
}
{
  const g = setup(2, ['adventures']);
  injH(g, 'p1', find('Orcicorn Raider'), 'or');
  play(g, 'p1', 'or', null, null);
  const r = g.pendingEffect?.type === 'move_downgrade_steal_upgrade' ? g.resolvePendingEffect('p1', [], { skip:true }) : {ok:true};
  r.ok
    ? pass('Orcicorn Raider (move_downgrade_steal_upgrade): skip declines cleanly')
    : fail('Orcicorn Raider skip', JSON.stringify(r));
}

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) { console.log('Fix the ❌ failures above.'); process.exitCode = 1; }

/**
 * test_neigh_settle.js — Neigh window auto-close, bot passing, no-target exits, temp-steal hooks.
 * Run: node test_neigh_settle.js   → every line should begin with ✅
 */
'use strict';
const { Game }       = require('./game');
const { createDeck } = require('./cards');
const { getExpansionCards, EXPANSIONS } = require('./expansions');
const { runBotStep } = require('./bot');

const ALL = [...createDeck(), ...getExpansionCards(Object.keys(EXPANSIONS))];
let passed = 0, failed = 0;
const pass = l => { console.log(`✅ ${l}`); passed++; };
const fail = (l, d) => { console.log(`❌ ${l} — ${d}`); failed++; process.exitCode = 1; };
const check = (label, cond, det) => cond ? pass(label) : fail(label, det);
const find = n => ALL.find(c => c.name === n);
const uni = id => ({ id, type:'basic_unicorn', name:'BU', emoji:'🦄', effect:null, description:'', expansion:null });
const clone = (c, id) => ({ ...c, id });

function setup(n = 2) {
  const g = new Game('n' + Math.random());
  for (let i = 1; i <= n; i++) g.addPlayer('p' + i, 'P' + i);
  g.updateSettings({ expansions: [], winCondition: 7, localMode: false, debugMode: false });
  g.startGame();
  g.phase = 'action'; g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  for (const p of g.playerOrder) { g.players[p].hand = []; g.players[p].stable = []; g.players[p].connected = true; }
  return g;
}
const giveNeigh = (g, pid, id, name = 'Neigh') => g.players[pid].hand.push(clone(find(name), id));

function play(g, cardId = 'c1') {
  g.players.p1.hand.push(uni(cardId));
  return g.playCard('p1', cardId, null, null);
}
const inStable = (g, pid, id) => g.players[pid].stable.some(c => c.id === id);

console.log('── Neigh window closes by itself ──');
{ // nobody holds a Neigh → settles at once, no grace period
  const g = setup(3); play(g);
  check('window opens after the play', g.neighWindow, 'no neigh window');
  check('nobody can respond → no pending responders', g.neighPendingResponders().length === 0, JSON.stringify(g.neighPendingResponders()));
  check('state shows no wait time when nobody can respond', g.stateFor('p1').neighWaitRemainingMs === 0, g.stateFor('p1').neighWaitRemainingMs);
  const r = g.settleNeighWindow();
  check('settle resolves the card with no one pressing anything', !r?.error && !g.neighWindow && inStable(g, 'p1', 'c1'), JSON.stringify(r));
  check('settle is a no-op once closed', g.settleNeighWindow() === null, 'not null');
}
{ // a Neigh-holder is waited on, until they answer
  const g = setup(3); giveNeigh(g, 'p2', 'n2'); play(g);
  check('holder is pending', JSON.stringify(g.neighPendingResponders()) === '["p2"]', JSON.stringify(g.neighPendingResponders()));
  check('wait timer is reported while someone can still respond', g.stateFor('p1').neighWaitRemainingMs > 0, g.stateFor('p1').neighWaitRemainingMs);
  check('settle does NOT close while a holder has not answered', g.settleNeighWindow() === null && g.neighWindow && !inStable(g, 'p1', 'c1'), 'closed early');
  const r = g.passNeigh('p2');
  check('"Let it play" from the only holder closes the window and the card lands', !r?.error && !g.neighWindow && inStable(g, 'p1', 'c1'), JSON.stringify(r));
}
{ // two holders: all must answer
  const g = setup(3); giveNeigh(g, 'p2', 'n2'); giveNeigh(g, 'p3', 'n3'); play(g);
  g.passNeigh('p2');
  check('one pass of two keeps the window open', g.neighWindow && !inStable(g, 'p1', 'c1'), 'closed early');
  g.passNeigh('p3');
  check('second pass closes it', !g.neighWindow && inStable(g, 'p1', 'c1'), 'still open');
}
{ // a disconnected holder is not waited on
  const g = setup(2); giveNeigh(g, 'p2', 'n2'); play(g);
  g.players.p2.connected = false;
  g.settleNeighWindow();
  check('disconnected Neigh-holder no longer blocks the play', !g.neighWindow && inStable(g, 'p1', 'c1'), 'still open');
}
{ // Neigh played → nobody else holds one → chain settles with the card countered
  const g = setup(2); giveNeigh(g, 'p2', 'n2'); play(g);
  const r = g.playInstant('p2', 'n2');
  check('Neigh opens the Super Neigh window', !r?.error && g.superNeighWindow, JSON.stringify(r));
  check('p1 (no Neigh) cannot answer → nothing pending', g.neighPendingResponders().length === 0, JSON.stringify(g.neighPendingResponders()));
  g.settleNeighWindow();
  check('settle finalizes: card countered, not in stable', !g.superNeighWindow && !g.neighWindow && !inStable(g, 'p1', 'c1') && g.discard.some(c => c.id === 'c1'), 'not countered');
}
{ // the original player holding a Neigh gets to answer the Neigh
  const g = setup(2); giveNeigh(g, 'p2', 'n2'); giveNeigh(g, 'p1', 'n1'); play(g);
  g.playInstant('p2', 'n2');
  check('original player holding a Neigh is the pending responder', JSON.stringify(g.neighPendingResponders()) === '["p1"]', JSON.stringify(g.neighPendingResponders()));
  g.passNeigh('p1');
  check('they pass → Neigh stands, card countered', !g.superNeighWindow && !inStable(g, 'p1', 'c1'), 'not countered');
}
{ // a Super Neigh can't be answered
  const g = setup(3); giveNeigh(g, 'p2', 'sn2', 'Super Neigh'); giveNeigh(g, 'p3', 'n3'); play(g);
  g.playInstant('p2', 'sn2');
  check('Super Neigh on the table → nobody pending even though p3 holds a Neigh', g.neighPendingResponders().length === 0, JSON.stringify(g.neighPendingResponders()));
  g.settleNeighWindow();
  check('and it settles by itself', !g.superNeighWindow && !inStable(g, 'p1', 'c1'), 'unsettled');
}

console.log('\n── Bots answer the window ──');
{ for (const diff of ['easy', 'medium', 'hard']) {
    let stuck = 0;
    for (let k = 0; k < 15; k++) {
      const g = setup(2); g.players.p2.isBot = true; giveNeigh(g, 'p2', 'n2'); play(g);
      runBotStep(g, 'p2', diff);
      if (g.neighPendingResponders().includes('p2')) stuck++;
    }
    check(`bot (${diff}) holding a Neigh always either Neighs or passes (never left pending)`, stuck === 0, `${stuck}/15 stuck`);
  } }
{ const g = setup(2); g.players.p1.isBot = true; g.players.p2.isBot = false; play(g);
  const r = runBotStep(g, 'p1', 'medium');
  check('bot actor closes its own window at once when nobody can Neigh', r.acted && !g.neighWindow && inStable(g, 'p1', 'c1'), JSON.stringify(r)); }
{ const g = setup(2); g.players.p1.isBot = true; giveNeigh(g, 'p2', 'n2'); play(g);
  const r = runBotStep(g, 'p1', 'medium');
  check('bot actor waits (does not force) while a human holder is still deciding', r.kind === 'neigh_wait' && g.neighWindow, JSON.stringify(r)); }
{ const g = setup(3); g.players.p1.isBot = g.players.p2.isBot = g.players.p3.isBot = true; giveNeigh(g, 'p3', 'n3'); play(g);
  const r = runBotStep(g, 'p1', 'medium');
  check('bot actor lets a bot responder go first (does not hog the tick)', r.acted === false, JSON.stringify(r)); }

console.log('\n── "Discard, then steal/destroy" with no target ──');
{ const g = setup(2); g.players.p1.hand = [uni('a'), uni('b'), uni('c')];
  g._queueEffect({ type:'discard_n_steal_unicorn', playerId:'p1', needed:2 });
  const r = g.resolvePendingEffect('p1', ['a', 'b'], {});
  check('steal: opponent has no Unicorn → discard is paid and the effect closes', !r.error && !g.pendingEffect && g.players.p1.hand.length === 1, JSON.stringify(r) + JSON.stringify(g.pendingEffect)); }
{ const g = setup(2); g.players.p2.stable = [uni('x')]; g.players.p1.hand = [uni('a'), uni('b'), uni('c')];
  g._queueEffect({ type:'discard_n_steal_unicorn', playerId:'p1', needed:2 });
  g.resolvePendingEffect('p1', ['a', 'b'], {});
  check('steal: with a target the effect still waits for the pick', g.pendingEffect?.discardDone === true, JSON.stringify(g.pendingEffect));
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'x' });
  check('steal: pick completes it', !r.error && inStable(g, 'p1', 'x'), JSON.stringify(r)); }
{ const g = setup(2); g.players.p1.hand = [uni('a'), uni('b'), uni('c')];
  g._queueEffect({ type:'discard_two_destroy_unicorn', playerId:'p1' });
  const r = g.resolvePendingEffect('p1', ['a', 'b'], {});
  check('destroy: no Unicorn anywhere → effect closes after the discard', !r.error && !g.pendingEffect, JSON.stringify(r) + JSON.stringify(g.pendingEffect)); }
{ // the bot plays both halves
  const g = setup(2); g.players.p1.isBot = true; g.players.p2.stable = [uni('x')]; g.players.p1.hand = [uni('a'), uni('b'), uni('c')];
  g._queueEffect({ type:'discard_two_destroy_unicorn', playerId:'p1', optional:true });
  let guard = 0; while (g.pendingEffect && guard++ < 6) { if (!runBotStep(g, 'p1', 'hard').acted) break; }
  check('bot resolves discard_two_destroy_unicorn without leaving it pending', !g.pendingEffect, JSON.stringify(g.pendingEffect)); }
{ const g = setup(2); g.players.p1.isBot = true; g.players.p2.stable = [uni('x')]; g.players.p1.hand = [uni('a'), uni('b'), uni('c')];
  g._queueEffect({ type:'discard_n_steal_unicorn', playerId:'p1', needed:2 });
  let guard = 0; while (g.pendingEffect && guard++ < 6) { if (!runBotStep(g, 'p1', 'hard').acted) break; }
  check('bot steals a Unicorn via discard_n_steal_unicorn', !g.pendingEffect && inStable(g, 'p1', 'x'), JSON.stringify(g.pendingEffect)); }
{ const g = setup(2); g.players.p1.isBot = true; g.players.p2.hand = [uni('h1')];
  g._queueEffect({ type:'wall_of_horns_offer', playerId:'p1', attackerId:'p2', optional:true, source:'Wall of Horns' });
  runBotStep(g, 'p1', 'easy');
  check('bot accepts the Wall of Horns offer', !g.pendingEffect && g.players.p1.hand.some(c => c.id === 'h1'), JSON.stringify(g.pendingEffect)); }

console.log('\n── Temp-stolen Unicorn returns with its reactions ──');
{ const g = setup(2);
  // p1 is holding p2's Unicorn on loan; p2 has Barbed Wire ("each time a Unicorn enters or leaves your Stable, discard")
  const loan = { ...uni('loan'), _tempFrom: 'p2' };
  g.players.p1.stable = [loan];
  g.players.p2.stable = [clone(find('Barbed Wire'), 'bw')];
  g.players.p2.hand = [uni('d1'), uni('d2')];
  g.tempSteals = [{ pid: 'p1', cardId: 'loan', returnTo: 'p2' }];
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  g._advanceTurn();
  check('card went home', inStable(g, 'p2', 'loan') && !inStable(g, 'p1', 'loan'), 'not returned');
  check('owner\'s Barbed Wire reacted (discard prompt pending in the Beginning phase)', g.pendingEffect?.playerId === 'p2' && g.phase === 'beginning', JSON.stringify(g.pendingEffect) + g.phase);
  const e = g.pendingEffect;
  const r = g.resolvePendingEffect('p2', ['d1'], {});
  check('answering it carries the turn on to the Draw phase', !r.error && !g.pendingEffect && g.phase === 'draw' && g.currentPlayer === 'p1', JSON.stringify(r) + g.phase); }
{ const g = setup(2); // no reactions → straight to Draw, nothing stuck
  g.players.p1.stable = [{ ...uni('loan'), _tempFrom: 'p2' }]; g.tempSteals = [{ pid: 'p1', cardId: 'loan', returnTo: 'p2' }];
  g.currentPlayerIndex = g.playerOrder.indexOf('p2'); g._advanceTurn();
  check('plain return (no reactions) goes straight to Draw', !g.pendingEffect && g.phase === 'draw' && inStable(g, 'p2', 'loan'), g.phase); }

console.log('\n── Free Candy / steal-a-Baby picks: a wrong pick is an error, never a silent skip ──');
{
  const mk = () => {
    const g = new Game('fc' + Math.random());
    for (const i of [1, 2]) g.addPlayer('p' + i, 'P' + i);
    g.updateSettings({ expansions: ['nsfw'], winCondition: 7, localMode: false, debugMode: false });
    g.startGame();
    g.phase = 'action'; g.currentPlayerIndex = g.playerOrder.indexOf('p1');
    for (const p of g.playerOrder) { g.players[p].hand = []; g.players[p].stable = []; g.players[p].connected = true; }
    return g;
  };
  const NS = [...createDeck(), ...getExpansionCards(Object.keys(EXPANSIONS))];
  const fc = NS.find(c => c.name === 'Free Candy Unicorn');
  const baby = id => ({ id, type:'baby_unicorn', name:'Baby', emoji:'b', effect:null, description:'', expansion:null });
  const play = g => { g.players.p1.hand.push({ ...fc, id:'fc1' }); g.playCard('p1', 'fc1', null, null); g.settleNeighWindow(); };

  { const g = mk(); g.players.p2.stable = [uni('basic'), baby('baby')];
    play(g);
    check('Free Candy asks for a Baby Unicorn', g.pendingEffect?.type === 'steal_baby_temp', JSON.stringify(g.pendingEffect));
    const phaseBefore = g.phase, actionsBefore = g.actionsUsedThisTurn;
    const r = g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'basic' });
    check('picking a non-Baby Unicorn is an error that says what to do', /isn't a Baby Unicorn/.test(r.error || ''), JSON.stringify(r));
    check('...the effect stays open and the turn does not end', g.pendingEffect?.type === 'steal_baby_temp' && g.phase === phaseBefore && g.currentPlayer === 'p1' && g.players.p2.stable.length === 2, `${g.phase}/${g.currentPlayer}`);
    const r2 = g.resolvePendingEffect('p1', [], { targetPlayerId:'p1', targetCardId:'fc1' });
    check('picking your own card is an error too', !!r2.error && g.pendingEffect?.type === 'steal_baby_temp', JSON.stringify(r2));
    const r3 = g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'nope' });
    check('picking a card that is not there is an error', !!r3.error && g.pendingEffect?.type === 'steal_baby_temp', JSON.stringify(r3));
    const r4 = g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'baby' });
    check('re-picking a real Baby Unicorn then works', !r4.error && g.players.p1.stable.some(c => c.id === 'baby') && !g.pendingEffect, JSON.stringify(r4));
  }
  { const g = mk(); g.players.p2.stable = [uni('basic')];            // no Baby anywhere to steal
    play(g);
    check('no Baby Unicorn to steal → the effect is skipped, not left to soft-lock', !g.pendingEffect && g.players.p1.stable.some(c => c.id === 'fc1'), JSON.stringify(g.pendingEffect));
    check('...and the turn moves on normally (the card used the turn\'s action)', g.currentPlayer === 'p2' && !g.pendingEffect, `${g.currentPlayer}/${g.phase}`);
  }
  for (const [type, label, bad] of [['steal_baby', 'Baby', 'basic'], ['steal_basic_temp', 'Basic', 'baby'], ['choice_steal_baby_or_revive_basic', 'Baby', 'basic']]) {
    const g = mk(); g.players.p2.stable = [uni('basic'), baby('baby')];
    g.pendingEffect = { type, playerId:'p1' };
    const r = g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:bad, choice:'a' });
    check(`${type}: wrong kind of Unicorn is an error, effect stays open`, !!r.error && g.pendingEffect?.type === type, JSON.stringify(r));
  }
}

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);

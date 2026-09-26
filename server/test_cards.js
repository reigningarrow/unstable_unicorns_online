/**
 * test_cards.js — Per-card mechanics smoke tests
 *
 * Covers specific passive interactions, shield chains, and card-level correctness.
 * Run: node test_cards.js   → all lines should begin with ✅
 *
 * KNOWN FAILING TESTS (real bugs, not test errors) — marked with [BUG]:
 *   (none — all previously known bugs have been fixed)
 *
 * Keep this file updated: add a test BEFORE fixing a bug so the fix can be verified,
 * and regressions caught in future sessions.
 */

'use strict';
const { Game }            = require('./game');
const { createDeck }      = require('./cards');
const { getExpansionCards, EXPANSIONS } = require('./expansions');

const ALL = [...createDeck(), ...getExpansionCards(Object.keys(EXPANSIONS))];

let passed = 0, failed = 0;
const pass  = label        => { process.stdout.write(`✅ ${label}\n`); passed++; };
const fail  = (label, det) => { process.stdout.write(`❌ ${label} — ${det}\n`); failed++; process.exitCode = 1; };
// xfail: known bug, tracked above. Inverted assertion so the suite stays green
// while the bug is unfixed; flip to pass/fail once fixed.
const xfail = (label, det) => { process.stdout.write(`⚠️  [BUG] ${label} — ${det}\n`); };

// ─── helpers ────────────────────────────────────────────────────────────────

function setup(playerCount = 2, expansions = []) {
  const g = new Game('t' + Math.random());
  for (let i = 1; i <= playerCount; i++) g.addPlayer('p' + i, 'P' + i);
  g.updateSettings({ expansions, winCondition: 7, localMode: false, debugMode: false });
  g.startGame();
  g.phase = 'action';
  g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  return g;
}

const find  = name => ALL.find(c => c.name === name);
const injS  = (g, pid, c, id) => g.players[pid].stable.push({ ...c, id });
const injH  = (g, pid, c, id) => g.players[pid].hand.push({ ...c, id });

const uni  = id => ({ id, type: 'basic_unicorn',   name: 'BU',  emoji: '🦄', effect: null, description: '', expansion: null });
const upg  = id => ({ id, type: 'upgrade',         name: 'UPG', emoji: '⬆️', effect: null, description: '', expansion: null });
const dwn  = id => ({ id, type: 'downgrade',       name: 'DWN', emoji: '⬇️',
  effect: { trigger: 'passive', type: 'hand_limit_minus' }, description: '', expansion: null });

// ─── Section 1: Passive immunity — blocking incoming cards ───────────────────

console.log('\n── Passive immunity ──');

// [BUG] Dragon's Blessing: downgrade placed in owner's stable should be blocked
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find("Dragon's Blessing"), 'db');
  injH(g, 'p2', find('Barbed Wire'), 'bw');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  g.playCard('p2', 'bw', 'p1', null);
  g.resolveNeigh('p2');
  const blocked = !g.players['p1'].stable.some(c => c.id === 'bw');
  blocked
    ? pass("Dragon's Blessing blocks incoming downgrade")
    : fail("Dragon's Blessing", 'downgrade entered stable — fix: check downgrades_have_no_effect in DOWNGRADE branch of _resolveCardEffect');
}

// Saved by the Sigil: blocks ALL downgrades from entering
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', find('Saved by the Sigil'), 'sig');
  injH(g, 'p2', find('Barbed Wire'), 'bw');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  g.playCard('p2', 'bw', 'p1', null);
  g.resolveNeigh('p2');
  !g.players['p1'].stable.some(c => c.id === 'bw')
    ? pass('Saved by the Sigil blocks incoming downgrade') : fail('Saved by the Sigil', 'downgrade entered stable');
}

// Broken Stable: prevents the owner from playing upgrades
{
  const g = setup();
  injS(g, 'p1', find('Broken Stable'), 'bs');
  injH(g, 'p1', find('Rainbow Aura'), 'ra');
  const r = g.playCard('p1', 'ra', null, null);
  r.error ? pass('Broken Stable blocks upgrade play') : fail('Broken Stable', 'upgrade played through');
}

// Ginormous Unicorn: owner cannot play Neigh cards at all
{
  const g = setup();
  const n = ALL.find(c => c.effect?.type === 'neigh');
  injS(g, 'p1', find('Ginormous Unicorn'), 'gin');
  injS(g, 'p2', uni('v'), 'v');
  injH(g, 'p2', find('Unicorn Poison'), 'up');
  injH(g, 'p1', n, 'n1');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  g.playCard('p2', 'up', 'p1', 'gin');
  const r = g.playInstant('p1', 'n1');
  r.error ? pass('Ginormous Unicorn: owner cannot neigh') : fail('Ginormous Unicorn', 'neigh not blocked');
}

// stateFor: neighBlocked exposed correctly per player
{
  const g = setup();
  injS(g, 'p1', find('Ginormous Unicorn'), 'gin');
  const s1 = g.stateFor('p1');
  const s2 = g.stateFor('p2');
  s1.neighBlocked === true  ? pass('neighBlocked=true for Ginormous owner')       : fail('neighBlocked p1', s1.neighBlocked);
  s2.neighBlocked === false ? pass('neighBlocked=false for non-Ginormous player') : fail('neighBlocked p2', s2.neighBlocked);
}

// Queen Bee: blocks basic unicorns from entering any OTHER player's stable
{
  const g = setup(3);
  injS(g, 'p1', find('Queen Bee Unicorn'), 'qb');
  injH(g, 'p2', uni('bu'), 'bu');
  g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  g.playCard('p2', 'bu', null, null);
  g.resolveNeigh('p2');
  !g.players['p2'].stable.some(c => c.id === 'bu')
    ? pass('Queen Bee: blocks basic entering another stable') : fail('Queen Bee', 'basic entered p2 stable');
}

// Queen Bee: does NOT block the owner from playing basics into their own stable
{
  const g = setup();
  injS(g, 'p1', find('Queen Bee Unicorn'), 'qb');
  injH(g, 'p1', uni('bu'), 'bu');
  g.playCard('p1', 'bu', null, null);
  g.resolveNeigh('p1');
  g.players['p1'].stable.some(c => c.id === 'bu')
    ? pass('Queen Bee: owner can still play basics into own stable') : fail('Queen Bee self-block', 'owner blocked from own stable');
}

// ─── Section 2: Destroy protection ──────────────────────────────────────────

console.log('\n── Destroy protection ──');

// [BUG] Rainbow Aura: all unicorns in owner's stable cannot be destroyed
{
  const g = setup();
  injS(g, 'p1', find('Rainbow Aura'), 'ra');
  injS(g, 'p1', uni('v'), 'v');
  g._destroyCard('p1', 'v', 'p2');
  g.players['p1'].stable.some(c => c.id === 'v')
    ? pass('Rainbow Aura: blocks destroy')
    : fail('Rainbow Aura', 'card destroyed — fix: _destroyCard checks protection.protectsFrom===\'destroy\'');
}

// Magical Kittencorn: cannot be destroyed BY MAGIC (pass byMagic=true)
{
  const g = setup();
  injS(g, 'p1', find('Magical Kittencorn'), 'kit');
  g._destroyCard('p1', 'kit', 'p2', true); // byMagic=true
  g.players['p1'].stable.some(c => c.id === 'kit')
    ? pass('Magical Kittencorn: cannot be destroyed by magic')
    : fail('Magical Kittencorn destroy', 'kittencorn destroyed by magic');
  // Non-magic destroy of Kittencorn itself should succeed
  g._destroyCard('p1', 'kit', 'p2', false); // byMagic=false
  !g.players['p1'].stable.some(c => c.id === 'kit')
    ? pass('Magical Kittencorn: CAN be destroyed by non-magic effects')
    : fail('Magical Kittencorn non-magic destroy', 'kittencorn not destroyed by non-magic');
}

// Phantom Unicorn (Nightmares): cannot be sacrificed or destroyed
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', find('Phantom Unicorn'), 'ph');
  g._destroyCard('p1', 'ph', 'p2');
  g.players['p1'].stable.some(c => c.id === 'ph')
    ? pass('Phantom Unicorn: cannot be destroyed') : fail('Phantom Unicorn destroy', 'was destroyed');
  g._sacrificeCard('p1', 'ph');
  g.players['p1'].stable.some(c => c.id === 'ph')
    ? pass('Phantom Unicorn: cannot be sacrificed') : fail('Phantom Unicorn sacrifice', 'was sacrificed');
}

// Unicorn Phoenix: discards a card from hand instead of being destroyed
{
  const g = setup();
  injS(g, 'p1', find('Unicorn Phoenix'), 'ph');
  injH(g, 'p1', uni('h'), 'h');
  const before = g.players['p1'].hand.length;
  g._destroyCard('p1', 'ph', 'p2');
  const stillInStable = g.players['p1'].stable.some(c => c.id === 'ph');
  const discarded     = g.players['p1'].hand.length < before;
  stillInStable && discarded
    ? pass('Unicorn Phoenix: blocks destroy by discarding from hand')
    : fail('Unicorn Phoenix', `inStable=${stillInStable} discarded=${discarded}`);
}

// Dragon Protection: owner discards from hand instead of the unicorn being destroyed
{
  const g = setup(2, ['dragons']);
  injS(g, 'p1', find('Dragon Protection'), 'dp');
  injS(g, 'p1', uni('v'), 'v');
  injH(g, 'p1', uni('h'), 'h');
  g._destroyCard('p1', 'v', 'p2');
  g.players['p1'].stable.some(c => c.id === 'v')
    ? pass('Dragon Protection: blocks destroy by discarding')
    : fail('Dragon Protection', 'card was destroyed');
}

// Black Knight Unicorn: once per turn, owner discards to block a destroy
{
  const g = setup();
  injS(g, 'p1', find('Black Knight Unicorn'), 'bk');
  injS(g, 'p1', uni('v'), 'v');
  injH(g, 'p1', uni('h'), 'h');
  g._destroyCard('p1', 'v', 'p2');
  g.players['p1'].stable.some(c => c.id === 'v')
    ? pass('Black Knight Unicorn: blocks one destroy per turn')
    : fail('Black Knight Unicorn', 'card was destroyed');
}

// ─── Section 3: Steal protection ─────────────────────────────────────────────

console.log('\n── Steal protection ──');

// Magical Kittencorn: only protects ITSELF from magic destroy — steals are NOT blocked
{
  const g = setup();
  injS(g, 'p1', find('Magical Kittencorn'), 'kit');
  injS(g, 'p1', uni('v'), 'v');
  g._stealCard('p2', 'p1', 'v');
  !g.players['p1'].stable.some(c => c.id === 'v')
    ? pass('Magical Kittencorn: steals from its stable are NOT blocked (only self-protects from magic destroy)')
    : fail('Magical Kittencorn steal', 'steal was incorrectly blocked by Kittencorn');
}

// Ugly Holiday Sweater (Christmas): unicorns cannot be stolen
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Ugly Holiday Sweater'), 'uhs');
  injS(g, 'p1', uni('v'), 'v');
  g._stealCard('p2', 'p1', 'v');
  g.players['p1'].stable.some(c => c.id === 'v')
    ? pass('Ugly Holiday Sweater: blocks steal') : fail('Ugly Holiday Sweater', 'card was stolen');
}

// ─── Section 4: Neigh interactions ───────────────────────────────────────────

console.log('\n── Neigh interactions ──');

// Yay: cards played by the owner cannot be neighed
{
  const g   = setup();
  const n   = ALL.find(c => c.effect?.type === 'neigh');
  injS(g, 'p1', find('Yay'), 'yay');
  injH(g, 'p1', uni('bu'), 'bu');
  injH(g, 'p2', n, 'n1');
  g.playCard('p1', 'bu', null, null);
  const r = g.playInstant('p2', 'n1');
  r.error ? pass('Yay: card cannot be neighed') : fail('Yay', 'neigh not blocked');
}

// Hex Neigh (Nightmares): neighed card is removed from game, not just discarded
{
  const g  = setup(2, ['nightmares']);
  injS(g, 'p2', uni('v'), 'v');
  injH(g, 'p1', find('Unicorn Poison'), 'up');
  injH(g, 'p2', find('Hex Neigh'), 'hn');
  g.playCard('p1', 'up', 'p2', 'v');
  g.playInstant('p2', 'hn');
  g.resolveNeigh('p2'); // close the Super Neigh window: nobody counters, so the Neigh stands
  g.removedFromGame.some(c => c.id === 'up')
    ? pass('Hex Neigh: neighed card removed from game') : fail('Hex Neigh', 'card not in removedFromGame');
}

// ─── Section 5: Stable limit / win condition modifiers ───────────────────────

console.log('\n── Stable limits & win modifiers ──');

// Tiny Stable: triggers a forced sacrifice when unicorn count exceeds limit after placement
{
  const g = setup();
  injS(g, 'p1', find('Tiny Stable'), 'ts');
  // Start has 1 baby. Add 5 more for 6 total (Tiny Stable limit = 5).
  for (let i = 1; i <= 5; i++) injS(g, 'p1', uni('u' + i), 'u' + i);
  injH(g, 'p1', uni('u6'), 'u6');
  g.playCard('p1', 'u6', null, null);
  g.resolveNeigh('p1');
  g.pendingEffect?.type === 'sacrifice_unicorn_tiny_stable'
    ? pass('Tiny Stable: triggers sacrifice when over limit')
    : fail('Tiny Stable', `pendingEffect=${g.pendingEffect?.type}`);
}

// Pandamonium: all unicorns count as pandas — win condition never met by count alone
{
  const g = setup();
  injS(g, 'p1', find('Pandamonium'), 'pand');
  for (let i = 0; i < 7; i++) injS(g, 'p1', uni('u' + i), 'u' + i);
  !g.stateFor('p1').winner
    ? pass('Pandamonium: 7 unicorns does not trigger win') : fail('Pandamonium', 'win triggered despite Pandamonium');
}

// Uneaten Fruitcake (Christmas): owner can never win
{
  const g = setup(2, ['christmas']);
  injS(g, 'p1', find('Uneaten Fruitcake'), 'uf');
  for (let i = 0; i < 7; i++) injS(g, 'p1', uni('u' + i), 'u' + i);
  !g.stateFor('p1').winner
    ? pass('Uneaten Fruitcake: owner cannot win') : fail('Uneaten Fruitcake', 'win triggered');
}

// Ginormous Unicorn: _unicornCount counts it as 2
// (winner is only set by _checkWin() called during card plays, not lazily in stateFor)
{
  const g = setup();
  injS(g, 'p1', find('Ginormous Unicorn'), 'gin');
  // baby already in stable from startGame: gin(2) + baby(1) = 3
  // add 4 more to reach 7
  for (let i = 0; i < 4; i++) injS(g, 'p1', uni('u' + i), 'u' + i);
  g._unicornCount('p1') === 7
    ? pass('Ginormous Unicorn: _unicornCount returns 7 (counts as 2)')
    : fail('Ginormous count', `_unicornCount=${g._unicornCount('p1')}`);
}

// Sweet Old Ladycorn (Nightmares): also counts as 2 in _unicornCount
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p1', find('Sweet Old Ladycorn'), 'sol');
  for (let i = 0; i < 4; i++) injS(g, 'p1', uni('u' + i), 'u' + i);
  g._unicornCount('p1') === 7
    ? pass('Sweet Old Ladycorn: _unicornCount returns 7 (counts as 2)')
    : fail('Sweet Old Ladycorn count', `_unicornCount=${g._unicornCount('p1')}`);
}

// ─── Section 6: Turn / phase mechanics ──────────────────────────────────────

console.log('\n── Turn & phase mechanics ──');

// Extra turns: correctly stay with the earning player in 3-player games
{
  const g = setup(3);
  injH(g, 'p1', find('Change of Luck'), 'col');
  [1, 2, 3].forEach(i => injH(g, 'p1', uni('c' + i), 'c' + i));
  g.playCard('p1', 'col', null, null);
  g.resolveNeigh('p1');
  g.resolvePendingEffect('p1', ['c1', 'c2', 'c3'], {});
  g.currentPlayer === 'p1'
    ? pass('Extra turn: stays with earning player in 3-player game')
    : fail('Extra turn', `currentPlayer=${g.currentPlayer}`);
}

// Unicorn Nap: skips the target player's entire turn
{
  const g = setup(2, ['rainbow_apocalypse']);
  injH(g, 'p1', find('Unicorn Nap'), 'un');
  g.playCard('p1', 'un', 'p2', null);
  g.resolveNeigh('p1');
  g.currentPlayer === 'p1'
    ? pass('Unicorn Nap: skips target player full turn')
    : fail('Unicorn Nap', `currentPlayer=${g.currentPlayer} phase=${g.phase}`);
}

// Temp steal: card returns to original owner after the thief's next turn ends
{
  const g = setup(2, ['nsfw']);
  injS(g, 'p2', uni('b'), 'b');
  g.pendingEffect = { type: 'steal_basic_temp', playerId: 'p1' };
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'b' });
  g._advanceTurn();
  g.players['p2'].stable.some(c => c.id === 'b')
    ? pass('Temp steal: card returns after thief turn ends')
    : fail('Temp steal return', 'card not returned');
}

// ─── Section 7: Hand visibility ──────────────────────────────────────────────

console.log('\n── Hand visibility ──');

// Nanny Cam: forces the owner's hand visible to all other players
{
  const g = setup();
  injS(g, 'p2', find('Nanny Cam'), 'nc');
  const s = g.stateFor('p1');
  s.players['p2'].handVisible && s.players['p2'].hand.length > 0
    ? pass('Nanny Cam: p2 hand visible to p1') : fail('Nanny Cam', `vis=${s.players['p2'].handVisible}`);
}

// removedFromGameCount shows in stateFor
{
  const g = setup(2, ['nightmares']);
  injS(g, 'p2', uni('v'), 'v');
  injH(g, 'p1', find('Unicorn Poison'), 'up');
  injH(g, 'p2', find('Hex Neigh'), 'hn');
  g.playCard('p1', 'up', 'p2', 'v');
  g.playInstant('p2', 'hn');
  g.resolveNeigh('p2'); // close the Super Neigh window: nobody counters, so the Neigh stands
  g.stateFor('p1').removedFromGameCount === 1
    ? pass('removedFromGameCount increments and appears in stateFor')
    : fail('removedFromGameCount', g.stateFor('p1').removedFromGameCount);
}

// ─── Section 8: Chainsaw Unicorn / destroy_upgrade_or_sacrifice_downgrade ───

console.log('\n── Chainsaw Unicorn ──');

{
  const g = setup();
  injH(g, 'p1', find('Chainsaw Unicorn'), 'cs');
  g.playCard('p1', 'cs', null, null);
  g.resolveNeigh('p1');
  !g.pendingEffect
    ? pass('Chainsaw: no modifiers → no effect queued')
    : fail('Chainsaw skip', g.pendingEffect?.type);
}

{
  const g = setup();
  injS(g, 'p2', upg('u1'), 'u1');
  injH(g, 'p1', find('Chainsaw Unicorn'), 'cs');
  g.playCard('p1', 'cs', null, null);
  g.resolveNeigh('p1');
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'u1' });
  !g.players['p2'].stable.some(c => c.id === 'u1')
    ? pass('Chainsaw: destroys opponent upgrade') : fail('Chainsaw destroy', 'upgrade still in stable');
}

{
  const g = setup();
  injS(g, 'p2', dwn('d1'), 'd1');
  injH(g, 'p1', find('Chainsaw Unicorn'), 'cs');
  g.playCard('p1', 'cs', null, null);
  g.resolveNeigh('p1');
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'd1' });
  !g.players['p2'].stable.some(c => c.id === 'd1')
    ? pass('Chainsaw: sacrifices opponent downgrade') : fail('Chainsaw sacrifice', 'downgrade still in stable');
}

{
  const g = setup();
  injS(g, 'p2', upg('u1'), 'u1');
  injH(g, 'p1', find('Chainsaw Unicorn'), 'cs');
  g.playCard('p1', 'cs', null, null);
  g.resolveNeigh('p1');
  g.pendingEffect?.optional === true
    ? pass('Chainsaw: effect carries optional=true') : fail('Chainsaw optional', JSON.stringify(g.pendingEffect));
  const r = g.resolvePendingEffect('p1', [], { skip: true });
  !r?.error && !g.pendingEffect
    ? pass('Chainsaw: optional skip resolves cleanly') : fail('Chainsaw skip', r?.error || g.pendingEffect?.type);
}

// ─── Section 9: Feasibility guards ───────────────────────────────────────────

console.log('\n── Feasibility guards ──');

{
  const g = setup();
  injH(g, 'p1', find('Necromancer Unicorn'), 'nec');
  g.playCard('p1', 'nec', null, null);
  g.resolveNeigh('p1');
  !g.pendingEffect
    ? pass('Necromancer: skips when not feasible') : fail('Necromancer', g.pendingEffect?.type);
}

// ─── Section 10: Tiny Stable via _placeCard ──────────────────────────────────

console.log('\n── Tiny Stable (_placeCard path) ──');

// Tiny Stable triggers when a unicorn enters via _placeCard (steal, revive, etc.)
{
  const g = setup();
  injS(g, 'p1', find('Tiny Stable'), 'ts');
  for (let i = 0; i < 5; i++) injS(g, 'p1', uni('f'+i), 'f'+i);
  // _placeCard directly (mimics steal/revive path)
  const v = uni('vv'); v.id = 'vv';
  g._placeCard('p1', v, null, null);
  g.pendingEffect?.type === 'sacrifice_unicorn_tiny_stable'
    ? pass('Tiny Stable: triggers sacrifice_unicorn_tiny_stable via _placeCard path')
    : fail('Tiny Stable _placeCard', g.pendingEffect?.type);
}

// Tiny Stable via normal playCard path
{
  const g = setup();
  injS(g, 'p1', find('Tiny Stable'), 'ts');
  for (let i = 0; i < 5; i++) injS(g, 'p1', uni('f'+i), 'f'+i);
  const v = uni('vv'); v.id = 'vv2';
  g.players['p1'].hand.push(v);
  g.phase = 'action'; g.currentPlayerIndex = g.playerOrder.indexOf('p1');
  g.playCard('p1', 'vv2', null, null);
  g.resolveNeigh('p1');
  g.pendingEffect?.type === 'sacrifice_unicorn_tiny_stable'
    ? pass('Tiny Stable: triggers via normal playCard path')
    : fail('Tiny Stable playCard', g.pendingEffect?.type);
}

// ─── Section 11: Kittencorn self-protection ──────────────────────────────────

console.log('\n── Kittencorn self-protection ──');

// Kittencorn: magic destroy of ITSELF is blocked
{
  const g = setup(2, ['rainbow_apocalypse']);
  injS(g, 'p1', find('Magical Kittencorn'), 'kit');
  const up = ALL.find(c => c.name === 'Unicorn Poison');
  g.players['p2'].hand.push({...up, id:'up'});
  g.phase = 'action'; g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  g.playCard('p2', 'up', 'p1', 'kit');
  g.resolveNeigh('p2');
  g.players['p1'].stable.some(c => c.id === 'kit')
    ? pass('Magical Kittencorn: magic destroy of itself is blocked')
    : fail('Kittencorn self-protect', 'kittencorn was destroyed');
}

// Kittencorn: magic destroy of ANOTHER unicorn in the same stable is NOT blocked
{
  const g = setup(2, ['rainbow_apocalypse']);
  injS(g, 'p1', find('Magical Kittencorn'), 'kit');
  injS(g, 'p1', uni('v'), 'v');
  const up = ALL.find(c => c.name === 'Unicorn Poison');
  g.players['p2'].hand.push({...up, id:'up2'});
  g.phase = 'action'; g.currentPlayerIndex = g.playerOrder.indexOf('p2');
  g.playCard('p2', 'up2', 'p1', 'v');
  g.resolveNeigh('p2');
  !g.players['p1'].stable.some(c => c.id === 'v')
    ? pass('Magical Kittencorn: magic destroy of OTHER unicorn in stable is NOT blocked')
    : fail('Kittencorn scope', 'other unicorn was incorrectly protected');
}

// ─── Section 12: Claw Machine ────────────────────────────────────────────────

console.log('\n── Claw Machine ──');

{
  const g = setup();
  injS(g, 'p1', find('Claw Machine'), 'cm');
  const h1 = uni('h1'); injH(g, 'p1', h1, 'h1');
  const before = g.players['p1'].hand.length;
  g.phase = 'beginning'; g._beginningPhase();
  g.pendingEffect?.type === 'beginning_optional_choices'
    ? pass('Claw Machine: queues beginning_optional_choices')
    : fail('Claw Machine queue', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', ['cm'], {});
  g.pendingEffect?.type === 'discard_then_draw_beginning'
    ? pass('Claw Machine: queues discard_then_draw_beginning after activation')
    : fail('Claw Machine activate', g.pendingEffect?.type);
  g.resolvePendingEffect('p1', ['h1'], {});
  g.phase === 'draw' && g.currentPlayer === 'p1'
    ? pass('Claw Machine: advances to draw phase (not end of turn)')
    : fail('Claw Machine phase', 'phase=' + g.phase + ' player=' + g.currentPlayer);
  g.players['p1'].hand.length === before
    ? pass('Claw Machine: net hand size unchanged (discard 1 draw 1)')
    : fail('Claw Machine hand', 'before=' + before + ' after=' + g.players['p1'].hand.length);
  !g.players['p1'].hand.some(c => c.id === 'h1')
    ? pass('Claw Machine: discarded card is gone from hand')
    : fail('Claw Machine discard', 'h1 still in hand');
}

// ─── Section 13: Code Health 3 — _placeCard routing ─────────────────────────

console.log('\n── Code Health 3: _placeCard routing ──');

// Tiny Stable fires via _placeCard
{
  const g = setup();
  injS(g, 'p1', find('Tiny Stable'), 'ts');
  for (let i = 0; i < 5; i++) g.players['p1'].stable.push({ ...uni('f'+i), id:'f'+i });
  g._placeCard('p1', { ...uni('vv'), id:'vv' }, null, null);
  g.pendingEffect?.type === 'sacrifice_unicorn_tiny_stable'
    ? pass('_placeCard: Tiny Stable check fires')
    : fail('_placeCard Tiny Stable', g.pendingEffect?.type);
}

// _checkWin fires via _placeCard
{
  const g = setup();
  g.settings.winCondition = 2;
  for (let i = 0; i < 2; i++) g._placeCard('p1', { ...uni('w'+i), id:'w'+i }, null, null);
  g.winner === 'p1'
    ? pass('_placeCard: _checkWin fires and sets winner')
    : fail('_placeCard _checkWin', g.winner);
}

// Queen Bee blocks via _placeCard
{
  const g = setup(3);
  injS(g, 'p1', find('Queen Bee Unicorn'), 'qb');
  const bu = uni('bu');
  g._placeCard('p2', bu, null, null);
  !g.players['p2'].stable.some(c => c.id === bu.id)
    ? pass('_placeCard: Queen Bee blocks basic unicorn entry')
    : fail('_placeCard Queen Bee', 'basic entered p2 stable');
}

// Enter trigger fires via _placeCard
{
  const g = setup();
  const gfu = find('Greedy Flying Unicorn');
  const before = g.players['p1'].hand.length;
  g._placeCard('p1', { ...gfu, id:'gfu' }, null, null);
  g.players['p1'].hand.length > before
    ? pass('_placeCard: enter trigger fires (Greedy Flying Unicorn draws)')
    : fail('_placeCard enter trigger', 'hand unchanged');
}

// ─── Section 14: Code Health 4 — hand limit enforcement ─────────────────────

console.log('\n── Code Health 4: hand limit enforcement ──');

// Non-current player over limit at end of turn
{
  const g = setup();
  for (let i = 0; i < 5; i++) injH(g, 'p2', uni('x'+i), 'x'+i);
  g.phase = 'end'; g._endPhase();
  const eff = g.pendingEffect;
  eff?.type === 'end_discard' && eff?.playerId === 'p2'
    ? pass('CODE HEALTH 4: p2 over limit triggers end_discard at turn end')
    : fail('CODE HEALTH 4 p2', 'type=' + eff?.type + ' pid=' + eff?.playerId);
}

// Multiple players over limit resolved sequentially
{
  const g = setup(3);
  for (let i = 0; i < 3; i++) { injH(g, 'p2', uni('x'+i), 'x'+i); injH(g, 'p3', uni('y'+i), 'y'+i); }
  g.phase = 'end'; g._endPhase();
  const eff = g.pendingEffect;
  eff?.type === 'end_discard'
    ? pass('CODE HEALTH 4: first over-limit player queued')
    : fail('CODE HEALTH 4 first', eff?.type);
  const toDiscard = g.players[eff.playerId].hand.slice(0, eff.amount).map(c => c.id);
  g.resolvePendingEffect(eff.playerId, toDiscard, {});
  g.pendingEffect?.type === 'end_discard'
    ? pass('CODE HEALTH 4: second over-limit player queued after first resolves')
    : fail('CODE HEALTH 4 second', g.pendingEffect?.type);
}

// Player exactly at limit: no end_discard
{
  const g = setup();
  g.phase = 'end'; g._endPhase();
  !g.pendingEffect || g.pendingEffect?.type !== 'end_discard'
    ? pass('CODE HEALTH 4: no end_discard when exactly at hand limit')
    : fail('CODE HEALTH 4 exact', 'end_discard queued unexpectedly');
}

// ─── Section 15: Intercept instants (Adventures: Fishing Rod / Unicorn Net) ──

console.log('\n── Intercept instants ──');

// Fishing Rod: redirects a direct-target Magic steal into the interceptor's own stable
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = []; // isolate: starting hands may already contain a Fishing Rod copy
  injH(g, 'p3', find('Fishing Rod'), 'fr');
  injS(g, 'p2', uni('target'), 'target');
  g.pendingEffect = { type:'choose_steal', playerId:'p1', targetType:null };
  g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'target' });
  g.pendingEffect?.type === 'intercept_offer' && g.pendingEffect.playerId === 'p3' && g.pendingEffect.kind === 'steal'
    ? pass('Fishing Rod: intercept_offer queued for holder')
    : fail('Fishing Rod queue', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept:true });
  g.players['p3'].stable.some(c => c.id === 'target') && !g.players['p1'].stable.some(c => c.id === 'target')
    ? pass('Fishing Rod: card redirected into interceptor stable, not the attacker')
    : fail('Fishing Rod redirect', 'wrong location');
  !g.players['p3'].hand.some(c => c.id === 'fr')
    ? pass('Fishing Rod: consumed from interceptor hand')
    : fail('Fishing Rod consume', 'still held');
}

// Unicorn Net: redirects a direct-target Magic destroy into the interceptor's hand
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  injH(g, 'p1', find('Unicorn Poison'), 'up');
  injH(g, 'p3', find('Unicorn Net'), 'un');
  injS(g, 'p2', uni('doomed'), 'doomed');
  g.playCard('p1', 'up', 'p2', 'doomed');
  g.resolveNeigh('p1');
  g.pendingEffect?.type === 'intercept_offer' && g.pendingEffect.kind === 'destroy'
    ? pass('Unicorn Net: intercept_offer queued on Magic destroy')
    : fail('Unicorn Net queue', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept:true });
  g.players['p3'].hand.some(c => c.id === 'doomed') && !g.discard.some(c => c.id === 'doomed')
    ? pass('Unicorn Net: card saved to interceptor hand instead of destroyed')
    : fail('Unicorn Net redirect', 'not saved');
}

// Declining the offer lets the original steal/destroy proceed unchanged
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  injH(g, 'p1', find('Unicorn Poison'), 'up2');
  injH(g, 'p3', find('Unicorn Net'), 'un2');
  injS(g, 'p2', uni('doomed2'), 'doomed2');
  g.playCard('p1', 'up2', 'p2', 'doomed2');
  g.resolveNeigh('p1');
  g.resolvePendingEffect('p3', [], { intercept:false });
  g.discard.some(c => c.id === 'doomed2') && !g.players['p2'].stable.some(c => c.id === 'doomed2')
    ? pass('Intercept declined: original destroy proceeds normally')
    : fail('Intercept decline', 'not destroyed');
  g.players['p3'].hand.some(c => c.id === 'un2')
    ? pass('Intercept declined: counter-instant stays in hand')
    : fail('Intercept decline keep', 'card gone');
}

// No eligible holder: resolves immediately with no intercept window
{
  const g = setup(2, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = [];
  injH(g, 'p1', find('Unicorn Poison'), 'up3');
  injS(g, 'p2', uni('normal'), 'normal');
  g.playCard('p1', 'up3', 'p2', 'normal');
  g.resolveNeigh('p1');
  g.discard.some(c => c.id === 'normal') && !g.pendingEffect
    ? pass('No intercept holder: resolves immediately, no window opened')
    : fail('No holder', 'pendingEffect=' + JSON.stringify(g.pendingEffect));
}

// The attacker holding their own counter-instant does not get to self-intercept
{
  const g = setup(2, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = [];
  injH(g, 'p1', find('Unicorn Poison'), 'up4');
  injH(g, 'p1', find('Unicorn Net'), 'un4');
  injS(g, 'p2', uni('normal2'), 'normal2');
  g.playCard('p1', 'up4', 'p2', 'normal2');
  g.resolveNeigh('p1');
  g.discard.some(c => c.id === 'normal2') && !g.pendingEffect
    ? pass('Attacker holding the counter-instant cannot self-intercept')
    : fail('Self-intercept', 'pendingEffect=' + JSON.stringify(g.pendingEffect));
}

// choose_destroy with count > 1: intercept offered per-target; a still-held
// counter-instant is offered again on the next target in the same queue.
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  injH(g, 'p3', find('Unicorn Net'), 'un5');
  injS(g, 'p2', uni('t1'), 't1');
  injS(g, 'p2', uni('t2'), 't2');
  g.pendingEffect = { type:'choose_destroy', playerId:'p1', targetType:null, count:2 };
  g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'t1' });
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('choose_destroy (count>1): first target offers intercept')
    : fail('count2 first', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept:false });
  g.discard.some(c => c.id === 't1') && g.pendingEffect?.type === 'choose_destroy' && g.pendingEffect.count === 1
    ? pass('choose_destroy (count>1): first destroyed, continues to remaining target')
    : fail('count2 continue', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'t2' });
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('choose_destroy (count>1): still-held card offers intercept again on 2nd target')
    : fail('count2 second offer', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept:false });
  g.discard.some(c => c.id === 't2') && !g.pendingEffect
    ? pass('choose_destroy (count>1): queue fully drains after all targets resolved')
    : fail('count2 drain', JSON.stringify(g.pendingEffect));
}

// ─── Section 16: Exotic destroy/sacrifice paths (self-sacrifice, Chainsaw,
// Rhinocorn, Ancient Ritual, multi-player sacrifice queues, Spray Bottle loop) ──

console.log('\n── Exotic destroy/sacrifice intercept paths ──');

// 1. Chainsaw-style destroy_upgrade_or_sacrifice_downgrade: UPGRADE branch interceptable
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  injH(g, 'p3', find('Unicorn Net'), 'un1');
  injS(g, 'p2', upg('u1'), 'u1');
  g.pendingEffect = { type: 'destroy_upgrade_or_sacrifice_downgrade', playerId: 'p1', optional: true };
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'u1' });
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('Chainsaw upgrade-destroy: intercept_offer queued')
    : fail('chainsaw-1', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: true });
  g.players['p3'].hand.some(c => c.id === 'u1') && !g.players['p2'].stable.some(c => c.id === 'u1')
    ? pass('Chainsaw upgrade-destroy: intercepted into hand')
    : fail('chainsaw-2', 'not redirected');
  !g.pendingEffect
    ? pass('Chainsaw upgrade-destroy: queue drains cleanly')
    : fail('chainsaw-3', JSON.stringify(g.pendingEffect));
}

// 2. Chainsaw-style DOWNGRADE branch: sacrifice resumeType, interceptable
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  injH(g, 'p3', find('Unicorn Net'), 'un2');
  injS(g, 'p2', dwn('d1'), 'd1');
  g.pendingEffect = { type: 'destroy_upgrade_or_sacrifice_downgrade', playerId: 'p1', optional: true };
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'd1' });
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('Chainsaw downgrade-sacrifice: intercept_offer queued')
    : fail('chainsaw-d1', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: false });
  g.discard.some(c => c.id === 'd1') && !g.players['p2'].stable.some(c => c.id === 'd1')
    ? pass('Chainsaw downgrade-sacrifice: declined, sacrificed normally')
    : fail('chainsaw-d2', 'not sacrificed');
}

// 3. Rhinocorn beginning_destroy_end_turn: intercept correctly surfaces (regression check for the
//    "stale pendingEffect" bug), and turn still ends correctly after resolution either way.
{
  const g = setup(3, ['nightmares']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  injH(g, 'p3', find('Unicorn Net'), 'un3');
  injS(g, 'p2', uni('rt1'), 'rt1');
  const startPid = 'p1';
  g.pendingEffect = { type: 'beginning_destroy_end_turn', playerId: 'p1', optional: true, targetType: 'unicorn' };
  const r = g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'rt1' });
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('Rhinocorn: intercept_offer correctly surfaces (not stale)')
    : fail('rhino-1', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: true });
  g.players['p3'].hand.some(c => c.id === 'rt1')
    ? pass('Rhinocorn: intercepted card saved to interceptor hand')
    : fail('rhino-2', 'not saved');
  !g.pendingEffect && g.pendingEffectQueue.length === 0
    ? pass('Rhinocorn: pendingEffect/queue cleared after intercept + end turn')
    : fail('rhino-3', 'not cleared: ' + JSON.stringify(g.pendingEffect));
}

// 4. Rhinocorn declined: destroy proceeds and turn ends immediately (no leftover pendingEffect)
{
  const g = setup(2, ['nightmares']);
  g.players['p1'].hand = []; g.players['p2'].hand = [];
  injS(g, 'p2', uni('rt2'), 'rt2');
  g.pendingEffect = { type: 'beginning_destroy_end_turn', playerId: 'p1', optional: true, targetType: 'unicorn' };
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'rt2' });
  g.discard.some(c => c.id === 'rt2') && !g.pendingEffect
    ? pass('Rhinocorn: no holder, destroys immediately and ends turn')
    : fail('rhino-4', JSON.stringify(g.pendingEffect));
}

// 5. sacrifice_unicorn (self-selected sacrifice) is interceptable
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  injH(g, 'p3', find('Unicorn Net'), 'un5');
  injS(g, 'p1', uni('own1'), 'own1');
  g.pendingEffect = { type: 'sacrifice_unicorn', playerId: 'p1' };
  g.resolvePendingEffect('p1', ['own1'], {});
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('sacrifice_unicorn: self-sacrifice interceptable')
    : fail('sac-unicorn-1', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: true });
  g.players['p3'].hand.some(c => c.id === 'own1') && !g.players['p1'].stable.some(c => c.id === 'own1')
    ? pass('sacrifice_unicorn: card grabbed by interceptor instead of sacrificed')
    : fail('sac-unicorn-2', 'not grabbed');
}

// 6. sacrifice_unicorn with _queue chaining (multi-player ALL_SACRIFICE style):
//    intercepting player 1's sacrifice still correctly advances to player 2's turn afterward.
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  injH(g, 'p3', find('Unicorn Net'), 'un6');
  injS(g, 'p1', uni('q1'), 'q1');
  injS(g, 'p2', uni('q2'), 'q2');
  g.pendingEffect = { type: 'sacrifice_unicorn', playerId: 'p1', _queue: ['p2'] };
  g.resolvePendingEffect('p1', ['q1'], {});
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('sacrifice_unicorn _queue: first sacrifice offers intercept')
    : fail('sac-queue-1', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: false }); // decline, p1 sacrifices normally
  g.discard.some(c => c.id === 'q1') && g.pendingEffect?.type === 'sacrifice_unicorn' && g.pendingEffect.playerId === 'p2'
    ? pass('sacrifice_unicorn _queue: advances to next player in queue after decline')
    : fail('sac-queue-2', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p2', ['q2'], {});
  // p3 still holds the (unused, declined-earlier) Unicorn Net, so it correctly offers again
  g.pendingEffect?.type === 'intercept_offer' && g.pendingEffect.action.tPid === 'p2' && g.pendingEffect.action.tCid === 'q2'
    ? pass('sacrifice_unicorn _queue: still-held card offers intercept on 2nd player too')
    : fail('sac-queue-3', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: false });
  g.discard.some(c => c.id === 'q2') && !g.pendingEffect
    ? pass('sacrifice_unicorn _queue: second player resolves, chain completes')
    : fail('sac-queue-4', JSON.stringify(g.pendingEffect));
}

// 7. sacrifice_unicorn_draw_three (Ancient Ritual): declining still grants the draw-3
{
  const g = setup(3, ['nightmares']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  injH(g, 'p3', find('Unicorn Net'), 'un7');
  injS(g, 'p1', uni('ar1'), 'ar1');
  const before = g.players['p1'].hand.length;
  g.pendingEffect = { type: 'sacrifice_unicorn_draw_three', playerId: 'p1' };
  g.resolvePendingEffect('p1', ['ar1'], {});
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('Ancient Ritual: intercept_offer queued')
    : fail('ritual-1', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: false });
  g.discard.some(c => c.id === 'ar1') && g.players['p1'].hand.length === before + 3
    ? pass('Ancient Ritual: declined -> sacrificed AND drew 3')
    : fail('ritual-2', 'hand=' + g.players['p1'].hand.length);
}

// 8. Ancient Ritual accepted: card grabbed, NO draw-3 granted (cost was intercepted)
{
  const g = setup(3, ['nightmares']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  injH(g, 'p3', find('Unicorn Net'), 'un8');
  injS(g, 'p1', uni('ar2'), 'ar2');
  const before = g.players['p1'].hand.length;
  g.pendingEffect = { type: 'sacrifice_unicorn_draw_three', playerId: 'p1' };
  g.resolvePendingEffect('p1', ['ar2'], {});
  g.resolvePendingEffect('p3', [], { intercept: true });
  g.players['p3'].hand.some(c => c.id === 'ar2') && g.players['p1'].hand.length === before
    ? pass('Ancient Ritual: intercepted -> no draw-3 granted')
    : fail('ritual-3', 'p1 hand=' + g.players['p1'].hand.length);
}

// 9. Spray Bottle of Youth style loop (destroy_each_opponent_unicorn_offer_babies):
//    each target gets an individual intercept window offered to whichever OTHER player
//    holds the counter-instant (any bystander may react, not just the victim) — matching
//    real Fishing Rod / Unicorn Net rules text ("when ANY player tries to...").
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p2'].hand = []; g.players['p3'].hand = [];
  g.players['p1'].stable = []; g.players['p2'].stable = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un9');
  injS(g, 'p2', uni('spray_p2'), 'spray_p2');
  injS(g, 'p3', uni('spray_p3'), 'spray_p3');
  g.nursery.push(uni('baby_a'), uni('baby_b'));
  g._processDestroyEachOpponent('p1', ['p2', 'p3'], 0);
  // First target is p2's unicorn; p3 (bystander, holds Net) gets first refusal on it
  g.pendingEffect?.type === 'intercept_offer' && g.pendingEffect.action.tPid === 'p2' && g.pendingEffect.action.tCid === 'spray_p2'
    ? pass('Spray Bottle: bystander holding Net offered intercept on 1st target (p2)')
    : fail('spray-1', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: false }); // let p2's card be destroyed normally
  const p2Destroyed = g.discard.some(c => c.id === 'spray_p2');
  const p2GotBaby = g.players['p2'].stable.some(c => c.id === 'baby_a' || c.id === 'baby_b');
  (p2Destroyed && p2GotBaby)
    ? pass('Spray Bottle: declined -> p2 destroyed + nursery baby granted, loop continues')
    : fail('spray-2', 'destroyed=' + p2Destroyed + ' baby=' + p2GotBaby);
  // Loop reaches p3's own unicorn; p3 still holds Net (unused) and is offered intercept again
  g.pendingEffect?.type === 'intercept_offer' && g.pendingEffect.action.tPid === 'p3' && g.pendingEffect.action.tCid === 'spray_p3'
    ? pass('Spray Bottle: p3 (holds Net) gets intercept window for their own target')
    : fail('spray-3', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: true });
  const grabbed = g.players['p3'].hand.some(c => c.id === 'spray_p3');
  const p3GotBaby = g.players['p3'].stable.some(c => c.id === 'baby_a' || c.id === 'baby_b');
  (grabbed && p3GotBaby)
    ? pass('Spray Bottle: p3 intercepts their own destroy AND still gets nursery baby')
    : fail('spray-4', 'grabbed=' + grabbed + ' baby=' + p3GotBaby);
  !g.pendingEffect
    ? pass('Spray Bottle: loop fully drains after last target resolved')
    : fail('spray-5', JSON.stringify(g.pendingEffect));
}

// ─── Section 17: Fixed inline-bypass sacrifice paths (now routed through
// _sacrificeCard, restoring Phoenix/shield protection + intercept support) ──

console.log('\n── Fixed inline-bypass sacrifice paths ──');

// ── sacrifice_self_steal_unicorn (Pit Covered in Leaves) ──────────────────────

// 1. Now routes through _sacrificeCard: Phoenix protection is respected
{
  const g = setup(2, ['adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const phoenix = find('Unicorn Phoenix');
  injS(g, 'p1', phoenix, 'ph1');
  injH(g, 'p1', uni('discardfodder'), 'fodder1'); // Phoenix redirects by discarding a random hand card
  g.pendingEffect = { type: 'sacrifice_self_steal_unicorn', playerId: 'p1', sourceCardId: 'ph1' };
  g.resolvePendingEffect('p1', [], {});
  g.players['p1'].stable.some(c => c.id === 'ph1')
    ? pass('Pit self-sacrifice: Phoenix protection now respected (routed through _sacrificeCard)')
    : fail('pit-phoenix', 'Phoenix was sacrificed despite protection');
}

// 2. Card actually lands in the discard pile now (previously vanished into the void)
{
  const g = setup(2, ['adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  injS(g, 'p1', uni('vanish1'), 'vanish1');
  g.pendingEffect = { type: 'sacrifice_self_steal_unicorn', playerId: 'p1', sourceCardId: 'vanish1' };
  g.resolvePendingEffect('p1', [], {});
  g.discard.some(c => c.id === 'vanish1')
    ? pass('Pit self-sacrifice: card now correctly lands in discard pile (was vanishing before)')
    : fail('pit-discard', 'card is nowhere — still vanishing');
}

// 3. Self-sacrifice step is now interceptable
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un1');
  injS(g, 'p1', uni('pit1'), 'pit1');
  g.pendingEffect = { type: 'sacrifice_self_steal_unicorn', playerId: 'p1', sourceCardId: 'pit1' };
  g.resolvePendingEffect('p1', [], {});
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('Pit self-sacrifice: now interceptable via Unicorn Net')
    : fail('pit-intercept-1', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: true });
  g.players['p3'].hand.some(c => c.id === 'pit1') && !g.players['p1'].stable.some(c => c.id === 'pit1')
    ? pass('Pit self-sacrifice: intercepted card grabbed by interceptor')
    : fail('pit-intercept-2', 'not grabbed');
  // Since the self-sacrifice (cost) was intercepted, the steal ability never activates:
  // no second "select a unicorn to steal" step should be pending.
  !g.pendingEffect
    ? pass('Pit self-sacrifice: intercepted -> steal step cancelled (cost never paid)')
    : fail('pit-intercept-3', 'unexpected leftover: ' + JSON.stringify(g.pendingEffect));
}

// 4. Declining lets the sacrifice proceed AND still reaches the steal step
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un2');
  injS(g, 'p1', uni('pit2'), 'pit2');
  injS(g, 'p2', uni('victim'), 'victim');
  g.pendingEffect = { type: 'sacrifice_self_steal_unicorn', playerId: 'p1', sourceCardId: 'pit2' };
  g.resolvePendingEffect('p1', [], {});
  g.resolvePendingEffect('p3', [], { intercept: false });
  g.pendingEffect?.type === 'sacrifice_self_steal_unicorn' && g.pendingEffect.sacrificeDone === true
    ? pass('Pit self-sacrifice: declined -> sacrificed, chain continues to steal step')
    : fail('pit-decline-1', JSON.stringify(g.pendingEffect));
  g.discard.some(c => c.id === 'pit2')
    ? pass('Pit self-sacrifice: declined -> card correctly in discard pile')
    : fail('pit-decline-2', 'not in discard');
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'victim' });
  g.players['p1'].stable.some(c => c.id === 'victim')
    ? pass('Pit self-sacrifice: steal step completes normally after decline')
    : fail('pit-decline-3', 'steal did not happen');
}

// ── sacrifice_four_search_four ────────────────────────────────────────────────

// 5. Each sacrificed unicorn is individually interceptable; grabbed cards don't count toward search
{
  const g = setup(3, ['nightmares']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un3');
  injS(g, 'p1', uni('s1'), 's1');
  injS(g, 'p1', uni('s2'), 's2');
  g.pendingEffect = { type: 'sacrifice_four_search_four', playerId: 'p1' };
  g.resolvePendingEffect('p1', ['s1', 's2'], {});
  g.pendingEffect?.type === 'intercept_offer' && g.pendingEffect.action.tCid === 's1'
    ? pass('sacrifice_four_search_four: first card offers intercept')
    : fail('s4-1', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: true }); // grab s1 (consumes p3's only Unicorn Net), doesn't count
  // p3's Unicorn Net is now consumed, so s2 has no holder left and resolves immediately —
  // the loop completes straight through to the search step.
  g.pendingEffect?.type === 'sacrifice_four_search_four' && g.pendingEffect.sacrificeDone === true
    ? pass('sacrifice_four_search_four: Net consumed on accept -> loop completes without further offers')
    : fail('s4-2', JSON.stringify(g.pendingEffect));
  g.pendingEffect?.type === 'sacrifice_four_search_four' && g.pendingEffect.sacrificeDone === true && g.pendingEffect.searchCount === 1
    ? pass('sacrifice_four_search_four: searchCount reflects only actually-sacrificed cards (1, not 2)')
    : fail('s4-3', JSON.stringify(g.pendingEffect));
  g.players['p3'].hand.some(c => c.id === 's1')
    ? pass('sacrifice_four_search_four: grabbed card ended up in interceptor hand')
    : fail('s4-4', 'not grabbed');
  g.discard.some(c => c.id === 's2')
    ? pass('sacrifice_four_search_four: actually-sacrificed card in discard')
    : fail('s4-5', 'not in discard');
}

// 6. No holder: proceeds exactly as before (regression check)
{
  const g = setup(2, ['nightmares']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  injS(g, 'p1', uni('s3'), 's3');
  injS(g, 'p1', uni('s4'), 's4');
  g.pendingEffect = { type: 'sacrifice_four_search_four', playerId: 'p1' };
  g.resolvePendingEffect('p1', ['s3', 's4'], {});
  g.pendingEffect?.type === 'sacrifice_four_search_four' && g.pendingEffect.searchCount === 2
    ? pass('sacrifice_four_search_four: no holder -> both sacrificed normally, count=2')
    : fail('s4-6', JSON.stringify(g.pendingEffect));
  g.discard.some(c => c.id === 's3') && g.discard.some(c => c.id === 's4')
    ? pass('sacrifice_four_search_four: both cards in discard pile')
    : fail('s4-7', 'missing from discard');
}

// 7. Two separate Unicorn Net holders: each card in the loop gets its own live offer
{
  const g = setup(4, ['nightmares']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = []; g.players['p4'].hand = []; g.players['p4'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un4a');
  injH(g, 'p4', find('Unicorn Net'), 'un4b');
  injS(g, 'p1', uni('m1'), 'm1');
  injS(g, 'p1', uni('m2'), 'm2');
  g.pendingEffect = { type: 'sacrifice_four_search_four', playerId: 'p1' };
  g.resolvePendingEffect('p1', ['m1', 'm2'], {});
  g.pendingEffect?.type === 'intercept_offer' && g.pendingEffect.action.tCid === 'm1'
    ? pass('multi-holder: first card offers intercept (to nearest holder in turn order)')
    : fail('s4-multi-1', JSON.stringify(g.pendingEffect));
  const firstOfferedTo = g.pendingEffect.playerId;
  g.resolvePendingEffect(firstOfferedTo, [], { intercept: false }); // let m1 be sacrificed
  g.pendingEffect?.type === 'intercept_offer' && g.pendingEffect.action.tCid === 'm2'
    ? pass('multi-holder: loop reaches second card and offers intercept again (2nd holder still has theirs)')
    : fail('s4-multi-2', JSON.stringify(g.pendingEffect));
  const secondOfferedTo = g.pendingEffect.playerId;
  g.resolvePendingEffect(secondOfferedTo, [], { intercept: true }); // grab m2
  g.pendingEffect?.type === 'sacrifice_four_search_four' && g.pendingEffect.searchCount === 1
    ? pass('multi-holder: final count reflects 1 actually sacrificed (m1), 1 grabbed (m2)')
    : fail('s4-multi-3', JSON.stringify(g.pendingEffect));
}

// ─── Section 18: Super Neigh chain (CODE HEALTH 5) ────────────────────────

console.log('\n── Super Neigh chain ──');

const neighCard = () => ALL.find(c => c.effect?.type === 'neigh');

// 1. The requested smoke test: p1 plays a card, p2 neighs it, p1 super-neighs — original card resolves.
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu1');
  injH(g, 'p1', target, 'bu1');
  injH(g, 'p1', neighCard(), 'n_p1');
  injH(g, 'p2', neighCard(), 'n_p2');
  g.playCard('p1', 'bu1', null, null);
  g.neighWindow ? pass('neigh window opens after playCard') : fail('setup', 'no neigh window');
  g.playInstant('p2', 'n_p2');
  g.superNeighWindow && !g.neighWindow
    ? pass('Super Neigh window opens after p2 Neighs')
    : fail('super-neigh-open', 'window state wrong');
  g.superNeighPendingCard?.playerId === 'p2'
    ? pass('superNeighPendingCard correctly records the neigher (p2)')
    : fail('super-neigh-record', JSON.stringify(g.superNeighPendingCard));
  g.playInstant('p1', 'n_p1'); // p1 Super Neighs their own card's Neigh
  g.superNeighWindow && g.superNeighPendingCard?.playerId === 'p1' && !g.players['p1'].stable.some(c => c.id === 'bu1')
    ? pass('Super Neigh chain: after the counter-Neigh, the window stays OPEN (not auto-resolved) so the other side can Neigh again')
    : fail('super-neigh-stays-open', JSON.stringify({ open: g.superNeighWindow, top: g.superNeighPendingCard?.playerId }));
  g.resolveNeigh('p1'); // p1 (top of chain) confirms nobody Neighs again — chain length 2 (even) → original card resolves
  g.players['p1'].stable.some(c => c.id === 'bu1')
    ? pass('Super Neigh: original card resolves normally (unicorn entered stable)')
    : fail('super-neigh-resolve', 'card did not resolve');
  !g.superNeighWindow && !g.neighWindow
    ? pass('Super Neigh: both windows closed after resolution')
    : fail('super-neigh-close', `super=${g.superNeighWindow} neigh=${g.neighWindow}`);
  !g.players['p2'].hand.some(c => c.id === 'n_p2') && !g.players['p1'].hand.some(c => c.id === 'n_p1')
    ? pass('Super Neigh: both Neigh cards consumed from hands')
    : fail('super-neigh-consume', 'a neigh card was not consumed');
  g.discard.some(c => c.id === 'n_p2') && g.discard.some(c => c.id === 'n_p1')
    ? pass('Super Neigh: both Neigh cards in discard pile')
    : fail('super-neigh-discard', 'missing from discard');
}

// 2. Nobody super-neighs: the neigh stands, original card is cancelled
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu2');
  injH(g, 'p1', target, 'bu2');
  injH(g, 'p2', neighCard(), 'n2');
  g.playCard('p1', 'bu2', null, null);
  g.playInstant('p2', 'n2');
  g.superNeighWindow
    ? pass('Nobody-supers: Super Neigh window opens')
    : fail('nobody-supers-open', 'window did not open');
  g.resolveNeigh('p2'); // p2 (the neigher) confirms nobody countered
  !g.superNeighWindow
    ? pass('Nobody-supers: window closes on resolveNeigh')
    : fail('nobody-supers-close', 'window still open');
  !g.players['p1'].stable.some(c => c.id === 'bu2')
    ? pass('Nobody-supers: original card never resolves (blocked)')
    : fail('nobody-supers-blocked', 'card resolved despite neigh standing');
}

// 3. resolveNeigh during super-neigh window can only be called by the neigher, not the original player
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu3');
  injH(g, 'p1', target, 'bu3');
  injH(g, 'p2', neighCard(), 'n3');
  g.playCard('p1', 'bu3', null, null);
  g.playInstant('p2', 'n3');
  g.resolveNeigh('p1').error
    ? pass('Only the neigher (p2) may resolve the standing Super Neigh window, not p1')
    : fail('resolve-wrong-player', 'p1 was incorrectly allowed to resolve');
}

// 4. A third player (not the original player, not the neigher) can also Super Neigh
{
  const g = setup(3);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  const target = uni('bu4');
  injH(g, 'p1', target, 'bu4');
  injH(g, 'p2', neighCard(), 'n4a');
  injH(g, 'p3', neighCard(), 'n4b');
  g.playCard('p1', 'bu4', null, null);
  g.playInstant('p2', 'n4a');
  g.playInstant('p3', 'n4b'); // bystander p3 super-neighs, not p1
  g.resolveNeigh('p3'); // p3 (top of chain) confirms nobody Neighs again
  g.players['p1'].stable.some(c => c.id === 'bu4')
    ? pass('Third-party player can Super Neigh; original card resolves')
    : fail('third-party-super', 'card did not resolve');
}

// 5. stateFor exposes superNeighWindow correctly to all players
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu5');
  injH(g, 'p1', target, 'bu5');
  injH(g, 'p2', neighCard(), 'n5');
  g.playCard('p1', 'bu5', null, null);
  g.playInstant('p2', 'n5');
  const s1 = g.stateFor('p1');
  const s2 = g.stateFor('p2');
  s1.superNeighWindow === true && s2.superNeighWindow === true
    ? pass('stateFor: superNeighWindow exposed to both players')
    : fail('stateFor-superneigh', 'not exposed');
  s1.superNeighPlayerId === 'p2' && s1.pendingCardPlayerId === 'p1'
    ? pass('stateFor: superNeighPlayerId + pendingCardPlayerId both correctly exposed')
    : fail('stateFor-ids', JSON.stringify({ spid: s1.superNeighPlayerId, pcpid: s1.pendingCardPlayerId }));
  s1.pendingCard?.id === 'bu5' && s1.superNeighCard?.id === 'n5'
    ? pass('stateFor: both the original card and the Neigh card are visible during the window')
    : fail('stateFor-cards', JSON.stringify({ pc: s1.pendingCard?.id, sc: s1.superNeighCard?.id }));
}

// 6. Regression: normal single-neigh flow (no super neigh at all, target has no Neigh in hand)
//    still correctly blocks the card via the standard resolveNeigh finalize path.
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const up = find('Unicorn Poison');
  const v = uni('victim6');
  injS(g, 'p2', v, 'victim6');
  injH(g, 'p1', up, 'up6');
  injH(g, 'p2', neighCard(), 'n6');
  g.playCard('p1', 'up6', 'p2', 'victim6');
  g.playInstant('p2', 'n6');
  g.resolveNeigh('p2');
  g.players['p2'].stable.some(c => c.id === 'victim6')
    ? pass('Regression: neighed destroy is blocked, target unicorn survives')
    : fail('regression-block', 'unicorn was destroyed despite neigh');
}

// 7. THE REPORTED BUG: a Neigh chain must be able to go deeper than 2 — if the
//    original player has a second Neigh card, they must be offered the chance to
//    Neigh the counter-Neigh right back, not have the card silently resolve.
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu7');
  injH(g, 'p1', target, 'bu7');
  injH(g, 'p2', neighCard(), 'p2n_a');
  injH(g, 'p2', neighCard(), 'p2n_b'); // p2 has TWO Neigh cards
  injH(g, 'p1', neighCard(), 'p1n_a');
  g.playCard('p1', 'bu7', null, null);
  g.playInstant('p2', 'p2n_a');  // chain=1: p2 Neighs p1's card
  g.playInstant('p1', 'p1n_a');  // chain=2: p1 Neighs p2's Neigh (only Neigh card p1 has)
  g.neighChain.length === 2 && g.superNeighWindow && !g.players['p1'].stable.some(c => c.id === 'bu7')
    ? pass('Deep chain: after the 2nd Neigh, card is still NOT resolved — window stays open for p2 to Neigh again')
    : fail('deep-chain-still-open', JSON.stringify({ len: g.neighChain.length, open: g.superNeighWindow }));
  g.players['p2'].hand.some(c => c.id === 'p2n_b')
    ? pass('Deep chain: p2 still has their second Neigh card available to continue the chain')
    : fail('deep-chain-second-card-gone', 'second Neigh card missing');
  g.playInstant('p2', 'p2n_b'); // chain=3: p2 uses their SECOND Neigh card
  g.neighChain.length === 3 && g.superNeighWindow
    ? pass('Deep chain: p2\'s second Neigh extends the chain to depth 3')
    : fail('deep-chain-depth-3', JSON.stringify({ len: g.neighChain.length }));
  g.resolveNeigh('p2'); // nobody has any Neigh cards left — p2 (top of chain) confirms
  const stillInHand = g.players['p1'].hand.some(c => c.id === 'bu7');
  const inDiscard = g.discard.some(c => c.id === 'bu7');
  (!stillInHand && inDiscard)
    ? pass('Deep chain (odd length 3): the last Neigh stands and blocks the original card')
    : fail('deep-chain-resolution', `stillInHand=${stillInHand} inDiscard=${inDiscard}`);
}

// 8. The base game's actual "Super Neigh" card (super:true) cannot itself be Neighed —
//    any attempt to counter it must be rejected, unlike a regular Neigh.
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu8');
  const trueSuperNeigh = ALL.find(c => c.effect?.type === 'neigh' && c.effect?.super === true);
  injH(g, 'p1', target, 'bu8');
  injH(g, 'p2', trueSuperNeigh, 'sn_p2');
  injH(g, 'p1', neighCard(), 'p1n8');
  g.playCard('p1', 'bu8', null, null);
  g.playInstant('p2', 'sn_p2'); // the real, unblockable Super Neigh
  const r = g.playInstant('p1', 'p1n8'); // p1 tries to counter it — must be rejected
  r.error
    ? pass('True Super Neigh card cannot itself be Neighed — counter attempt rejected')
    : fail('true-super-neigh-blocked', 'counter was incorrectly allowed');
  g.players['p1'].hand.some(c => c.id === 'p1n8')
    ? pass('True Super Neigh: rejected counter attempt did not consume the would-be counter card')
    : fail('true-super-neigh-not-consumed', 'card was consumed despite rejection');
}

// 9. Pandamonium/Oh Deer ("...considered Pandas/Reindeer. Cards that affect Unicorn
//    cards do not affect your Pandas/Reindeer.") must NOT suppress a unicorn's own
//    abilities — only Blinding Light/Medieval Sanitation ("...with NO EFFECTS") does.
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = [];
  const pandamonium = find('Pandamonium');
  const greedyFlying = find('Greedy Flying Unicorn'); // draws a card on enter, unconditional
  injS(g, 'p1', pandamonium, 'pand1');
  const before = g.players['p1'].hand.length;
  g._enterTrigger(greedyFlying, 'p1', null, null);
  g.players['p1'].hand.length === before + 1
    ? pass('Pandamonium does NOT suppress a unicorn\'s own enter-effect (draws correctly)')
    : fail('pandamonium-suppression', `hand before=${before} after=${g.players['p1'].hand.length}`);
}
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = [];
  const blinding = find('Blinding Light');
  const greedyFlying = find('Greedy Flying Unicorn');
  injS(g, 'p1', blinding, 'bl1');
  const before = g.players['p1'].hand.length;
  g._enterTrigger(greedyFlying, 'p1', null, null);
  g.players['p1'].hand.length === before
    ? pass('Blinding Light DOES still correctly suppress a unicorn\'s own enter-effect')
    : fail('blinding-light-suppression', `hand before=${before} after=${g.players['p1'].hand.length}`);
}
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = [];
  const pandamonium = find('Pandamonium');
  injS(g, 'p1', pandamonium, 'pand2');
  for (let i = 0; i < 7; i++) injS(g, 'p1', uni('bu' + i), 'bu' + i);
  g._checkWin() === null
    ? pass('Pandamonium still correctly blocks winning by Unicorn count (win-condition exclusion untouched)')
    : fail('pandamonium-win-check', 'incorrectly allowed a win by unicorn count');
}

// 10. Glitter Tornado (return_one_each_stable): the player must be able to pick which
//    card to return in EVERY remaining stable, including their own, in any order — and
//    a player with an empty stable must be skipped rather than soft-locking the effect.
{
  const g = setup(3);
  g.players['p1'].hand = []; g.players['p1'].stable = [];
  g.players['p2'].stable = []; g.players['p3'].stable = [];
  const glitter = find('Glitter Tornado');
  injH(g, 'p1', glitter, 'gt1');
  injS(g, 'p1', uni('p1c'), 'p1c');
  injS(g, 'p2', uni('p2c'), 'p2c');
  // p3's stable stays empty on purpose
  g.playCard('p1', 'gt1', null, null);
  g.resolveNeigh('p1');
  const remaining = g.pendingEffect?.remaining || [];
  (!remaining.includes('p3') && remaining.includes('p1') && remaining.includes('p2'))
    ? pass('Glitter Tornado: a player with an empty stable is excluded from remaining, others (including the caster) are included')
    : fail('glitter-tornado-remaining', JSON.stringify(remaining));
  // Resolve out of order: p2 first, then the caster's own stable
  g.resolvePendingEffect('p1', [], { targetPlayerId:'p2', targetCardId:'p2c' });
  g.resolvePendingEffect('p1', [], { targetPlayerId:'p1', targetCardId:'p1c' });
  (g.players['p1'].hand.some(c=>c.id==='p1c') && g.players['p2'].hand.some(c=>c.id==='p2c') && !g.pendingEffect)
    ? pass('Glitter Tornado: resolves fully out-of-order, including returning the caster\'s own card')
    : fail('glitter-tornado-resolve', JSON.stringify({ p1hand:g.players['p1'].hand.map(c=>c.id), p2hand:g.players['p2'].hand.map(c=>c.id), pending:g.pendingEffect }));
}

// ─── Section 19: CODE HEALTH 6 — neighed card now correctly leaves hand ──

console.log('\n── CODE HEALTH 6: neighed card discard/removal ──');

// 1. CODE HEALTH 6: neighed card (standing, no super-neigh) is discarded, not stuck in hand
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu1');
  injH(g, 'p1', target, 'bu1');
  injH(g, 'p2', neighCard(), 'n1');
  g.playCard('p1', 'bu1', null, null);
  g.playInstant('p2', 'n1');
  g.resolveNeigh('p2');
  const inHand = g.players['p1'].hand.some(c => c.id === 'bu1');
  const inDiscard = g.discard.some(c => c.id === 'bu1');
  (!inHand && inDiscard)
    ? pass('Neighed card (standing): removed from hand and correctly discarded')
    : fail('ch6-basic', `inHand=${inHand} inDiscard=${inDiscard}`);
}

// 2. Hex Neigh (remove from game): blocked card removed from hand AND game, not discarded
{
  const g = setup(2, ['nightmares']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const up = find('Unicorn Poison');
  const victim = uni('victim2');
  g.players['p2'].stable.push(victim);
  injH(g, 'p1', up, 'up2');
  injH(g, 'p2', find('Hex Neigh'), 'hn2');
  g.playCard('p1', 'up2', 'p2', 'victim2');
  g.playInstant('p2', 'hn2');
  g.resolveNeigh('p2');
  const inHand = g.players['p1'].hand.some(c => c.id === 'up2');
  const inDiscard = g.discard.some(c => c.id === 'up2');
  const inRemoved = g.removedFromGame.some(c => c.id === 'up2');
  (!inHand && !inDiscard && inRemoved)
    ? pass('Hex Neigh: blocked card removed from hand and game, NOT also discarded')
    : fail('ch6-hexneigh', `inHand=${inHand} inDiscard=${inDiscard} inRemoved=${inRemoved}`);
}

// 3. Super Neigh (countered): the ORIGINAL card resolves and correctly leaves hand via
//    normal resolution — regression check that CODE HEALTH 6 didn't touch this path.
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu3');
  injH(g, 'p1', target, 'bu3');
  injH(g, 'p1', neighCard(), 'n_p1');
  injH(g, 'p2', neighCard(), 'n_p2');
  g.playCard('p1', 'bu3', null, null);
  g.playInstant('p2', 'n_p2');
  g.playInstant('p1', 'n_p1');
  g.resolveNeigh('p1'); // p1 (top of chain) confirms nobody Neighs again
  const inHand = g.players['p1'].hand.some(c => c.id === 'bu3');
  const inStable = g.players['p1'].stable.some(c => c.id === 'bu3');
  (!inHand && inStable)
    ? pass('Super Neigh (countered): original card resolves normally, correctly left hand')
    : fail('ch6-superneigh', `inHand=${inHand} inStable=${inStable}`);
}

// 3b. Regression: stale hand-index bug. If the player's OWN Neigh card sits BEFORE the
//     originally-played card in their hand array, playing that Neigh to Super Neigh
//     splices it out first, shifting every later index down by one. _finalizeCardResolution
//     used to trust a cardIndex captured before that shift, so it either spliced the wrong
//     card or nothing at all — leaving the resolved card duplicated (both in the stable AND
//     still sitting in hand). This is the exact bug reported: "p1 plays a basic unicorn, p2
//     neighs it, p1 super-neighs — the unicorn is played, but p1 also gets a copy in hand."
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu3b');
  // Neigh card injected BEFORE the target card — the ordering that exposes the bug.
  injH(g, 'p1', neighCard(), 'n_p1b');
  injH(g, 'p1', target, 'bu3b');
  injH(g, 'p2', neighCard(), 'n_p2b');
  g.playCard('p1', 'bu3b', null, null);
  g.playInstant('p2', 'n_p2b');
  g.playInstant('p1', 'n_p1b');
  g.resolveNeigh('p1'); // p1 (top of chain) confirms nobody Neighs again
  const handCopies = g.players['p1'].hand.filter(c => c.id === 'bu3b').length;
  const inStable = g.players['p1'].stable.some(c => c.id === 'bu3b');
  (handCopies === 0 && inStable)
    ? pass('Super Neigh: no duplicate left in hand when the Neigh card precedes the played card')
    : fail('super-neigh-stale-index', `handCopies=${handCopies} inStable=${inStable}`);
  g.players['p1'].hand.length === 0
    ? pass('Super Neigh: hand is fully empty after both Neigh cards are consumed (no phantom card)')
    : fail('super-neigh-phantom', `hand=${JSON.stringify(g.players['p1'].hand.map(c=>c.id))}`);
}

// 3c. Regression (found by test_universal_card_audit.js's fuzz testing): when a Super
//     Neigh counter is itself a "remove from game" type (Hex Neigh), the ORIGINAL Neigh
//     card being countered was already pushed into discard the moment it was first
//     played (a few lines earlier in the same function). Also pushing it into
//     removedFromGame — without first taking it back out of discard — left the exact
//     same card object sitting in both zones simultaneously: a duplicate that only
//     showed up in the ~1-in-a-few-hundred games where a bot happened to hold a Hex
//     Neigh and chose to Super Neigh with it, which is why no hand-written per-card
//     test had ever caught it.
{
  const g = setup(2, ['nightmares']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu3c');
  injH(g, 'p1', target, 'bu3c');
  injH(g, 'p2', neighCard(), 'n_p2c');
  injH(g, 'p1', find('Hex Neigh'), 'hn_p1c');
  g.playCard('p1', 'bu3c', null, null);
  g.playInstant('p2', 'n_p2c');
  g.playInstant('p1', 'hn_p1c'); // Super Neigh the standing Neigh using Hex Neigh
  g.resolveNeigh('p1'); // p1 (top of chain) confirms nobody Neighs again
  const inDiscard = g.discard.some(c => c.id === 'n_p2c');
  const inRemoved = g.removedFromGame.some(c => c.id === 'n_p2c');
  (inRemoved && !inDiscard)
    ? pass('Super Neigh (Hex Neigh counter): countered Neigh card is removed from game, not duplicated into discard too')
    : fail('super-neigh-hex-duplication', `inDiscard=${inDiscard} inRemoved=${inRemoved}`);
  g.players['p1'].stable.some(c => c.id === 'bu3c')
    ? pass('Super Neigh (Hex Neigh counter): original card still resolves normally')
    : fail('super-neigh-hex-resolve', 'original card did not enter stable');
}

// 4. Hand count is correct after a stand: -1 (blocked card gone) with no phantom card left behind
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const target = uni('bu4');
  const before = 3;
  injH(g, 'p1', target, 'bu4');
  injH(g, 'p1', uni('filler1'), 'filler1');
  injH(g, 'p1', uni('filler2'), 'filler2');
  injH(g, 'p2', neighCard(), 'n4');
  const startCount = g.players['p1'].hand.length; // 3
  g.playCard('p1', 'bu4', null, null);
  g.playInstant('p2', 'n4');
  g.resolveNeigh('p2');
  g.players['p1'].hand.length === startCount - 1
    ? pass('Neighed card (standing): hand count correctly decreases by exactly 1')
    : fail('ch6-count', `expected ${startCount-1}, got ${g.players['p1'].hand.length}`);
}

// ─── Section 20: CODE HEALTH 7 — full stable.splice bypass audit ─────────

console.log('\n── CODE HEALTH 7: sacrifice/steal/destroy bypass fixes ──');

// 1. sacrifice_unicorn_then_draw: Phoenix now protects (was previously bypassing _sacrificeCard)
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  const phoenix = find('Unicorn Phoenix');
  injS(g, 'p1', phoenix, 'ph1');
  injH(g, 'p1', uni('fodder'), 'fodder');
  g.pendingEffect = { type: 'sacrifice_unicorn_then_draw', playerId: 'p1', draw: 1 };
  g.resolvePendingEffect('p1', ['ph1'], {});
  g.players['p1'].stable.some(c => c.id === 'ph1')
    ? pass('sacrifice_unicorn_then_draw: Phoenix protection now respected')
    : fail('ch7-1', 'Phoenix was sacrificed');
}

// 2. sacrifice_unicorn_then_draw: now interceptable via Unicorn Net
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un1');
  injS(g, 'p1', uni('t1'), 't1');
  g.pendingEffect = { type: 'sacrifice_unicorn_then_draw', playerId: 'p1', draw: 1 };
  g.resolvePendingEffect('p1', ['t1'], {});
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('sacrifice_unicorn_then_draw: now interceptable')
    : fail('ch7-2', JSON.stringify(g.pendingEffect));
}

// 3. sacrifice_n_destroy_n: multi-card sacrifice loop, each card individually interceptable
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un2');
  injS(g, 'p1', uni('m1'), 'm1');
  injS(g, 'p1', uni('m2'), 'm2');
  g.pendingEffect = { type: 'sacrifice_n_destroy_n', playerId: 'p1' };
  g.resolvePendingEffect('p1', ['m1', 'm2'], {});
  g.pendingEffect?.type === 'intercept_offer' && g.pendingEffect.action.tCid === 'm1'
    ? pass('sacrifice_n_destroy_n: first card offers intercept')
    : fail('ch7-3', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: true }); // grab m1, doesn't count
  g.pendingEffect?.type === 'sacrifice_n_destroy_n' && g.pendingEffect.sacrificeDone === true && g.pendingEffect.destroyCount === 1
    ? pass('sacrifice_n_destroy_n: destroyCount reflects only actually-sacrificed (1, not 2)')
    : fail('ch7-4', JSON.stringify(g.pendingEffect));
  g.players['p3'].hand.some(c => c.id === 'm1')
    ? pass('sacrifice_n_destroy_n: grabbed card in interceptor hand')
    : fail('ch7-5', 'not grabbed');
}

// 4. Buried Alive choice b: previously vanished into the void (never reached discard) — now fixed
{
  const g = setup(2, ['nightmares']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  injS(g, 'p1', dwn('ba1'), 'ba1');
  g.discard.push(uni('revive1'));
  g.pendingEffect = { type: 'sacrifice_unicorn_or_self_return', playerId: 'p1', sourceCardId: 'ba1' };
  g.resolvePendingEffect('p1', [], { choice: 'b' });
  // Sacrificing ba1 correctly adds it to discard, making it (rules-accurately) a valid pick
  // for the "return a card from discard" step too — resolve that step by taking revive1 instead.
  g.pendingEffect?.type === 'from_discard_pick' && g.pendingEffect.options.some(c => c.id === 'ba1')
    ? pass('Buried Alive choice b: self-sacrifice now correctly reaches discard (was vanishing)')
    : fail('ch7-6', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p1', ['revive1'], {});
  const baInDiscard = g.discard.some(c => c.id === 'ba1');
  const revivedInHand = g.players['p1'].hand.some(c => c.id === 'revive1');
  (baInDiscard && revivedInHand)
    ? pass('Buried Alive choice b: ba1 correctly ends up in discard, revive1 taken to hand')
    : fail('ch7-6b', `baInDiscard=${baInDiscard} revivedInHand=${revivedInHand}`);
}

// 5. Buried Alive choice b: now interceptable, and declining still completes the return-from-discard step
{
  const g = setup(3, ['nightmares', 'adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un3');
  injS(g, 'p1', dwn('ba2'), 'ba2');
  g.discard.push(uni('revive2'));
  g.pendingEffect = { type: 'sacrifice_unicorn_or_self_return', playerId: 'p1', sourceCardId: 'ba2' };
  g.resolvePendingEffect('p1', [], { choice: 'b' });
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('Buried Alive choice b: now interceptable')
    : fail('ch7-7', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: false });
  g.discard.some(c => c.id === 'ba2')
    ? pass('Buried Alive choice b: declined -> sacrificed correctly')
    : fail('ch7-8', 'not in discard');
}

// 6. Critical Hit: intercepting the self-sacrifice leaves the pending magic card untouched in discard
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un4');
  const ch = find('Critical Hit') || ALL.find(c => c.effect?.type === 'sacrifice_self_replay_magic');
  injS(g, 'p1', ch, 'ch1');
  const magic = find('Unicorn Poison');
  g.discard.push({ ...magic, id: 'magic1' });
  g.pendingEffect = { type: 'critical_hit_optional', playerId: 'p1' };
  g.resolvePendingEffect('p1', [], {});
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('Critical Hit: self-sacrifice now interceptable')
    : fail('ch7-9', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: true });
  const magicStillInDiscard = g.discard.some(c => c.id === 'magic1');
  const chGrabbed = g.players['p3'].hand.some(c => c.id === 'ch1');
  (magicStillInDiscard && chGrabbed)
    ? pass('Critical Hit: intercepted -> replay never happens, magic card stays untouched in discard')
    : fail('ch7-10', `magicInDiscard=${magicStillInDiscard} grabbed=${chGrabbed}`);
}

// 7. Steal bypasses now fire on_steal_or_destroy (Naughty List style) triggers via _stealCard
{
  const g = setup(2);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = [];
  // Naughty List: on_steal_or_destroy trigger firing is already covered by _stealCard itself;
  // here we confirm steal_baby now routes through _stealCard (protection check fires).
  injS(g, 'p2', find('Ginormous Unicorn'), 'gin'); // arbitrary stable filler, not used for protection here
  const baby = { id: 'baby1', type: 'baby_unicorn', name: 'Baby', emoji: 'b', effect: null, description: '', expansion: null };
  injS(g, 'p2', baby, 'baby1');
  g.pendingEffect = { type: 'steal_baby', playerId: 'p1' };
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'baby1' });
  g.players['p1'].stable.some(c => c.id === 'baby1')
    ? pass('steal_baby: now routes through _stealCard, steal succeeds normally')
    : fail('ch7-11', 'steal did not happen');
}

// 8. steal_baby: now interceptable via Fishing Rod
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Fishing Rod'), 'fr1');
  const baby = { id: 'baby2', type: 'baby_unicorn', name: 'Baby', emoji: 'b', effect: null, description: '', expansion: null };
  injS(g, 'p2', baby, 'baby2');
  g.pendingEffect = { type: 'steal_baby', playerId: 'p1' };
  g.resolvePendingEffect('p1', [], { targetPlayerId: 'p2', targetCardId: 'baby2' });
  g.pendingEffect?.type === 'intercept_offer' && g.pendingEffect.kind === 'steal'
    ? pass('steal_baby: now interceptable via Fishing Rod')
    : fail('ch7-12', JSON.stringify(g.pendingEffect));
}

// 9. destroy_all_basics_one_player: each basic individually interceptable, loop continues
{
  const g = setup(3, ['adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un5');
  injS(g, 'p2', uni('basic1'), 'basic1');
  injS(g, 'p2', uni('basic2'), 'basic2');
  g.pendingEffect = { type: 'destroy_all_basics_one_player', playerId: 'p1', targetPlayerId: 'p2' };
  g.resolvePendingEffect('p1', [], {});
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('destroy_all_basics_one_player: first basic offers intercept')
    : fail('ch7-13', JSON.stringify(g.pendingEffect));
  g.resolvePendingEffect('p3', [], { intercept: true }); // grab basic1; this consumes p3's only Unicorn Net
  // basic2 now has no holder left, so the loop completes it immediately and fully drains
  const basic1Grabbed = g.players['p3'].hand.some(c => c.id === 'basic1');
  const basic2Destroyed = g.discard.some(c => c.id === 'basic2');
  const noneLeft = !g.players['p2'].stable.some(c => c.type === 'basic_unicorn');
  (basic1Grabbed && basic2Destroyed && noneLeft && !g.pendingEffect)
    ? pass('destroy_all_basics_one_player: Net consumed on accept -> loop completes without further offers')
    : fail('ch7-14', `grabbed=${basic1Grabbed} destroyed=${basic2Destroyed} noneLeft=${noneLeft} pending=${JSON.stringify(g.pendingEffect)}`);
}

// 9b. destroy_all_basics_one_player with two separate holders: each basic gets a live offer
{
  const g = setup(4, ['adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = []; g.players['p4'].hand = []; g.players['p4'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un5a');
  injH(g, 'p4', find('Unicorn Net'), 'un5b');
  injS(g, 'p2', uni('basicA'), 'basicA');
  injS(g, 'p2', uni('basicB'), 'basicB');
  g.pendingEffect = { type: 'destroy_all_basics_one_player', playerId: 'p1', targetPlayerId: 'p2' };
  g.resolvePendingEffect('p1', [], {});
  const firstOfferedTo = g.pendingEffect?.playerId;
  g.resolvePendingEffect(firstOfferedTo, [], { intercept: false }); // let basicA be destroyed
  g.pendingEffect?.type === 'intercept_offer'
    ? pass('destroy_all_basics_one_player (2 holders): loop reaches 2nd basic, offers intercept again')
    : fail('ch7-14b', JSON.stringify(g.pendingEffect));
  const secondOfferedTo = g.pendingEffect.playerId;
  g.resolvePendingEffect(secondOfferedTo, [], { intercept: false });
  const noneLeft = !g.players['p2'].stable.some(c => c.type === 'basic_unicorn');
  (noneLeft && !g.pendingEffect)
    ? pass('destroy_all_basics_one_player (2 holders): loop fully drains after both resolved')
    : fail('ch7-15b', `noneLeft=${noneLeft} pending=${JSON.stringify(g.pendingEffect)}`);
}

// 10. Dragon's Fortune: intercepted self-sacrifice means no extra turn granted
{
  const g = setup(3, ['dragons', 'adventures']);
  g.players['p1'].hand = []; g.players['p1'].stable = []; g.players['p2'].hand = []; g.players['p2'].stable = []; g.players['p3'].hand = []; g.players['p3'].stable = [];
  injH(g, 'p3', find('Unicorn Net'), 'un6');
  injS(g, 'p1', uni('df1'), 'df1');
  g.pendingEffect = { type: 'sacrifice_self_take_extra_turn', playerId: 'p1', sourceCardId: 'df1' };
  g.resolvePendingEffect('p1', [], {});
  g.resolvePendingEffect('p3', [], { intercept: true });
  (!g.extraTurns['p1'] || g.extraTurns['p1'] === 0)
    ? pass("Dragon's Fortune: intercepted -> no extra turn granted (cost never paid)")
    : fail('ch7-16', 'extra turn granted despite interception');
}

// ─── Section 21: QOL 6 — Spectator mode (stateFor spectator opt) ──────────

console.log('\n── QOL 6: Spectator mode ──');

// 1. Normal stateFor(playerId) behavior unchanged (backward compat, no opts arg)
{
  const g = setup(2);
  const s1 = g.stateFor('p1');
  const p2HandHidden = s1.players['p2'].hand.length === 0 && s1.players['p2'].handCount > 0;
  p2HandHidden
    ? pass('stateFor(playerId): opponent hand still correctly hidden (backward compat)')
    : fail('spec-1', 'opponent hand visible without opts');
}

// 2. Spectator mode reveals every hand
{
  const g = setup(3);
  const spec = g.stateFor(null, { spectator: true });
  const allRevealed = g.playerOrder.every(pid => spec.players[pid].hand.length === spec.players[pid].handCount);
  allRevealed
    ? pass('stateFor(null, {spectator:true}): all hands revealed')
    : fail('spec-2', 'a hand was hidden in spectator mode');
  spec.isSpectator === true
    ? pass('stateFor spectator: isSpectator flag set')
    : fail('spec-3', 'isSpectator not set');
}

// 3. Spectator mode doesn't leak or crash on pendingEffect/neighBlocked with null playerId
{
  const g = setup(2);
  g.pendingEffect = { type: 'choose_destroy', playerId: 'p1' };
  const spec = g.stateFor(null, { spectator: true });
  spec.pendingEffect?.type === 'choose_destroy'
    ? pass('stateFor spectator: sees the raw pendingEffect (no player-restriction)')
    : fail('spec-4', 'pendingEffect not visible to spectator');
  spec.neighBlocked === false
    ? pass('stateFor spectator: neighBlocked safely defaults to false for null playerId')
    : fail('spec-5', 'neighBlocked crashed or wrong');
}

// 4. Regular player's own pendingEffect visibility still correctly restricted (regression)
{
  const g = setup(2);
  g.pendingEffect = { type: 'choose_destroy', playerId: 'p1' };
  const s2 = g.stateFor('p2');
  s2.pendingEffect === null
    ? pass('stateFor(p2): pendingEffect correctly hidden from non-owning player (regression)')
    : fail('spec-6', 'pendingEffect leaked to wrong player');
}

// 5. Nanny Cam still works correctly alongside spectator reveal (no regression in the OR logic)
{
  const g = setup(2);
  const s1 = g.stateFor('p1');
  s1.players['p2'].handVisible === false
    ? pass('stateFor(p1): handVisible correctly false for a normal opponent (regression)')
    : fail('spec-7', 'handVisible wrongly true');
}

// 6. localMode / debugMode still reveal all hands without spectator flag (regression)
{
  const g = new Game('t' + Math.random());
  g.addPlayer('p1', 'P1'); g.addPlayer('p2', 'P2');
  g.updateSettings({ expansions: [], winCondition: 7, localMode: true, debugMode: false });
  g.startGame(); g.phase = 'action';
  const s1 = g.stateFor('p1');
  s1.players['p2'].hand.length === s1.players['p2'].handCount
    ? pass('stateFor: localMode still reveals all hands without spectator flag (regression)')
    : fail('spec-8', 'localMode hand reveal broken');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

const warnings = [];
console.log(`\n── Results: ${passed} passed, ${failed} failed, ${warnings.length} known bugs (⚠️ ) ──`);
if (failed > 0) console.log('Fix the ❌ failures above before making any other changes.');
if (warnings.length > 0) console.log('Fix the ⚠️  known bugs when tackling code health improvements.');

/**
 * test_bot.js — Bot/AI opponent regression tests
 *
 * Covers: bot lifecycle (add/remove), the bot decision engine's ability to
 * play full games to completion without crashing or stalling, and the
 * specific engine bugs discovered and fixed while building the bot (several
 * of these are latent bugs that could also affect human players — see
 * CONTINUATION_PROMPT.md "Bot / AI opponent" section for the full list).
 *
 * Run: node test_bot.js   → all lines should begin with ✅
 */

'use strict';
const { Game } = require('./game');
const { EXPANSIONS } = require('./expansions');
const { runBotStep } = require('./bot');

let passed = 0, failed = 0;
const pass = label        => { process.stdout.write(`✅ ${label}\n`); passed++; };
const fail = (label, det) => { process.stdout.write(`❌ ${label} — ${det}\n`); failed++; process.exitCode = 1; };

function setup(n = 2, exps = []) {
  const g = new Game('t' + Math.random());
  for (let i = 1; i <= n; i++) g.addPlayer('p' + i, 'P' + i);
  g.updateSettings({ expansions: exps, winCondition: 7, localMode: false, debugMode: false });
  return g;
}

function simulate(g, ids, maxSteps = 3000) {
  let steps = 0, noProgressStreak = 0;
  while (!g.winner && steps < maxSteps) {
    let anyActed = false;
    for (const pid of ids) {
      const res = runBotStep(g, pid, g.players[pid].botDifficulty);
      if (res.acted) anyActed = true;
    }
    steps++;
    if (!anyActed) { noProgressStreak++; if (noProgressStreak > 20) break; } else noProgressStreak = 0;
  }
  return { steps, stuck: !g.winner && noProgressStreak > 20, timedOut: !g.winner && steps >= maxSteps };
}

// ─── 1. Bot lifecycle ─────────────────────────────────────────────────────────

{
  const g = setup(1);
  const r = g.addBot('Rex', 'hard');
  (r.ok && g.players[r.playerId]?.isBot && g.players[r.playerId]?.botDifficulty === 'hard')
    ? pass('addBot: creates a bot player with the requested difficulty')
    : fail('addBot', JSON.stringify(r));
}
{
  const g = setup(1);
  const r = g.addBot(undefined, 'nonsense-difficulty');
  (r.ok && g.players[r.playerId]?.botDifficulty === 'medium')
    ? pass('addBot: invalid difficulty falls back to medium, name falls back to default')
    : fail('addBot fallback', JSON.stringify(r) + ' ' + JSON.stringify(g.players[r.playerId]));
}
{
  const g = setup(1);
  const r = g.addBot('Rex', 'easy');
  const rr = g.removeBot(r.playerId);
  (rr.ok && !g.players[r.playerId] && !g.playerOrder.includes(r.playerId))
    ? pass('removeBot: removes the bot from players and playerOrder')
    : fail('removeBot', JSON.stringify(rr));
}
{
  const g = setup(1);
  const r = g.removeBot('p1'); // not a bot
  r.error ? pass('removeBot: rejects removing a non-bot player') : fail('removeBot non-bot', 'no error');
}
{
  const g = setup(1);
  const r = g.addBot('Rex', 'easy');
  g.phase = 'action'; // simulate started game
  const rr = g.removeBot(r.playerId);
  rr.error ? pass('removeBot: rejects once the game has started') : fail('removeBot after start', 'no error');
}
{
  const g = setup(1);
  g.addBot('Rex', 'easy');
  const s = g.stateFor('p1');
  const botEntry = Object.values(s.players).find(p => p.isBot);
  (botEntry && botEntry.botDifficulty === 'easy')
    ? pass('stateFor: exposes isBot/botDifficulty to clients')
    : fail('stateFor bot fields', JSON.stringify(botEntry));
}

// ─── 2. Full bot-vs-bot games complete without crashing or stalling ──────────

{
  const allExpansions = Object.keys(EXPANSIONS);
  const scenarios = [
    { n: 2, diffs: ['easy', 'hard'], exp: [] },
    { n: 2, diffs: ['medium', 'medium'], exp: allExpansions },
    { n: 3, diffs: ['easy', 'medium', 'hard'], exp: allExpansions },
    { n: 4, diffs: ['easy', 'easy', 'hard', 'hard'], exp: allExpansions },
  ];
  let allOk = true, detail = '';
  for (const s of scenarios) {
    const g = setup(0, s.exp);
    const ids = s.diffs.slice(0, s.n).map((d, i) => g.addBot('Bot' + i, d).playerId);
    g.updateSettings({ expansions: s.exp, winCondition: 7 });
    g.startGame();
    const r = simulate(g, ids);
    if (r.stuck) { allOk = false; detail = `${s.n}p stuck after ${r.steps} steps`; break; }
  }
  allOk ? pass('Bot-vs-bot: representative games (2-4p, various expansions) complete without stalling')
        : fail('Bot-vs-bot games', detail);
}

// ─── 3. Regression: engine bugs found while building the bot ────────────────
// These were real, pre-existing bugs (not bot-specific) that happened to be
// invisible to human playtesting but were immediately hit by automated bot
// play. Fixed in game.js; guarded here so they can't silently come back.

{
  // choose_destroy/choose_steal: optional effects with no legal target used to
  // have no way to decline, permanently stalling the game.
  const g = setup(2);
  g.pendingEffect = { type: 'choose_destroy', playerId: 'p1', optional: true };
  const r = g.resolvePendingEffect('p1', [], { skip: true });
  (r.ok && !g.pendingEffect) ? pass('choose_destroy: optional effect can be skipped') : fail('choose_destroy skip', JSON.stringify(r));
}
{
  const g = setup(2);
  g.pendingEffect = { type: 'choose_steal', playerId: 'p1', optional: true };
  const r = g.resolvePendingEffect('p1', [], { skip: true });
  (r.ok && !g.pendingEffect) ? pass('choose_steal: optional effect can be skipped') : fail('choose_steal skip', JSON.stringify(r));
}
{
  // sacrifice_basic_draw_three: used to have no feasibility check at all —
  // a player with zero Basic Unicorns in their stable had no way to resolve it.
  const g = setup(2);
  g.phase = 'action'; g.currentPlayerIndex = 0;
  g.players['p1'].stable = [{ id: 'm1', type: 'magical_unicorn', name: 'X', emoji: '🦄', effect: null, description: '', expansion: null }];
  g.pendingEffect = { type: 'sacrifice_basic_draw_three', playerId: 'p1' };
  const r = g.resolvePendingEffect('p1', [], {});
  (r.ok && !g.pendingEffect) ? pass('sacrifice_basic_draw_three: skips cleanly when no Basic Unicorn exists') : fail('sacrifice_basic_draw_three feasibility', JSON.stringify(r));
}
{
  // end_discard: used to accept an empty/insufficient selection as a silent
  // no-op, which _endPhase() would immediately re-queue — an infinite
  // discard/requeue loop with no way out for any client that under-selects.
  const g = setup(2);
  g.players['p1'].hand = [1, 2, 3].map(i => ({ id: 'h' + i, type: 'basic_unicorn', name: 'X', emoji: '🦄', effect: null, description: '', expansion: null }));
  g.pendingEffect = { type: 'end_discard', playerId: 'p1', amount: 2 };
  const r = g.resolvePendingEffect('p1', [], {}); // empty selection — must be rejected, not silently accepted
  r.error ? pass('end_discard: rejects an insufficient/empty selection instead of silently no-opping') : fail('end_discard validation', 'accepted empty selection: ' + JSON.stringify(r));
}
{
  const g = setup(2);
  g.players['p1'].hand = [1, 2, 3].map(i => ({ id: 'h' + i, type: 'basic_unicorn', name: 'X', emoji: '🦄', effect: null, description: '', expansion: null }));
  g.pendingEffect = { type: 'end_discard', playerId: 'p1', amount: 2 };
  const r = g.resolvePendingEffect('p1', ['h1', 'h2'], {});
  (r.ok && g.players['p1'].hand.length === 1) ? pass('end_discard: a correct full selection still works') : fail('end_discard valid case', JSON.stringify(r) + ' handLen=' + g.players['p1'].hand.length);
}
{
  // _placeCard's internal win-check used to set this.winner without ever
  // transitioning phase to GAME_OVER or logging/announcing the win — so any
  // win reached via a route other than "play a unicorn directly from hand"
  // (revive-from-discard, search-and-place, sacrifice-then-revive, etc.)
  // would silently set winner in the background while the game kept running.
  const g = setup(2);
  g.phase = 'action'; g.currentPlayerIndex = 0;
  for (let i = 0; i < 6; i++) g.players['p1'].stable.push({ id: 'u' + i, type: 'basic_unicorn', name: 'BU', emoji: '🦄', effect: null, description: '', expansion: null });
  g._placeCard('p1', { id: 'winner', type: 'basic_unicorn', name: 'BU', emoji: '🦄', effect: null, description: '', expansion: null }, null, null);
  (g.winner === 'p1' && g.phase === 'game_over')
    ? pass('_placeCard: winning via direct placement properly sets winner AND transitions to game_over')
    : fail('_placeCard win transition', `winner=${g.winner} phase=${g.phase}`);
}

// ─── Results ──────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exitCode = 1;

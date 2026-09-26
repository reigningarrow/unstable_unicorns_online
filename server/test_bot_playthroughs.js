// Dedicated bot-vs-bot playthrough run: many complete games at 2p then 3p,
// all expansions enabled, checking for crashes, stalls, and card conservation.
const { Game }        = require('./game');
const { runBotStep }  = require('./bot');
const { EXPANSIONS }  = require('./expansions');

let pass = 0, fail = 0, crash = 0;
const failures = [];

function setup(n) {
  const g = new Game('t' + Math.random());
  for (let i = 1; i <= n; i++) g.addPlayer('p' + i, 'P' + i);
  g.updateSettings({ expansions: Object.keys(EXPANSIONS), winCondition: 7, localMode: false, debugMode: false });
  g.startGame();
  for (const pid of g.playerOrder) g.players[pid].isBot = true;
  return g;
}

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
  const collectOptions = eff => { if (eff?.options && eff.type !== 'take_one_from_list') for (const c of eff.options) ids.push(c.id); };
  collectOptions(g.pendingEffect);
  if (Array.isArray(g.pendingEffectQueue)) for (const eff of g.pendingEffectQueue) collectOptions(eff);
  return ids;
}
function multisetEqual(a, b) {
  const countOf = arr => { const m = new Map(); for (const id of arr) m.set(id, (m.get(id) || 0) + 1); return m; };
  const ma = countOf(a), mb = countOf(b);
  if (ma.size !== mb.size) return false;
  for (const [id, n] of ma) if (mb.get(id) !== n) return false;
  return true;
}

function runOneGame(n, gameIdx, difficulty) {
  const g = setup(n);
  const before = snapshotIds(g);
  let steps = 0, noProgress = 0;
  const maxSteps = 5000;
  let errorThrown = null;
  try {
    while (!g.winner && steps < maxSteps) {
      let acted = false;
      for (const pid of g.playerOrder) {
        const r = runBotStep(g, pid, difficulty);
        steps++;
        if (r && r.acted) { acted = true; break; }
      }
      if (!acted) { noProgress++; if (noProgress > 30) break; } else noProgress = 0;
    }
  } catch (e) {
    errorThrown = e;
  }
  const after = snapshotIds(g);
  const stuck = !errorThrown && !g.winner && noProgress > 30;
  const conserved = errorThrown ? null : multisetEqual(before, after);

  if (errorThrown) {
    crash++;
    failures.push(`${n}p game #${gameIdx}: CRASHED after ${steps} steps — ${errorThrown.message}\n${errorThrown.stack}`);
  } else if (stuck) {
    fail++;
    failures.push(`${n}p game #${gameIdx}: STALLED (no legal bot action) after ${steps} steps, winner=${g.winner || 'none'}`);
  } else if (!conserved) {
    fail++;
    failures.push(`${n}p game #${gameIdx}: CARD CONSERVATION VIOLATED after ${steps} steps (cards created/destroyed outside intended zones)`);
  } else {
    pass++;
  }
  return { steps, winner: g.winner, errorThrown, stuck, conserved };
}

const GAMES_PER_SIZE = 20;
const difficulties = ['easy', 'medium', 'hard'];

for (const n of [2, 3]) {
  console.log(`\n── Running ${GAMES_PER_SIZE} full bot-vs-bot games at ${n} players (all expansions) ──`);
  for (let i = 1; i <= GAMES_PER_SIZE; i++) {
    const difficulty = difficulties[i % difficulties.length];
    const result = runOneGame(n, i, difficulty);
    const status = result.errorThrown ? '💥 CRASH' : result.stuck ? '🛑 STALL' : !result.conserved ? '⚠️  CONSERVATION' : '✅';
    console.log(`  ${status}  game #${i} (${difficulty}): ${result.steps} steps, winner=${result.winner || 'none/timeout'}`);
  }
}

console.log(`\n── Results: ${pass} passed, ${fail} failed, ${crash} crashed (${GAMES_PER_SIZE * 2} total games) ──`);
if (failures.length) {
  console.log('\n── Failure details ──');
  for (const f of failures) console.log(f + '\n');
}
process.exit(fail > 0 || crash > 0 ? 1 : 0);

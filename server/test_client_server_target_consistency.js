/**
 * test_client_server_target_consistency.js
 *
 * Regression guard for a real bug class: the CLIENT (App.jsx's getCardTargetNeeds)
 * decides whether to show a target-player-picker / stable-card-picker / 2-player
 * auto-select shortcut BEFORE a card is played, based on its own hardcoded list of
 * effect types. The SERVER (game.js's playCard) separately and authoritatively
 * decides whether a play is actually valid based on ITS OWN hardcoded list
 * (mustHaveStable / mustHavePlayer). These two lists are maintained independently,
 * with nothing structurally forcing them to agree.
 *
 * When they drift — as happened with Blatant Thievery ('look_hand_take_one'), which
 * was in the server's mustHavePlayer list but missing from the client's equivalent
 * list entirely — the client never shows a picker or auto-selects a target, and
 * playing the card always fails with a server-side "Select a target player first" /
 * "Select a target card in a stable first" error, no matter what the player does.
 * The card ends up completely unplayable.
 *
 * This check parses both files as text (App.jsx is JSX/React and isn't a Node
 * module we can require) and confirms every effect type the SERVER requires a
 * player/stable target for is ALSO present in the CLIENT's corresponding list.
 * The reverse isn't checked: the client is allowed to have extra entries the
 * server doesn't strictly require (e.g. 'force_discard', which server-side already
 * supports being played with OR without an upfront target — see game.js's
 * 'force_discard' case) since those are optional UX shortcuts, not requirements.
 *
 * Run: node test_client_server_target_consistency.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { EFFECTS } = require('./cards');

let passed = 0, failed = 0;
const pass = label        => { process.stdout.write(`✅ ${label}\n`); passed++; };
const fail = (label, det) => { process.stdout.write(`❌ ${label} — ${det}\n`); failed++; process.exitCode = 1; };

const gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
const appPath = path.join(__dirname, '..', 'client', 'src', 'App.jsx');
const appSrc = fs.readFileSync(appPath, 'utf8');

// Resolve an EFFECTS.XXX / literal-string mix inside an array literal into a
// plain array of string effect-type names.
function extractArrayLiteral(src, varName) {
  const re = new RegExp(`const ${varName}\\s*=[\\s\\S]*?\\[([^\\[\\]]*?)\\]\\.includes\\(t\\)`);
  const m = src.match(re);
  if (!m) throw new Error(`Could not find ${varName} array literal in source — has the surrounding code structure changed? Update this check's regex.`);
  const body = m[1];
  return [...body.matchAll(/(?:EFFECTS\.([A-Z_]+))|'([\w_]+)'/g)]
    .map(x => x[1] ? EFFECTS[x[1]] : x[2])
    .filter(Boolean);
}

let serverMustHaveStable, serverMustHavePlayer, clientStableNeeds, clientPlayerNeeds;
try {
  serverMustHaveStable = extractArrayLiteral(gameSrc, 'mustHaveStable');
  pass(`Parsed server's mustHaveStable list (${serverMustHaveStable.length} types)`);
} catch (e) { fail('Parse server mustHaveStable', e.message); serverMustHaveStable = []; }

try {
  serverMustHavePlayer = extractArrayLiteral(gameSrc, 'mustHavePlayer');
  pass(`Parsed server's mustHavePlayer list (${serverMustHavePlayer.length} types)`);
} catch (e) { fail('Parse server mustHavePlayer', e.message); serverMustHavePlayer = []; }

// Client: getCardTargetNeeds has two if-blocks returning 'stable' and 'player'.
// Isolate that function's body first so the array-extraction below can't drift
// off into an unrelated, much-earlier '[' elsewhere in this 2000+ line file.
const fnMatch = appSrc.match(/const getCardTargetNeeds = \(card\) => \{[\s\S]*?\n  \};/);
if (!fnMatch) throw new Error("Could not find getCardTargetNeeds function body in App.jsx — has it been renamed or restructured? Update this check's regex.");
const fnBody = fnMatch[0];

function extractClientList(returnValue) {
  const re = new RegExp(`\\[([^\\[\\]]*?)\\]\\.includes\\(t\\)\\)\\s*return '${returnValue}'`);
  const m = fnBody.match(re);
  if (!m) throw new Error(`Could not find getCardTargetNeeds' '${returnValue}' branch — has App.jsx's structure changed? Update this check's regex.`);
  return [...m[1].matchAll(/'([\w_]+)'/g)].map(x => x[1]);
}

try {
  clientStableNeeds = extractClientList('stable');
  pass(`Parsed client's "stable" target-needs list (${clientStableNeeds.length} types)`);
} catch (e) { fail('Parse client stable list', e.message); clientStableNeeds = []; }

try {
  clientPlayerNeeds = extractClientList('player');
  pass(`Parsed client's "player" target-needs list (${clientPlayerNeeds.length} types)`);
} catch (e) { fail('Parse client player list', e.message); clientPlayerNeeds = []; }

// The actual consistency check: everything the server REQUIRES a stable/player
// target for, the client must also recognize as needing that target — or the
// card becomes unplayable exactly like Blatant Thievery was.
for (const t of serverMustHaveStable) {
  clientStableNeeds.includes(t)
    ? pass(`Client asks for a stable target for '${t}' (server requires it)`)
    : fail(`Missing client stable-target handling for '${t}'`,
        `server's mustHaveStable requires it, but client's getCardTargetNeeds does not return 'stable' for it — this card would be unplayable`);
}
for (const t of serverMustHavePlayer) {
  clientPlayerNeeds.includes(t)
    ? pass(`Client asks for a player target for '${t}' (server requires it)`)
    : fail(`Missing client player-target handling for '${t}'`,
        `server's mustHavePlayer requires it, but client's getCardTargetNeeds does not return 'player' for it — this card would be unplayable (this exact gap is what broke Blatant Thievery/'look_hand_take_one')`);
}

// A type should never appear in BOTH the server's two lists, or BOTH the
// client's two lists — that would be an internally-contradictory requirement.
const serverBoth = serverMustHaveStable.filter(t => serverMustHavePlayer.includes(t));
serverBoth.length === 0
  ? pass('Server: no effect type is in both mustHaveStable and mustHavePlayer')
  : fail('Server list overlap', `type(s) in both lists: ${serverBoth.join(', ')}`);
const clientBoth = clientStableNeeds.filter(t => clientPlayerNeeds.includes(t));
clientBoth.length === 0
  ? pass('Client: no effect type is in both "stable" and "player" needs lists')
  : fail('Client list overlap', `type(s) in both lists (the "stable" check runs first, making the "player" entry dead code): ${clientBoth.join(', ')}`);

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) console.log('Fix the ❌ failures above.');

// ─── Additional regression: Americorn's pull_random_hand ──────────────────
// getCardTargetNeeds must not force an upfront 'stable' target for enter/beginning-
// trigger unicorn cards (Americorn, Rhinocorn) — that target is resolved interactively
// via a pendingEffect after the card is already in the stable. Without this guard,
// Americorn could never be played at all (the client would demand a stable-card pick
// the server never needed and had no matching UI for).
appSrc.includes('isEnterOrBeginningUnicorn')
  ? pass('getCardTargetNeeds exempts enter/beginning-trigger unicorn cards from the stable-target requirement')
  : fail('Americorn target-needs regression', 'isEnterOrBeginningUnicorn guard not found in App.jsx — Americorn/Rhinocorn would be unplayable again');

// choose_opponent_pull_random needs real UI (a label + an opponent-picker), not the
// generic 'Resolve effect' fallback with no way to interact.
appSrc.includes("pendingEffect.type==='choose_opponent_pull_random'") && appSrc.includes('choose_opponent_pull_random')
  ? pass('choose_opponent_pull_random has a pendingEffect label')
  : fail('Americorn label regression', 'no label branch for choose_opponent_pull_random — falls back to "Resolve effect"');
appSrc.includes("pendingEffect?.type==='choose_opponent_pull_random'")
  ? pass('choose_opponent_pull_random has an opponent-picker UI block')
  : fail('Americorn UI regression', 'no opponent-picker block for choose_opponent_pull_random — effect would be a dead end');

// ─── Additional regression: Mother Goose / Rainbow Unicorn / Chainsaw Massicorn ───
// All three were converted to proper interactive pendingEffects (with a working
// server-side confirm/skip resolver) in a previous session, but the client-side UI
// was never actually added for any of them — so a generic "hand cards become
// selectable" fallback fired instead, and clicking a hand card silently did nothing
// (selectCard() only sets local React state; nothing gets sent to the server without
// a type-specific Confirm button). This is the exact bug reported for Mother Goose.
for (const [type, label] of [
  ['take_from_nursery', 'Mother Goose Unicorn'],
  ['play_basic_from_hand', 'Rainbow Unicorn'],
  ['draw_per_basic_in_stable', 'Chainsaw Massicorn'],
]) {
  appSrc.includes(`pendingEffect.type==='${type}'`)
    ? pass(`${type} has a pendingEffect label (${label})`)
    : fail(`${label} label regression`, `no label branch for ${type} — falls back to "Resolve effect"`);
  appSrc.includes(`pendingEffect?.type==='${type}'`)
    ? pass(`${type} has a confirm/skip UI block (${label})`)
    : fail(`${label} UI regression`, `no UI block for ${type} — effect would be a dead end`);
}

console.log(`\n── Final: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exitCode = 1;

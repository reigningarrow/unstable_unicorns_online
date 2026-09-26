# Unstable Unicorns Online — Session Continuation Prompt

## How to use

1. Start a new Claude conversation
2. Upload the zip as an attachment
3. Paste this entire document as your first message

---

## Step 0 — Mandatory pre-flight (do this before anything else)

```
Before writing a single line of code:
1. Extract: unzip the attachment into /home/claude/unstable-unicorns/
2. Read EVERY file in full: server/game.js, server/cards.js, server/expansions.js,
   server/index.js, server/bot.js, client/src/App.jsx, client/src/index.css
3. npm install: cd server && npm install && cd ../client && npm install
4. Run integration tests:    cd server && node test_integration.js  → must be 25/25
5. Run per-card tests:       cd server && node test_cards.js        → must be 153/153, 0 known bugs
6. Run comprehensive tests:  cd server && node test_all_cards.js    → must be 232/232
7. Run bot regression tests: cd server && node test_bot.js          → must be 13/13
8. Run client/server target-consistency check: cd server && node test_client_server_target_consistency.js → must be 22/22
9. Run effect coverage check (see Audit checklist § B)
10. Build client: cd client && npm run build  → must be 0 errors
11. Run all 16 smoke tests (see Audit checklist § F)
12. Only then proceed.
```

Never modify based on memory. Always read current file state first.

---

## Project overview

Unstable Unicorns Online — self-hostable real-time multiplayer web implementation.
475 physical cards: 2nd Edition base (127) + 7 expansions.

| Layer | Tech | Entry point |
|-------|------|-------------|
| Server | Node.js + Express + `ws` | `server/index.js` (~269 lines) |
| Game engine | Pure JS class | `server/game.js` (~2,736 lines) |
| Base cards | JS definitions | `server/cards.js` (343 lines) |
| Expansions | 7 packs, factory fns | `server/expansions.js` (859 lines) |
| Frontend | React 18 + Vite | `client/src/App.jsx` (~2,259 lines) |
| Styles | CSS custom props, dark purple | `client/src/index.css` |
| Tests — integration | Plain Node.js | `server/test_integration.js` (313 lines, 25 tests) |
| Tests — per-card | Plain Node.js | `server/test_cards.js` (~1,579 lines, 153 tests) |
| Tests — comprehensive | Plain Node.js | `server/test_all_cards.js` (2,265 lines, 207 tests) |

Quick start:
```bash
cd server && npm install
cd ../client && npm install && npm run build
cd ../server && node index.js
# Open http://localhost:3001
```

---

## Architecture — critical rules

### Game phases
```
waiting → beginning → draw → action → end → (back to beginning)
```

### Key central helpers — ALWAYS USE THESE
- `_sacrificeCard(pid, cid)` — all sacrifices; handles Phoenix, Dragon Protection, on_sac_or_destroy shields
- `_destroyCard(tPid, tCid, byPid, byMagic=false)` — all destroys; same shield chain; pass `byMagic=true` when triggered by a Magic card
- `_stealCard(byPid, fromPid, cid)` — fires on_steal_or_destroy triggers
- `_placeCard(pid, card, tPid, tCid)` — **the ONLY route for adding a card to a stable**; runs enter-triggers, Queen Bee check, Tiny Stable overflow, on_unicorn_enter draw, `_checkWin`. Never call `stable.push` directly for game-state card placement.
- `_hasPassive(pid, type)` — checks passives including: `on_would_sac_destroy`, `on_sac_or_destroy`, `on_sac_destroy_return_hand`, `on_leave.return_to_hand_self`, `on_unicorn_enter_or_leave`, `hand_visible`
- `_effectDone()` — closes a pendingEffect in action/end phase; pops queue or calls `_endPhase()`
- `_effectDoneBeginning(pid)` — closes a pendingEffect in beginning phase; pops queue or advances to DRAW

### Effect queue rules
- Never call `_advanceTurn()` directly except for effects that must immediately end the turn (Zombie Unicorn, Dragon's Fortune extra turn)
- Always close with `_effectDone()` (or `_effectDoneBeginning()` in beginning phase)
- `_queueEffect(obj)` — if `pendingEffect` is already set, pushes to `pendingEffectQueue`
- Effects queued from beginning-phase cards (e.g. Rainbow Lasso `discard_n_steal_unicorn`) must carry `fromBeginning:true` so the resolver calls `doneB()` instead of `done()`; otherwise the player's draw/action phases are skipped

### Turn locking rule (CRITICAL)
When `resolveNeigh()` runs after a card play: if any `pendingEffect` is queued, `phase` is set to `END` immediately. The current player cannot play more cards. `_effectDone()` handles `_endPhase()` → `_advanceTurn()` once all effects resolve.

### Super Neigh chain (CORRECT implementation)
Playing a Neigh via `playInstant()` does **not** resolve immediately. It closes `neighWindow`
and opens `superNeighWindow` instead, storing the Neigh card + its player in
`superNeighPendingCard`. From there:
- **Any player** (including the original card's own player) holding a Neigh card may call
  `playInstant()` again during `superNeighWindow` to Super Neigh — this cancels the first
  Neigh and resolves the *original* card normally via `_finalizeCardResolution()`. The
  Super Neigh's own draw/discard/remove-from-game effects target whoever played the
  first Neigh (mirroring how a normal Neigh's effects target the original card's player).
- If nobody Super Neighs, the player who played the (still-standing) Neigh calls
  `resolveNeigh()` — this is routed to `_finalizeNeighStanding()` (not the normal
  card-resolution path), which applies the first Neigh's own effects and cancels the
  original card.
- `resolveNeigh(pid)` is context-sensitive: during `superNeighWindow` it requires
  `pid === superNeighPendingCard.playerId` (the neigher); otherwise it requires
  `pid === pendingCard.playerId` (the original card's player), same as before.
- `_finalizeCardResolution()` is shared by both the plain "nobody neighed at all" path and
  the "Super Neigh cancelled the Neigh" path — it's the exact resolution logic that used
  to live inline in `resolveNeigh()`.
- When a Neigh stands with no Super Neigh, `_finalizeNeighStanding()` correctly splices
  the blocked card out of the original player's hand and pushes it to `discard` (or
  `removedFromGame` for Hex Neigh, never both) — this was a latent gap found and fixed
  after the initial Super Neigh implementation (see "Fixed bugs" below).

### Cross-player effects (e.g. Annoying Flying Unicorn)
When effect `playerId !== currentPlayer`:
- Phase is set to `END` in `resolveNeigh()`
- Do NOT call `_endPhase()` yet — the opponent resolves their effect first
- Their `_effectDone()` will call `_endPhase()` → `_advanceTurn()`

### Intercept instants — Fishing Rod / Unicorn Net (CORRECT implementation)
No separate `interceptWindow` state property exists — intercepts are modelled as a
`pendingEffect` of type `'intercept_offer'`, reusing the existing effect-queue
infrastructure instead of a parallel mechanism:
- `_maybeIntercept(kind, byPid, tPid, tCid, byMagic, opts)` — call this immediately
  before any `_destroyCard`/`_sacrificeCard`/`_stealCard` call whose target is a specific,
  known card. `kind:'steal'` looks for a Fishing Rod holder; anything else looks for a
  Unicorn Net holder. Returns `true` if deferred (caller must NOT perform the action).
- The check searches every player except `byPid` (any bystander may react, not just the
  victim), starting just after `byPid` in turn order.
- `opts.resumeType` — `'destroy'` (default), `'sacrifice'`, or `'steal'` — which function
  to call if declined.
- `opts.advance` — `'done'` (default), `'doneB'`, or `'endTurn'` — how the *intercept
  offer itself* closes once resolved. Always safe to call `done()`/`doneB()`
  unconditionally right after `_maybeIntercept()` (they're queue-aware and won't
  prematurely end the phase if something's queued) — this is the standard pattern used
  everywhere. Manual-advance effects (Rhinocorn's immediate turn-end) are the one
  exception: null `pendingEffect` explicitly before calling `_maybeIntercept()` there.
- `opts.continuation` — `{type:'requeue', effect}` to queue a follow-up pendingEffect
  once the intercept closes (both branches), or a custom type dispatched via
  `_runContinuation(cont, wasIntercepted)` for multi-target loops: `_processDestroyEachOpponent`
  (Spray Bottle of Youth), `_processMultiSacrifice` (generalized — backs both
  `sacrifice_four_search_four` and `sacrifice_n_destroy_n`), `_processDestroyAllBasics`
  ("destroy all basics in one player's stable"). All three re-derive the current target
  list/position each call rather than trusting a stale snapshot, since the stable/hand
  shrinks as cards are removed mid-loop.
- `opts.thenDraw` / `opts.thenDiscardPick` / `opts.thenRequeue` — decline-only follow-ups
  (the cost-triggered chain is skipped entirely if the card was grabbed instead).
- Accepting redirects the card: steals go into the interceptor's stable, sacrifice/destroy
  go into the interceptor's hand. The counter-instant itself is only consumed on accept —
  declining keeps it in hand, so it will be offered again on the next qualifying
  steal/destroy while still held.


`_advanceTurn()` checks `extraTurns[currentPid]` BEFORE advancing the index. If > 0, it decrements and restarts the current player's beginning phase without advancing.

### _placeCard — ALL stable entry routes must go through here
`_placeCard(pid, card, tPid, tCid)` handles all card types (unicorn, upgrade, downgrade). It:
- Runs Queen Bee and Extreme Adventurer blocking checks for basics
- Pushes to `player.stable`
- Fires `on_unicorn_enter_or_leave` and `on_unicorn_enter` passives
- Checks Tiny Stable overflow → queues `sacrifice_unicorn_tiny_stable` if needed
- Calls `_enterTrigger(card, pid, tPid, tCid)`
- Calls `_checkWin()` and sets `this.winner` if win condition met

**Legitimate `stable.push` exceptions** (do NOT route through `_placeCard`):
- Lines 445, 459, 475 — inside `_resolveCardEffect` (direct play path, already equivalent)
- Lines 1560, 1575 — temp steals (`_tempFrom` metadata; must skip enter triggers)
- Lines 2051, 2064, 2069 — inside `_placeCard` itself
- Line 2218 — inside `_stealCard`
- Line 2270 — temp steal return at turn end

### Hand limit enforcement
`_endPhase()` iterates **every player** in `playerOrder` and queues `end_discard` for the first player over their limit. After that player resolves, `_endPhase()` is called again (not `_advanceTurn()`) to check remaining players before the turn advances.

### Llamacorn / ALL_DISCARD (CORRECT implementation)
`ALL_DISCARD` queues one `discard_choice` effect per player (in `playerOrder` order). Each player resolves their own `discard_choice` before the next is prompted. The resolver uses `done()` so multiple effects pop the queue in sequence. IMPORTANT: there must be only ONE `case EFFECTS.ALL_DISCARD:` in each switch statement — a duplicate stale case earlier in the same switch will shadow the correct one silently.

### choose_destroy / choose_steal targetType validation
Both enforce `eff.targetType` when present (`'unicorn'`, `'upgrade'`, `'downgrade'`). On_leave triggers pass `targetType` from the card definition when queueing.

### Kittencorn protection (CORRECT implementation)
`_destroyCard` checks `protect_from_magic_destroy` only when `byMagic=true`. It blocks destroy ONLY when the targeted card IS the Kittencorn itself (identified by `card.effect?.type==='protection' && card.effect?.protectsFrom==='magic_destroy'`). Does NOT protect other unicorns in the stable. Does NOT block steals.

### Discard pile (CORRECT implementation)
`stateFor()` exposes:
- `discardTop` — the single most-recently-discarded card (for the "Last Played" sidebar panel)
- `discardPile` — full array, most-recent-first (for `DiscardPileBrowser` modal, always available)
These are distinct. The sidebar label reads "Last Played", not "Last Played / Discard Top".

### stateFor(playerId, opts={}) shape
`opts.spectator: true` reveals every hand (same mechanism as `localMode`/`debugMode`) and
`playerId` can be `null`. Player-facing broadcasts (from `index.js`) also inject a
top-level `spectatorCount` field (how many spectators are currently watching the room) —
this isn't part of `stateFor()` itself, since spectator tracking is a connection-layer
concern, not game-engine state.
```js
{
  phase, currentPlayer, playerOrder, winner,
  deckCount, discardCount,
  discardTop,          // full card object — top of pile (= most recently played/discarded)
  discardPile,         // full array, most-recent-first — searchable at any time
  nurseryCount, removedFromGameCount, log: [{msg,ts}],  // last 30 entries
  neighWindow: bool,
  neighBlocked: bool,  // true if this player has Ginormous Unicorn (false for spectators/null playerId)
  pendingCard: card|null,           // exposed while neighWindow OR superNeighWindow is open
  pendingCardPlayerId: string|null,
  superNeighWindow: bool,           // true once a Neigh has been played on pendingCard and is itself open to being Neighed
  superNeighCard: card|null,        // the Neigh card that was just played (visible during superNeighWindow)
  superNeighPlayerId: string|null,  // who played that Neigh (the one who must confirm "let it stand")
  pendingEffect: obj|null,  // shown to the affected player only; shown unredacted to spectators
  isSpectator: bool,        // true iff opts.spectator was set
  settings: { expansions[], winCondition, localMode, debugMode },
  winCondition,
  players: {
    [pid]: {
      id, name, isHost, connected,
      handCount, hand,       // hand is [] unless showHand (always populated for spectators)
      stable, unicornCount,
      handLimit,
      handVisible            // true if pid has Nanny Cam / Clairvoyant Unicorn (or spectator/local/debug)
    }
  }
}
```

### Spectator mode (CORRECT implementation)
Spectators get **full reveal** (every hand visible — a broadcast/omniscient view, not the
redacted view a player gets of opponents) and can join **at any time, including
mid-game** — both were explicit design decisions, confirmed before implementing, since
neither was a clear-cut "obviously correct" default.
- Client sends `{type:'join_spectator', room}`; server assigns a spectator id and adds
  the ws to `room.spectators` (a separate map from `room.clients`, since spectators have
  no entry in `game.players`) — never call `game.addPlayer()` for a spectator.
- `broadcastState()`/`broadcast()` in `index.js` fan out to `room.spectators` too, using
  `game.stateFor(null, {spectator:true})`.
- On the client, spectators render through a dedicated `SpectatorBoard` component, not
  `GameBoard` — completely separate code path, zero risk to normal player rendering.
  `GameBoard` still hard-requires a non-null `playerId`, unchanged.
- Spectators are removed from `room.spectators` on ws close; they don't persist across a
  page refresh (no localStorage entry is written for a spectate session), unlike players.

### Stable card display
Two rows:
- **Row 1**: unicorns (baby, basic, magical)
- **Row 2**: upgrades and downgrades (shown only when present, separated by hairline)

---

## Audit checklist — run every session

### A. Integration tests
```bash
cd server && node test_integration.js   # must be 25/25, exit 0
```

### B. Effect coverage check
```bash
cd server && node -e "
const {createDeck,EFFECTS}=require('./cards');
const {getExpansionCards,EXPANSIONS}=require('./expansions');
const fs=require('fs');
const src=fs.readFileSync('./game.js','utf8');
const allCards=[...createDeck(),...getExpansionCards(Object.keys(EXPANSIONS))];
const cases=new Set();
[...src.matchAll(/case ['\"]([\w_]+)['\"]:/g)].forEach(m=>cases.add(m[1]));
Object.values(EFFECTS).forEach(v=>cases.add(v));
[...src.matchAll(/eff\.type===?'([\w_]+)'/g)].forEach(m=>cases.add(m[1]));
[...src.matchAll(/\.type==='([\w_]+)'/g)].forEach(m=>cases.add(m[1]));
[...src.matchAll(/type:'([\w_]+)',playerId/g)].forEach(m=>cases.add(m[1]));
const missing=new Map();
for(const c of allCards){
  if(c.effect?.type&&!cases.has(c.effect.type))
    if(!missing.has(c.effect.type)) missing.set(c.effect.type,c.name+'['+c.expansion+']');
}
console.log('Unhandled ('+missing.size+'):');
for(const [t,n] of missing) console.log(' ',t,'<-',n);
"
# Expected: exactly 2 false positives (both handled at runtime, not via switch case):
#   pull_random_from_attacker  ← Wall of Horns (handled in _destroyCard loop)
#   return_to_nursery_instead  ← Nightmare babies (handled in _sacrificeCard/_destroyCard)
```

### C. Per-card tests
```bash
cd server && node test_cards.js         # must be 153/153, 0 known bugs
```

### D. Comprehensive card tests
```bash
cd server && node test_all_cards.js     # must be 232/232
```

### D.5. Bot / AI opponent regression tests
```bash
cd server && node test_bot.js           # must be 13/13, 0 failed
```

### D.6. Client/server target-requirement consistency check
```bash
cd server && node test_client_server_target_consistency.js   # must be 22/22, 0 failed
```

### E. Client build
```bash
cd client && npm run build              # must be 0 errors
```

### F. Smoke tests
```bash
cd server && node << 'EOF'
const {Game}=require('./game');
const {createDeck}=require('./cards');
const {getExpansionCards,EXPANSIONS}=require('./expansions');
const allCards=[...createDeck(),...getExpansionCards(Object.keys(EXPANSIONS))];
const pass=n=>process.stdout.write('✅ '+n+'\n');
const fail=(n,m)=>{process.stdout.write('❌ '+n+' — '+m+'\n');process.exitCode=1;};
function setup(n=2,exps=[]) {
  const g=new Game('t'+Math.random());
  for(let i=1;i<=n;i++) g.addPlayer('p'+i,'P'+i);
  g.updateSettings({expansions:exps,winCondition:7,localMode:false,debugMode:false});
  g.startGame();g.phase='action';g.currentPlayerIndex=g.playerOrder.indexOf('p1');
  return g;
}
const inj=(g,pid,c)=>g.players[pid].stable.push(c);
const injH=(g,pid,c)=>g.players[pid].hand.push(c);
const uni=id=>({id,type:'basic_unicorn',name:'BU',emoji:'🦄',effect:null,description:'',expansion:null});
const upg=id=>({id,type:'upgrade',name:'UPG',emoji:'⬆️',effect:null,description:'',expansion:null});

// Phoenix blocks destroy
{const g=setup();const ph=allCards.find(c=>c.name==='Unicorn Phoenix');inj(g,'p1',{...ph,id:'ph'});injH(g,'p1',uni('h'));g._destroyCard('p1','ph','p2');g.players['p1'].stable.some(c=>c.id==='ph')?pass('Phoenix blocks destroy'):fail('Phoenix','destroyed');}
// Blatant Thievery requires target player
{const g=setup();const bt=allCards.find(c=>c.name==='Blatant Thievery');injH(g,'p1',{...bt,id:'bt'});g.playCard('p1','bt',null,null).error?pass('Blatant Thievery requires target'):fail('Blatant Thievery','no error');}
// AFU: locks turn, cross-player discard
{const g=setup();const afu=allCards.find(c=>c.name==='Annoying Flying Unicorn');injH(g,'p1',{...afu,id:'afu'});injH(g,'p2',uni('h'));g.playCard('p1','afu',null,null);g.resolveNeigh('p1');if(g.phase==='end')pass('AFU: locks END phase');else fail('AFU phase',g.phase);g.resolvePendingEffect('p1',[],{targetPlayerId:'p2'});const hb=g.players['p2'].hand.length;g.resolvePendingEffect('p2',['h'],{});g.players['p2'].hand.length<hb?pass('AFU: p2 discards'):fail('AFU p2','unchanged');}
// Llamacorn: all players resolve via player-chosen discard_choice (not random)
{const g=setup(3);const ll=allCards.find(c=>c.name==='Llamacorn');injH(g,'p1',{...ll,id:'ll'});g.playCard('p1','ll',null,null);g.resolveNeigh('p1');let n=0;while(g.pendingEffect?.type==='discard_choice'&&n<5){const o=g.pendingEffect.playerId;const c=g.players[o].hand[0]?.id;g.resolvePendingEffect(o,c?[c]:[],{});n++;}(!g.pendingEffect||g.pendingEffect.type!=='discard_choice')?pass('Llamacorn: all players resolve via choice'):fail('Llamacorn','still pending');}
// Nanny Cam: hand visible
{const g=setup(2);const nc=allCards.find(c=>c.name==='Nanny Cam');inj(g,'p2',{...nc,id:'nc'});const s=g.stateFor('p1');(s.players['p2'].handVisible&&s.players['p2'].hand.length>0)?pass('Nanny Cam: p2 hand visible to p1'):fail('Nanny Cam','vis='+s.players['p2'].handVisible);}
// Necromancer: skips when not feasible
{const g=setup();const nec=allCards.find(c=>c.name==='Necromancer Unicorn');injH(g,'p1',{...nec,id:'nec'});g.playCard('p1','nec',null,null);g.resolveNeigh('p1');!g.pendingEffect?pass('Necromancer: skips when not feasible'):fail('Necromancer',g.pendingEffect?.type);}
// Change of Luck: 3-card multi-discard + extra turn
{const g=setup(3);const col=allCards.find(c=>c.name==='Change of Luck');injH(g,'p1',{...col,id:'col'});[1,2,3].forEach(i=>injH(g,'p1',uni('c'+i)));g.playCard('p1','col',null,null);g.resolveNeigh('p1');if(g.pendingEffect?.type==='discard_extra_turn_pending'&&g.pendingEffect?.amount===3)pass('Change of Luck: multi-discard queued');else fail('Change of Luck',g.pendingEffect?.type);g.resolvePendingEffect('p1',['c1','c2','c3'],{});g.currentPlayer==='p1'?pass('Change of Luck: extra turn stays with p1'):fail('Extra turn',g.currentPlayer);}
// Temp steal return on next turn
{const g=setup(2,['nsfw']);inj(g,'p2',uni('b'));g.pendingEffect={type:'steal_basic_temp',playerId:'p1'};g.resolvePendingEffect('p1',[],{targetPlayerId:'p2',targetCardId:'b'});g._advanceTurn();g.players['p2'].stable.some(c=>c.id==='b')?pass('Temp steal returns on next turn'):fail('Temp steal return','not returned');}
// Turn advances correctly
{const g=setup();const up=allCards.find(c=>c.name==='Unicorn Poison');inj(g,'p2',uni('v'));injH(g,'p1',{...up,id:'up'});g.playCard('p1','up','p2','v');g.resolveNeigh('p1');(['beginning','draw'].includes(g.phase)&&g.currentPlayer==='p2')?pass('Turn advances correctly'):fail('Turn',g.phase+'/'+g.currentPlayer);}
// Ginormous Unicorn: owner cannot neigh
{const g=setup();const gin=allCards.find(c=>c.name==='Ginormous Unicorn');const neigh=allCards.find(c=>c.effect?.type==='neigh');const up=allCards.find(c=>c.name==='Unicorn Poison');inj(g,'p1',{...gin,id:'gin'});inj(g,'p2',uni('v'));injH(g,'p2',{...up,id:'up'});injH(g,'p1',{...neigh,id:'n1'});g.currentPlayerIndex=g.playerOrder.indexOf('p2');g.playCard('p2','up','p1','gin');g.playInstant('p1','n1').error?pass('Ginormous owner cannot neigh'):fail('Ginormous neigh','no error');}
// Chainsaw Unicorn: skips when no modifiers / destroys upgrade
{const g=setup();const cs=allCards.find(c=>c.name==='Chainsaw Unicorn');injH(g,'p1',{...cs,id:'cs'});g.playCard('p1','cs',null,null);g.resolveNeigh('p1');!g.pendingEffect?pass('Chainsaw: skips when no modifiers'):fail('Chainsaw skip',g.pendingEffect?.type);}
{const g=setup();const cs=allCards.find(c=>c.name==='Chainsaw Unicorn');inj(g,'p2',upg('u1'));injH(g,'p1',{...cs,id:'cs'});g.playCard('p1','cs',null,null);g.resolveNeigh('p1');g.resolvePendingEffect('p1',[],{targetPlayerId:'p2',targetCardId:'u1'});!g.players['p2'].stable.some(c=>c.id==='u1')?pass('Chainsaw: destroys opponent upgrade'):fail('Chainsaw destroy','still in stable');}
// Stabby the Unicorn: only destroys unicorn cards
{const g=setup();const stab=allCards.find(c=>c.name==='Stabby the Unicorn');inj(g,'p1',{...stab,id:'stab'});inj(g,'p2',upg('ug1'));g._sacrificeCard('p1','stab');g.resolvePendingEffect('p1',[],{targetPlayerId:'p2',targetCardId:'ug1'}).error?pass('Stabby: rejects non-unicorn target'):fail('Stabby targetType','upgrade was destroyed');}
// _placeCard fires Queen Bee blocking check
{const g=setup(3);const qb=allCards.find(c=>c.name==='Queen Bee Unicorn');inj(g,'p1',{...qb,id:'qb'});const bu=uni('bu');g._placeCard('p2',bu,null,null);!g.players['p2'].stable.some(c=>c.id==='bu')?pass('_placeCard: Queen Bee blocks'):fail('_placeCard Queen Bee','basic entered');}
// stateFor exposes full discardPile array
{const g=setup();g.discard.push({id:'d1',type:'magic',name:'X',emoji:'✨',effect:null,description:'',expansion:null});const s=g.stateFor('p1');(Array.isArray(s.discardPile)&&s.discardPile.length>=1)?pass('stateFor: discardPile array exposed'):fail('discardPile','not array or empty');}
// Super Neigh: p1 plays a card, p2 neighs it, p1 super-neighs — original card resolves
{const g=setup();const neigh=allCards.find(c=>c.effect?.type==='neigh');g.players['p1'].hand=[{id:'sn1',type:'basic_unicorn',name:'BU',emoji:'🦄',effect:null,description:'',expansion:null},{...neigh,id:'n_p1'}];g.players['p2'].hand=[{...neigh,id:'n_p2'}];g.playCard('p1','sn1',null,null);g.playInstant('p2','n_p2');g.playInstant('p1','n_p1');g.players['p1'].stable.some(c=>c.id==='sn1')?pass('Super Neigh: p1 supers p2\'s neigh, original card resolves'):fail('Super Neigh','card did not resolve');}
EOF
# Expected: all 16 smoke tests pass
```

---

## Current state — what is DONE

### All pendingEffect types implemented (100+)
Including all base-deck effects, all Adventures choice cards, all Nightmares effects, all Dragons effects, NSFW temp steals, Christmas Gift Inspector, Rainbow Apocalypse Special Delivery, Unicorns of Legend Wall of Horns, Critical Hit, discard_choice (Llamacorn / ALL_DISCARD), Claw Machine, Rainbow Lasso.

### Intercept instants — Fishing Rod / Unicorn Net (fully implemented)
`_maybeIntercept()` opens an `intercept_offer` pendingEffect (reusing the existing effect
queue rather than a parallel `interceptWindow` state machine) at every direct-target
steal/destroy/sacrifice call site, including: direct Magic card plays, unicorn enter-trigger
steal/destroy, the generic `choose_destroy`/`choose_steal`/`may_destroy_optional` pathways,
Chainsaw Unicorn / Targeted Destruction's upgrade-destroy-or-downgrade-sacrifice, all
self-selected sacrifice effects (`sacrifice_unicorn`, `sacrifice_any`, Tiny Stable overflow),
Rhinocorn's immediate-turn-end destroy, Ancient Ritual, Pit Covered in Leaves, Buried Alive,
and multi-target loops (Spray Bottle of Youth, "sacrifice up to 4 unicorns, search for that
many") where each target gets its own independent intercept window. See the dedicated
"Intercept instants" section above for the mechanics.

### Super Neigh chain (fully implemented)
Playing a Neigh no longer resolves immediately — it opens a `superNeighWindow` that any
player (including the original card's player) can Neigh right back, cancelling the first
Neigh and letting the original card resolve normally. See the dedicated "Super Neigh chain"
section above.

### UI features implemented
- Card zoom modal (right-click or 🔍 button on any card — stable, hand, or discard)
- **Last Played** panel in right sidebar (distinct from the discard pile browser)
- **Browse Discard Pile** button + `DiscardPileBrowser` modal with text search/filter (accessible from sidebar button and clickable 🗑 counter in header)
- Hover detail on stable cards via `onHover` prop
- Nanny Cam / Clairvoyant Unicorn hand reveal rendered below opponent's stable
- `isMyEffect` flag: hand cards selectable on opponent's turn for cross-player effects
- Effect panel: `⚡` (your effect) vs `⏳ PlayerName must:` with colour coding
- `beginning_optional_choices`: individual "Activate X" button per card
- Multi-select discard for effects with `amount > 1`
- Re-Target (`move_upgrade_or_downgrade_between_stables`) two-step stable-card picker
- Critical Hit `⚔️` activate/skip buttons
- Stable split into two rows: unicorns (top) + upgrades/downgrades (bottom, hairline divider)
- Ginormous Unicorn: neigh button hidden; 🚫 informational message shown
- Chainsaw / Targeted Destruction / Dragon's Fire: cross-stable targeting
- Skip button for optional `destroy_upgrade_or_sacrifice_downgrade`
- `removedFromGameCount` shown in header as 🚫N
- **Win screen**: confetti canvas, animated final standings, 🥇🥈🥉 medals
- Extra turns correctly consumed in 3+ player games
- Claw Machine: `discard_then_draw_beginning` wired with label, discard button, and "Skip (hand empty)"
- Rich log entries: `"P1 plays 🧪 Unicorn Poison → P2's Llamacorn"`, `"P1 destroys P2's 🦄 BU"`, `"P1 steals 🦄 BU from P2"`, `"P1 sacrifices their 🦄 BU"`
- Choice card A/B buttons: `choice_*` effect types show labelled option buttons (e.g. "A: Steal Baby Unicorn" / "B: Revive Basic from Discard") derived per-card, plus a Skip button, instead of a generic Confirm
- `fuck_marry_kill` Step 1 player-picker: "Give to {PlayerName}" buttons per opponent (auto-fires in 2-player games)
- Mobile layout: `@media` breakpoints at 700px/480px for stacked layout, reduced card sizes
- NSFW age gate: confirmation modal ("I'm 18+ — Enable") before the NSFW expansion can be toggled on, tracked per-session
- Intercept offer banner: "Play {Fishing Rod/Unicorn Net} to intercept" / "Let it happen" buttons, shown to whichever bystander holds the counter-instant
- Super Neigh window: separate banner from the base Neigh window — "Super Neigh!" button for the original card's player (and any other Neigh-holder), "Let it stand" button for whoever played the first Neigh
- Spectator mode: `SpectatorBoard` — read-only, full-hand-reveal view of every player's stable/hand, deck/discard summary, log, and pending-effect/neigh banners; "👀 Watch this room" entry on the join screen (room code only, no name needed)
- Shared `ZoomButton` component (hand/stable/Nanny Cam all use it) — proper touch-target size (24px/20px circular hit area) instead of the old ~10x10px hitbox that was reported as nearly unusable, especially on mobile
- Bot / AI opponent: "Add Bot" (difficulty selector + name pool) and "✕ remove" in the lobby (host only, pre-game only); one-click "Play vs Bot" quick-start on the join screen; 🤖 badge + difficulty tag shown in the lobby player list, the in-game player list, and the final standings on the game-over screen — see the dedicated "Bot / AI opponent" section for the engine

### Fixed bugs (do not re-break)

| Bug | Fix summary |
|-----|-------------|
| Blatant Thievery without target | `look_hand_take_one` in `mustHavePlayer` |
| Alluring Narwhal could steal unicorns | `choose_steal` validates `targetType` |
| Stabby the Unicorn could destroy any card | `choose_destroy` validates `targetType`; on_leave passes `targetType` through |
| AFU phase lock | `resolveNeigh()` sets `phase=END` when pendingEffect queued |
| Llamacorn random discard | `ALL_DISCARD` queues `discard_choice` per player; duplicate stale case removed |
| Llamacorn resolved wrong player | `discard_choice` guarded by `eff.playerId===pid` |
| Nanny Cam logic backwards | `hand_visible` checks `pid2`'s own stable |
| Necromancer forced when not feasible | Feasibility check before queuing |
| Change of Luck discard=1 | `discard_extra_turn_pending` multi-select |
| First card in hand unclickable | `position:relative; display:inline-block` on card wrapper |
| `isMyEffect` crash | Declared after `pendingEffect` destructured |
| Back Kick missing opponent discard | `thenDiscard` check in `_executeMagic` RETURN_TO_HAND |
| Extra turn lost in 3+ player games | `_advanceTurn()` checks `extraTurns` before advancing index |
| Ginormous Unicorn owner could neigh | `neighBlocked` in `stateFor()`; client hides button |
| Chainsaw only targeted own stable | Added to `STABLE_EFFECTS` + always-active list |
| Rainbow Aura didn't block destroys | `_getPassives` indexes `protect_from_destroy` from `protectsFrom:'destroy'` |
| Kittencorn blocked ALL magic destroys in stable | Only blocks when targeted card IS the Kittencorn itself |
| Kittencorn blocked all steals | `blocksSteal`/`protect_from_steal` removed entirely |
| Pandamonium owner could win | `_checkWin` skips `unicorns_are_pandas` players |
| Dragon's Blessing didn't block downgrades | `downgrades_have_no_effect` check in DOWNGRADE branch |
| Saved by the Sigil was destroyable/sacrificeable | `block_downgrades_self_protected` added to both indestructible guards |
| Unicorn of War could be destroyed | `card.effect?.passive?.type==='cannot_be_destroyed'` checked in `_destroyCard` |
| Naughty List fired on victim not thief | `on_steal_or_destroy` fires from thief/destroyer's stable |
| FMK required upfront target player | Removed from `mustHavePlayer` |
| Supernatural Selection needed specific card | Moved from `mustHaveStable` to `mustHavePlayer` |
| Hand limits only checked current player | `_endPhase()` iterates all players; `end_discard` calls `_endPhase()` not `_advanceTurn()` |
| Tiny Stable only fired on direct play | Overflow check added inside `_placeCard` |
| `_placeCard` bypassed Queen Bee | Queen Bee + Extreme Adventurer checks added inside `_placeCard` |
| `_placeCard` didn't call `_checkWin` | `_checkWin` now called inside `_placeCard` unicorn branch |
| Rainbow Lasso ended turn after stealing | `fromBeginning:true` → `doneB()` |
| Rainbow Lasso could steal non-unicorns | `discard_n_steal_unicorn` validates target is IS_UNICORN |
| Claw Machine showed "Resolve effect" | `discard_then_draw_beginning` added to label map + button set |
| Discard pile = last played card | Renamed panel "Last Played"; `discardPile` array in `stateFor()`; `DiscardPileBrowser` modal |
| Various direct `stable.push` bypasses | All routed through `_placeCard` |
| Ghost Guide, nursery, play_basic_from_hand etc. | Routed through `_placeCard` |
| No intercept mechanic for Fishing Rod / Unicorn Net | `_maybeIntercept()` + `intercept_offer` pendingEffect, wired into every direct-target steal/destroy/sacrifice call site |
| Pit Covered in Leaves: self-sacrifice bypassed `_sacrificeCard` | Card vanished without reaching discard, and Phoenix/shields never fired — routed through `_sacrificeCard`, now interceptable too |
| `sacrifice_four_search_four` sacrificed all cards in one uninterceptable batch | Rebuilt as a per-card loop (`_processSacrificeFour`) — each card gets its own intercept window; grabbed cards don't count toward the search number |
| Neigh could not itself be Neighed (no Super Neigh) | `superNeighWindow` + `superNeighPendingCard`; `playInstant()`/`resolveNeigh()` now context-sensitive; shared `_finalizeCardResolution()` |
| Neighed card (standing, no Super Neigh) never left hand or reached discard | `_finalizeNeighStanding()` now splices it out and pushes to `discard` (or `removedFromGame` for Hex Neigh, never both) |
| ~20 more sacrifice/steal/destroy code paths bypassed `_sacrificeCard`/`_stealCard` (missing Phoenix/shield protection, missing `on_steal_or_destroy` triggers, missing intercept) | Full audit — all routed through the central helpers; two of them (Buried Alive choice-b, already-fixed Pit Covered in Leaves) were also silently discarding cards into nowhere, now correctly reach the discard pile; `sacrifice_four_search_four` and `sacrifice_n_destroy_n`'s multi-card loops consolidated into one `_processMultiSacrifice()`; `destroy_all_basics_one_player` rebuilt as a per-card loop (`_processDestroyAllBasics()`) |
| No spectator mode | `stateFor(playerId, {spectator})` opt (full hand reveal via the existing `revealAll` mechanism), `room.spectators` map, `join_spectator` WS message, `SpectatorBoard` client component |
| Flaky Fishing Rod test: only 1 of 3 players' starting hands was cleared, so ~1/20 random seeds dealt a real Fishing Rod to the wrong player and misdirected the intercept offer | Fixed the specific test's isolation; audited every other intercept test in the file for the same gap (none found) |
| Card zoom (🔍) button nearly unusable — ~10x10px hitbox (`fontSize:7, padding:'1px 2px'`), duplicated identically in 3 places (hand, stable, Nanny Cam) | Extracted a shared `ZoomButton` component with a real touch-target size (24px full/20px small — ~6x the tap area), used everywhere; also widened the gap between hand cards (5px→8px) to reduce mis-taps between adjacent cards |
| HEEEEERE'S STABBY's `remove_from_game` spliced the target straight out of the stable, bypassing every protection check (Phantom Unicorn's indestructibility, Kittencorn's magic-destroy immunity, Dragon Protection/Black Knight/`on_sac_or_destroy` discard-instead shields, Phoenix), all `on_sac_or_destroy`/`on_steal_or_destroy` triggers, and the Fishing Rod/Unicorn Net intercept window entirely | `_destroyCard(tPid,tCid,byPid,byMagic,toRemovedFromGame)` gained a `toRemovedFromGame` param — the full protection/trigger chain now runs unchanged, and only the final destination (discard vs. removedFromGame) differs; `remove_from_game` now goes through `_maybeIntercept('destroy',...,{toRemovedFromGame:true})` → `_destroyCard(...,true,true)` like every other destroy; the intercept-decline path threads `action.toRemovedFromGame` through so a declined offer still lands in the right pile |
| Glitter Bomb (user-reported: "says resolve effect but doesn't allow selection of any cards") — its effect type `sacrifice_then_destroy_one` was missing from `App.jsx`'s `needsSacrifice` and `STABLE_EFFECTS` lists entirely, so clicking any card on either step (sacrifice, then destroy) sent nothing to the server. Server-side resolution was already correct (confirmed via a direct simulation); the gap was 100% client-side, and this card had zero prior test coverage on either side, which is exactly why it went unnoticed | Added `sacrifice_then_destroy_one` to `needsSacrifice` (sacrifice step, gated on `!sacrificeDone`) and to `STABLE_EFFECTS` (destroy step then works via the existing generic `sacrificeDone` check in `needsStableClick`); added an accurate prompt label ("a card", not "a unicorn" — Glitter Bomb allows sacrificing/destroying any card type, confirmed against the resolver's lack of a type filter); added a full server-side regression test (`test_all_cards.js`) covering the beginning-phase queue → sacrifice step → destroy step chain, since none existed before |
| Magical Kittencorn (user-reported) — its "cannot be destroyed" protection only ever checked a `byMagic` boolean, and ~30 of the ~35 call sites that could trigger a destroy (including Upgrade-card abilities like Stable Artillery and Glitter Bomb) hardcoded that boolean to `false` regardless of what actually triggered the destroy — so Kittencorn was vulnerable to Upgrade/Downgrade-sourced destroys when it should have been protected, while one shared pendingEffect type (`sacrifice_n_destroy_n`, used by both a Unicorn card and a Magic card) had no way to distinguish the two at all | Replaced the single `byMagic` parameter with a dispatch-time instance flag `this._kittenProtects`, set from the *triggering card's own type* at every dispatch entry point (`_enterTrigger`, `_queueBeginningEffect`, `_executeMagic`, and both `on_leave` dispatch points, which recompute it from the just-destroyed/sacrificed card since that's a fresh unicorn ability regardless of what destroyed the outer card) — true for Magic/Instant/Upgrade/Downgrade, false for Unicorn. `_destroyCard`'s check now reads this flag (falling back to an explicitly-passed `byMagic=true` for direct/test callers that don't go through the normal dispatch flow). Verified safe across multi-step effect chains and the async Fishing-Rod/Unicorn-Net intercept round-trip (the value is captured into the intercept's stored `action` object at offer-time, restored before the deferred `_destroyCard` call on decline, exactly like the existing `action.byMagic` pattern) — confirmed via direct testing that `playCard`/`resolvePendingEffect` are fully blocked for everyone while any pendingEffect is open, so nothing else can interleave and go stale. Added 5 regression tests covering both directions plus the genuinely ambiguous `sacrifice_n_destroy_n` case both ways |
| Many "you may" (optional) card effects had no way to decline (user-reported) — a broad audit found ~121 cards across the pool with `optional:true`; the client had **zero skip UI at all** for `choose_destroy`/`choose_steal`/`choose_return` (backing 7+ cards: Stabby the Unicorn, Dragon Unicorn, Berserkercorn, Paladin Unicorn, Alluring Narwhal, Shark With a Horn, and others) and for `move_upgrade_or_downgrade_between_stables`; several server resolvers (`discard_two_steal_any`, `move_downgrade_steal_upgrade`, `discard_search_magic_play`, `discard_then_steal`, `play_upgrade_from_hand`) had no `extra?.skip` path at all; and — worse — four cards (Rainbow Unicorn, Mother Goose Unicorn, Chainsaw Massicorn, and Americorn/Festive Flying Unicorn) were **auto-executing synchronously with zero player input whatsoever**, ignoring `optional:true` entirely; Americorn/Festive Flying Unicorn's `pull_random_hand` additionally never fired *at all* even before that, since the effect type wasn't in `playCard`'s `mustHavePlayer` list and enter-triggered unicorns are explicitly exempted from `mustHaveStable`, so no target player was ever supplied | Added explicit Skip buttons in `App.jsx` for `choose_destroy`/`choose_steal`/`choose_return`/`move_upgrade_or_downgrade_between_stables`, plus a generic fallback Skip button for any other `pendingEffect.optional===true` case not already handled (safe even for unverified types — the server just returns an error rather than corrupting state); added `extra?.skip` support to the 5 resolvers listed above (gating `discard_then_steal`'s on `eff.optional` specifically, since Possession shares that type but is mandatory); converted the 4 synchronous auto-execute cases into proper interactive `pendingEffect`s with confirm/skip (`play_basic_from_hand`, `take_from_nursery`, `draw_per_basic_in_stable`), and gave Americorn/Festive Flying Unicorn a real interactive opponent-picker (`choose_opponent_pull_random`) so the ability fires at all, let alone optionally. Added 15 regression tests. This audit was not fully exhaustive given the scale (~75 distinct optional effect types) — the generic client-side fallback should catch most of the remaining long tail, but a dedicated follow-up pass is still worth doing; see Known Remaining Issues |
| Sadistic Ritual (user-reported: couldn't select a unicorn to sacrifice when the only unicorn in the stable was a Baby Unicorn) — turned out not to be baby-unicorn-specific at all: `App.jsx`'s `Stable` component only allows clicking cards in **your own** stable when a hardcoded `allowOwnClick` prop is true, and that prop only ever covered `move_upgrade_or_downgrade_between_stables`/`destroy_upgrade_or_sacrifice_downgrade` — so `needsSacrifice` (the flag driving every sacrifice-type effect: Sadistic Ritual, plain Sacrifice a Unicorn, Glitter Bomb's sacrifice step, etc.) never actually made any of your own cards clickable, regardless of card type. The user's specific repro (baby-unicorn-only stable) was just the one that got noticed, not a distinct root cause | Added `needsSacrifice` to the `allowOwnClick` condition on the player's own `<Stable>` — one line, since `needsSacrifice` was already computed correctly and already scoped to the affected player only (a pendingEffect is only ever sent to the player it belongs to, so there's no cross-player leakage risk in also using it here) |
| Blatant Thievery — user-reported "select a target player first" error when pressing Play in a 2-player game (not yet tested at 3+ players, per the report). Root cause: `App.jsx`'s `getCardTargetNeeds` (which decides whether to show a target-player picker, or auto-select the only opponent in a 2-player game, before a card can be played) was missing `'look_hand_take_one'` from its player-target list entirely, even though the server's authoritative `mustHavePlayer` list has always required it. Confirmed via testing this made the card **completely unplayable at every player count**, not just 2-player — the 2-player report was just the first one hit. A second, related mismatch was also found and fixed: `'destroy_all_basics_one_player'` was incorrectly present in the client's *stable*-target list (checked first, silently shadowing a later, correct entry in the player-target list) | Added `'look_hand_take_one'`, `'look_and_take'`, and `'destroy_all_basics_one_player'` to the client's player-target list, and removed the incorrect `'destroy_all_basics_one_player'` entry from the stable-target list. Added regression tests confirming the full play-and-resolve flow works in both 2-player and 3-player games. Also added a new permanent guard, `server/test_client_server_target_consistency.js`, which statically parses both `game.js`'s `mustHaveStable`/`mustHavePlayer` lists and `App.jsx`'s `getCardTargetNeeds` lists and fails if the client is ever missing an entry the server requires — this exact bug class (silent drift between the two independently-maintained lists) should not be able to recur silently again |

*(A remote-crash DoS and several server-hardening gaps are covered in the dedicated
"Security audit" section below, not duplicated in this table. Nine further engine bugs —
found by exhaustively stress-testing the new bot — are covered in the dedicated
"Bot / AI opponent" section's own table, also not duplicated here.)*

---

## Security audit (server) — findings and fixes

A full pass over `server/index.js` (the only network-facing code — REST + WebSocket)
found one **critical** remote DoS and several hardening gaps. All fixed; see below.

### 🔴 Critical — fixed
**Any unauthenticated client could crash the entire process** (dropping every room and
every connected player, not just their own), with a single WebSocket message, and no
special privilege beyond being host of their own freely-created room:
```json
{"type":"update_settings","settings":{"expansions":{}}}
```
followed by `{"type":"start_game"}`. `getExpansionCards()` did `for (const id of ids)`
with no check that `ids` was an array; a non-iterable value threw a `TypeError`
synchronously inside a `ws.on('message', ...)` callback, which was not wrapped in
try/catch anywhere — Node's default behavior for an uncaught exception is to print
the stack and **exit the process**. Proven with a live PoC (two real WebSocket clients
against a running server) before and after the fix.

Fix (defense in depth, each layer independent):
1. `game.updateSettings()` now validates `expansions` is an array of known expansion-id
   strings (anything else is dropped, never stored).
2. `getExpansionCards()` itself also guards against non-array input, so nothing that
   calls it in the future can reintroduce this class of bug.
3. The entire WebSocket `message` handler in `index.js` is now wrapped in try/catch —
   any exception is logged and answered with an `{type:'error'}` reply instead of
   crashing the process.
4. `process.on('uncaughtException'/'unhandledRejection')` added as a last-resort
   backstop. This **was independently necessary**, not just redundant: a follow-up PoC
   sending an oversized WebSocket frame threw from inside the `ws` library's own
   stream-processing internals (`Receiver.haveLength`), outside the try/catch's call
   stack entirely — only the process-level handler caught that one.

### 🟠 Hardening — fixed
| Gap | Fix |
|-----|-----|
| No cap on WebSocket message size (`ws` defaults to 100 MiB) | `maxPayload: 64 * 1024` on `WebSocket.Server` |
| `POST /api/rooms` had no rate limit or cap — spammable for unbounded memory growth | Per-IP limit (20 rooms / 10 min) + hard `MAX_ROOMS = 1000` cap, both returning proper 429/503 |
| Room-code generation didn't check for collisions | `POST /api/rooms` now loops until it finds an unused code |
| `name` (player) and `text` (chat) had no type or length checks — unbounded strings get rebroadcast to every client on every state update and written to disk on every autosave | `isNonEmptyString()` guard: names capped at 24 chars, chat at 500 chars, both must actually be strings |
| `winCondition` from `update_settings` wasn't validated as numeric — a non-numeric value silently became `NaN`, breaking the win check so the game could never end | Coerced via `Number()`, falls back to the previous value if not finite |
| `msg.playerId` (reconnect token) wasn't type-checked before being used as an object key | Now requires `typeof === 'string'` |
| Per-connection WebSocket transport errors had no handler | Added `ws.on('error', ...)` per connection (logs, doesn't crash) |

### Reviewed, no fix needed
- **XSS**: no `dangerouslySetInnerHTML` anywhere in `App.jsx`; chat/log text is rendered
  through normal JSX (auto-escaped). Player names and chat text are also safe for the
  same reason.
- **Prototype pollution**: `updateSettings()` only ever assigns a fixed, explicit set of
  known keys (`expansions`, `winCondition`, `localMode`, `debugMode`) — never a generic
  object merge/spread of client input — so a crafted `__proto__`/`constructor` payload
  in `settings` has nothing to pollute.
- **`debugAction`**: already correctly gated on both `settings.debugMode` (host-only
  toggle, off by default) and `isHost`, so it isn't reachable by an arbitrary client.
- **CORS**: wide open (`cors()` with no origin restriction) on the REST endpoints, but
  none of them read/write anything sensitive or use cookies/session state (playerId is
  a bearer value in the WS message body, not a cookie), so this is a low-severity,
  accepted tradeoff for a self-hosted app with no accounts — noted here rather than
  changed, since restricting origins would need a real deployment story (known host/
  port) that doesn't exist yet for a self-hosted drop-in server.
- **Persisted snapshot / reconnect model**: `rooms_snapshot.json` stores full hands in
  plaintext on disk, and reconnecting is just "know the right UUID" — both are accepted
  design tradeoffs of a no-accounts, self-hosted party game, not remotely exploitable
  bugs. Worth keeping in mind if this is ever exposed beyond a trusted LAN/group.

---

## Bot / AI opponent

`server/bot.js` is a self-contained decision engine — pure functions that call the
same public `Game` methods a real client would (`playCard`, `drawCard`,
`resolvePendingEffect`, `playInstant`, `resolveNeigh`, `actionDrawCard`). It never
reaches into engine internals beyond that.

### How bots enter a game
- **Lobby**: host clicks "Add Bot" (difficulty selector + name pool), or "✕" to
  remove one — before the game starts only (`game.addBot`/`game.removeBot`,
  WS messages `add_bot`/`remove_bot`, host-gated, mirrors `update_settings`'s
  waiting-phase-only restriction).
- **Play vs Bot**: one-click quick-start on the join screen — creates a room, joins,
  adds one bot at the chosen difficulty, lands in the lobby (still lets the host add
  more bots / tweak expansions / review settings before starting).
- Any mix of humans and bots is supported, up to the normal 8-player cap.

### Decision engine shape (`bot.js`)
- **Turn actions** (beginning/draw/action phase): a `cardValue()` heuristic scores
  hand/stable cards (unicorns > upgrades > downgrades, with bonuses for
  `count_as_two`/passive effects); `planCardPlay()` builds a legal `playCard()` call
  per hand card (respecting the same `mustHaveStable`/`mustHavePlayer` targeting
  rules as `game.js`'s own `playCard()`), and the highest-scoring legal play wins
  (with some randomness on lower difficulties).
- **Neigh / Super Neigh**: heuristic yes/no based on how threatening the played card
  is and whether the bot is the target; a `neighChance` knob per difficulty.
- **pendingEffect resolution** — the hard part, since the engine has ~100 distinct
  pendingEffect types (see `resolvePendingEffect` in `game.js`). Two tiers:
  1. **Tier 1**: hand-written handlers for the shapes that cover the large majority
     of real play — discard family, sacrifice family, destroy/steal family,
     search/pick family, `intercept_offer`, `beginning_optional_choices`, and every
     named `choice_*` card (each with the exact `sel`/`extra` shape it needs — these
     vary a lot card-to-card, see the `TIER1_HANDLERS` table).
  2. **Tier 2**: a generic fallback for everything else — builds a prioritized list
     of plausible `(sel, extra)` candidates from the same scoring helpers and submits
     each to the *real* `resolvePendingEffect` until one isn't rejected. Safe because
     `game.js` validates before it mutates anything in every case that was audited —
     a rejected candidate is a no-op, never a corrupted state.
  3. **Circuit breaker**: if literally nothing resolves an effect after 4 attempts
     (tracked per pendingEffect object via a `WeakMap`), it's force-closed via
     `_effectDone()`/`_effectDoneBeginning()` and logged, rather than ever letting one
     unanticipated card interaction freeze a room forever.
- **Difficulty** (`difficultyConfig`): easy/medium/hard scale `aggression` (how much
  targeting favors the leading opponent / how willing to play disruptive cards),
  `neighChance`, `optionalUseChance` (beginning-phase activations, intercepts), and
  `randomness` (top-N-instead-of-best-1 card selection, occasional draw-instead).

### Server wiring (`index.js`)
- `scheduleBotTick(roomId)` runs after every `broadcastState()` call. A per-room
  `botTicking` flag serializes it (no overlapping chains); each tick performs **one**
  bot action, re-broadcasts, and schedules the next tick after a pacing delay
  (700–1300ms for turn actions / neigh-window closes, ~350–450ms for quick reactive
  decisions) — so humans watching can actually follow what happened rather than
  seeing a silent instant batch. A 500-iteration safety cap stops a chain and logs an
  error if bot.js's own circuit breaker somehow didn't (defense in depth).

### Validation
- `server/test_bot.js` — bot lifecycle (add/remove, difficulty fallback, `stateFor`
  exposure) + regression guards for the engine bugs below + a
  representative-scenarios bot-vs-bot completion check. Run: `node test_bot.js`.
- Ad-hoc stress testing during development (not checked in): 400+ simulated
  bot-vs-bot games across every difficulty combination and every expansion
  combination reached 100% completion (no crash, no permanent stall) after the fixes
  below; a full live run through the real WebSocket/`index.js` layer (add_bot →
  start_game → played out via real `ws` messages → `game_over`) also completed
  successfully end-to-end.

### Real engine bugs found and fixed while building this
None of these are bot-specific — they're pre-existing correctness bugs that
automated, fast, exhaustive bot play happened to surface immediately, but any of them
could also have hit a human player in the right (rare) circumstances. All are
covered by regression tests (`test_bot.js`, plus the full suite still passing at
25/153/232).

| Bug | Fix |
|-----|-----|
| `choose_destroy`/`choose_steal` (optional effects, e.g. Alluring Narwhal) had no way to decline — even when no legal target existed at all, permanently stalling the game | Added `extra?.skip` support, mirroring the pattern already used by `destroy_upgrade_or_sacrifice_downgrade` |
| `move_upgrade_or_downgrade_between_stables` / `choose_return` — same "no skip when no legal target" gap | Added `extra?.skip` support |
| `sacrifice_unicorn_then_draw`, `sacrifice_basic_draw_three`, `sacrifice_any`, `sacrifice_then_destroy_one` — no feasibility check when the required card type (or any card at all) didn't exist in the player's stable | Each now detects the impossible case and resolves/skips cleanly instead of requiring an unsatisfiable selection |
| `discard_n_steal_unicorn`, `discard_two_destroy_unicorn`, `discard_two_bring_two_babies`, `discard_two_return_all_opponents_one`, `discard_unicorn_revive_unicorn_end_turn` — no feasibility check when hand had fewer cards than the discard cost required | Each now detects the shortfall and skips/ends the turn instead of requiring an unsatisfiable selection |
| `discard_then_search_upgrade_into_stable` / `discard_search_magic_play` — queued a `search_deck_pick` sub-effect via `_searchDeckPick` (landing in `pendingEffectQueue` since `pendingEffect` was still set), then manually set a `discardDone` flag and returned *without* calling `done()` — so the queued sub-effect was never surfaced and the game stalled forever on an already-completed step | Replaced the manual flag-set with `return done();`, which correctly pops the queue |
| **10 separate `choice_*`/related handlers** used an identical broken pattern — `this.pendingEffect=null; if(queue.length>0) pendingEffect=queue.shift();` — which, when the queue was empty, cleared the effect *without* ever calling `_endPhase()`/`_advanceTurn()` (unlike `done()`), silently freezing the game in whatever phase it was in | All 10 replaced with `return done();` (found via a scripted search for the repeated pattern, not one-by-one) — **this was the single highest-impact fix**, cutting the bot stress-test stall rate from ~13% to ~1.5% in one change |
| `end_discard` never validated that the submitted selection actually satisfied the required discard amount — an empty/insufficient selection "succeeded" as a no-op, `_endPhase()` immediately re-checked hand limits, found the player still over, and re-queued an *identical* `end_discard` — an infinite discard/requeue loop with no way out for any client (buggy, malicious, or just under-selecting) that submitted too few cards | Added the missing validation (`sel.length < need → error`), matching the pattern already used by `discard_extra_turn_pending` |
| `_placeCard`'s internal win-check set `this.winner` but never transitioned `phase` to `game_over`, logged the win, or was visible in a `gameOver` return flag — so winning via any placement route *other* than "play a unicorn directly from hand" (revive-from-discard, search-and-place, sacrifice-then-revive, etc.) silently set the winner in the background while the game kept running as if nothing had happened | `_placeCard`'s win-check now transitions phase and logs identically to the already-correct check in `_finalizeCardResolution` (guarded against double-logging if both fire) |

---

## Known remaining issues (priority ordered)

### 🟡 Medium — incomplete polish
*(none currently known — the two former Medium items, choice-card A/B buttons and the
`fuck_marry_kill` player-picker, are both implemented; verify with a quick read of
`App.jsx` around `choice_` and `fuck_marry_kill` before assuming otherwise, since this
doc can drift out of date.)*

### 🟢 Low — completeness
| Item | Description |
|------|-------------|
| Broader inline-sacrifice/stable.splice audit | `_sacrificeCard`/`_destroyCard`'s protection chain only fires for code paths that route through them. Bypasses found and fixed across sessions: Pit Covered in Leaves, `sacrifice_four_search_four`, and (this session) HEEEEERE'S STABBY's `remove_from_game`. Every remaining `stable.splice` site in `game.js` (~30) has now been reviewed; the rest are legitimate non-destroy moves (return-to-deck, return-to-hand, move-between-stables via `_placeCard`, temp-steal returns, or internal to `_destroyCard`/`_sacrificeCard`/`_stealCard` themselves) — see the Development Rules for the checklist to re-apply if a new card effect is added. |
| Demonicorn's `on_destroyed` trigger isn't wired up at all | Noticed while updating docs after the bot session (checking whether other `remove_from_game`-effect cards shared the intercept fix). Demonicorn's card definition has `{trigger:'on_destroyed', type:'remove_from_game', optional:true}`, but `game.js` has no `on_destroyed`/`effect.trigger` dispatch anywhere (confirmed via grep) — so the ability silently never fires when Demonicorn is destroyed. Not touched this session (out of scope — found via a documentation cross-check, not targeted testing); needs a dedicated fix session. |
| Full audit of remaining "you may" (optional) effects | The user-reported skip-option bug was fixed for the highest-impact cases (see Fixed Bugs table) plus a generic client-side Skip fallback for anything else flagged `pendingEffect.optional`, but the underlying card-level audit (~121 cards, ~75 distinct effect types) was not individually verified end-to-end. Priority follow-ups if more are found: (1) check for other cards handled *synchronously* in `_enterTrigger`'s switch with a bare `break` despite `optional:true` on the card (the same bug class as Rainbow Unicorn/Mother Goose/Chainsaw Massicorn/Americorn, all fixed this session) — search for `case` bodies that end in `break;` rather than `return {pendingEffect:true}` and cross-reference against cards with `optional:true`; (2) check that every pendingEffect type queued from an `optional:true` card actually carries `optional:true` on the object itself (only ~14/75 did before this session); (3) verify `resolvePendingEffect`'s handler for each supports `extra?.skip` (or the type's natural empty-selection equivalent) — watch for shared types like `discard_then_steal` where ONE card using the type is optional and another (Possession) isn't, so skip must be gated on `eff.optional`, not added unconditionally. |
| Room browser | List public rooms on landing page |
| Sound effects | Web Audio API or Howler.js |

---

## Development rules

1. **Read every relevant file before writing any code. Re-read after every `str_replace`.**
2. Route all sacrifices through `_sacrificeCard(pid, cid)` — never inline.
3. Route all destroys through `_destroyCard(tPid, tCid, byPid, byMagic)` — never inline.
4. Route ALL stable entry through `_placeCard(pid, card, tPid, tCid)` — never `stable.push` directly.
5. `_effectDone()` not `_advanceTurn()` — only call `_advanceTurn()` for immediate-turn-end effects.
6. **Add to ALL FOUR places when adding a new effect type:**
   - `_enterTrigger()` or `_executeMagic()` — to queue it
   - `_queueBeginningEffect()` — if it has a `beginning` trigger
   - `resolvePendingEffect()` — to handle player input
   - The pending effect label map in `App.jsx` — so the UI shows what to do
7. **Build after every change:** `cd client && npm run build` must be 0 errors.
8. **Run all test suites after every change:** integration 25/25, per-card 153/153, comprehensive 232/232, bot 13/13.
9. Use `str_replace` for targeted edits — never rewrite entire large files.
10. `isMyEffect = pendingEffect?.playerId === effectivePid` — must be declared AFTER `const { phase, pendingEffect, ... } = state` to avoid blank screen (temporal dead zone).
11. Card wrappers need `position:relative; display:inline-block` — otherwise zoom button positions incorrectly.
12. **Check feasibility before queuing optional effects** — check if any valid target exists; if not, log and skip silently. See Necromancer, Chainsaw Unicorn as examples.
13. **Never remove existing features** — only add.
14. **Check for duplicate `case` labels in switch statements** before adding a new one — a stale duplicate earlier in the switch silently shadows your new case. This was the root cause of Llamacorn's random-discard bug persisting despite the fix being written.
15. **`fromBeginning:true` flag** — when queueing any multi-step effect from `_queueBeginningEffect`, add this flag so the resolver calls `doneB()` instead of `done()`, preventing the player's draw/action phases from being skipped.

---

## Session workflow

```
1. Extract zip, read all 7 files in full (incl. server/bot.js)
2. npm install (server + client)
3. node test_integration.js  → 25/25
4. node test_cards.js        → 153/153, 0 known bugs
5. node test_all_cards.js    → 232/232
6. node test_bot.js          → 13/13
7. node test_client_server_target_consistency.js → 22/22
8. npm run build             → 0 errors
9. Effect coverage check     → 2 false positives only
10. 16 smoke tests            → all pass
11. Pick highest-priority issue from Known Remaining Issues
12. Implement fix
13. Run ALL checks again
14. Package zip and return
```

---

## File sizes (current baseline)

| File | Lines |
|------|-------|
| `server/game.js` | 2,911 |
| `server/cards.js` | 343 |
| `server/expansions.js` | 860 |
| `server/index.js` | 393 |
| `server/bot.js` | 662 |
| `client/src/App.jsx` | 2,409 |
| `server/test_integration.js` | 313 |
| `server/test_cards.js` | 1,579 |
| `server/test_all_cards.js` | 2,540 |
| `server/test_bot.js` | 175 |
| `server/test_client_server_target_consistency.js` | 117 |

---

## Expansion card counts

| ID | Physical cards | Key mechanic |
|----|---------------|--------------|
| `dragons` | 54 | Dragon Protection shield, Dragon's Fortune extra turn |
| `unicorns_of_legend` | 54 | RPG classes, Critical Hit, Wall of Horns |
| `rainbow_apocalypse` | 49 | Four Horsemen, Special Delivery |
| `adventures` | 54 | Pirates, choice cards, intercept instants |
| `nsfw` | 50 | Temp steals, Blow Up shield, Rainbow Shitstorm |
| `christmas` | 34 | Naughty List, Gift Inspector, Uneaten Fruitcake |
| `nightmares` | 53 | Remove from game, Hex Neigh, Phantom Unicorn (indestructible) |

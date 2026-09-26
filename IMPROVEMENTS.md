# Unstable Unicorns — Improvement Prompts

Use each still-open section below as a self-contained prompt in a new Claude session.
Always run the full audit checklist first (see CONTINUATION_PROMPT.md Step 0 + Audit A–F).
Never skip the pre-flight. Never remove existing features.

**Status key:** ✅ DONE (verified against current code) · 🔲 OPEN (not yet implemented)

---

## Status summary

| Item | Status |
|------|--------|
| CODE HEALTH 1 — Rainbow Aura / Kittencorn protection | ✅ DONE |
| CODE HEALTH 2 — Dragon's Blessing blocks downgrades | ✅ DONE |
| CODE HEALTH 3 — Route all `stable.push` through `_placeCard` | ✅ DONE (core cases); see "Newly discovered" below for related sacrifice-routing gaps found and fixed this session |
| CODE HEALTH 4 — Hand limit enforcement at end of turn | ✅ DONE |
| CODE HEALTH 5 — Neigh chain (Super Neigh) | ✅ DONE |
| CODE HEALTH 6 — Neighed card never leaves hand/discard | ✅ DONE |
| CODE HEALTH 7 — Full `stable.splice` bypass audit | ✅ DONE |
| QOL 1 — Richer game log entries | ✅ DONE |
| QOL 2 — Choice card buttons for Adventures | ✅ DONE |
| QOL 3 — Adventures intercept window (Fishing Rod / Unicorn Net) | ✅ DONE |
| QOL 4 — Mobile layout | ✅ DONE |
| QOL 5 — NSFW expansion age gate | ✅ DONE |
| QOL 6 — Spectator mode | ✅ DONE |
| QOL 7 — Room browser | 🔲 OPEN |
| QOL 8 — AI opponent | ✅ DONE |
| QOL 9 — Sound effects | 🔲 OPEN |
| QOL 10 — Card zoom button touch target (user-reported) | ✅ DONE |
| QOL 11 — Glitter Bomb unresolvable (user-reported) | ✅ DONE |
| QOL 12 — Magical Kittencorn protection scope (user-reported) | ✅ DONE |
| QOL 13 — "You may" effects with no skip option (user-reported) | ✅ DONE (highest-impact cases; broader audit still open — see CONTINUATION_PROMPT.md) |
| QOL 14 — Sadistic Ritual / sacrifice cards unselectable (user-reported) | ✅ DONE |
| QOL 15 — Blatant Thievery unplayable (user-reported) | ✅ DONE |

Everything marked ✅ above is implemented and verified against the current codebase
(re-verify with a quick grep before assuming — this doc can drift, and the whole point of
Step 0 is to never trust a written summary over the actual file state). Only two
QOL feature requests remain open (room browser, sound effects) — no known correctness
bugs are outstanding (aside from Demonicorn's `on_destroyed` trigger, noticed but not
yet fixed — see CONTINUATION_PROMPT.md's Known Remaining Issues).

---

## ✅ DONE — CODE HEALTH 1 — Rainbow Aura and Magical Kittencorn protection

`_getPassives` indexes `protection` passives under `protect_from_<protectsFrom>` so
`_hasPassive` finds them. `_destroyCard` checks `protect_from_destroy` (Rainbow Aura) and
`protect_from_magic_destroy` (Kittencorn, only when `byMagic=true`, only blocks the
Kittencorn card itself — doesn't shield the rest of the stable). Kittencorn does **not**
block steals (that protection was found to be a misread of the card and was removed).

---

## ✅ DONE — CODE HEALTH 2 — Dragon's Blessing (downgrades have no effect)

`_resolveCardEffect`'s `DOWNGRADE` branch checks `_hasPassive(tPid, 'downgrades_have_no_effect')`
before placing the downgrade; if true, the card is discarded with a log line instead.
`block_downgrades_self_protected` (Saved by the Sigil) remains a separate, additional check.

---

## ✅ DONE — CODE HEALTH 3 — Route all `stable.push` through `_placeCard`

All game-state card placement routes through `_placeCard`. The documented legitimate
exceptions (temp steals, `_placeCard`'s own internals, `_stealCard`) are intentional and
still stand. See CODE HEALTH 7 below for a related-but-distinct class of gap (sacrifice
code paths that bypass `_sacrificeCard`, which is a *removal* helper, not `_placeCard`).

---

## ✅ DONE — CODE HEALTH 4 — Hand limit enforcement at end of turn

`_endPhase()` iterates every player in `playerOrder` and queues `end_discard` for the
first player over their limit; it re-calls itself (not `_advanceTurn()`) after each
resolves, so every over-limit player is caught before the turn actually advances.

---

## ✅ DONE — CODE HEALTH 5 — Neigh chain (Super Neigh)

Playing a Neigh via `playInstant()` no longer resolves immediately. It closes
`neighWindow` and opens `superNeighWindow`, storing the Neigh card + its player in
`superNeighPendingCard`. From there, any player (including the original card's own
player) holding a Neigh may play it to Super Neigh — cancelling the first Neigh and
resolving the original card via the newly-extracted `_finalizeCardResolution()`. If
nobody Super Neighs, the player who played the (still-standing) Neigh calls
`resolveNeigh()`, now routed to `_finalizeNeighStanding()`, which applies that Neigh's own
draw/discard/remove-from-game effects and cancels the original card. `stateFor()` exposes
`superNeighWindow`, `superNeighCard`, `superNeighPlayerId` (see CONTINUATION_PROMPT.md's
`stateFor()` shape and the dedicated "Super Neigh chain" section for the full mechanics).
App.jsx has a separate banner for the super-neigh window with its own button set. 5 new
tests cover: p1 super-neighing their own card's neigh, nobody-supers standing, only the
neigher may resolve, a third-party bystander super-neighing, and `stateFor` exposure —
plus 3 existing tests were updated for the new two-phase flow (Hex Neigh,
`removedFromGameCount`, Unicorn Caroler all now call `resolveNeigh()` after `playInstant()`
to close the window, since a Neigh no longer finalizes in one step).

---

## ✅ DONE — CODE HEALTH 6 — Neighed card never leaves hand or discard

**Discovered while implementing Super Neigh; fixed as a follow-up.** Confirmed rule:
a neighed card counts as "played" — it's discarded, not returned to hand (matching
standard physical rules; this was the one open decision, confirmed with the user before
implementing). `_finalizeNeighStanding()` now splices the blocked card out of the
original player's hand (looking it up by `id`, falling back from the stale `cardIndex` if
the hand has shifted) and pushes it to `discard` — **except** when the standing Neigh is
`neigh_remove_from_game` (Hex Neigh), in which case it goes to `removedFromGame` instead,
never both. 4 new tests cover: the basic discard case, Hex Neigh's remove-from-game
(confirming it's NOT also discarded), the Super-Neigh-countered path is unaffected
(unchanged — it already correctly removed the card via `_finalizeCardResolution`), and an
exact hand-count check (-1, no phantom leftover card). One existing test (Unicorn Caroler)
needed updating: it previously asserted the recipient's hand *grew*, but the correct
behavior is a net-zero size change (the blocked card leaves, Caroler's gift arrives) — the
test now checks the specific cards involved rather than raw hand size.

---

## ✅ DONE — CODE HEALTH 7 — Full `stable.splice` bypass audit

**The audit found substantially more than the two cases already fixed** (Pit Covered in
Leaves, `sacrifice_four_search_four`) — roughly 20 more genuine bypasses across three
categories, all fixed:

**Sacrifice bypasses** (14 — now routed through `_sacrificeCard` + intercept):
`sacrifice_unicorn_then_draw`, `sacrifice_basic_draw_three`, `sacrifice_unicorn_destroy_unicorn`'s
sacrifice step, `sacrifice_then_revive`, `sacrifice_then_destroy_two`, `sacrifice_then_destroy_one`,
`sacrifice_n_destroy_n`'s sacrifice step (rebuilt as a per-card loop — see below),
`sacrifice_magical_search_basic`, Dragon's Fortune's self-sacrifice, Survivalist Unicorn's
sacrifice of an opponent's downgrade, Buried Alive's choice-b self-sacrifice, Critical
Hit's self-sacrifice, Angel Unicorn's beginning-phase self-sacrifice (a second, separate
handler from the enter-trigger one fixed earlier — same effect-type name, different
trigger context), and Bungee Jumping Unicorn's choice-a sacrifice.

Two of these were also the "card vanishes without reaching discard" bug (same class as
Pit Covered in Leaves): **Buried Alive's choice-b self-sacrifice** simply did
`stable.splice()` with the result discarded (literally, in the JS sense — never pushed
anywhere). Now fixed; as a nice side effect of fixing it correctly, the just-sacrificed
card legitimately shows up as a pickable option in the following "return a card from
discard" step, which is the rules-accurate behavior once the card properly reaches the
discard pile in the first place.

**Steal bypasses** (5 — now routed through `_stealCard` + intercept, which also means they
now correctly fire the `unicorns_cannot_be_stolen` protection check and `on_steal_or_destroy`
triggers that manual `_placeCard`-based theft was silently skipping): `steal_downgrade`,
`steal_baby`, Polyamorous Unicorn's steal step (already used `_stealCard`, just missing
the intercept wrap), Cutthroat Captain's choice-a steal, Pillaging Pirate's choice-a steal.

**Bulk destroy** (1): `destroy_all_basics_one_player` sacrificed/destroyed every Basic
Unicorn in one sweep with a single inline loop. Rebuilt as `_processDestroyAllBasics()` —
re-filters the target's stable each iteration (since it shrinks as cards are removed) so
each individual basic gets its own intercept window, following the same continuation
pattern as Spray Bottle of Youth and the generalized `_processMultiSacrifice()` (which now
also backs `sacrifice_four_search_four` and `sacrifice_n_destroy_n` — the two multi-card
sacrifice loops were consolidated into one function).

**Confirmed correct as-is (not bugs):** `RETURN_TO_DECK`, "return baby to nursery",
all pure "move to another stable" / "return to hand" effects, and the documented
temp-steal exceptions (Naked Narwhal, etc.). **Correction from a later session:**
`remove_from_game` (HEEEEERE'S STABBY) was originally assessed here as "deliberately
bypassing `_destroyCard`" — that assessment was wrong. It was a genuine bug (found via
a live proof-of-concept against Phantom Unicorn) and has since been fixed; see the
"Security audit" and "remove_from_game" sections below.

18 new tests cover representative cases from each category — Phoenix now protecting
`sacrifice_unicorn_then_draw`, the multi-card loop's count bookkeeping, both vanishing-card
fixes reaching discard correctly, Critical Hit's cost-cancels-effect semantics, steal
bypasses now firing through `_stealCard`, and the bulk-destroy loop with both single- and
dual-holder scenarios. `test_cards.js` is now 145/145.

---

## ✅ DONE — QOL 1 — Richer game log entries

Log entries include target information: card plays show `→ Target's Card`, destroys/
steals/sacrifices name the specific card and player. Emoji included throughout.

---

## ✅ DONE — QOL 2 — Choice card buttons for Adventures expansion

Every `choice_*` effect type has a per-card label map rendering real option text (e.g.
"A: Steal Baby Unicorn" / "B: Revive Basic from Discard") instead of generic "Option A/B",
plus a Skip button. See `App.jsx` around the `choice_steal_baby_or_revive_basic` etc. list.

---

## ✅ DONE — QOL 3 — Adventures intercept window (Fishing Rod / Unicorn Net)

Implemented differently than originally sketched, but fully functional: rather than a
separate `interceptWindow`/`interceptContext` state pair and a new `play_intercept`
WebSocket message, intercepts are modelled as an `intercept_offer` pendingEffect reusing
the existing effect-queue infrastructure (`_maybeIntercept()`, resolved through the
existing `resolve_effect` message). This was the simpler and lower-risk path since it
piggybacks on already-tested machinery instead of adding a parallel one. Wired into every
direct-target steal/destroy/sacrifice call site across the codebase, including multi-step
chains and multi-target loops. See CONTINUATION_PROMPT.md's dedicated "Intercept instants"
section for the full mechanics and `_maybeIntercept()`'s options.

---

## ✅ DONE — QOL 4 — Mobile layout

`client/src/index.css` has `@media (max-width: 700px)` and `@media (max-width: 480px)`
breakpoints for stacked layout and reduced sizing.

---

## ✅ DONE — QOL 5 — NSFW expansion age gate

`App.jsx` has an `nsfwPending` state gate with a confirmation modal ("I'm 18+ — Enable")
before the `nsfw` expansion can be toggled on; tracked so it doesn't re-trigger on
toggle-off-then-on within the same session.

---

## ✅ DONE — QOL 6 — Spectator mode

Confirmed two design decisions before implementing (both had genuine ambiguity, no
dominant "obviously correct" answer): spectators get **full reveal** (all hands visible,
broadcast/omniscient view — not the redacted view a player gets of opponents), and they
can join **anytime, including mid-game**.

**Server:** `stateFor(playerId, opts={})` gained an `opts.spectator` flag — when true,
`revealAll` is forced (same mechanism already used by `localMode`/`debugMode`) and
`playerId` can be `null` since a spectator has no hand of their own to compare against;
`pendingEffect` is shown unredacted (no privacy concern once every hand is already
visible). Fully backward compatible — no existing caller passes `opts`, so behavior for
real players is byte-for-byte unchanged. `index.js` tracks spectators in a separate
`room.spectators` map (not `room.clients`, since spectators aren't real players in
`game.players`); a new `join_spectator` WS message assigns a spectator id and both
`broadcastState`/`broadcast` now also fan out to every spectator. Player-facing state
gets a `spectatorCount` field so players can see how many people are watching.

**Client:** a new `SpectatorBoard` component (read-only — no hand clicks, no action
buttons) shows every player's stable and fully-revealed hand, the deck/discard summary,
recent log, and read-only neigh/super-neigh/pending-effect banners. `JoinScreen` got a
"👀 Watch this room" button that only needs a room code, no name. Existing `GameBoard`
is completely untouched — the spectator path is a fully separate screen/component, so
there's zero risk to normal player rendering.

8 new tests cover: backward compatibility of plain `stateFor(playerId)`, full hand
reveal + `isSpectator` flag under the spectator opt, `pendingEffect` visibility for
spectators without leaking to the wrong *player*, and regression checks for
Nanny Cam/localMode hand-reveal logic. Also fixed a **flaky pre-existing test** found
while re-running the suite for regression checking: a Fishing-Rod interception test only
cleared one of three players' starting hands, so roughly 1 in 20 random seeds would deal
a real Fishing Rod into the wrong player's hand and misdirect the intercept offer — not
a game bug, but a test-isolation gap; fixed by clearing all three hands consistently, and
audited every other intercept test in the file to confirm none had the same gap.

---

## 🔲 OPEN — QOL 7 — Room browser

List public/open rooms on the landing page instead of requiring a room code/link.

---

## ✅ DONE — QOL 8 — AI opponent

Went well beyond "always plays first legal card, targets randomly" — built a genuine
three-difficulty decision engine (`server/bot.js`), plus lobby integration ("Add Bot"
with a difficulty selector, "✕" to remove, pre-game only) and a one-click "Play vs Bot"
quick-start on the join screen. Any mix of humans and bots is supported, up to the
normal 8-player cap.

**Decision engine:** a `cardValue()` heuristic scores hand/stable cards (unicorns >
upgrades > downgrades, bonuses for `count_as_two`/passive effects) to drive which card
to play and who to target each turn; Neigh/Super Neigh decisions weigh how threatening
the played card is; difficulty (`easy`/`medium`/`hard`) scales aggression, how often
optional effects get used, neigh frequency, and how much randomness vs. always-best-play
is used.

**The hard part — resolving ~100 different pendingEffect types:** rather than hand-write
bespoke logic for every one, this uses two tiers. Tier 1 covers the shapes that make up
the large majority of real play (discard/sacrifice/destroy/steal families, search/pick,
intercepts, beginning choices, and every named `choice_*` card with its exact
card-specific `sel`/`extra` shape). Tier 2 is a generic fallback for everything else: it
builds a prioritized list of plausible `(sel, extra)` candidates from the same scoring
helpers and submits each to the *real* `resolvePendingEffect` until one is accepted —
safe because the engine validates before mutating anything, so a rejected candidate is a
no-op, never a corrupted state. A circuit breaker (tracked per-effect via a `WeakMap`)
force-closes anything that still can't resolve after 4 attempts and logs it, so no
unanticipated card interaction can freeze a room forever.

**Server wiring:** `scheduleBotTick()` runs after every `broadcastState()`, serialized
per-room, performing one bot action at a time with a pacing delay (700–1300ms for turn
actions/neigh-closes, ~350–450ms for quick reactions) so humans can actually follow what
happened rather than seeing an instant silent batch.

**Validation:** `server/test_bot.js` (13 tests: lifecycle, `stateFor` exposure, a
representative bot-vs-bot completion check, and regression guards for the bugs below).
During development: 400+ simulated bot-vs-bot games across every difficulty × expansion
combination reached 100% completion (no crash, no permanent stall); a full live game
was also played out end-to-end through the real WebSocket server (`add_bot` →
`start_game` → real `ws` messages → `game_over`).

**Nine real, pre-existing engine bugs were found and fixed** by this stress-testing —
none of them bot-specific, all could theoretically have hit a human player too, just
rarely enough to have gone unnoticed until something played thousands of games fast:
optional effects with no way to decline even when no legal target existed
(`choose_destroy`/`choose_steal`/`choose_return`/`move_upgrade_or_downgrade_between_stables`),
several sacrifice/discard effects with no feasibility check for whether the player
could actually pay the cost, a systemic bug where 10 separate handlers cleared
`pendingEffect` without ever calling `_effectDone()` (silently freezing the game — this
was the single highest-impact fix, cutting the stress-test stall rate from ~13% to
~1.5% in one change), `end_discard` accepting an insufficient selection as a silent
no-op (creating an infinite discard/requeue loop), and `_placeCard`'s win-check setting
`this.winner` without ever transitioning the game to `game_over` for any win reached
outside the "play a unicorn directly from hand" path. Full details, including the exact
fix for each, are in CONTINUATION_PROMPT.md's dedicated "Bot / AI opponent" section.

---

## 🔲 OPEN — QOL 9 — Sound effects

Web Audio API or Howler.js for card plays, destroys, wins, etc. No design work done yet —
would need at minimum: card-play, destroy/sacrifice, steal, win-fanfare, and neigh sounds.

---

## ✅ DONE — QOL 10 — Card zoom button touch target (user-reported)

Not from this doc originally — a direct user report: "some cards in the player's hand
are very difficult to select, especially the view card button." Root cause: the zoom
(🔍) button's clickable hitbox was ~10×10px (`fontSize:7, padding:'1px 2px'`), copy-pasted
identically across three locations (hand cards, stable cards, Nanny Cam reveal) — nearly
unusable, especially on mobile touch. Hand cards also only had a 5px gap between them,
making it easy to mis-tap the wrong neighbor.

Extracted a shared `ZoomButton` component with a real circular touch target (24px on
full-size cards, 20px on small ones — roughly 6x the tappable area versus the original),
used in all three places instead of three separately-maintained copies of the same tiny
inline style. Widened the hand-card gap from 5px to 8px. Pure client change — full server
test suite unaffected (25/25 + 153/153 + 207/207), confirmed with a clean production build.

---

## ✅ DONE — QOL 11 — Glitter Bomb unresolvable (user-reported)

Not from this doc originally — a direct user report: "Glitter bomb does not work it says
resolve effect but does not allow for selection of any cards." Root cause: Glitter Bomb's
effect type (`sacrifice_then_destroy_one` — "sacrifice a card, then destroy a card") was
missing entirely from two lists in `App.jsx` that gate which cards become clickable:
`needsSacrifice` (for the sacrifice step) and `STABLE_EFFECTS` (which the destroy step
needs to become clickable via the existing generic `sacrificeDone` check). With neither
list recognizing the type, clicking any card on either step sent nothing to the server —
matching the report exactly ("resolve effect" showed, but no click did anything).
Server-side resolution was already correct (confirmed directly via simulation); this
was a 100% client-side gap. This card had zero prior test coverage on either side,
which is exactly why it went unnoticed.

Fixed by adding `sacrifice_then_destroy_one` to both lists, plus an accurate prompt
label ("a card", not "a unicorn" — confirmed against the resolver that Glitter Bomb
allows sacrificing/destroying any card type, not just unicorns). Added a full
server-side regression test (`test_all_cards.js`) covering the beginning-phase queue →
sacrifice step → destroy step chain end to end, since none existed before.
`test_all_cards.js` is now 217/217 as of this fix (later fixes in this session bring it to 230/230 — see QOL 12/13).

---

## ✅ DONE — QOL 12 — Magical Kittencorn protection scope (user-reported)

User report: "magical kittencorn is not destroyed by unicorn effects, this is
incorrect behaviour it should only not be destroyed by magic or upgrade/downgrade
cards." Direct testing confirmed the second half first — Kittencorn already survived
Unicorn-triggered destroys correctly (Berserkercorn, Unicorn of Death both destroyed it
as expected) — but that testing also turned up the real, verifiable bug the report was
pointing at: Kittencorn's protection was gated on a single `byMagic` boolean, and
roughly 30 of the ~35 destroy call sites across the engine hardcoded that boolean to
`false` regardless of what actually triggered them — including Upgrade-card abilities
like Stable Artillery and Glitter Bomb. So Kittencorn was vulnerable to Upgrade/
Downgrade-sourced destroys when, per the card's own broader design intent in this
codebase, it should have been protected from those too, alongside Magic. One
pendingEffect type (`sacrifice_n_destroy_n`) is shared between a Unicorn card
(Warlock Unicorn) and a Magic card (Plague of Death) with no way to distinguish them at
all under the old boolean.

Fixed by replacing the single parameter with a dispatch-time flag (`_kittenProtects`)
derived from the *triggering card's own type* at every entry point (`_enterTrigger`,
`_queueBeginningEffect`, `_executeMagic`, and both `on_leave` dispatch points, which
recompute it fresh since an on-leave ability is the leaving card's own trigger
regardless of what caused it to leave). Verified this stays correct across multi-step
effect chains and the async Fishing Rod/Unicorn Net intercept round-trip (captured into
the intercept's stored action object at offer-time, mirroring how `action.byMagic`
already worked) — confirmed via direct testing that the engine fully blocks all other
actions while any pendingEffect is open, so nothing else can interleave and go stale.
Added 5 regression tests covering both directions of the fix plus the genuinely
ambiguous `sacrifice_n_destroy_n` case both ways.

---

## ✅ DONE (highest-impact cases) — QOL 13 — "You may" effects with no skip option (user-reported)

User report: many optional card effects always trigger with no way to decline. A full
audit found ~121 cards with `optional:true` across ~75 distinct effect types — too many
to individually verify end-to-end in one pass, so this fix prioritized the
highest-impact, most clearly broken cases and added a generic safety net for the rest.

**Biggest single gap**: the client had **zero skip UI at all** for `choose_destroy` /
`choose_steal` / `choose_return`, which back 7+ cards (Stabby the Unicorn, Dragon
Unicorn, Berserkercorn, Paladin Unicorn, Alluring Narwhal, Shark With a Horn, and more)
and `move_upgrade_or_downgrade_between_stables` — clicking cards worked, but there was
no way to say "actually, don't." Fixed with explicit Skip buttons for all four, plus a
generic fallback Skip button for any other `pendingEffect.optional===true` case not
already handled — safe to add broadly since an unrecognized skip just surfaces a
harmless server error rather than corrupting anything.

**Worse — four cards were auto-executing with zero player input at all**, silently
ignoring `optional:true` entirely: Rainbow Unicorn (played a Basic Unicorn from hand
automatically), Mother Goose Unicorn (took a Nursery baby automatically), Chainsaw
Massicorn (drew cards automatically), and Americorn/Festive Flying Unicorn — whose
`pull_random_hand` additionally **never fired at all** even before that, since the
effect type wasn't in `playCard`'s target-requirement list and enter-triggered
Unicorns are specifically exempted from the other target-requirement list, so no
opponent was ever supplied for it to pull from. All four converted into proper
interactive `pendingEffect`s with confirm/skip; Americorn/Festive Flying Unicorn now
get a real opponent-picker (`choose_opponent_pull_random`) so the ability works at all.

**Also fixed**: missing `extra?.skip` support in 5 resolvers (`discard_two_steal_any`,
`move_downgrade_steal_upgrade`, `discard_search_magic_play`, `discard_then_steal`,
`play_upgrade_from_hand`) — `discard_then_steal`'s gated specifically on `eff.optional`
since Possession shares that type but is mandatory, so an unconditional skip would have
let Possession be wrongly declined too.

Added 15 regression tests. `test_all_cards.js` is now 230/230. **Not fully exhaustive**
given the scale — see CONTINUATION_PROMPT.md's Known Remaining Issues for the priority
checklist to apply if more gaps like these are found (the same three failure patterns:
missing `optional` on the queued pendingEffect, missing `extra?.skip` in the resolver,
or — worst — synchronous auto-execution that never checked `optional` at all).

---

## ✅ DONE — QOL 14 — Sadistic Ritual / sacrifice cards unselectable (user-reported)

User report: playing Sadistic Ritual, the player couldn't select a unicorn in their
stable to sacrifice — reported specifically for a stable containing only a Baby
Unicorn, with a request to check the same logic for all similar downgrade cards.

The server-side logic was already completely correct (a direct simulation of the exact
reported scenario — Sadistic Ritual plus a lone Baby Unicorn — sacrificed it and drew a
card without any issue). The real bug, confirmed by tracing the client's `Stable`
component, wasn't about Baby Unicorns at all: `selectable` for a card in **your own**
stable is `(highlight && !isMe) || (allowOwnClick && isMe)` — and `allowOwnClick` was
hardcoded to only ever be true for two unrelated effect types
(`move_upgrade_or_downgrade_between_stables`, `destroy_upgrade_or_sacrifice_downgrade`).
`needsSacrifice` — the flag that drives *every* sacrifice-type effect (Sadistic Ritual,
plain "sacrifice a unicorn," Glitter Bomb's sacrifice step, and others) — was never
included, so none of those effects could ever make your own stable cards clickable, for
any card type, in any stable composition. The Baby-Unicorn-only stable wasn't a special
case; it's just the specific one that got noticed and reported.

Fixed with a one-line addition: `allowOwnClick={needsSacrifice || ...}`. Safe to do
directly, since `needsSacrifice` is already correctly scoped to the affected player only
(a `pendingEffect` is only ever sent to the player it belongs to, so there's no risk of
this making a DIFFERENT player's own stable cards appear clickable for an effect that
isn't theirs).

---

## ✅ DONE — QOL 15 — Blatant Thievery unplayable (user-reported)

User report: pressing "Play" on Blatant Thievery in a 2-player game immediately errors
"select a target player first," with a request to also check 3+ player games since that
hadn't been tested.

Root cause: `App.jsx`'s `getCardTargetNeeds` — which decides whether to show a
target-player picker, or auto-select the only opponent in a 2-player game, before a
card can be played — was missing `'look_hand_take_one'` (Blatant Thievery's effect
type) from its player-target list entirely, even though the server's authoritative
`mustHavePlayer` list has always required a target player for it. Direct testing
confirmed this made the card **completely unplayable at every player count**, not just
2 — the 2-player report was simply the first one hit, exactly as the user suspected
when asking for 3+ players to be checked too. A second, related bug was found in the
same audit: `'destroy_all_basics_one_player'` was incorrectly present in the client's
*stable*-target list (checked first in the function, silently shadowing what should
have been its entry in the player-target list) — the same failure class, just not yet
reported.

Fixed by adding the two missing effect types to the client's player-target list and
removing the incorrect stable-target entry. Added regression tests confirming the full
play-and-resolve flow works in both 2-player and 3-player games.

Also added a new permanent guard: `server/test_client_server_target_consistency.js`.
This is the second bug this session (after QOL 14, in spirit) caused by two
independently-maintained lists silently drifting apart — one in the server
(`game.js`'s `mustHaveStable`/`mustHavePlayer`), one in the client (`App.jsx`'s
`getCardTargetNeeds`) — with nothing structurally forcing them to agree. The new test
statically parses both and fails immediately if the client is ever missing an entry the
server requires, so this specific failure mode (a card silently becoming completely
unplayable) shouldn't be able to recur unnoticed for any future card.

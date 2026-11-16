# Card-text audit

Source of truth: `unstable_unicorns_cards.csv`. Scope: 2nd Edition base deck + 7 expansions (the Control, Chaos, NSFW Base and Diamond
decks in the CSV are out of scope). Every unique card with an effect has at least one behavioural test in
`server/test_card_text_behavior.js` (run by `npm test`); each test is written from the printed text and asserts the final game state.

## Inventory
Deck names/quantities match the CSV exactly, including 8 cards that were missing and have been added: Heavenly Smite, Llamapocalypse, Overpopulation,
Storm of Cuteness, Ultimate Destruction (Rainbow Apocalypse), Dirty Mind ×2 (NSFW), Not-So-Secret Santacorn, Nutcrackercorn (Christmas).
(The Nightmares "Reference card" is not a playable card.)

## Rules confirmed with the project owner
- SACRIFICE: only cards in your own Stable. DESTROY: only cards in another player's Stable.
- Mystical Vortex / Reset Button: the played card itself stays in the discard pile after "shuffle the discard into the deck".

## Defects found and fixed (all covered by tests)
| Card(s) | Was | Now |
|---|---|---|
| Mermaid Unicorn | could return your own card; soft-lock with no target; "must" skippable | other players only; no-target fizzles; can't be skipped |
| Swift Flying Unicorn (+ any "revive Basic") | Neigh offered then rejected, lost | shared `_matchesTargetType` |
| Back Kick, Unicorn Nap, Hangover | could target yourself | "another player" enforced at play |
| Unicorn Poison, Dragon's Breath | could destroy non-Unicorns / protected Pandas | validated before the Neigh window |
| Unicorn Swap | could swap with yourself | other player only |
| Chain Lightning | could target your own Stable | other Stables only |
| Fire and Brimstone, Zombie Apocalypse (3+ players) | bot ignored the per-opponent restriction | bot respects `onlyPlayerId` |
| Stable Artillery | waited on a target that could not exist | no-target fizzle |
| Survivalist, Fuck. Marry. Kill, Dominatrix Whip | sacrificed/destroyed in the wrong Stable; silent skips | validated |
| Dragon Slayer Unicorn | placeholder only | enforced (source tagging) |
| Dragon Unicorn | only fired on sacrifice/destroy | fires on any "leaves your Stable" |
| Dragon Skies | shuffled the Unicorn into the deck | bottom of the deck |
| Dragon Kiss | fetched the Magic card but never played it (card also vanished) | played immediately, ends in discard |
| Flare Gun | cast as an action; made the target skip their whole turn | reaction window at turn start; target skips Beginning+Draw only |
| Naked Narwhal, Free Candy Unicorn | stolen Unicorn returned at your next turn, not when the card left | returns when the stealing card leaves your Stable |
| Berserkercorn | drawback missing | "if destroyed, SACRIFICE a Unicorn" |
| Divine Peace | placeholder only | owner cannot destroy |
| The Tiniest Unicorn | placeholder only | immune to Unicorn/Upgrade effects |
| Bungee Jumping Unicorn (b) | returned any card in your Stable | returns THIS card |
| Glowing Horn (b) | Unicorns only | any card that can enter a Stable |
| Unicorn Shovel (b) | auto-picked 2 Unicorns | you choose |
| Silver Tongue (b), Unicorn Caroler | took a RANDOM card | the other player chooses what to give |
| Mysterious Compass (a) | left a stray effect pending | clean |
| Extremely Small Backpack | never fired | any draw |
| Silver Lining | needed an extra empty "continue" call | advances normally |
| Pony Play | made the VICTIM skip their draw, even if nothing was pulled | you skip it, only if you pulled |
| The Bitchiest Unicorn | playable without a Basic Unicorn | restriction enforced |
| Friendly Snowmancorn | never sacrificed | sacrificed after you steal/destroy |
| Helper Elficorn | offered with any number of Unicorns | only with 4 or fewer |
| Baby Unicorns (Nightmares) | ignored "returned to your hand" | return to the Nursery |
| Demonicorn, Winged Horrorcorn | triggers missing | implemented |
| Paranormal Affection | placeholder only | Upgrades can't be destroyed |
| Rainbow Shitstorm | a card returned to hand during the sacrifice step (e.g. Annoying Flying Unicorn) was erased by the final deal | discarded with the hand, shuffled in |
| Supernatural Selection ("destroy all Basics") | **infinite loop / out-of-memory** when a Basic couldn't be destroyed (Rainbow Aura, Divine Peace…) | each Basic tried once |
| Critical Hit | replayed the last Magic card in the discard pile (wrong card if the played card discarded another Magic card) | replays the card that was played |
| The Cornjuring | offered no cards; unusable | search → pick → placed in the chosen player's Stable |

## Open questions (current behaviour kept; not changed)
1. **Magical Kittencorn** — CSV: "cannot be destroyed by Magic cards". The engine also protects it from Upgrade/Downgrade-caused destroys (an earlier session's
   reported fix; `test_all_cards.js` asserts it).
2. **Prismatic Bray** — CSV: "DISCARD up to 2 cards, then force up to 2 players to SACRIFICE a Unicorn". The engine ties the number of players to the number discarded.
3. **Orcicorn Raider / Charming Bardicorn / Polyamorous Unicorn** — the steal after the move can be skipped in the UI and the server accepts it; the text reads as one effect.
4. **Dragon Kiss, Wizard Unicorn, Flare Gun** are not Neigh-able: "immediately play it" resolves directly and Flare Gun has no Neigh window.
5. (Resolved) The bot playthrough suite's occasional out-of-memory/timeout was the Supernatural Selection loop above; 3,200 seeded bot games now finish with no hangs, crashes or lost cards.

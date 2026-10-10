'use strict';
// Static, heuristic cross-check of each card's PRINTED TEXT (description, as
// shown in the UI and matching the real game) against its EFFECT METADATA.
// This is deliberately separate from test_universal_card_audit.js, which only
// checks structural invariants (no crash, no duplication, no stall) — every
// bug found in review so far (Gift Inspector, Pestilence, Warlock Unicorn,
// Friendly Dragoncorn, Zombie Unicorn, Dragon's Blessing) was STRUCTURALLY
// fine — nothing crashed, nothing duplicated — but did the wrong THING
// relative to its own printed text. That's a different class of bug this
// script targets: text vs. implementation drift.
//
// This can't fully verify an implementation is correct — it's a heuristic
// triage pass that flags cards WORTH a human re-reading against game.js, not
// a proof of correctness. False positives are expected and fine; false
// negatives (missed real bugs) are the real risk, so checks are kept broad.
const { createDeck } = require('./cards');
const { getExpansionCards, EXPANSIONS } = require('./expansions');
const fs = require('fs');

const ALL = [...createDeck(), ...getExpansionCards(Object.keys(EXPANSIONS))];
const seen = new Map();
for (const c of ALL) if (!seen.has(c.name)) seen.set(c.name, c);
const cards = [...seen.values()];

const gameSrc = fs.readFileSync(__dirname + '/game.js', 'utf8');

const flags = [];
function flag(card, rule, detail) {
  flags.push({ name: card.name, expansion: card.expansion, type: card.effect?.type, rule, detail });
}

for (const card of cards) {
  const d = card.description || '';
  const e = card.effect || {};

  // ── Rule 1: "may" (optional language) but effect isn't marked optional ──
  // Caught Friendly Dragoncorn's forced-autodraw bug exactly. Skip passives
  // (ongoing abilities, not a one-time choice) and skip_turn-type wording
  // ("you may skip") which read differently.
  if (/\bmay\b/i.test(d) && !/\bmay not\b/i.test(d) && e.trigger !== 'passive' && !e.optional) {
    flag(card, 'MAY_NOT_OPTIONAL', `text says "may" but effect.optional is not set — verify this is actually presented as a choice, not forced`);
  }

  // ── Rule 2: "each (other )?player" + discard/sacrifice, no "random" wording ──
  // Caught Unicorn of Pestilence's random-discard bug exactly. The real-game
  // convention: unless text explicitly says "at random"/"randomly"/"you
  // choose", the AFFECTED player picks their own card.
  if (/each (other )?player|force(s)? (each|another|a) (other )?player/i.test(d)
      && /discard|sacrifice/i.test(d)
      && !/random/i.test(d)) {
    flag(card, 'POSSIBLE_RANDOM_SHOULD_BE_CHOICE', `text implies affected player(s) pick their own card, but says nothing about randomness — verify effect.type "${e.type}" routes through a *_choice pattern (discard_choice / sacrifice_choice), not _discardRandom / random selection, in game.js`);
  }

  // ── Rule 3: "immediately end your turn" — resolution must actually end it ──
  // Caught Zombie Unicorn's stuck-phase bug exactly.
  if (/end(s)? your turn/i.test(d)) {
    flag(card, 'ENDS_TURN_TEXT', `text says it ends the turn — verify the resolution path actually calls _advanceTurn()/_endPhase(), not just clears pendingEffect`);
  }

  // ── Rule 4: "no effect" / neutralizes another card type — check all the
  // places that type of card's effects get evaluated, not just one ──
  // Caught Dragon's Blessing's incomplete downgrade-neutering exactly.
  if (/have no effect|has no effect|no longer have any effect/i.test(d)) {
    flag(card, 'NEUTRALIZES_OTHER_CARDS', `text neutralizes another card category — verify EVERY place that category's effects are evaluated (passives, beginning-phase triggers, enter triggers, static modifiers) respects this, not just the "can it be played" check`);
  }

  // ── Rule 5: "any number" (of cards/unicorns) — needs real multi-select ──
  // Caught Warlock Unicorn's single-card-only bug (client-side, but the
  // server-side type is the trail to follow).
  if (/any number/i.test(d) && e.type) {
    const serverHandlesArray = new RegExp(`type===['"]${e.type}['"][^}]*sel\\.`,'s').test(gameSrc)
      || new RegExp(`'${e.type}'[\\s\\S]{0,400}sel\\.length`).test(gameSrc);
    flag(card, 'ANY_NUMBER', `text says "any number" — verify both the server (array-based selection, not single id) and client (actual multi-select UI, not single-click-resolves) support it. Quick server-side signal: looks array-aware = ${serverHandlesArray}`);
  }

  // ── Rule 6: beginning-of-turn trigger — resolution must return to Draw
  // phase (doneB), not end the action phase (done) ──
  // Caught Gift Inspector's turn-skip bug exactly.
  if (e.trigger === 'beginning') {
    flag(card, 'BEGINNING_TRIGGER', `beginning-phase trigger — verify every resolution path for effect.type "${e.type}" (including shared/reused effect types like look_deck_return_order) calls doneB()/_effectDoneBeginning, not done()/_effectDone, unless the card's own text explicitly ends the turn (see rule 3)`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────
const byRule = {};
for (const f of flags) (byRule[f.rule] ??= []).push(f);

console.log(`\nAudited ${cards.length} unique cards. ${flags.length} flags across ${Object.keys(byRule).length} rules.\n`);
for (const [rule, items] of Object.entries(byRule)) {
  console.log(`\n━━━ ${rule} (${items.length}) ━━━`);
  for (const f of items) {
    console.log(`  • ${f.name}${f.expansion ? ` [${f.expansion}]` : ''} — type: ${f.type || '(none)'}`);
  }
}

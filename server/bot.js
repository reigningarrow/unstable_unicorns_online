// bot.js — AI opponent decision engine for Unstable Unicorns Online
//
// Design notes (read this before touching resolveEffect):
// The game engine has ~100 distinct pendingEffect types (see game.js
// resolvePendingEffect). Hand-writing bespoke, fully-informed logic for every
// single one is not practical, so this module uses two tiers:
//   Tier 1 — hand-written handlers for the shapes that cover the large
//            majority of real gameplay (discard, sacrifice, destroy/steal,
//            search/pick, intercepts, beginning choices, and all the named
//            "choice_*" cards).
//   Tier 2 — a generic heuristic trial-and-error fallback for everything
//            else: it builds a prioritized list of plausible (sel, extra)
//            candidates from the same card-scoring building blocks and
//            submits them to the REAL resolvePendingEffect, stopping at the
//            first one that isn't rejected. game.js validates before it
//            mutates anything (every case checks its inputs before acting),
//            so a rejected candidate is a no-op — this can never corrupt
//            state, it just occasionally picks a legal-but-not-optimal
//            option for rare/exotic cards instead of getting stuck.
//
// Everything here is pure decision-making — it calls the same public Game
// methods a real client would (playCard, drawCard, resolvePendingEffect,
// playInstant, resolveNeigh, actionDrawCard). It never reaches into private
// engine internals.

const IS_UNICORN = t => ['baby_unicorn', 'basic_unicorn', 'magical_unicorn'].includes(t);

// ── Card / board scoring ──────────────────────────────────────────────────
// A simple, transparent value model — good enough to consistently prefer
// "keep my good stuff / take their good stuff" without pretending to fully
// understand every one of ~475 cards' text.
function cardValue(card) {
  if (!card) return 0;
  const e = card.effect;
  if (IS_UNICORN(card.type)) {
    let v = (e?.type === 'count_as_two' || e?.type === 'count_double') ? 4 : 2;
    if (card.type === 'magical_unicorn') v += 1;
    if (e) v += 1; // has some ability/passive worth something
    if (e?.trigger === 'passive') v += 1; // protective/ongoing effects are strong
    return v;
  }
  if (card.type === 'upgrade') {
    let v = 1.5;
    if (e?.trigger === 'passive') v += 1.5; // shields, blockers etc.
    return v;
  }
  if (card.type === 'downgrade') return 0.4; // a liability to whoever holds it
  if (e?.type === 'neigh' || e?.type === 'neigh_remove_from_game') return 1.3; // worth keeping in hand
  return 1; // generic magic/instant in hand
}

function stableValue(game, pid) {
  return game.players[pid].stable.reduce((s, c) => s + cardValue(c), 0);
}

// Opponents ordered by threat (closest to winning first).
function opponentsByThreat(game, pid) {
  return game.playerOrder
    .filter(p => p !== pid)
    .sort((a, b) => (game._unicornCount(b) - game._unicornCount(a)) || (stableValue(game, b) - stableValue(game, a)));
}

function bestStableTarget(game, pid, { targetType, playerPool } = {}) {
  const pool = playerPool || opponentsByThreat(game, pid);
  let best = null, bestScore = -1, bestPid = null;
  for (const opid of pool) {
    for (const c of game.players[opid].stable) {
      if (targetType === 'unicorn' && !IS_UNICORN(c.type)) continue;
      if (targetType === 'upgrade' && c.type !== 'upgrade') continue;
      if (targetType === 'downgrade' && c.type !== 'downgrade') continue;
      const v = cardValue(c);
      if (v > bestScore) { bestScore = v; best = c; bestPid = opid; }
    }
  }
  return best ? { targetPlayerId: bestPid, targetCardId: best.id, card: best } : null;
}

function worstFrom(list, { targetType } = {}) {
  let worst = null, worstScore = Infinity;
  for (const c of list) {
    if (targetType === 'unicorn' && !IS_UNICORN(c.type)) continue;
    if (targetType === 'upgrade' && c.type !== 'upgrade') continue;
    if (targetType === 'downgrade' && c.type !== 'downgrade') continue;
    const v = cardValue(c);
    if (v < worstScore) { worstScore = v; worst = c; }
  }
  return worst;
}

function bestFrom(list) {
  let best = null, bestScore = -1;
  for (const c of list) { const v = cardValue(c); if (v > bestScore) { bestScore = v; best = c; } }
  return best;
}

function worstHandCards(game, pid, n, opts = {}) {
  const hand = [...game.players[pid].hand];
  const picked = [];
  for (let i = 0; i < n && hand.length; i++) {
    const w = worstFrom(hand, opts);
    if (!w) break;
    picked.push(w.id);
    hand.splice(hand.findIndex(c => c.id === w.id), 1);
  }
  return picked;
}

function worstStableCards(game, pid, n, opts = {}) {
  const stable = [...game.players[pid].stable];
  const picked = [];
  for (let i = 0; i < n && stable.length; i++) {
    const w = worstFrom(stable, opts);
    if (!w) break;
    picked.push(w.id);
    stable.splice(stable.findIndex(c => c.id === w.id), 1);
  }
  return picked;
}

// ── Difficulty knobs ───────────────────────────────────────────────────────
// Easy: plays fairly passively, rarely uses optional/aggressive options, never
//   neighs, targets are picked with much more randomness.
// Medium: solid fundamentals — builds its stable, takes obviously-good trades,
//   neighs only big threats.
// Hard: consistently targets the leading opponent, takes essentially every
//   value-positive option, neighs aggressively and counters with Super Neigh.
function difficultyConfig(difficulty) {
  switch (difficulty) {
    case 'easy':   return { aggression: 0.25, neighChance: 0.05, optionalUseChance: 0.35, randomness: 0.55 };
    case 'hard':   return { aggression: 0.95, neighChance: 0.65, optionalUseChance: 0.9,  randomness: 0.05 };
    case 'medium':
    default:       return { aggression: 0.6,  neighChance: 0.3,  optionalUseChance: 0.6,  randomness: 0.25 };
  }
}

function chance(p) { return Math.random() < p; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Turn actions (beginning / draw / action phase) ─────────────────────────

function takeTurnAction(game, pid, difficulty) {
  const cfg = difficultyConfig(difficulty);
  if (game.phase === 'draw') { return !!game.drawCard(pid)?.ok; }
  if (game.phase !== 'action') return false;

  const player = game.players[pid];
  const candidates = [];
  for (const card of player.hand) {
    const play = planCardPlay(game, pid, card, cfg);
    if (play) candidates.push(play);
  }

  // Occasionally (more often on Easy) just draw instead of playing, to avoid
  // being a perfectly-optimal machine every single turn.
  if (!candidates.length || chance(cfg.randomness * 0.4)) {
    const r = game.actionDrawCard(pid);
    if (r?.ok) return true;
    if (!candidates.length) return false; // truly nothing else to do
  }

  candidates.sort((a, b) => b.score - a.score);
  // Some randomness on lower difficulties: occasionally pick from the top few
  // rather than always the single best.
  const pool = candidates.slice(0, Math.max(1, Math.round(1 + cfg.randomness * 3)));
  const chosen = pick(pool);
  const r = game.playCard(pid, chosen.card.id, chosen.targetPlayerId || null, chosen.targetCardId || null);
  if (r?.ok) return true;
  // Fallback: if our chosen play was somehow rejected, just draw.
  const dr = game.actionDrawCard(pid);
  return !!dr?.ok;
}

// Score + build a legal playCard() call for a hand card, or return null if we
// don't want to / can't play it right now.
function planCardPlay(game, pid, card, cfg) {
  const type = card.type;
  const e = card.effect;
  if (type === 'baby_unicorn') return null; // babies live in the nursery, not hand-playable

  if (type === 'basic_unicorn' || type === 'magical_unicorn') {
    let score = 6 + cardValue(card);
    if (type === 'magical_unicorn') score += 1; // usually has an ability on top of counting
    return { card, score, targetPlayerId: null, targetCardId: null };
  }

  if (type === 'upgrade') {
    let score = 4 + cardValue(card);
    return { card, score, targetPlayerId: null, targetCardId: null };
  }

  if (type === 'downgrade') {
    // Downgrades always need a target player (mustHavePlayer in game.js).
    const opp = opponentsByThreat(game, pid)[0];
    if (!opp) return null;
    return { card, score: 3 + cfg.aggression * 3, targetPlayerId: opp, targetCardId: null };
  }

  if (type === 'magic' || type === 'instant') {
    if (e?.type === 'neigh' || e?.type === 'neigh_remove_from_game') return null; // held for reactive use, not played proactively
    return planMagicPlay(game, pid, card, cfg);
  }

  return null;
}

// mustHaveStable / mustHavePlayer effect-type sets, mirrored from game.js
// playCard() so we generate legal target requirements rather than guessing.
const MUST_HAVE_STABLE = new Set(['steal', 'destroy', 'return_to_hand', 'return_to_deck',
  'sacrifice_self_destroy_unicorn', 'move_own_unicorn_steal_unicorn', 'destroy_then_target_may_destroy',
  'remove_from_game', 'pull_random_hand']);
const MUST_HAVE_PLAYER = new Set(['skip_turn', 'trade_hands', 'move_unicorn_any_stable_not_own',
  'destroy_all_basics_one_player', 'look_hand_take_one', 'look_and_take']);

function planMagicPlay(game, pid, card, cfg) {
  const e = card.effect;
  const t = e?.type;
  const isEnterTrigger = false; // magic/instant cards are never enter-triggers
  let targetPlayerId = null, targetCardId = null;
  let score = 3;

  if (t && MUST_HAVE_STABLE.has(t)) {
    const wantSteal = t === 'steal';
    const targetType = wantSteal ? undefined : undefined; // most direct-destroy magic isn't type-restricted at play time
    const target = bestStableTarget(game, pid);
    if (!target) return null; // nothing worth targeting (or nothing at all in play)
    targetPlayerId = target.targetPlayerId; targetCardId = target.targetCardId;
    score += cardValue(target.card) * (wantSteal ? 1.4 : 1.2) * cfg.aggression;
  } else if (t && MUST_HAVE_PLAYER.has(t)) {
    const opp = opponentsByThreat(game, pid)[0];
    if (!opp) return null;
    targetPlayerId = opp;
    score += 2 * cfg.aggression;
  } else {
    // Everything else either needs no target at play time, or resolves an
    // enter/queued interactive effect afterward (handled by resolveEffect).
    score += 2;
  }
  return { card, score, targetPlayerId, targetCardId };
}

// ── Neigh / Super Neigh decisions ──────────────────────────────────────────

function maybeNeigh(game, pid, difficulty) {
  const cfg = difficultyConfig(difficulty);
  const hand = game.players[pid].hand;
  const neighCard = hand.find(c => c.effect?.type === 'neigh' || c.effect?.type === 'neigh_remove_from_game');
  if (!neighCard) return false;
  const played = game.pendingCard?.card;
  if (!played) return false;
  // Only bother countering things that actually hurt us or help an opponent a lot.
  const threatensMe = game.pendingCard?.targetPlayerId === pid;
  const isBigUnicornOrMagic = IS_UNICORN(played.type) || played.type === 'magic';
  const worthIt = threatensMe || (isBigUnicornOrMagic && cfg.aggression > 0.4);
  if (!worthIt) return false;
  if (!chance(cfg.neighChance)) return false;
  const r = game.playInstant(pid, neighCard.id);
  return !!r?.ok;
}

function maybeSuperNeigh(game, pid, difficulty) {
  const cfg = difficultyConfig(difficulty);
  const hand = game.players[pid].hand;
  const neighCard = hand.find(c => c.effect?.type === 'neigh' || c.effect?.type === 'neigh_remove_from_game');
  if (!neighCard) return false;
  // Super Neigh un-does the Neigh, letting the original card go through — so it's
  // most attractive when the original card was OUR play, or otherwise good for us.
  const originalPlayerId = game.pendingCard?.playerId;
  const iPlayedIt = originalPlayerId === pid;
  const worthIt = iPlayedIt || chance(cfg.aggression * 0.5);
  if (!worthIt) return false;
  if (!chance(cfg.neighChance)) return false;
  const r = game.playInstant(pid, neighCard.id);
  return !!r?.ok;
}

// ── Choice-card ('choice_*') heuristics ─────────────────────────────────────
// Mirrors the card meanings the client shows as "[a] ... or [b] ..." labels
// (see App.jsx) so the bot can make a sensible pick rather than a blind guess.
function pickChoice(game, pid, eff, cfg) {
  const opp = opponentsByThreat(game, pid)[0];
  const oppStable = opp ? game.players[opp].stable : [];
  const me = game.players[pid];
  switch (eff.type) {
    case 'choice_steal_baby_or_revive_basic':
      return oppStable.some(c => c.type === 'baby_unicorn') ? 'a' : 'b';
    case 'choice_discard_hand_draw3_or_trade_hands':
      return 'a';
    case 'choice_steal_upgrade_or_move_downgrade':
      return oppStable.some(c => c.type === 'upgrade') ? 'a'
        : me.stable.some(c => c.type === 'downgrade') ? 'b' : 'a';
    case 'choice_force_all_discard_or_draw':
      return cfg.aggression > 0.4 ? 'a' : 'b';
    case 'choice_sacrifice_destroy_or_revive_from_discard': {
      const target = bestStableTarget(game, pid);
      const haveSacrifice = me.stable.some(c => IS_UNICORN(c.type));
      return (target && haveSacrifice && cfg.aggression > 0.3) ? 'a' : 'b';
    }
    case 'choice_draw3_discard1_or_add_from_discard': {
      const best = bestFrom(game.discard);
      return (best && cardValue(best) >= 3) ? 'b' : 'a';
    }
    case 'choice_discard3_extra_turn_or_move_steal_unicorn':
      return me.hand.length >= 4 ? 'a' : 'b';
    case 'choice_reveal_all_hands_or_take_from_all':
      return cfg.aggression > 0.3 ? 'b' : 'a';
    case 'choice_revive_unicorn_or_two_unicorns_to_hand':
      return 'a';
    case 'choice_sacrifice_downgrade_or_return_hand':
      return me.stable.some(c => c.type === 'downgrade') ? 'a' : 'b';
    case 'choice_draw_two_or_play_basic':
      return 'b';
    default:
      return chance(0.5) ? 'a' : 'b';
  }
}

// ── Tier 1: hand-written pendingEffect handlers ─────────────────────────────
// Each returns { sel, extra } or null (meaning "skip / can't help", fall to
// Tier 2). Handlers intentionally stay simple and reuse the scoring helpers
// above rather than re-deriving card-specific strategy for every one.

function discardHandler(game, pid, eff, cfg) {
  const n = eff.amount || 1;
  return { sel: worstHandCards(game, pid, n) };
}

function sacrificeUnicornHandler(game, pid, eff) {
  const sel = worstStableCards(game, pid, 1, { targetType: 'unicorn' });
  return sel.length ? { sel } : null;
}

function sacrificeAnyHandler(game, pid, eff) {
  const sel = worstStableCards(game, pid, 1);
  return sel.length ? { sel } : null;
}

function destroyOrStealHandler(game, pid, eff, cfg) {
  const target = bestStableTarget(game, pid, { targetType: eff.targetType });
  if (!target) return { extra: { skip: true } }; // may_destroy_optional etc. allow skipping
  return { extra: { targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } };
}

function pickFromOptionsHandler(game, pid, eff) {
  const options = eff.options || [];
  const best = bestFrom(options);
  if (best && cardValue(best) > 0) return { sel: [best.id] };
  return { sel: [] }; // decline — legal for search/from-discard picks
}

const TIER1_HANDLERS = {
  return_one_each_stable: (game, pid, eff) => {
    const remaining = eff.remaining || [];
    if (!remaining.length) return null;
    const target = bestStableTarget(game, pid, { playerPool: remaining });
    return target ? { extra: { targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } } : null;
  },
  discard: discardHandler,
  discard_choice: discardHandler,
  end_discard: discardHandler,
  discard_extra_turn_pending: discardHandler,
  target_discard: discardHandler,
  discard_for_extra_turn: discardHandler,
  sacrifice_unicorn: sacrificeUnicornHandler,
  sacrifice_any: sacrificeAnyHandler,
  sacrifice_unicorn_then_draw: sacrificeUnicornHandler,
  sacrifice_basic_draw_three: (game, pid) => {
    const stable = game.players[pid].stable.filter(c => c.type === 'basic_unicorn');
    const w = worstFrom(stable);
    return w ? { sel: [w.id] } : null;
  },
  sacrifice_unicorn_draw_three: sacrificeUnicornHandler,
  sacrifice_self_revive_unicorn: sacrificeUnicornHandler,
  choose_destroy: destroyOrStealHandler,
  may_destroy_optional: (game, pid, eff, cfg) => {
    const target = bestStableTarget(game, pid, { targetType: eff.targetType });
    if (!target || cardValue(target.card) < 1.5) return { extra: { skip: true } };
    return { extra: { targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } };
  },
  choose_steal: destroyOrStealHandler,
  choose_return: destroyOrStealHandler,
  search_deck_pick: pickFromOptionsHandler,
  from_discard_pick: pickFromOptionsHandler,
  search_nightmare_downgrade_into_stable: pickFromOptionsHandler,
  steal_downgrade: destroyOrStealHandler,
  steal_baby: destroyOrStealHandler,
  beginning_optional_choices: (game, pid, eff, cfg) => {
    const sel = (eff.choices || [])
      .filter(() => chance(cfg.optionalUseChance))
      .map(c => c.cardId);
    return { sel };
  },
  intercept_offer: (game, pid, eff, cfg) => {
    // eff.kind is 'steal' or 'destroy'; decide whether it's worth grabbing the
    // targeted card into our own hand/stable instead of letting it happen.
    const worthIt = chance(cfg.aggression * 0.7 + 0.15);
    return { extra: { intercept: worthIt } };
  },
  critical_hit_optional: (game, pid, eff, cfg) => ({ extra: { skip: !chance(cfg.optionalUseChance) } }),

  // ── destroy_upgrade_or_sacrifice_downgrade (Chainsaw Unicorn etc.) ────────
  // Targets an Upgrade (destroy) or Downgrade (sacrifice) in ANY stable —
  // never a unicorn — so the generic destroy/steal helper needs a type filter.
  destroy_upgrade_or_sacrifice_downgrade: (game, pid, eff) => {
    const upg = bestStableTarget(game, pid, { targetType: 'upgrade' });
    const dwn = bestStableTarget(game, pid, { targetType: 'downgrade' });
    const target = upg || dwn;
    if (!target) return { extra: { skip: true } };
    return { extra: { targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } };
  },
  move_downgrade_to_opponent: (game, pid, eff) => {
    const sel = worstStableCards(game, pid, 1, { targetType: 'downgrade' });
    const opp = opponentsByThreat(game, pid)[0];
    if (!sel.length || !opp) return null;
    return { sel, extra: { targetPlayerId: opp } };
  },
  move_upgrade_or_downgrade_between_stables: (game, pid) => {
    // Prefer pulling an opponent's Upgrade onto our own stable; otherwise ship
    // one of our own Downgrades off onto the leading opponent.
    const theirUpgrade = bestStableTarget(game, pid, { targetType: 'upgrade' });
    if (theirUpgrade) {
      return { extra: { sourcePlayerId: theirUpgrade.targetPlayerId, sourceCardId: theirUpgrade.targetCardId, targetPlayerId: pid } };
    }
    const ownDowngrade = worstFrom(game.players[pid].stable, { targetType: 'downgrade' });
    const opp = opponentsByThreat(game, pid)[0];
    if (ownDowngrade && opp) return { extra: { sourcePlayerId: pid, sourceCardId: ownDowngrade.id, targetPlayerId: opp } };
    return null;
  },
  move_own_unicorn_steal_unicorn: (game, pid) => {
    const mine = worstFrom(game.players[pid].stable, { targetType: 'unicorn' });
    const target = bestStableTarget(game, pid, { targetType: 'unicorn' });
    if (!mine || !target) return null;
    return { sel: [mine.id], extra: { targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } };
  },
  sacrifice_then_destroy_one: (game, pid, eff) => {
    if (!eff.sacrificeDone) {
      const sel = worstStableCards(game, pid, 1);
      return sel.length ? { sel } : null;
    }
    const target = bestStableTarget(game, pid);
    if (!target) return null;
    return { extra: { targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } };
  },
  discard_n_steal_unicorn: (game, pid, eff) => {
    const needed = eff.needed || 2;
    if (!eff.discardDone) {
      const sel = worstHandCards(game, pid, needed);
      return sel.length >= Math.min(needed, game.players[pid].hand.length) ? { sel } : null;
    }
    const target = bestStableTarget(game, pid, { targetType: 'unicorn' });
    if (!target) return null;
    return { extra: { targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } };
  },
  discard_unicorn_revive_unicorn_end_turn: (game, pid) => {
    const unicorn = game.players[pid].hand.find(c => IS_UNICORN(c.type));
    return unicorn ? { sel: [unicorn.id] } : null;
  },
  fuck_marry_kill: (game, pid, eff) => {
    if (!eff.step1Done) {
      const me = game.players[pid];
      if (!me.hand.length) return { sel: [], extra: {} }; // engine auto-skips this step when hand is empty
      const worst = worstFrom(me.hand);
      const opp = opponentsByThreat(game, pid)[0];
      if (!worst || !opp) return null;
      return { sel: [worst.id], extra: { targetPlayerId: opp } };
    }
    const target = bestStableTarget(game, pid, { targetType: 'unicorn' }) || bestStableTarget(game, pid);
    if (!target) return null;
    return { extra: { targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } };
  },

  // ── choice_* cards — exact per-type field requirements (see game.js) ─────
  choice_steal_baby_or_revive_basic: (game, pid, eff, cfg) => {
    const babyTarget = (() => {
      for (const opid of opponentsByThreat(game, pid)) {
        const b = game.players[opid].stable.find(c => c.type === 'baby_unicorn');
        if (b) return { targetPlayerId: opid, targetCardId: b.id };
      }
      return null;
    })();
    if (babyTarget) return { extra: { choice: 'a', ...babyTarget } };
    return { extra: { choice: 'b' } };
  },
  choice_discard_hand_draw3_or_trade_hands: (game, pid, eff, cfg) => {
    const choice = pickChoice(game, pid, eff, cfg);
    if (choice === 'b') {
      const opp = opponentsByThreat(game, pid)[0];
      if (opp) return { extra: { choice: 'b', targetPlayerId: opp } };
    }
    return { extra: { choice: 'a' } };
  },
  choice_steal_upgrade_or_move_downgrade: (game, pid, eff, cfg) => {
    const upgTarget = bestStableTarget(game, pid, { targetType: 'upgrade' });
    if (upgTarget) return { extra: { choice: 'a', targetPlayerId: upgTarget.targetPlayerId, targetCardId: upgTarget.targetCardId } };
    const ownDowngrade = worstFrom(game.players[pid].stable, { targetType: 'downgrade' });
    const opp = opponentsByThreat(game, pid)[0];
    if (ownDowngrade && opp) return { sel: [ownDowngrade.id], extra: { choice: 'b', targetPlayerId: opp } };
    return null;
  },
  choice_force_all_discard_or_draw: (game, pid, eff, cfg) => ({ extra: { choice: cfg.aggression > 0.4 ? 'a' : 'b' } }),
  choice_sacrifice_destroy_or_revive_from_discard: (game, pid, eff, cfg) => {
    const target = bestStableTarget(game, pid);
    const haveSacrifice = game.players[pid].stable.some(c => IS_UNICORN(c.type));
    return { extra: { choice: (target && haveSacrifice && cfg.aggression > 0.3) ? 'a' : 'b' } };
  },
  choice_draw3_discard1_or_add_from_discard: (game, pid, eff) => {
    const best = bestFrom(game.discard);
    return { extra: { choice: (best && cardValue(best) >= 3) ? 'b' : 'a' } };
  },
  choice_discard3_extra_turn_or_move_steal_unicorn: (game, pid) => {
    const me = game.players[pid];
    if (me.hand.length >= 4) return { extra: { choice: 'a' } };
    const mine = worstFrom(me.stable, { targetType: 'unicorn' });
    const target = bestStableTarget(game, pid, { targetType: 'unicorn' });
    if (mine && target) return { extra: { choice: 'a' } }; // fall back to the safe no-target option
    return { extra: { choice: 'a' } };
  },
  choice_reveal_all_hands_or_take_from_all: (game, pid, eff, cfg) => ({ extra: { choice: cfg.aggression > 0.3 ? 'b' : 'a' } }),
  choice_revive_unicorn_or_two_unicorns_to_hand: () => ({ extra: { choice: 'a' } }),
  choice_sacrifice_downgrade_or_return_hand: (game, pid) => {
    const me = game.players[pid];
    const downgrade = me.stable.find(c => c.type === 'downgrade');
    if (downgrade) return { extra: { choice: 'a', targetCardId: downgrade.id } };
    const any = worstFrom(me.stable);
    if (any) return { extra: { choice: 'b', targetCardId: any.id } };
    return { extra: { skip: true } };
  },
  choice_draw_two_or_play_basic: (game, pid) => {
    const basic = game.players[pid].hand.find(c => c.type === 'basic_unicorn');
    if (basic) return { sel: [basic.id], extra: { choice: 'b' } };
    return { extra: { choice: 'a' } };
  },
};

// ── Tier 2: generic heuristic trial-and-error fallback ──────────────────────
// Builds a prioritized list of candidate (sel, extra) shapes and submits each
// to the real resolvePendingEffect until one is accepted. See module header.
function genericResolve(game, pid, eff, cfg) {
  const me = game.players[pid];
  const target = bestStableTarget(game, pid);
  const targetUnicorn = bestStableTarget(game, pid, { targetType: 'unicorn' });
  const opp = opponentsByThreat(game, pid)[0];
  const amount = eff.amount || eff.needed || 1;

  const selCandidates = [
    [],
    worstHandCards(game, pid, amount),
    worstHandCards(game, pid, 1),
    worstHandCards(game, pid, 1, { targetType: 'unicorn' }),
    worstHandCards(game, pid, 2),
    worstHandCards(game, pid, 3),
    worstStableCards(game, pid, 1, { targetType: 'unicorn' }),
    worstStableCards(game, pid, 1, { targetType: 'downgrade' }),
    worstStableCards(game, pid, 1),
    (eff.options || []).length ? [bestFrom(eff.options).id] : [],
  ];

  const extraCandidates = [
    {},
    { skip: true },
    { confirm: true },
    { intercept: false },
    opp ? { targetPlayerId: opp } : {},
    target ? { targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } : {},
    targetUnicorn ? { targetPlayerId: targetUnicorn.targetPlayerId, targetCardId: targetUnicorn.targetCardId } : {},
    { choice: 'a' },
    { choice: 'b' },
    target ? { choice: 'a', targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } : {},
    target ? { choice: 'b', targetPlayerId: target.targetPlayerId, targetCardId: target.targetCardId } : {},
  ];

  let attempts = 0;
  for (const sel of selCandidates) {
    for (const extra of extraCandidates) {
      if (++attempts > 150) break;
      const r = game.resolvePendingEffect(pid, sel, extra);
      if (r && !r.error) return true;
    }
  }
  // Absolute last resort — try truly empty input once more in case an earlier
  // candidate's non-empty sel/extra was itself what tripped a validator.
  const r = game.resolvePendingEffect(pid, [], {});
  return !!(r && !r.error);
}

// Tracks consecutive resolution failures per pendingEffect object, for the
// circuit breaker in resolveMyEffect below.
const STUCK_EFFECT_COUNTS = new WeakMap();

function resolveMyEffect(game, pid, difficulty) {
  const eff = game.pendingEffect;
  if (!eff || eff.playerId !== pid) return false;
  const cfg = difficultyConfig(difficulty);
  const handler = TIER1_HANDLERS[eff.type];
  if (handler) {
    const out = handler(game, pid, eff, cfg);
    if (out) {
      const r = game.resolvePendingEffect(pid, out.sel || [], out.extra || {});
      if (r && !r.error) return true;
    }
  }
  if (genericResolve(game, pid, eff, cfg)) return true;

  // Circuit breaker: every avenue above failed for this exact pendingEffect object.
  // Rather than let one rare/unanticipated card interaction freeze the whole room
  // forever, track repeated failures on the same effect and force it closed after a
  // few tries — a graceful (if imperfect) fallback beats an indefinitely stuck game.
  const failCount = (STUCK_EFFECT_COUNTS.get(eff) || 0) + 1;
  STUCK_EFFECT_COUNTS.set(eff, failCount);
  if (failCount >= 4) {
    console.error(`[bot] Could not resolve pendingEffect type "${eff.type}" for ${pid} after ${failCount} attempts — forcing it closed.`);
    if (typeof game._effectDoneBeginning === 'function' && game.phase === 'beginning') game._effectDoneBeginning(pid);
    else if (typeof game._effectDone === 'function') game._effectDone();
    else { game.pendingEffect = null; game.pendingEffectQueue = []; }
    return true;
  }
  return false;
}

// Minimum time (ms) a neigh/super-neigh window must stay open before a bot,
// as the window's own owner, is allowed to close it — long enough for a human
// opponent sharing the game to notice and click Neigh if they want to.
// Only enforced when at least one human is actually in the game; an all-bot
// game closes windows immediately since nobody needs the reaction time.
const MIN_HUMAN_NEIGH_WAIT_MS = 30000;

function gameHasHumanPlayer(game) {
  return game.playerOrder.some(id => !game.players[id]?.isBot);
}

// ── Top-level entry point ───────────────────────────────────────────────────
// Called repeatedly by index.js's bot scheduler. Performs at most one action
// per call and reports what kind of thing it did, so the caller can pick an
// appropriate "thinking time" delay before ticking again.
function runBotStep(game, pid, difficulty) {
  if (!game || game.winner) return { acted: false };
  const player = game.players[pid];
  if (!player || !player.isBot) return { acted: false };

  // 1. Our own pending effect always takes priority.
  if (game.pendingEffect && game.pendingEffect.playerId === pid) {
    return { acted: resolveMyEffect(game, pid, difficulty), kind: 'effect' };
  }
  // Don't act on anything else while ANY effect belonging to someone else is
  // open — that player (bot or human) needs to resolve it first.
  if (game.pendingEffect) return { acted: false };

  // 2. Neigh window: someone else's card was just played — decide whether to
  //    counter it, unless it's our own window to eventually resolve.
  if (game.neighWindow && game.pendingCard && game.pendingCard.playerId !== pid) {
    return { acted: maybeNeigh(game, pid, difficulty), kind: 'neigh_decision' };
  }
  if (game.superNeighWindow && game.superNeighPendingCard && game.superNeighPendingCard.playerId !== pid) {
    return { acted: maybeSuperNeigh(game, pid, difficulty), kind: 'superneigh_decision' };
  }
  // 3. We're the one who must eventually close the window — but not before a
  //    human opponent has had a real chance to react. Without this, a bot
  //    playing a card against a human (with no other bot around to occupy the
  //    tick loop's normal "thinking" delay) would close its own neigh window
  //    on the very next tick, well under a second after opening it.
  if (game.neighWindow && game.pendingCard?.playerId === pid) {
    if (gameHasHumanPlayer(game)) {
      const elapsed = Date.now() - (game.neighWindowOpenedAt || 0);
      if (elapsed < MIN_HUMAN_NEIGH_WAIT_MS) {
        return { acted: true, kind: 'neigh_wait', waitMs: MIN_HUMAN_NEIGH_WAIT_MS - elapsed };
      }
    }
    return { acted: !!game.resolveNeigh(pid)?.ok, kind: 'neigh_resolve' };
  }
  if (game.superNeighWindow && game.superNeighPendingCard?.playerId === pid) {
    if (gameHasHumanPlayer(game)) {
      const elapsed = Date.now() - (game.neighWindowOpenedAt || 0);
      if (elapsed < MIN_HUMAN_NEIGH_WAIT_MS) {
        return { acted: true, kind: 'neigh_wait', waitMs: MIN_HUMAN_NEIGH_WAIT_MS - elapsed };
      }
    }
    return { acted: !!game.resolveNeigh(pid)?.ok, kind: 'superneigh_resolve' };
  }

  // 4. Our turn.
  if (game.currentPlayer === pid) {
    if (game.phase === 'end' && typeof game._endPhase === 'function') {
      // Should be rare — normally whatever set phase to 'end' also calls _endPhase()
      // itself. This is a safety net in case some code path didn't (or a cross-player
      // effect finished in a way that left it dangling) — calling it again is safe and
      // either queues an end_discard effect or advances the turn.
      game._endPhase();
      return { acted: true, kind: 'end_phase_recovery' };
    }
    return { acted: takeTurnAction(game, pid, difficulty), kind: 'turn_action' };
  }

  return { acted: false };
}

module.exports = { runBotStep, cardValue, stableValue, difficultyConfig };

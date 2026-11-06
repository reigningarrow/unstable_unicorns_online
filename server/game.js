// game.js — Unstable Unicorns game engine (fully fixed)

const { createDeck, createBabyUnicornDeck, shuffle, CARD_TYPES, EFFECTS } = require('./cards');
const { getExpansionCards, EXPANSIONS } = require('./expansions');

const PHASES = { WAITING:'waiting', BEGINNING:'beginning', DRAW:'draw', ACTION:'action', END:'end', GAME_OVER:'game_over' };
const IS_UNICORN = t => [CARD_TYPES.BABY_UNICORN, CARD_TYPES.BASIC_UNICORN, CARD_TYPES.MAGICAL_UNICORN].includes(t);

// Minimum time (ms) a Neigh/Super Neigh window must stay open before the acting
// player (the one whose card is pending, or whose Neigh most recently stood) is
// allowed to resolve/close it. Without this, the acting player — who sees the
// "Let it play" button immediately — could click it before an opponent holding a
// Neigh card even has a chance to react. bot.js already respects this exact
// value for bot-controlled actors; enforcing it here as well makes sure a human
// acting player can't shortcut past it.
const MIN_NEIGH_WAIT_MS = 30000;

// ── Shield (replacement-effect) rules ────────────────────────────────────────
// "If <a card> would be destroyed/sacrificed, you MAY <pay a cost> instead."
// One row per shield card family, replacing eight hand-copied if-blocks that
// lived inside _sacrificeCard/_destroyCard (and, in Black Knight's case, did
// something other than what the card says).
//   match : which card effect this row describes
//   scope : whose loss it can prevent — 'self' (only the shield itself),
//           'unicorn' (any OTHER Unicorn card in the owner's Stable),
//           'any' (any card in the owner's Stable)
//   how   : which kinds of removal it replaces
//   cost  : what the owner pays instead — discard N cards (their choice of
//           which), or sacrifice the shield card itself
const SHIELD_RULES = [
  // Unicorn Phoenix
  { match: e => e.trigger==='on_would_sac_destroy' && e.type==='discard_instead',      scope:'self',    how:['destroy','sacrifice'], cost:{ kind:'discard', n:1 } },
  // Dragon Protection
  { match: e => e.type==='discard_instead_of_destroy',                                scope:'any',     how:['destroy'],             cost:{ kind:'discard', n:1 } },
  // Magic Elixir
  { match: e => e.trigger==='on_sac_or_destroy' && e.type==='discard_instead',        scope:'any',     how:['destroy','sacrifice'], cost:{ kind:'discard', n:1 } },
  // Unicorn Survival Kit
  { match: e => e.trigger==='on_sac_or_destroy' && e.type==='discard_two_instead',    scope:'unicorn', how:['destroy','sacrifice'], cost:{ kind:'discard', n:2 } },
  // Blow Up Unicorn
  { match: e => e.trigger==='on_sac_or_destroy' && e.type==='sacrifice_self_instead', scope:'unicorn', how:['destroy','sacrifice'], cost:{ kind:'sacrifice_self' } },
  // Black Knight Unicorn: "you may SACRIFICE this card instead"
  { match: e => e.type==='shield_from_destroy',                                       scope:'unicorn', how:['destroy'],             cost:{ kind:'sacrifice_self' } },
];

class Game {
  constructor(roomId) {
    this.id = roomId;
    this.players = {};
    this.playerOrder = [];
    this.currentPlayerIndex = 0;
    this.phase = PHASES.WAITING;
    this.deck = [];
    this.discard = [];
    this.nursery = [];
    this.winner = null;
    this.log = [];
    this.pendingEffect = null;
    this.pendingEffectQueue = [];
    this.neighWindow = false;
    this.neighWindowOpenedAt = null; // Date.now() timestamp of when neighWindow/superNeighWindow
                                      // most recently opened — used to enforce a minimum time
                                      // before a bot is allowed to auto-close its own window,
                                      // so a human opponent has a real chance to react.
    this.neighPassed = new Set(); // playerIds who've explicitly declined to Neigh the
                                   // currently-open window (see passNeigh()); reset whenever
                                   // the window (re)opens.
    this.pendingCard = null;
    this.superNeighWindow = false;
    this.superNeighPendingCard = null;
    this.neighChain = []; // full sequence of {card, playerId} Neigh plays in the current chain (superNeighPendingCard always mirrors the last entry, for client compat)
    this.maxPlayers = 8;
    this.minPlayers = 2;
    this.skippedPlayers = new Set();
    this._endTurnAfterEffects = false; // set by _endTurnNow() while reactions are still resolving
    this.skippedActionPlayers = new Set();
    this.skippedDrawPlayers = new Set();
    this.extraTurns = {};
    this.removedFromGame = [];
    this.extraActionsThisTurn = 0;
    this.actionsUsedThisTurn = 0;
    this.settings = { expansions:[], winCondition:7, localMode:false, debugMode:false };
    // Tracks whether the card-effect chain CURRENTLY resolving originated from a
    // Magic/Instant/Upgrade/Downgrade card (true) or a Unicorn card's own ability
    // (false). Set at each dispatch entry point (_enterTrigger, _queueBeginningEffect,
    // _executeMagic, on_leave dispatch) based on the triggering card's type, and read
    // by _destroyCard's Magical Kittencorn check instead of a per-call-site literal —
    // see that check for why a single dispatch-time flag (rather than threading a
    // parameter through every intermediate call) is both correct and far less invasive
    // here: pendingEffect resolution is exclusive to one chain at a time, and
    // _maybeIntercept already captures this value into its stored `action` object at
    // offer-time, so it stays correct even across an async intercept round-trip.
    this._kittenProtects = false;
  }

  addPlayer(pid, name, opts={}) {
    if (Object.keys(this.players).length >= this.maxPlayers) return { error:'Game is full' };
    if (this.phase !== PHASES.WAITING) return { error:'Game already started' };
    const isBot = !!opts.isBot;
    const botDifficulty = ['easy','medium','hard'].includes(opts.botDifficulty) ? opts.botDifficulty : 'medium';
    this.players[pid] = { id:pid, name, hand:[], stable:[], isHost:Object.keys(this.players).length===0, connected:true,
      isBot, ...(isBot ? { botDifficulty } : {}) };
    this.playerOrder.push(pid);
    this.addLog(`${name} joined${isBot ? ` (bot — ${botDifficulty})` : ''}`);
    return { ok:true };
  }
  // Bots get an internally-generated id (never exposed as a "reconnect token" since
  // nothing ever needs to reconnect as a bot) — callers just get the id back so they
  // can broadcast state / reference it if needed (e.g. for a "remove bot" button).
  addBot(name, difficulty) {
    const pid = 'bot_' + Math.random().toString(36).slice(2, 10);
    const botName = (name && typeof name === 'string' && name.trim()) ? name.trim().slice(0, 24) : 'Bot';
    const r = this.addPlayer(pid, botName, { isBot:true, botDifficulty: difficulty });
    if (r.error) return r;
    return { ok:true, playerId: pid };
  }
  removeBot(pid) {
    if (this.phase !== PHASES.WAITING) return { error:'Cannot remove players after the game has started' };
    const p = this.players[pid];
    if (!p || !p.isBot) return { error:'Not a bot' };
    delete this.players[pid];
    this.playerOrder = this.playerOrder.filter(x => x !== pid);
    // If the bot happened to be host (shouldn't normally happen — bots are never
    // added first — but guard anyway), hand host to the next real/earliest player.
    if (p.isHost && this.playerOrder.length) this.players[this.playerOrder[0]].isHost = true;
    this.addLog(`${p.name} (bot) removed`);
    return { ok:true };
  }
  removePlayer(pid) {
    const p = this.players[pid];
    if (!p) return;
    p.connected = false;
    this.addLog(`${p.name} disconnected`);
    // If the disconnected player was host and the game hasn't started yet, the
    // lobby would otherwise be stuck forever — nobody else can start the game
    // or change settings while waiting for a host who may never come back.
    // Hand host to another connected player (mirrors removeBot()'s handoff).
    if (p.isHost && this.phase === PHASES.WAITING) {
      const next = this.playerOrder.find(id => id !== pid && this.players[id]?.connected);
      if (next) {
        p.isHost = false;
        this.players[next].isHost = true;
        this.addLog(`${this.players[next].name} is now the host`);
      }
    }
  }
  reconnectPlayer(pid) { if (this.players[pid]) this.players[pid].connected=true; }
  updateSettings(s) {
    if (this.phase !== PHASES.WAITING) return { error:'Already started' };
    if (s.expansions !== undefined) {
      // Must be an array of known expansion id strings — anything else (object, string,
      // number, unknown ids) is silently dropped rather than stored and later crashing
      // getExpansionCards()/startGame() when it's finally iterated over.
      this.settings.expansions = Array.isArray(s.expansions)
        ? s.expansions.filter(id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(EXPANSIONS, id))
        : [];
    }
    if (s.winCondition !== undefined) {
      const n = Number(s.winCondition);
      this.settings.winCondition = Number.isFinite(n) ? Math.min(10, Math.max(4, Math.trunc(n))) : this.settings.winCondition ?? 7;
    }
    if (s.localMode !== undefined)    this.settings.localMode    = !!s.localMode;
    if (s.debugMode !== undefined)    this.settings.debugMode    = !!s.debugMode;
    return { ok:true };
  }

  startGame() {
    if (Object.keys(this.players).length < this.minPlayers) return { error:`Need at least ${this.minPlayers} players` };
    const baseCards = createDeck().filter(c => c.type !== CARD_TYPES.BABY_UNICORN);
    const expCards  = getExpansionCards(this.settings.expansions).filter(c => c.type !== CARD_TYPES.BABY_UNICORN);
    this.deck = shuffle([...baseCards, ...expCards]);
    const baseBabies = createBabyUnicornDeck();
    const expBabies  = getExpansionCards(this.settings.expansions).filter(c => c.type === CARD_TYPES.BABY_UNICORN);
    this.nursery = shuffle([...baseBabies, ...expBabies]);
    for (const pid of this.playerOrder) {
      this.players[pid].stable = [this.nursery.pop()];
      this.players[pid].hand   = this.deck.splice(0, 5);
    }
    this.playerOrder = shuffle(this.playerOrder);
    this.currentPlayerIndex = 0;
    this.phase = PHASES.BEGINNING;
    this.addLog(`Game started! ${this.settings.expansions.length ? '+' + this.settings.expansions.join(', ') : '(base)'}`);
    if (this.settings.localMode) this.addLog('LOCAL MODE: all hands visible');
    if (this.settings.debugMode) this.addLog('DEBUG MODE: enabled');
    this.addLog('Turn order: ' + this.playerOrder.map(p=>this.players[p]?.name).join(' → '));
    this._beginningPhase();
    return { ok:true };
  }

  debugAction(pid, action, payload) {
    if (!this.settings.debugMode) return { error:'Debug mode not enabled' };
    if (!this.players[pid]?.isHost) return { error:'Only host can use debug actions' };
    switch(action) {
      case 'draw_specific': {
        const target = payload.targetPlayerId || this.currentPlayer;
        const idx = this.deck.findIndex(c => c.id === payload.cardId);
        if (idx === -1) return { error:'Card not in deck' };
        this.players[target].hand.push(this.deck.splice(idx, 1)[0]);
        this.addLog(`[DEBUG] ${this.players[target].name} draws specific card`);
        return { ok:true };
      }
      case 'skip_turn': { this._advanceTurn(); this.addLog(`[DEBUG] Turn skipped`); return { ok:true }; }
      case 'set_phase': { this.phase = payload.phase; this.addLog(`[DEBUG] Phase → ${payload.phase}`); return { ok:true }; }
      case 'clear_pending': {
        this.pendingEffect = null; this.pendingEffectQueue = [];
        this.neighWindow = false; this.pendingCard = null; this.neighWindowOpenedAt = null;
        this.superNeighWindow = false; this.superNeighPendingCard = null; this.neighChain = [];
        this.addLog(`[DEBUG] Pending cleared`); return { ok:true };
      }
      case 'set_action_phase': {
        this.phase = PHASES.ACTION; this.addLog(`[DEBUG] Action phase set`); return { ok:true };
      }
      case 'win_now': {
        const w = payload.playerId || pid;
        this.phase = PHASES.GAME_OVER; this.winner = w;
        this.addLog(`[DEBUG] ${this.players[w].name} wins!`);
        return { ok:true, gameOver:true, winner:w };
      }
      default: return { error:`Unknown debug action: ${action}` };
    }
  }

  _getPassives(pid) {
    const passives = [];
    const neutralized = this._unicornsNeutralized(pid);
    const stable = this.players[pid]?.stable || [];
    // Dragon's Blessing: "Downgrade cards in your Stable have no effect." Detected
    // directly from the stable (rather than via _hasPassive, to avoid recursing
    // into this same function) so every Downgrade card's passive-derived effect
    // below can be skipped — not just new ones blocked from being played.
    const downgradesNeutered = stable.some(c => c.effect?.trigger==='passive' && c.effect?.type==='downgrades_have_no_effect');
    for (const card of stable) {
      const e = card.effect;
      if (!e) continue;
      // Blinding Light (and similarly-worded "no effects" cards) suppress a Unicorn's
      // own abilities — the neutralizing card itself is always a Downgrade, so it's
      // never filtered out by this check.
      if (neutralized && IS_UNICORN(card.type)) continue;
      if (downgradesNeutered && card.type === CARD_TYPES.DOWNGRADE) continue;
      if (e.trigger === 'passive') {
        passives.push({ ...e, sourceCard:card });
        // Cards like Ginormous Unicorn store secondary restrictions in e.restriction
        if (e.restriction) passives.push({ type:e.restriction, trigger:'passive', sourceCard:card });
        // Index PROTECTION passives under their protectsFrom key so _hasPassive() can find them.
        // e.g. Rainbow Aura (protectsFrom:'destroy') → 'protect_from_destroy'
        //      Magical Kittencorn (protectsFrom:'magic_destroy') → 'protect_from_magic_destroy'
        if (e.type === 'protection' && e.protectsFrom) {
          passives.push({ type:'protect_from_' + e.protectsFrom, trigger:'passive', sourceCard:card });
        }
      }
      if (e.passive) passives.push({ ...e.passive, sourceCard:card });
      // Index protection triggers as passives so _hasPassive() can query them
      if (e.trigger === 'on_sac_or_destroy')         passives.push({ type:e.type, trigger:e.trigger, optional:e.optional, sourceCard:card });
      if (e.trigger === 'on_would_sac_destroy')       passives.push({ type:e.type, trigger:e.trigger, optional:e.optional, sourceCard:card });
      if (e.trigger === 'on_sac_destroy_return_hand') passives.push({ type:e.type, trigger:e.trigger, sourceCard:card });
      if (e.onLeave?.type === 'return_to_hand_self')  passives.push({ type:'return_to_hand_self', trigger:'on_leave', sourceCard:card });
      if (e.trigger === 'on_unicorn_enter_or_leave')   passives.push({ type:'on_unicorn_enter_or_leave', trigger:e.trigger, sourceCard:card, amount:e.amount });
      if (e.trigger === 'passive' && e.type === 'shield_from_destroy') passives.push({ type:'shield_from_destroy', trigger:'passive', sourceCard:card });
      if (e.trigger === 'on_magic_play')  passives.push({ type:e.type, trigger:e.trigger, sourceCard:card });
      if (e.trigger === 'on_unicorn_destroyed') passives.push({ type:e.type, trigger:e.trigger, sourceCard:card });
      if (e.trigger === 'on_unicorn_enter') passives.push({ type:'on_unicorn_enter', trigger:e.trigger, sourceCard:card, amount:e.amount });
      if (e.trigger === 'on_upgrade_enter') passives.push({ type:'on_upgrade_enter', trigger:e.trigger, sourceCard:card, amount:e.amount });
    }
    return passives;
  }
  _hasPassive(pid, type) { return this._getPassives(pid).some(p => p.type === type); }
  _getPassiveCard(pid, type) { return this._getPassives(pid).find(p => p.type === type)?.sourceCard || null; }
  _unicornsNeutralized(pid) {
    // Only Blinding Light / Medieval Sanitation ("...considered Basic Unicorns with
    // NO EFFECTS") actually strip a unicorn's own abilities. Pandamonium ("...considered
    // Pandas") and Oh Deer ("...considered Reindeer") only change the card's TYPE for
    // targeting/protection and win-condition purposes — their printed text says nothing
    // about suppressing effects, so they must NOT be treated the same way here.
    return (this.players[pid]?.stable||[]).some(c =>
      c.effect?.type === 'unicorns_are_basic' ||
      (c.effect?.trigger==='passive' && c.effect?.type === 'unicorns_are_basic')
    );
  }
  // Pandamonium ("Cards that affect Unicorn cards do not affect your Pandas") and Oh Deer
  // (same wording, Reindeer) make every Unicorn card in that player's Stable immune to
  // OTHER effects that specifically act on Unicorn cards — steal/destroy/sacrifice-a-
  // Unicorn, forced mass-sacrifice, etc. — while it remains in their Stable. It's a type
  // change for targeting purposes only, not an ability suppression (see _unicornsNeutralized).
  _unicornsProtectedByType(pid) {
    return (this.players[pid]?.stable||[]).some(c =>
      c.effect?.type === 'unicorns_are_pandas' || c.effect?.type === 'unicorns_are_reindeer'
    );
  }
  // Whether `card`, sitting in player `pid`'s Stable, is a valid target for an effect that
  // "affects Unicorn cards" (steal/destroy/sacrifice a Unicorn, etc). Use this instead of a
  // bare IS_UNICORN(card.type) check anywhere such an effect selects/validates a card from a
  // player's STABLE — cards in hand/deck/discard are never Pandas/Reindeer (the rule only
  // covers "your Unicorns" while they're in your Stable under the passive).
  _isTargetableUnicorn(pid, card) {
    return IS_UNICORN(card.type) && !this._unicornsProtectedByType(pid);
  }

  // "STEAL a Baby/Basic Unicorn" effects: which cards could the acting player legally pick?
  // (another player's Stable only, and only Unicorns that aren't protected from being targeted.)
  _stealTargetsOfType(pid, type) {
    const out = [];
    for (const p of this.playerOrder) {
      if (p === pid) continue;
      for (const c of this.players[p].stable) if (c.type === type && this._isTargetableUnicorn(p, c)) out.push({ pid:p, card:c });
    }
    return out;
  }

  // Validates the card the player clicked for a "steal a <type>" effect. Returns {} when it's a
  // legal pick, or {error} telling them what to repick — never silently does nothing (which used
  // to end the effect, and with it the turn, on a mis-click).
  _checkStealPick(pid, extra, type, label) {
    const tp = this.players[extra.targetPlayerId];
    const card = tp?.stable.find(c => c.id === extra.targetCardId);
    if (!tp || !card) return { error:`Card not found — pick a ${label} in another player's Stable` };
    if (extra.targetPlayerId === pid) return { error:`You can't steal from your own Stable — pick a ${label} in another player's Stable` };
    if (card.type !== type) return { error:`${card.name} isn't a ${label} — pick a ${label} in another player's Stable` };
    if (!this._isTargetableUnicorn(extra.targetPlayerId, card)) return { error:`${card.name} can't be targeted right now — pick another ${label}` };
    return {};
  }

  // Is there at least one Unicorn the acting player could pick as a target?
  // (othersOnly: stealing never targets your own Stable.) Used so a "discard N, THEN
  // steal/destroy a Unicorn" effect doesn't leave a player stuck on a pick that
  // can't be made once the discard has been paid.
  _hasUnicornTarget(pid, othersOnly) {
    return this.playerOrder.some(p => (!othersOnly || p !== pid) &&
      this.players[p].stable.some(c => this._isTargetableUnicorn(p, c)));
  }

  _queueEffect(eff) {
    if (!this.pendingEffect) this.pendingEffect = eff;
    else this.pendingEffectQueue.push(eff);
  }

  // Used wherever pendingEffectQueue is discarded outright (e.g. an endTurnAfter/
  // immediate-turn-end effect firing while something else happens to be queued behind
  // it). Any cards sitting in a queued effect's .options were extracted from a zone
  // (deck/discard) pending a player's choice — return them to discard so they aren't
  // silently lost. Exception: take_one_from_list's options are a LIVE reference into
  // cards that are simultaneously still sitting in this.discard (a valid "here's what
  // got discarded, take one back" design, not an extraction) — pushing those again
  // would create an in-array duplicate rather than rescuing anything.
  _salvageQueuedOptions() {
    for (const queued of this.pendingEffectQueue) {
      if (queued?.options && queued.type !== 'take_one_from_list') this.discard.push(...queued.options);
    }
  }

  // ── Intercept instants (Adventures: Fishing Rod / Unicorn Net) ─────────────
  // Finds the first other player (search order starting right after byPid,
  // wrapping around) holding the matching counter-instant in hand.
  // kind: 'steal' -> Fishing Rod, 'destroy' -> Unicorn Net.
  _findInterceptHolder(byPid, kind) {
    const cardName = kind === 'steal' ? 'Fishing Rod' : 'Unicorn Net';
    const order = this.playerOrder;
    const startIdx = order.indexOf(byPid);
    for (let i = 1; i <= order.length; i++) {
      const p = order[(startIdx + i) % order.length];
      if (p === byPid) continue;
      const card = (this.players[p]?.hand || []).find(c => c.name === cardName);
      if (card) return { pid: p, card };
    }
    return null;
  }
  // Opens an intercept window if an eligible player holds the counter-instant.
  // Returns true if the original steal/destroy/sacrifice was DEFERRED — caller
  // must NOT execute the action itself; resolution happens through
  // resolvePendingEffect's 'intercept_offer' case once the holder accepts or
  // declines (declining performs the original action via the stored `action`).
  // opts:
  //   resumeType: 'destroy'|'sacrifice'|'steal' — which underlying function to call on decline
  //               (defaults to 'steal' for kind='steal', else 'destroy')
  //   advance:    'done'|'doneB'|'endTurn' — how to close the effect once resolved (default 'done')
  //   thenDraw:   N — draw N cards after the action resolves (either branch), e.g. Ancient Ritual
  //   thenDiscardPick: {targetType} — run _discardPick after the action resolves (accept branch skips this,
  //               since the underlying cost was itself intercepted and never completed)
  //   continuation: { type, ... } — resumed via _runContinuation after the effect closes (for loops)
  _maybeIntercept(kind, byPid, tPid, tCid, byMagic=false, opts={}) {
    const holder = this._findInterceptHolder(byPid, kind);
    if (!holder) return false;
    const resumeType = opts.resumeType || (kind === 'steal' ? 'steal' : 'destroy');
    const advance = opts.advance || 'done';
    this._queueEffect({ type:'intercept_offer', playerId:holder.pid, kind,
      interceptCardId:holder.card.id,
      action:{ ...opts, resumeType, byPid, tPid, tCid, byMagic, kittenProtects:this._kittenProtects, advance } });
    this.addLog(`${this.players[holder.pid].name} may play ${holder.card.emoji} ${holder.card.name} to intercept!`);
    return true;
  }
  // Runs a stored continuation once an intercept_offer (or the action it deferred) has closed.
  // Used for multi-target loop effects (e.g. Spray Bottle of Youth) so each target still gets
  // its own intercept window without unrolling the whole loop into pendingEffect state.
  // wasIntercepted: true if the holder accepted (redirected the card) rather than declining
  // (declining means the original sacrifice/destroy/steal actually happened).
  _runContinuation(cont, wasIntercepted) {
    if (!cont) return;
    if (cont.type === 'destroy_all_basics_step') {
      this._processDestroyAllBasics(cont.byPid, cont.targetId);
    } else if (cont.type === 'multi_sacrifice_step') {
      // On decline, the generic intercept resolver already performed the sacrifice for us —
      // credit it toward the running count before resuming the loop.
      const count = cont.sacrificedCount + (wasIntercepted ? 0 : 1);
      this._processMultiSacrifice(cont.pid, cont.cardIds, cont.index, count, cont.thenType);
    } else if (cont.type === 'requeue') {
      // Generic: re-queues a fully-formed pendingEffect for the next step of a chain
      // (e.g. advancing a multi-player sacrifice queue) once the intercept has closed.
      this._queueEffect(cont.effect);
    }
  }
  // Generalized multi-card sacrifice loop (e.g. "sacrifice up to 4 unicorns, then search
  // for that many" / "sacrifice any number, then destroy that many"). Each card gets its
  // own intercept window; a card grabbed by an interceptor doesn't count toward the
  // resulting count (it wasn't actually sacrificed). thenType selects what to queue once
  // the loop completes: 'sacrifice_four_search_four' or 'sacrifice_n_destroy_n'.
  _processMultiSacrifice(pid, cardIds, index, sacrificedCount, thenType) {
    for (let i = index; i < cardIds.length; i++) {
      const cid = cardIds[i];
      if (!this.players[pid].stable.some(c => c.id === cid)) continue; // already gone
      const intercepted = this._maybeIntercept('destroy', pid, pid, cid, false, {
        resumeType: 'sacrifice',
        continuation: { type:'multi_sacrifice_step', pid, cardIds, index:i+1, sacrificedCount, thenType }
      });
      if (intercepted) return; // resumes via intercept_offer -> _runContinuation
      this._sacrificeCard(pid, cid);
      sacrificedCount++;
    }
    this.addLog(`${this.players[pid].name} sacrifices ${sacrificedCount} card${sacrificedCount===1?'':'s'}`);
    if (sacrificedCount > 0) {
      if (thenType === 'sacrifice_n_destroy_n') {
        this._queueEffect({ type:'sacrifice_n_destroy_n', playerId:pid, sacrificeDone:true, destroyCount:sacrificedCount });
      } else {
        this._queueEffect({ type:'sacrifice_four_search_four', playerId:pid, sacrificeDone:true, searchCount:sacrificedCount });
      }
    }
  }
  // "Destroy all basics in one player's stable" effects. Each basic gets its own intercept
  // window; re-filters the stable each iteration since it shrinks as cards are removed
  // (no need to track a fixed id list upfront).
  _processDestroyAllBasics(byPid, targetId) {
    const tp = this.players[targetId];
    while (true) {
      const next = tp.stable.find(c => c.type === CARD_TYPES.BASIC_UNICORN);
      if (!next) break;
      const intercepted = this._maybeIntercept('destroy', byPid, targetId, next.id, false, {
        continuation: { type:'destroy_all_basics_step', byPid, targetId }
      });
      if (intercepted) return; // resumes via intercept_offer -> _runContinuation
      this._destroyCard(targetId, next.id, byPid);
    }
    this.addLog(`${this.players[byPid].name} destroys all basics in ${tp.name}'s stable`);
  }
  _effectDone() {
    this.pendingEffect = null;
    if (this.pendingEffectQueue.length > 0) {
      this.pendingEffect = this.pendingEffectQueue.shift();
      return;
    }
    if (this._endTurnAfterEffects) { this._advanceTurn(); return; }
    this.phase = PHASES.END;
    this._endPhase();
  }
  _effectDoneBeginning(pid) {
    this.pendingEffect = null;
    if (this.pendingEffectQueue.length > 0) {
      this.pendingEffect = this.pendingEffectQueue.shift();
      return;
    }
    if (this._endTurnAfterEffects) { this._advanceTurn(); return; }
    this.phase = PHASES.DRAW;
    // Log the actual current-turn player, not necessarily `pid` — a chained
    // beginning-phase effect can end up resolved by a DIFFERENT player than
    // whoever's turn it is (e.g. Bitchiest Unicorn queues a discard_choice for
    // the targeted opponent; it's their resolvePendingEffect call that finally
    // drains the queue here, but it's still the acting player's Draw Phase).
    const turnPlayer = this.players[this.playerOrder[this.currentPlayerIndex]] || this.players[pid];
    this.addLog(`${turnPlayer?.name}'s turn — Draw Phase`);
  }

  // A temp-stolen Unicorn went back to its owner when the thief's next turn began
  // (see _advanceTurn). Fire the reactions that move implies — the thief's Stable lost a
  // Unicorn, the owner's gained one — now that queueing effects is safe. Runs with the
  // phase set to BEGINNING so each reaction exits through doneB() back to the Draw phase.
  _fireReturnedTempStealHooks() {
    const returned = this._returnedTempSteals;
    if (!returned || returned.length === 0) return;
    this._returnedTempSteals = [];
    this.phase = PHASES.BEGINNING;
    for (const r of returned) {
      this._onUnicornLeft(r.from, r.card);
      this._onUnicornEntered(r.to, r.card);
    }
    for (const e of [this.pendingEffect, ...this.pendingEffectQueue]) if (e && e.fromBeginning === undefined) e.fromBeginning = true;
    const win = this.winner || this._checkWin();   // the owner may have just regained a winning Unicorn
    if (win && !this.winner) { this.winner = win; this.addLog(`🎉 ${this.players[win].name} wins!`); }
    if (this.winner) { this.phase = PHASES.GAME_OVER; this.pendingEffect = null; this.pendingEffectQueue = []; }
  }

  _beginningPhase() {
    const pid = this.currentPlayer;
    if (!pid) return;
    const player = this.players[pid];
    this.extraActionsThisTurn = 0;
    this.actionsUsedThisTurn  = 0;
    if (this.skippedPlayers.has(pid)) { this.skippedPlayers.delete(pid); this.addLog(`${player.name} skips their turn`); this._advanceTurn(); return; }
    this._fireReturnedTempStealHooks();
    if (this.phase === PHASES.GAME_OVER) return;
    if (this._hasPassive(pid,'skip_beginning_phase')) {
      this.addLog(`${player.name} skips Beginning phase`);
      this.phase = this.pendingEffect ? PHASES.BEGINNING : PHASES.DRAW;   // a returned-card reaction may still need answering
      return;
    }
    const beginCards = player.stable.filter(c => c.effect?.trigger === 'beginning' && !(c.type === CARD_TYPES.DOWNGRADE && this._hasPassive(pid,'downgrades_have_no_effect')));
    if (beginCards.length === 0) {
      if (this.pendingEffect) { this.phase = PHASES.BEGINNING; return; }
      this.phase=PHASES.DRAW; this.addLog(`${player.name}'s turn — Draw Phase`); return;
    }
    const required = beginCards.filter(c => !c.effect?.optional);
    const optional = beginCards.filter(c => c.effect?.optional);
    for (const card of required) this._queueBeginningEffect(card, pid);
    if (optional.length > 0) {
      this._queueEffect({ type:'beginning_optional_choices', playerId:pid,
        choices: optional.map(c => ({ cardId:c.id, cardName:c.name, description:c.description, effect:c.effect })) });
    }
    this.phase = PHASES.BEGINNING;
    this.addLog(`${player.name}'s Beginning phase`);
    if (!this.pendingEffect) { this.phase=PHASES.DRAW; this.addLog(`${player.name}'s turn — Draw Phase`); }
  }

  _queueBeginningEffect(card, pid) {
    const e = card.effect;
    const player = this.players[pid];
    this._kittenProtects = (card.type === CARD_TYPES.UPGRADE || card.type === CARD_TYPES.DOWNGRADE);
    switch(e.type) {
      // "DISCARD a card" (Dragon's Curse, Autoerotic Asphyxiation) — the
      // owner's own choice of which card, not a random pick.
      case EFFECTS.DISCARD: this._queueEffect({ type:'discard_choice', playerId:pid, amount:e.amount||1, source:card.name, fromBeginning:true }); break;
      case 'sacrifice_unicorn_draw': this._queueEffect({ type:'sacrifice_unicorn_then_draw', playerId:pid, draw:e.draw||1 }); break;
      case 'move_hand_card_to_bottom_deck': this._queueEffect({ type:'move_hand_to_bottom_deck', playerId:pid }); break;
      case EFFECTS.DESTROY: this._queueEffect({ type:'beginning_destroy_end_turn', playerId:pid, optional:e.optional, targetType:e.targetType||'unicorn' }); break;
      case 'move_self_steal_and_draw': this._queueEffect({ type:'move_self_steal_and_draw', playerId:pid, sourceCardId:card.id }); break;
      // Claw Machine: discard 1, then draw 1
      case 'discard_then_draw': this._queueEffect({ type:'discard_then_draw_beginning', playerId:pid, draw:e.draw||1, optional:e.optional }); break;
      // Caffeine Overload: sacrifice a unicorn, then draw 2
      // Caffeine Overload: "SACRIFICE a card" — ANY stable card, not restricted
      // to Unicorns (that restriction belongs to Sadistic Ritual's separate
      // "SACRIFICE a Unicorn card" text, which correctly uses a different type
      // below) — was incorrectly sharing the unicorn-only handler.
      case 'sacrifice_then_draw': this._queueEffect({ type:'sacrifice_any', playerId:pid, thenDraw:e.draw||2, optional:e.optional, fromBeginning:true, source:card.name }); break;
      // Double Dutch: play an extra card this turn (grants extra action on draw)
      case 'play_two_cards': this.extraActionsThisTurn = (this.extraActionsThisTurn||0) + 1; this.addLog(`${player.name}: Double Dutch — play 2 cards this turn`); break;
      // Nightmare: Existential Dread: steal a downgrade from opponent's stable
      case 'steal_downgrade': this._queueEffect({ type:'steal_downgrade', playerId:pid, optional:e.optional, fromBeginning:true }); break;
      // Glitter Bomb: sacrifice 1, destroy 1 (beginning phase)
      case 'sacrifice_then_destroy': this._queueEffect({ type:'sacrifice_then_destroy_one', playerId:pid, optional:e.optional, fromBeginning:true }); break;
      // Dragon's Fortune: optionally sacrifice itself for an extra turn
      case 'sacrifice_self_take_extra_turn': this._queueEffect({ type:'sacrifice_self_take_extra_turn', playerId:pid, sourceCardId:card.id }); break;
      // Dragon Skies: move a unicorn from any stable to bottom of deck, that player draws 1
      case 'move_unicorn_to_deck_draw': this._queueEffect({ type:'move_unicorn_to_deck_draw', playerId:pid }); break;
      // Special Delivery: take a baby from nursery, skip action phase
      case 'nursery_skip_action': this._queueEffect({ type:'nursery_skip_action', playerId:pid }); break;
      // Bitchiest Unicorn: force target opponent to discard 1
      case 'force_opponent_discard': this._queueEffect({ type:'force_opponent_discard', playerId:pid, amount:e.amount||1 }); break;
      // Polyamorous Unicorn: move self to another stable and steal a unicorn
      case 'move_self_steal_unicorn': this._queueEffect({ type:'move_self_steal_unicorn', playerId:pid, sourceCardId:card.id }); break;
      // Pony Play: pull random from target, target skips draw phase
      case 'pull_random_skip_draw': this._queueEffect({ type:'pull_random_skip_draw', playerId:pid }); break;
      // Gift Inspector: look at top 2, return in any order
      case 'look_top_two_return_any_order': { const top=this.deck.splice(0,2); if(top.length>0){this._queueEffect({type:'look_deck_return_order',playerId:pid,options:top,fromBeginning:true});} break; }
      // Adventures: sacrifice unicorn, draw 3 (Ancient Ritual)
      case 'sacrifice_unicorn_draw_three': this._queueEffect({ type:'sacrifice_unicorn_draw_three', playerId:pid }); break;
      // Adventures: sacrifice self (the upgrade card), then steal a unicorn (Pit Covered in Leaves)
      case 'sacrifice_self_steal_unicorn': this._queueEffect({ type:'sacrifice_self_steal_unicorn', playerId:pid, sourceCardId:card.id }); break;
      // Adventures: pull random card from target instead of drawing (Royal Hooves)
      case 'pull_random_instead_of_draw': this._queueEffect({ type:'pull_random_instead_of_draw', playerId:pid }); break;
      // Adventures: discard 1, then pull random from opponent (Vagabond Unicorn)
      case 'discard_pull_random_from_opponent': this._queueEffect({ type:'discard_pull_random_from_opponent', playerId:pid }); break;
      // Adventures: discard 1, then sacrifice opponent's downgrade (Survivalist Unicorn)
      case 'discard_then_sacrifice_downgrade': this._queueEffect({ type:'discard_then_sacrifice_downgrade', playerId:pid }); break;
      // Nightmares: skip draw, pull random from target (Poltergeist Swipe)
      case 'skip_draw_pull_random': this._queueEffect({ type:'skip_draw_pull_random', playerId:pid }); break;
      // Nightmares: discard 3 and remove from game 1 from discard (Strange Craft Project)
      case 'discard_three_remove_from_game': this._queueEffect({ type:'discard_three_remove_from_game', playerId:pid }); break;
      // Nightmares: owner sacrifices a unicorn at beginning (Currently Indisposed passive effect on each turn)
      // (sacrifices are handled via enter trigger only; ongoing via beginning trigger on downgrade)
      // Nightmares: Ghost Guide — draw, if upgrade/downgrade place into stable
      // Ghost Guide: "you MAY draw a card and reveal it" — needs its own
      // confirm/skip (was forced unconditionally, no decline at all).
      case 'draw_reveal_if_upgrade_downgrade_into_stable': this._queueEffect({ type:'draw_reveal_if_upgrade_downgrade_into_stable', playerId:pid, optional:true, fromBeginning:true }); break;
      // Nightmares: Buried Alive — sacrifice a unicorn or sacrifice itself to return card from discard
      case 'sacrifice_unicorn_or_self_return': this._queueEffect({ type:'sacrifice_unicorn_or_self_return', playerId:pid, sourceCardId:card.id }); break;
      // Beginning draw (Extreme Adventurer Unicorn, Friendly Snowmancorn, Clairvoyant Unicorn, etc.)
      // "you MAY draw a card" (Extreme Adventurer Unicorn, Friendly Snowmancorn,
      // Helper Elficorn, Clairvoyant Unicorn) — selecting the card in the
      // beginning-of-turn optional-effects list only means "I want to consider
      // this"; the draw itself still needs its own confirm/skip, consistent
      // with every other "may X" beginning-trigger card fixed this session
      // (Caffeine Overload, Glitter Bomb, Unicorn of Death, etc.) — otherwise
      // a forced draw can push the player over their hand limit into a
      // discard they never actually agreed to.
      case EFFECTS.DRAW:
        if (e.optional) { this._queueEffect({ type:'draw_n_optional', playerId:pid, amount:e.amount||1, optional:true, fromBeginning:true, source:card.name }); }
        else { this._drawCards(pid, e.amount||1); this.addLog(`${player.name}: ${card.name} — draws ${e.amount||1}`); }
        break;
      // Nursery (Beast Master Unicorn) — take from nursery; with cost skip_draw
      case EFFECTS.NURSERY:
        if (this.nursery.length>0) {
          this._placeCard(pid, this.nursery.pop(), null, null);
          this.addLog(`${player.name}: ${card.name} — takes Baby from Nursery`);
          if (e.cost?.type==='skip_draw') this.skippedDrawPlayers.add(pid);
        }
        break;
      // Hex beginning routing (passive skip_draw already active; this ensures consistent handling)
      case EFFECTS.SKIP_TURN: case 'skip_draw': this.skippedDrawPlayers.add(pid); this.addLog(`${player.name}: ${card.name} — skip draw this turn`); break;
      // Rainbow Lasso: discard 3, steal a unicorn
      case 'discard_three_steal_unicorn': this._queueEffect({ type:'discard_n_steal_unicorn', playerId:pid, needed:3, fromBeginning:true }); break;
      // Stable Artillery: discard 2, destroy a unicorn
      case 'discard_two_destroy_unicorn': this._queueEffect({ type:'discard_two_destroy_unicorn', playerId:pid, optional:e.optional, fromBeginning:true }); break;
      // Angel Unicorn: sacrifice itself, revive a unicorn from discard
      case 'sacrifice_self_revive_unicorn': this._queueEffect({ type:'sacrifice_self_revive_unicorn', playerId:pid, sourceCardId:card.id, fromBeginning:true }); break;
      // Extremely Fertile Unicorn: discard 1, take a baby from nursery
      case 'discard_then_nursery': this._queueEffect({ type:'discard_then_nursery', playerId:pid, optional:e.optional, fromBeginning:true }); break;
      // Unicorn of Death: sacrifice a unicorn, destroy a unicorn
      case 'sacrifice_unicorn_destroy_unicorn': this._queueEffect({ type:'sacrifice_unicorn_destroy_unicorn', playerId:pid, optional:e.optional, fromBeginning:true }); break;
      // Zombie Unicorn: discard a unicorn, revive a unicorn, end turn
      case 'discard_unicorn_revive_unicorn_end_turn': this._queueEffect({ type:'discard_unicorn_revive_unicorn_end_turn', playerId:pid }); break;
      // Rainbow Sprinkles: "draw 3, then immediately end your turn" — that means
      // skip the rest of THIS turn entirely (Draw phase included), not just the
      // Action phase. skippedActionPlayers (used correctly by Special Delivery,
      // whose text really does only say "skip your Action phase") would leave
      // the normal Draw phase still happening afterward — an extra free card —
      // and playCard()'s skippedActionPlayers check doesn't even cover
      // actionDrawCard()'s "draw instead of playing", so the turn wouldn't
      // actually end at all. Returning this sentinel tells the caller
      // (beginning_optional_choices) to end the turn outright instead of its
      // normal doneB() (→ Draw phase).
      case 'draw_three_end_turn': {
        this._drawCards(pid, 3);
        this.addLog(`${player.name}: Rainbow Sprinkles — draws 3, ends turn`);
        return 'END_TURN';
      }
      // Dominatrix Whip: move a unicorn to any other stable
      case 'move_unicorn_any_stable_not_own': this._queueEffect({ type:'move_unicorn_any_stable_not_own', playerId:pid, optional:e.optional }); break;
      default:
        this.addLog(`${player.name}: ${card.name} beginning (${e.type})`);
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[UU] _queueBeginningEffect: unhandled effect type '${e.type}' on card '${card.name}'`);
        }
    }
  }

  drawCard(pid) {
    if (this.phase !== PHASES.DRAW) return { error:'Not in draw phase' };
    if (pid !== this.currentPlayer) return { error:'Not your turn' };
    if (this.skippedDrawPlayers.has(pid)) { this.skippedDrawPlayers.delete(pid); this.phase=PHASES.ACTION; return {ok:true}; }
    if (this._hasPassive(pid,'skip_draw')) { this.phase=PHASES.ACTION; this.addLog(`${this.players[pid].name} skips Draw (Hex)`); return {ok:true}; }
    let drawCount = 1;
    for (const card of this.players[pid].stable) {
      if (card.type===CARD_TYPES.UPGRADE && card.effect?.trigger==='draw_phase') drawCount += card.effect.amount||0;
    }
    if (this._hasPassive(pid,'play_two_cards')) this.extraActionsThisTurn = 1;
    this._drawCards(pid, drawCount);
    this.phase = PHASES.ACTION;
    this.addLog(`${this.players[pid].name} drew ${drawCount}`);
    if (this._hasPassive(pid,'discard_after_draw')) this._queueEffect({type:'discard',playerId:pid,amount:1});
    return { ok:true };
  }

  actionDrawCard(pid) {
    if (this.phase !== PHASES.ACTION) return { error:'Not in action phase' };
    if (pid !== this.currentPlayer) return { error:'Not your turn' };
    this._drawCards(pid, 1);
    this.addLog(`${this.players[pid].name} drew instead of playing`);
    this.actionsUsedThisTurn++;
    // Extremely Small Backpack: "Each time you draw any number of cards,
    // DISCARD a card" — this applies to drawing via this action-phase
    // "draw instead of playing" option too, not just the normal Draw phase
    // (which already queues this separately in drawCard() above).
    if (this._hasPassive(pid,'discard_after_draw')) this._queueEffect({ type:'discard', playerId:pid, amount:1, source:'Extremely Small Backpack' });
    this.phase = PHASES.END;
    if (!this.pendingEffect) this._endPhase();
    // Else: the discard above is still pending — _effectDone() will call
    // _endPhase() itself once it resolves, same pattern as the Neigh-bonus
    // fix above (an unconditional _endPhase() here would otherwise silently
    // wipe out whatever was just queued).
    return { ok:true };
  }

  playCard(pid, cardId, targetPlayerId, targetCardId) {
    if (this.phase !== PHASES.ACTION) return { error:'Not in action phase' };
    if (pid !== this.currentPlayer) return { error:'Not your turn' };
    if (this.skippedActionPlayers.has(pid)) { this.skippedActionPlayers.delete(pid); return { error:'Action phase skipped this turn' }; }
    const player = this.players[pid];
    const idx = player.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return { error:'Card not in hand' };
    const card = player.hand[idx];
    if (card.type===CARD_TYPES.UPGRADE && this._hasPassive(pid,'cannot_play_upgrades')) return { error:'Broken Stable prevents Upgrades' };
    if (card.effect?.type===EFFECTS.NEIGH && this._hasPassive(pid,'cannot_play_neigh')) return { error:'Cannot play Neigh cards' };
    const yayProtected = this._hasPassive(pid,'cards_cannot_be_neighed');
    const e = card.effect;
    if (e) {
      const t = e.type;
      // mustHaveStable only for magic/instant cards — unicorn enter/beginning triggers (e.g. Rhinocorn,
      // whose destroy fires later at the start of a future turn, not when the card is played) queue
      // choose_steal/choose_destroy/beginning_destroy_end_turn interactively instead
      const isEnterTrigger = (e.trigger === 'enter' || e.trigger === 'beginning') && IS_UNICORN(card.type);
      const mustHaveStable = !isEnterTrigger && [EFFECTS.STEAL,EFFECTS.DESTROY,EFFECTS.RETURN_TO_HAND,EFFECTS.RETURN_TO_DECK,
        'sacrifice_self_destroy_unicorn','destroy_then_target_may_destroy',
        'remove_from_game','pull_random_hand'].includes(t);
      const mustHavePlayer = card.type===CARD_TYPES.DOWNGRADE||[EFFECTS.SKIP_TURN,'skip_turn','trade_hands',
        'destroy_all_basics_one_player',
        'look_hand_take_one','look_and_take'].includes(t);
      if (mustHaveStable && (!targetPlayerId||!targetCardId)) return { error:'Select a target card in a stable first' };
      if (mustHavePlayer && !targetPlayerId) return { error:'Select a target player first' };
    }
    if (targetPlayerId && !this.players[targetPlayerId]) return { error:'Invalid target player' };
    this.pendingCard = { card, playerId:pid, cardIndex:idx, targetPlayerId, targetCardId, yayProtected };
    this.neighWindow = !yayProtected;
    this.neighWindowOpenedAt = this.neighWindow ? Date.now() : null;
    this.neighPassed = new Set();
    this.superNeighWindow = false;
    this.superNeighPendingCard = null;
    this.neighChain = [];
    // Build a rich log entry: include target player and target card when known
    const tPName = targetPlayerId ? this.players[targetPlayerId]?.name : null;
    const tCName = targetCardId
      ? (this.players[targetPlayerId]?.stable.find(c=>c.id===targetCardId)?.name ||
         this.players[targetPlayerId]?.hand.find(c=>c.id===targetCardId)?.name)
      : null;
    const targetStr = tCName ? ` → ${tPName}'s ${tCName}` : tPName ? ` → ${tPName}` : '';
    this.addLog(`${player.name} plays ${card.emoji} ${card.name}${targetStr}…`);
    if (yayProtected) return this.resolveNeigh(pid);
    return { ok:true, neighWindow:true };
  }

  playInstant(pid, cardId) {
    const player = this.players[pid];
    const idx = player.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return { error:'Card not in hand' };
    const card = player.hand[idx];
    if (card.effect?.type !== EFFECTS.NEIGH && card.effect?.type !== 'neigh_remove_from_game') return { error:'Not a Neigh card' };
    if (this._hasPassive(pid,'cannot_play_neigh')) return { error:'Cannot play Neigh cards' };

    // ── Countering a Neigh that's already in flight ──────────────────────────
    // Any player (including the original card's player) holding a Neigh card may play
    // it here to counter the most recent Neigh in the chain. This just extends the
    // chain and reopens the window — it does NOT resolve anything yet. The chain can
    // go arbitrarily deep (each side keeps countering with their remaining Neigh
    // cards) until someone with the current "top" card confirms nobody's countering
    // it (resolveNeigh), at which point the whole chain resolves based on its length:
    // an odd number of Neighs played means the last one stands and blocks the
    // original card; an even number means the original card resolves normally.
    if (this.superNeighWindow) {
      const topCard = this.neighChain.length ? this.neighChain[this.neighChain.length-1].card : null;
      if (topCard?.effect?.super) return { error:`${topCard.name} cannot be Neigh'd` };
      player.hand.splice(idx, 1);
      this.discard.push(card);
      const neighedCard = this.superNeighPendingCard?.card;
      this.addLog(`${player.name} Super Neigh! — ${neighedCard?.name || 'the Neigh'} is countered!`);
      this.neighChain.push({ card, playerId: pid });
      this.superNeighPendingCard = { card, playerId: pid };
      this.neighWindowOpenedAt = Date.now();
      this.neighPassed = new Set();
      return { ok:true, superNeighWindow:true };
    }

    if (!this.neighWindow) return { error:'Nothing to Neigh' };
    player.hand.splice(idx, 1);
    this.discard.push(card);
    const pendingName = this.pendingCard?.card?.name || 'card';
    this.addLog(`${player.name} Neigh! — ${pendingName}…`);
    // Open the Super Neigh window instead of resolving immediately: the original card's
    // player (and anyone else holding a Neigh) gets a chance to Neigh this Neigh right back.
    this.neighWindow = false;
    this.superNeighWindow = true;
    this.neighChain = [{ card, playerId: pid }];
    this.superNeighPendingCard = { card, playerId: pid };
    this.neighWindowOpenedAt = Date.now();
    this.neighPassed = new Set();
    return { ok:true, superNeighWindow:true };
  }

  // How much longer (ms) the acting player must wait before they're allowed to
  // resolve/close the currently-open Neigh or Super Neigh window. 0 once elapsed.
  // NOTE: this is informational only at the engine level (used to populate
  // neighWaitRemainingMs in stateFor() for the client's countdown UI); the actual
  // wait is enforced in index.js's WebSocket handler for the human-initiated
  // 'resolve_neigh' message, not here in resolveNeigh() itself. Enforcing it here
  // would also gate every direct, in-process engine caller — including bot.js
  // (which already manages its own deliberate wait before calling this) and the
  // entire synchronous test suite, which calls resolveNeigh() immediately after
  // playCard() by design, with no real opponent present to react.
  _neighWaitRemaining() {
    if (!this.neighWindowOpenedAt) return 0;
    return Math.max(0, MIN_NEIGH_WAIT_MS - (Date.now() - this.neighWindowOpenedAt));
  }

  // Every other connected player currently holding a card that could actually
  // Neigh this — the only players whose response is meaningful. A player with
  // no Neigh card in hand has no decision to make, so they don't block anything.
  _eligibleNeighResponders(actorId) {
    return this.playerOrder.filter(otherId => {
      if (otherId === actorId) return false;
      const p = this.players[otherId];
      if (!p || p.connected === false) return false;
      if (this._hasPassive(otherId,'cannot_play_neigh')) return false;
      return p.hand.some(c => c.effect?.type==='neigh' || c.effect?.type==='neigh_remove_from_game');
    });
  }

  _allEligibleRespondersPassed(actorId) {
    return this._eligibleNeighResponders(actorId).every(otherId => this.neighPassed.has(otherId));
  }

  // Who the open Neigh / Super Neigh window is still waiting on: every opponent who
  // holds a playable Neigh and hasn't yet played one or passed ("Let it play").
  // Empty when nobody CAN respond — in which case the window needs no waiting at all.
  // A Super Neigh card can't itself be Neigh'd, so nobody can answer one.
  neighPendingResponders() {
    if (this.superNeighWindow) {
      const top = this.neighChain.length ? this.neighChain[this.neighChain.length-1] : null;
      if (!top || top.card?.effect?.super) return [];
      return this._eligibleNeighResponders(top.playerId).filter(id => !this.neighPassed.has(id));
    }
    if (this.neighWindow && this.pendingCard) {
      return this._eligibleNeighResponders(this.pendingCard.playerId).filter(id => !this.neighPassed.has(id));
    }
    return [];
  }

  // The acting player never has to press anything to let their own card play: the
  // window closes by itself the moment nobody is left who could Neigh it (nobody
  // holds a Neigh, or everyone who does has played one or passed). Called by the
  // server after every state change; deliberately NOT folded into playCard()/
  // resolveNeigh(), because the synchronous engine tests and bot.js call those
  // directly and expect the window to stay open until they close it.
  // Returns null when the window is still waiting (or none is open), otherwise
  // whatever closing it returned (may be {error} — e.g. a Queen Bee-blocked play).
  settleNeighWindow() {
    if (!this.neighWindow && !this.superNeighWindow) return null;
    if (this.neighWindow && !this.pendingCard) return null;
    if (this.superNeighWindow && !this.neighChain.length) return null;
    if (this.neighPendingResponders().length > 0) return null;
    return this.superNeighWindow ? this._finalizeNeighChain() : this._closeNeighWindowAndResolve();
  }

  // A player explicitly declines to Neigh the currently-open window. Once every
  // opponent who could actually Neigh it has either done so or passed, the
  // window closes automatically — nobody has to wait on the acting player's own
  // button (which still exists only as a fallback for a stalled/AFK opponent;
  // see MIN_NEIGH_WAIT_MS / index.js).
  passNeigh(pid) {
    const isSuper = this.superNeighWindow;
    if (!this.neighWindow && !isSuper) return { error:'No Neigh window open' };
    const actorId = isSuper ? this.superNeighPendingCard?.playerId : this.pendingCard?.playerId;
    if (!actorId) return { error:'No pending card' };
    if (!this.players[pid]) return { error:'Unknown player' };
    if (pid === actorId) return { error:'You cannot pass on your own card — use resolve_neigh instead' };
    this.neighPassed.add(pid);
    const settled = this.settleNeighWindow();
    return settled || { ok:true };
  }

  _closeNeighWindowAndResolve() {
    this.neighWindow = false;
    this.neighWindowOpenedAt = null;
    return this._finalizeCardResolution();
  }

  resolveNeigh(pid) {
    // Super Neigh window open: the player who played the most recent (still-standing)
    // Neigh in the chain confirms nobody countered it further, so the chain resolves.
    if (this.superNeighWindow) {
      if (!this.superNeighPendingCard || pid !== this.superNeighPendingCard.playerId) return { error:'Not your Neigh to resolve' };
      return this._finalizeNeighChain();
    }
    if (!this.pendingCard || pid !== this.pendingCard.playerId) return { error:'Not your card' };
    if (!this.neighWindow && !this.pendingCard.yayProtected) return { error:'No pending card' };
    if (!this.neighWindow) return this._finalizeCardResolution(); // yayProtected: nothing to close
    return this._closeNeighWindowAndResolve();
  }

  // Resolves a Neigh chain of any depth once nobody counters the most recent Neigh.
  // Only the LAST Neigh in the chain "stood" (every earlier one in the chain was itself
  // countered by the next, so only the final one's own rider effects fire) — its
  // neighTarget_*/you_may_draw/both_may_draw effects target whoever's card or Neigh it
  // directly countered (the original card's owner, or the previous Neigh's player).
  // The original card's fate then depends purely on the chain's length: an odd number
  // of Neighs played means the last one stands and blocks the original card; an even
  // number means every Neigh in the chain cancelled the one before it, so the original
  // card resolves normally.
  _finalizeNeighChain() {
    const chain = this.neighChain;
    const last = chain[chain.length - 1];
    const card = last.card;
    const neigherPid = last.playerId;
    const isRemovedFromGame = card.effect?.type==='neigh_remove_from_game';
    // Whoever's card/Neigh this last Neigh directly countered: the previous entry in
    // the chain (already discarded), or the original pendingCard (still in hand) if
    // this was the first Neigh played.
    if (chain.length >= 2) {
      const prev = chain[chain.length - 2];
      // "may DRAW" is a choice, not a forced draw (a forced draw can push someone
      // over their hand limit into an unwanted discard they never agreed to) —
      // queue draw_n_optional per player instead of drawing unconditionally.
      if (card.effect?.neighTarget_may_draw) this._queueEffect({ type:'draw_n_optional', playerId:prev.playerId, amount:1, optional:true, source:card.name });
      // "must DISCARD a card" with no "at random" wording — the target picks
      // their own card, same convention as every other forced discard on cards.
      if (card.effect?.neighTarget_must_discard) this._queueEffect({ type:'discard_choice', playerId:prev.playerId, amount:1, source:card.name });
      if (card.effect?.you_may_draw) this._queueEffect({ type:'draw_n_optional', playerId:neigherPid, amount:1, optional:true, source:card.name });
      if (card.effect?.both_may_draw) {
        this._queueEffect({ type:'draw_n_optional', playerId:neigherPid, amount:1, optional:true, source:card.name });
        this._queueEffect({ type:'draw_n_optional', playerId:prev.playerId, amount:1, optional:true, source:card.name });
      }
      if (isRemovedFromGame) {
        const di = this.discard.findIndex(c => c.id === prev.card.id);
        if (di !== -1) {
          const removed = this.discard.splice(di,1)[0];
          this.removedFromGame.push(removed);
          this.addLog(`${removed.name} removed from game!`);
        }
      }
    } else {
      const countered = this.pendingCard?.playerId;
      if (card.effect?.neighTarget_may_draw) this._queueEffect({ type:'draw_n_optional', playerId:countered, amount:1, optional:true, source:card.name });
      if (card.effect?.neighTarget_must_discard) this._queueEffect({ type:'discard_choice', playerId:countered, amount:1, source:card.name });
      if (card.effect?.you_may_draw) this._queueEffect({ type:'draw_n_optional', playerId:neigherPid, amount:1, optional:true, source:card.name });
      if (card.effect?.both_may_draw) {
        this._queueEffect({ type:'draw_n_optional', playerId:neigherPid, amount:1, optional:true, source:card.name });
        this._queueEffect({ type:'draw_n_optional', playerId:countered, amount:1, optional:true, source:card.name });
      }
    }

    const blocked = chain.length % 2 === 1;
    if (!blocked) {
      // Even-length chain: every Neigh cancelled the one before it, so the original
      // card is unblocked and resolves exactly as if nobody had ever Neighed it.
      this.superNeighWindow = false; this.superNeighPendingCard = null; this.neighChain = []; this.neighWindowOpenedAt = null;
      return this._finalizeCardResolution();
    }

    // Odd-length chain: the last Neigh stands and blocks the original card. Only a
    // chain of length 1 means the last (only) Neigh directly countered the original
    // card itself, so remove-from-game only applies to the original card in that case
    // — at length 3+ the last Neigh countered a previous Neigh instead (handled above),
    // and the original card is simply discarded as an ordinary consequence of parity.
    const targetPid = this.pendingCard?.playerId;
    const blockedCard = this.pendingCard?.card;
    const pendingCardIndex = this.pendingCard?.cardIndex;
    const pendingName = blockedCard?.name || 'card';
    const removeOriginalFromGame = isRemovedFromGame && chain.length === 1;
    // The blocked card was "played" — it leaves the player's hand either way: discarded
    // normally, or removed from game entirely for Hex Neigh (never both).
    if (targetPid && blockedCard) {
      const hand = this.players[targetPid].hand;
      const hi = (pendingCardIndex!=null && hand[pendingCardIndex]?.id===blockedCard.id)
        ? pendingCardIndex
        : hand.findIndex(c=>c.id===blockedCard.id);
      if (hi !== -1) {
        const removed = hand.splice(hi,1)[0];
        if (removeOriginalFromGame) {
          this.removedFromGame.push(removed);
          this.addLog(`${pendingName} removed from game!`);
        } else {
          this.discard.push(removed);
        }
      }
    }
    if (this._hasPassive(targetPid,'on_neigh_take_card_from_neigher') && this.players[neigherPid].hand.length>0) {
      const ri = Math.floor(Math.random()*this.players[neigherPid].hand.length);
      this.players[targetPid].hand.push(this.players[neigherPid].hand.splice(ri,1)[0]);
      this.addLog(`Unicorn Caroler triggers`);
    }
    this.addLog(`${pendingName} — Neigh stands, blocked!`);
    this.superNeighWindow = false; this.superNeighPendingCard = null; this.neighChain = []; this.pendingCard = null; this.neighWindowOpenedAt = null;
    this.phase = PHASES.END;
    if (!this.pendingEffect) {
      // No rider effect (may-draw/must-discard) queued above — safe to end the
      // turn immediately, exactly as before.
      this._endPhase();
    }
    // Else: a queued draw_n_optional/discard_choice (neighTarget_may_draw,
    // you_may_draw, both_may_draw, neighTarget_must_discard) is still pending —
    // calling _endPhase() unconditionally here would silently wipe it out
    // (_endPhase can itself overwrite pendingEffect, or jump straight to
    // _advanceTurn(), with no awareness of what's already queued). Leave it;
    // _effectDone() will call _endPhase() itself once that resolves.
    return { ok:true, negated:true };
  }

  // Resolves the original pending card (used both when nobody neighs at all, and when a
  // Neigh chain of even length cancels itself out).
  _finalizeCardResolution() {
    const { card, cardIndex, playerId:pid, targetPlayerId, targetCardId } = this.pendingCard;
    const player = this.players[pid];
    const hi = (cardIndex!=null && player.hand[cardIndex]?.id===card.id)
      ? cardIndex
      : player.hand.findIndex(c=>c.id===card.id);
    if (hi !== -1) player.hand.splice(hi, 1);
    this.pendingCard = null;
    const result = this._resolveCardEffect(pid, card, targetPlayerId, targetCardId);
    if (result?.error) return result;
    this.actionsUsedThisTurn++;
    const maxActions = 1 + this.extraActionsThisTurn;
    const alreadyWon = !!this.winner;
    const win = this.winner || this._checkWin();
    if (win) { this.phase=PHASES.GAME_OVER; this.winner=win; if(!alreadyWon)this.addLog(`🎉 ${this.players[win].name} wins!`); return {ok:true,gameOver:true,winner:win}; }
    if (!this.pendingEffect) {
      if (this.actionsUsedThisTurn < maxActions) return { ok:true }; // stay in action (Double Dutch)
      this.phase = PHASES.END; this._endPhase();
    } else {
      // A card effect is pending (for current player or an opponent).
      // Lock the action phase immediately — no more cards can be played.
      // _effectDone() will call _endPhase() → _advanceTurn() once all effects resolve.
      if (this.actionsUsedThisTurn < maxActions) return { ok:true }; // Double Dutch still gets extra action first
      this.phase = PHASES.END; // mark END so playCard/actionDrawCard are blocked
      // Do NOT call _endPhase() here — _effectDone() handles turn advance after all effects resolve
    }
    return { ok:true };
  }

  _resolveCardEffect(pid, card, tPid, tCid) {
    const player  = this.players[pid];
    const tPlayer = tPid ? this.players[tPid] : null;
    const e = card.effect;
    switch(card.type) {
      case CARD_TYPES.BABY_UNICORN:
      case CARD_TYPES.BASIC_UNICORN:
      case CARD_TYPES.MAGICAL_UNICORN: {
        // Queen Bee: block basics from entering others. This is a blocked play, not a
        // completed one — return an error and restore the card to hand so the player's
        // turn/action isn't consumed by a card that never actually did anything.
        if (card.type===CARD_TYPES.BASIC_UNICORN) {
          for (const p of this.playerOrder) {
            if (p!==pid && this._hasPassive(p,'block_basic_to_others')) {
              player.hand.push(card);
              return {error:`${this.players[p].name}'s Queen Bee Unicorn blocks Basic Unicorns from entering any Stable but its own — choose a different action`};
            }
          }
        }
        // Extreme Adventurer: block basics entering own stable — same fix as above.
        if (card.type===CARD_TYPES.BASIC_UNICORN && this._hasPassive(pid,'block_basic_unicorns_own_stable')) {
          player.hand.push(card);
          return {error:`${card.name} is blocked by your Extreme Adventurer Unicorn — choose a different action`};
        }
        // Humbug: Magical Unicorn cards cannot enter your Stable (was defined but never
        // enforced anywhere — found while auditing this same bug class).
        if (card.type===CARD_TYPES.MAGICAL_UNICORN && this._hasPassive(pid,'block_magical_unicorns')) {
          player.hand.push(card);
          return {error:`${card.name} is blocked by your Humbug — choose a different action`};
        }
        player.stable.push(card);
        this.addLog(`${player.name} adds ${card.emoji} ${card.name} to stable`);
        this._onUnicornEntered(pid, card);   // Barbed Wire / Tiny Stable / Gingerbread Stable
        const r = this._enterTrigger(card,pid,tPid,tCid);
        if (r?.pendingEffect) return {ok:true};
        break;
      }
      case CARD_TYPES.UPGRADE: {
        const target = tPlayer||player;
        target.stable.push({...card,isUpgrade:true});
        this.addLog(`${player.name} plays ${card.emoji} ${card.name} → ${target.name}'s stable`);
        if (this._hasPassive(target.id,'on_upgrade_enter') && target.id===pid) this._drawCards(pid,1);
        if (card.effect?.type==='play_two_cards') this.extraActionsThisTurn=1;
        const r = this._enterTrigger(card,target.id,tPid,tCid);
        if (r?.pendingEffect) return {ok:true};
        break;
      }
      case CARD_TYPES.DOWNGRADE: {
        if (!tPlayer) return {error:'Downgrade requires a target player'};
        if (this._hasPassive(tPid,'block_downgrades_self_protected')) {
          player.hand.push(card);
          return {error:`${tPlayer.name} is protected by Saved by the Sigil — Downgrades cannot be played on them. Choose a different action`};
        }
        if (this._hasPassive(tPid,'downgrades_have_no_effect')) {
          player.hand.push(card);
          return {error:`${tPlayer.name} is protected by Dragon's Blessing — Downgrades have no effect. Choose a different action`};
        }
        tPlayer.stable.push({...card,isDowngrade:true});
        this.addLog(`${player.name} plays ${card.emoji} ${card.name} → ${tPlayer.name}'s stable`);
        // (Barbed Wire is NOT triggered here: it only reacts to UNICORN cards entering or
        // leaving a Stable, and this is a Downgrade.)
        // Hand-limit changes are not applied here: _handLimit() derives them from whatever is in
        // the Stables right now, so they follow the card when it is moved, stolen, destroyed or neutralised.
        if (e?.type==='discard_hand_draw_one') { this.discard.push(...tPlayer.hand); tPlayer.hand=[]; this._drawCards(tPid,1); }
        if (e?.trigger==='enter' && e?.type===EFFECTS.SACRIFICE) this._queueEffect({type:'sacrifice_unicorn',playerId:tPid,source:card.name});
        break;
      }
      case CARD_TYPES.MAGIC:
      case CARD_TYPES.INSTANT: {
        this.discard.push(card);
        const tPName2 = tPid ? this.players[tPid]?.name : null;
        const tCName2 = tCid ? this.players[tPid]?.stable.find(c=>c.id===tCid)?.name : null;
        const tStr2 = tCName2 ? ` → ${tPName2}'s ${tCName2}` : tPName2 ? ` → ${tPName2}` : '';
        this.addLog(`${player.name} plays ${card.emoji} ${card.name}${tStr2}`);
        const magicResult = this._executeMagic(pid,card,tPid,tCid);
        // Critical Hit: on_magic_play — may sacrifice Critical Hit to replay last magic from discard
        if (this._hasPassive(pid,'sacrifice_self_replay_magic')) {
          this._queueEffect({type:'critical_hit_optional',playerId:pid});
        }
        return magicResult;
      }
    }
    return {ok:true};
  }

  _searchDeckMatches(e) {
    if (!e) return [...this.deck];
    if (e.nameContains) return this.deck.filter(c=>c.name.toLowerCase().includes(e.nameContains.toLowerCase()));
    if (e.targetType==='unicorn') return this.deck.filter(c=>IS_UNICORN(c.type));
    if (e.targetType==='magic')   return this.deck.filter(c=>c.type===CARD_TYPES.MAGIC);
    if (e.targetType==='upgrade') return this.deck.filter(c=>c.type===CARD_TYPES.UPGRADE);
    if (e.targetType==='downgrade') return this.deck.filter(c=>c.type===CARD_TYPES.DOWNGRADE);
    if (e.targetType==='instant') return this.deck.filter(c=>c.type===CARD_TYPES.INSTANT);
    if (e.targetType==='basic')   return this.deck.filter(c=>c.type===CARD_TYPES.BASIC_UNICORN);
    if (e.targetType==='neigh')   return this.deck.filter(c=>c.effect?.type===EFFECTS.NEIGH);
    if (e.targetType)             return this.deck.filter(c=>c.type===e.targetType);
    return [...this.deck];
  }

  _searchDiscardMatches(e) {
    if (!e) return [...this.discard];
    if (e.nameContains) return this.discard.filter(c=>c.name.toLowerCase().includes(e.nameContains.toLowerCase()));
    if (e.targetType==='unicorn') return this.discard.filter(c=>IS_UNICORN(c.type));
    if (e.targetType==='magic')   return this.discard.filter(c=>c.type===CARD_TYPES.MAGIC);
    if (e.targetType==='upgrade') return this.discard.filter(c=>c.type===CARD_TYPES.UPGRADE);
    if (e.targetType==='downgrade') return this.discard.filter(c=>c.type===CARD_TYPES.DOWNGRADE);
    if (e.targetType==='instant') return this.discard.filter(c=>c.type===CARD_TYPES.INSTANT);
    if (e.targetType==='basic')   return this.discard.filter(c=>c.type===CARD_TYPES.BASIC_UNICORN);
    if (e.targetType==='neigh')   return this.discard.filter(c=>c.effect?.type===EFFECTS.NEIGH);
    if (e.targetType)             return this.discard.filter(c=>c.type===e.targetType);
    return [...this.discard];
  }

  // Remove matching cards from deck/discard, queue pick effect
  _searchDeckPick(pid, e, addToHand=true, intoStable=false) {
    const matches = this._searchDeckMatches(e);
    if (matches.length===0) { this.addLog(`Nothing found in deck`); return false; }
    const ids = new Set(matches.map(c=>c.id));
    this.deck = this.deck.filter(c=>!ids.has(c.id));
    this.deck = shuffle(this.deck);
    this._queueEffect({type:'search_deck_pick',playerId:pid,options:matches,addToHand,intoStable});
    return true;
  }

  _discardPick(pid, e, addToHand=true, intoStable=false, thenDraw=0, endTurnAfter=false) {
    const matches = this._searchDiscardMatches(e);
    if (matches.length===0) { this.addLog(`Nothing in discard`); return false; }
    const ids = new Set(matches.map(c=>c.id));
    this.discard = this.discard.filter(c=>!ids.has(c.id));
    this._queueEffect({type:'from_discard_pick',playerId:pid,options:matches,addToHand,intoStable,thenDraw,endTurnAfter,targetType:e?.targetType||null});
    return true;
  }

  _enterTrigger(card, pid, tPid, tCid) {
    const e = card.effect;
    if (!e) return null;
    // Passive-trigger cards have no enter effect (their numeric hand-limit modifiers are derived
    // on demand by _handLimit, not applied here).
    if (e.trigger && e.trigger !== 'enter') return null;
    const player = this.players[pid];
    if (card.type===CARD_TYPES.MAGICAL_UNICORN && this._unicornsNeutralized(pid)) {
      this.addLog(`${card.name} effect suppressed`); return null;
    }
    this._kittenProtects = (card.type === CARD_TYPES.UPGRADE || card.type === CARD_TYPES.DOWNGRADE);
    switch(e.type) {
      case EFFECTS.DRAW: {
        if (e.optional) { this._queueEffect({type:'draw_n_optional',playerId:pid,amount:e.amount||1,optional:true}); return {pendingEffect:true}; }
        this._drawCards(pid,e.amount||1); this.addLog(`${player.name} draws ${e.amount||1} (${card.name})`); break;
      }
      case 'draw_discard': this._drawCards(pid,e.draw||2); this._queueEffect({type:'discard',playerId:pid,amount:e.discard||1}); return {pendingEffect:true};
      case 'look_top_keep_one': { const top=this.deck.splice(0,e.amount||3); this._queueEffect({type:'look_top_keep_one',playerId:pid,options:top,discardRest:e.discardRest||false}); return {pendingEffect:true}; }
      case 'look_top_return_any_order': { const top=this.deck.splice(0,e.amount||3); this._queueEffect({type:'look_deck_return_order',playerId:pid,options:top}); return {pendingEffect:true}; }
      case 'look_top_return_same_order': { const top=this.deck.splice(0,e.amount||3); this._queueEffect({type:'look_deck_return_same',playerId:pid,options:top}); return {pendingEffect:true}; }
      case 'all_may_draw': {
        // "Each player (including you) MAY draw a card" — this is optional per
        // player, not a forced draw. Queue one draw_n_optional per player (in
        // turn order) so each gets their own confirm/skip choice.
        for (const p of this.playerOrder) this._queueEffect({ type:'draw_n_optional', playerId:p, amount:e.amount||1, optional:true });
        this.addLog(`${card.name}: each player may draw ${e.amount||1}`);
        if (this.pendingEffect) return {pendingEffect:true};
        break;
      }
      case EFFECTS.ALL_SACRIFICE: {
        const queue=this.playerOrder.filter(p=>e.targetType==='unicorn'?this.players[p].stable.some(c=>this._isTargetableUnicorn(p,c)):this.players[p].stable.length>0);
        for(const p of queue) this._queueEffect({type:e.targetType==='unicorn'?'sacrifice_unicorn':'sacrifice_any',playerId:p,source:card.name});
        if(queue.length>0) return {pendingEffect:true}; break;
      }
      case 'all_sacrifice_unicorn_draw': {
        // Each player chooses WHICH Unicorn to sacrifice (not auto-picked) —
        // queue one sacrifice_unicorn (then draw 1) per player with a valid target.
        const targets = this.playerOrder.filter(p => this.players[p].stable.some(c=>this._isTargetableUnicorn(p,c)));
        for (const p of targets) this._queueEffect({ type:'sacrifice_unicorn', playerId:p, source:card.name, thenDraw:1 });
        this.addLog(`${card.name}: all players must sacrifice a Unicorn, then draw 1`);
        break;
      }
      case EFFECTS.ALL_DISCARD: case 'all_discard': {
        // Each player chooses their own card to discard (not random).
        // Queue one discard_choice effect per player with a hand, in turn order.
        const targets = this.playerOrder.filter(p => this.players[p].hand.length > 0);
        for (const p of targets) this._queueEffect({ type:'discard_choice', playerId:p, amount:e.amount||1, source:card.name });
        this.addLog(`${card.name}: all players must discard ${e.amount||1}`);
        if (this.pendingEffect) return { pendingEffect:true };
        break;
      }
      case 'all_discard_take_one': {
        // "Each other player must DISCARD a card" — THEIR choice, not a random
        // pick — "choose one of the discarded cards" (the actor picks from
        // whatever they actually discarded, afterward). Chain one discard_choice
        // per victim, threading the gathered cards forward, then hand the actor
        // a take_one_from_list once everyone's discarded.
        const targets = this.playerOrder.filter(p=>p!==pid && this.players[p].hand.length>0);
        if (targets.length > 0) {
          const [first, ...rest] = targets;
          this._queueEffect({ type:'discard_choice', playerId:first, amount:1, source:card.name, gatherForActor:pid, gathered:[], remainingTargets:rest });
          return {pendingEffect:true};
        }
        break;
      }
      case EFFECTS.SEARCH_DECK: case 'search_deck': if(this._searchDeckPick(pid,e,e.addToHand!==false,e.intoStable===true)) return {pendingEffect:true}; break;
      case EFFECTS.FROM_DISCARD: case 'from_discard': if(this._discardPick(pid,e,e.addToHand!==false,e.intoStable===true)) return {pendingEffect:true}; break;
      case EFFECTS.STEAL: if(tPid&&tCid){if(this._maybeIntercept('steal',pid,tPid,tCid,false))return {pendingEffect:true}; this._stealCard(pid,tPid,tCid);}else{this._queueEffect({type:'choose_steal',playerId:pid,targetType:e.targetType||null,optional:e.optional});return {pendingEffect:true};} break;
      case EFFECTS.DESTROY: if(tPid&&tCid){if(this._maybeIntercept('destroy',pid,tPid,tCid,false))return {pendingEffect:true}; this._destroyCard(tPid,tCid,pid);}else{this._queueEffect({type:'choose_destroy',playerId:pid,targetType:e.targetType||null,optional:e.optional});return {pendingEffect:true};} break;
      case EFFECTS.RETURN_TO_HAND: if(tPid&&tCid){this._returnToHand(tPid,tCid,pid);}else{this._queueEffect({type:'choose_return',playerId:pid});return {pendingEffect:true};} break;
      case 'play_upgrade_from_hand': this._queueEffect({type:'play_upgrade_from_hand',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'play_basic_from_hand': { const hasBasic=player.hand.some(c=>c.type===CARD_TYPES.BASIC_UNICORN); if(hasBasic){this._queueEffect({type:'play_basic_from_hand',playerId:pid,optional:e.optional}); return {pendingEffect:true};} break; }
      case EFFECTS.NURSERY: if(this.nursery.length>0){this._queueEffect({type:'take_from_nursery',playerId:pid,optional:e.optional}); return {pendingEffect:true};} break;
      case 'sacrifice_all_own': { const dgs=player.stable.filter(c=>c.type===CARD_TYPES.DOWNGRADE); player.stable=player.stable.filter(c=>c.type!==CARD_TYPES.DOWNGRADE); this.discard.push(...dgs); break; }
      case 'sacrifice_then_revive': this._queueEffect({type:'sacrifice_then_revive',playerId:pid,step:'sacrifice',optional:e.optional}); return {pendingEffect:true};
      case 'discard_two_unicorns_revive': {
        // Only queue if the player actually has 2+ unicorns in hand AND there's a unicorn in discard to revive
        const unicornsInHand = player.hand.filter(c=>IS_UNICORN(c.type)).length;
        const unicornsInDiscard = this.discard.filter(c=>IS_UNICORN(c.type)).length;
        if (unicornsInHand >= 2 && unicornsInDiscard > 0) {
          this._queueEffect({type:'discard_two_unicorns_revive',playerId:pid,optional:e.optional});
          return {pendingEffect:true};
        }
        // Can't be used — skip silently
        this.addLog(`${player.name}: ${card.name} — can't activate (need 2 unicorns in hand + 1 in discard)`);
        break;
      }
      // Shark With a Horn: "you may SACRIFICE this card, then DESTROY a Unicorn card."
      // The whole chain is one up-front decision — queue it so the player can decline
      // before anything irreversible happens, instead of sacrificing synchronously here.
      case 'sacrifice_self_destroy_unicorn': {
        this._queueEffect({type:'sacrifice_self_destroy_unicorn',playerId:pid,sourceCardId:card.id,optional:e.optional});
        return {pendingEffect:true};
      }
      case 'destroy_upgrade_or_sacrifice_downgrade': {
        const anyModifier=Object.values(this.players).some(p=>p.stable.some(c=>c.type===CARD_TYPES.UPGRADE||c.type===CARD_TYPES.DOWNGRADE));
        if(!anyModifier){this.addLog(`${player.name}: ${card.name} — no Upgrades or Downgrades to target`);break;}
        this._queueEffect({type:'destroy_upgrade_or_sacrifice_downgrade',playerId:pid,optional:card.effect?.optional}); return {pendingEffect:true};
      }
      case 'discard_then_steal': this._queueEffect({type:'discard_then_steal',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'sacrifice_magical_search_basic': this._queueEffect({type:'sacrifice_magical_search_basic',playerId:pid}); return {pendingEffect:true};
      case 'discard_then_search_upgrade_into_stable': this._queueEffect({type:'discard_then_search_upgrade_into_stable',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'move_downgrade_steal_upgrade': this._queueEffect({type:'move_downgrade_steal_upgrade',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'look_hand_take_one': this._queueEffect({type:'look_and_take',playerId:pid,targetPlayerId:tPid,revealedHand:(this.players[tPid]?.hand||[]).map(c=>({...c}))}); return {pendingEffect:true};
      case 'pull_random_hand': { const hasTarget=this.playerOrder.some(p=>p!==pid&&this.players[p].hand.length>0); if(hasTarget){this._queueEffect({type:'choose_opponent_pull_random',playerId:pid}); return {pendingEffect:true};} break; }
      case 'force_discard':
        if (tPid) {
          this._queueEffect({type:'target_discard',playerId:tPid,amount:e.amount||1,source:card.name});
          return {pendingEffect:true};
        } else if (e.optional) {
          // Player must pick a target opponent — queue chooser
          this._queueEffect({type:'choose_opponent_discard',playerId:pid,amount:e.amount||1,source:card.name});
          return {pendingEffect:true};
        }
        break;
      case 'move_upgrade_or_downgrade_between_stables': this._queueEffect({type:'move_upgrade_or_downgrade_between_stables',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'discard_n_others_discard_n': this._queueEffect({type:'discard_n_others_discard_n',playerId:pid}); return {pendingEffect:true};
      case 'all_may_destroy_unicorn': {
        // "EACH PLAYER (including you) may DESTROY a Unicorn card" — every
        // player gets their own independent optional choice, not just the
        // player who played this card. Queue one choose_destroy per player.
        for (const p of this.playerOrder) this._queueEffect({ type:'choose_destroy', playerId:p, targetType:'unicorn', optional:true, source:card.name });
        return {pendingEffect:true};
      }
      case 'choose_players_draw_each': this._queueEffect({type:'choose_players_draw_each',playerId:pid}); return {pendingEffect:true};
      // Jack the Reapercorn: "you MAY draw a card. If that card is a Neigh
      // card, you MAY reveal it and draw a second card." Both draws are a
      // choice — previously both were forced.
      case 'draw_if_neigh_draw_again': this._queueEffect({ type:'draw_n_optional', playerId:pid, amount:1, optional:true, revealIfNeighBonus:true, source:card.name }); return {pendingEffect:true};
      case 'draw_per_basic_in_stable': { const n=player.stable.filter(c=>c.type===CARD_TYPES.BASIC_UNICORN).length; if(n>0){this._queueEffect({type:'draw_per_basic_in_stable',playerId:pid,amount:n,optional:e.optional}); return {pendingEffect:true};} break; }
      case 'sacrifice_basic_draw_three': this._queueEffect({type:'sacrifice_basic_draw_three',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'discard_remove_from_game': this._queueEffect({type:'discard_remove_from_game',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'discard_two_return_all_opponents_one': this._queueEffect({type:'discard_two_return_all_opponents_one',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'steal_baby':
        if (this._stealTargetsOfType(pid, CARD_TYPES.BABY_UNICORN).length) { this._queueEffect({type:'steal_baby',playerId:pid,optional:e.optional}); return {pendingEffect:true}; }
        this.addLog(`${player.name}: no Baby Unicorn to steal`); break;
      // The Great Narwhal: search deck for a Narwhal card by name
      case 'search_deck_by_name': if(e.nameContains){if(this._searchDeckPick(pid,{nameContains:e.nameContains},e.addToHand!==false,false))return {pendingEffect:true};}break;
      // Adventures enter-trigger choice cards
      case 'choice_steal_baby_or_revive_basic': this._queueEffect({type:'choice_steal_baby_or_revive_basic',playerId:pid}); return {pendingEffect:true};
      case 'choice_discard_hand_draw3_or_trade_hands': this._queueEffect({type:'choice_discard_hand_draw3_or_trade_hands',playerId:pid}); return {pendingEffect:true};
      case 'choice_steal_upgrade_or_move_downgrade': this._queueEffect({type:'choice_steal_upgrade_or_move_downgrade',playerId:pid}); return {pendingEffect:true};
      case 'choice_force_all_discard_or_draw': this._queueEffect({type:'choice_force_all_discard_or_draw',playerId:pid}); return {pendingEffect:true};
      // Nightmares: Currently Indisposed enter trigger — sacrifice a unicorn
      case 'sacrifice': this._queueEffect({type:'sacrifice_unicorn',playerId:pid,source:card.name}); return {pendingEffect:true};
      // Nightmares: Exorcise Regimen — handled inline in downgrade case, but if somehow routed here:
      case 'discard_hand_draw_one': {
        this.discard.push(...player.hand); player.hand=[]; this._drawCards(pid,1);
        this.addLog(`${player.name}: ${card.name} — discard hand, draw 1`); break;
      }
      // NSFW: temp steal enter triggers
      case 'steal_basic_temp':
        if (this._stealTargetsOfType(pid, CARD_TYPES.BASIC_UNICORN).length) { this._queueEffect({type:'steal_basic_temp',playerId:pid,sourceCardId:card.id}); return {pendingEffect:true}; }
        this.addLog(`${player.name}: no Basic Unicorn to steal`); break;
      case 'steal_baby_temp':
        if (this._stealTargetsOfType(pid, CARD_TYPES.BABY_UNICORN).length) { this._queueEffect({type:'steal_baby_temp',playerId:pid,sourceCardId:card.id}); return {pendingEffect:true}; }
        this.addLog(`${player.name}: no Baby Unicorn to steal`); break;
      // Stowaway Unicorn: "you may DRAW a card and reveal it..." — the may covers the
      // whole action, so when optional, queue a confirm/skip step instead of drawing
      // unconditionally (a revealed Downgrade could be forced into the stable otherwise).
      case 'draw_reveal_if_unicorn_upgrade_downgrade_into_stable': {
        if (e.optional) { this._queueEffect({type:'draw_reveal_if_unicorn_upgrade_downgrade_into_stable',playerId:pid,optional:true}); return {pendingEffect:true}; }
        const drawn=this.deck.shift(); if(drawn){if([CARD_TYPES.BASIC_UNICORN,CARD_TYPES.MAGICAL_UNICORN,CARD_TYPES.BABY_UNICORN,CARD_TYPES.UPGRADE,CARD_TYPES.DOWNGRADE].includes(drawn.type)){this._placeCard(pid,drawn,null,null);this.addLog(`${player.name} places ${drawn.emoji} ${drawn.name} in stable`);}else{player.hand.push(drawn);this.addLog(`${player.name} draws ${drawn.emoji} ${drawn.name}`);}} break;
      }
      case 'discard_look_top_three_keep_one': this._queueEffect({type:'discard_look_top_three_keep_one',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'move_downgrade_to_opponent': this._queueEffect({type:'move_downgrade_to_opponent',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'discard_two_steal_any': this._queueEffect({type:'discard_two_steal_any',playerId:pid,optional:e.optional}); return {pendingEffect:true};
      case 'sacrifice_n_destroy_n': this._queueEffect({type:'sacrifice_n_destroy_n',playerId:pid,sacrificed:[],optional:e.optional}); return {pendingEffect:true};
      case 'discard_search_magic_play': case 'discard_wizard_search_magic': this._queueEffect({type:'discard_search_magic_play',playerId:pid}); return {pendingEffect:true};
      // Passive/numeric modifiers applied on enter
      case EFFECTS.COUNT_AS_TWO: case EFFECTS.PROTECTION: case 'block_basic_to_others': case 'hand_visible':
      case 'cannot_play_neigh': case 'cannot_play_upgrades': case 'unicorns_are_pandas': case 'unicorns_are_basic':
      case 'unicorns_are_reindeer': case 'cards_cannot_be_neighed': case 'cannot_be_destroyed':
      case 'cannot_be_sacrificed_or_destroyed': case 'protection_from_dragon_destroy': case 'all_hand_limit_reduce':
      case 'reduce_hand_limit': case 'increase_hand_limit': case 'protection_from_unicorn_upgrade_effects':
      case 'cannot_destroy': case 'downgrades_have_no_effect': case 'unicorns_cannot_be_stolen':
      case 'block_magical_unicorns': case 'block_downgrades_self_protected': case 'tiny_stable_limit':
      case 'skip_beginning_phase': case 'cannot_win_with_basic': case 'cannot_win': case 'upgrades_cannot_be_destroyed':
      case 'on_neigh_take_card_from_neigher': case 'play_two_cards': case 'on_unicorn_enter':
      case 'on_upgrade_enter': case 'on_unicorn_enter_or_leave': case 'skip_draw': case 'discard_after_draw':
      case 'block_basic_unicorns_own_stable': case 'requires_basic_in_stable':
        break;
      default:
        this.addLog(`${card.name}: ${e.type}`);
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[UU] _enterTrigger: unhandled effect type '${e.type}' on card '${card.name}'`);
        }
    }
    return null;
  }

  _executeMagic(pid, card, tPid, tCid) {
    const player  = this.players[pid];
    const tPlayer = tPid ? this.players[tPid] : null;
    const e = card.effect;
    if (!e) return {ok:true};
    this._kittenProtects = true; // this function only ever runs for Magic/Instant cards
    switch(e.type) {
      case 'draw_discard': this._drawCards(pid,e.draw||3); this._queueEffect({type:'discard',playerId:pid,amount:e.discard||1}); break;
      case 'draw_discard_extra_turn': this._drawCards(pid,e.draw||2); this._queueEffect({type:'discard_extra_turn_pending',playerId:pid,amount:e.discard||3}); break;
      case EFFECTS.DESTROY: if(tPid&&tCid){if(this._maybeIntercept('destroy',pid,tPid,tCid,true))return {pendingEffect:true}; this._destroyCard(tPid,tCid,pid,true);} else return {error:'Select target card'}; break;
      case EFFECTS.RETURN_TO_HAND:
        if(e.all&&e.ownStable){const unis=player.stable.filter(c=>this._isTargetableUnicorn(pid,c));player.stable=player.stable.filter(c=>!this._isTargetableUnicorn(pid,c));player.hand.push(...unis);this._drawCards(pid,2);this.addLog(`${player.name} returns unicorns to hand, draws 2`);}
        else if(tPid&&tCid){
          this._returnToHand(tPid,tCid,pid);
          if(e.thenDiscard){const owner=e.thenDiscard.owner==='target'?tPid:pid;this._queueEffect({type:'target_discard',playerId:owner,amount:e.thenDiscard.amount||1,source:'Back Kick'});}
        } else return {error:'Select target'};
        break;
      case EFFECTS.RETURN_TO_DECK:
        if(tPid&&tCid){const idx=this.players[tPid].stable.findIndex(c=>c.id===tCid);if(idx!==-1){const c=this.players[tPid].stable.splice(idx,1)[0];this.deck.push(c);this.deck=shuffle(this.deck);this.addLog(`${player.name} returns ${c.name} to deck`);}}
        else return {error:'Select target'};
        break;
      case EFFECTS.TRADE_HANDS: case 'trade_hands':
        if(tPlayer){[player.hand,tPlayer.hand]=[tPlayer.hand,player.hand];this.addLog(`${player.name} trades hands with ${tPlayer.name}`);}
        else return {error:'Select target player'};
        break;
      case EFFECTS.SKIP_TURN: case 'skip_turn':
        if(tPid){this.skippedPlayers.add(tPid);this.addLog(`${tPlayer.name} skips next turn`);}
        else return {error:'Select target player'};
        break;
      case EFFECTS.FROM_DISCARD: case 'from_discard': case 'revive_unicorn':
        this._discardPick(pid,e.type==='revive_unicorn'?{targetType:'unicorn'}:e,e.type!=='revive_unicorn',e.type==='revive_unicorn'||e.intoStable); break;
      case 'all_discard_one_shuffle_discard': {
        const targets = this.playerOrder.filter(p => this.players[p].hand.length > 0);
        if (targets.length === 0) {
          this.deck = shuffle([...this.deck, ...this.discard]); this.discard = [];
          this.addLog(`${card.name}: no one had a card to discard; discard pile shuffled in`);
        } else {
          targets.forEach((p, i) => this._queueEffect({ type:'discard_choice', playerId:p, amount:1, source:card.name, thenShuffleDiscard: i === targets.length - 1 }));
          this.addLog(`${card.name}: all players must discard 1 (their choice)`);
        }
        break;
      }
      case 'all_sacrifice_upgrades_downgrades_shuffle':
        for(const p of this.playerOrder){const rm=this.players[p].stable.filter(c=>c.type===CARD_TYPES.UPGRADE||c.type===CARD_TYPES.DOWNGRADE);this.players[p].stable=this.players[p].stable.filter(c=>c.type!==CARD_TYPES.UPGRADE&&c.type!==CARD_TYPES.DOWNGRADE);this.discard.push(...rm);}
        this.deck=shuffle([...this.deck,...this.discard]);this.discard=[];this.addLog(`Reset Button`); break;
      case 'all_sacrifice_upgrades_downgrades':
        for(const p of this.playerOrder){const rm=this.players[p].stable.filter(c=>c.type===CARD_TYPES.UPGRADE||c.type===CARD_TYPES.DOWNGRADE);this.players[p].stable=this.players[p].stable.filter(c=>c.type!==CARD_TYPES.UPGRADE&&c.type!==CARD_TYPES.DOWNGRADE);this.discard.push(...rm);}
        this.addLog(`Dragon-Scorched Stables`); break;
      case 'shake_up_shuffle_draw5': case 'shuffle_hand_discard_draw5':
        this.discard.push(...player.hand);player.hand=[];this.deck=shuffle([...this.deck,...this.discard]);this.discard=[];this._drawCards(pid,5);this.addLog(`${player.name}: Shake Up`); break;
      case 'return_one_each_stable': case 'all_return_one_to_hand': {
        const remaining = this.playerOrder.filter(p=>this.players[p].stable.length>0);
        if (remaining.length>0) this._queueEffect({type:'return_one_each_stable',playerId:pid,remaining});
        break;
      }
      case 'move_upgrade_or_downgrade_between_stables': this._queueEffect({type:'move_upgrade_or_downgrade_between_stables',playerId:pid}); break;
      case 'destroy_upgrade_or_sacrifice_downgrade': {
        const anyMod=Object.values(this.players).some(p=>p.stable.some(c=>c.type===CARD_TYPES.UPGRADE||c.type===CARD_TYPES.DOWNGRADE));
        if(!anyMod){this.addLog(`${player.name}: no Upgrades or Downgrades to target`);break;}
        this._queueEffect({type:'destroy_upgrade_or_sacrifice_downgrade',playerId:pid}); break;
      }
      case 'sacrifice_then_destroy_two': this._queueEffect({type:'sacrifice_then_destroy_two',playerId:pid,step:'sacrifice'}); break;
      case 'move_own_unicorn_steal_unicorn': {
        const hasOwn = player.stable.some(c=>this._isTargetableUnicorn(pid,c));
        const hasTargetUnicorn = this.playerOrder.some(p=>p!==pid && this.players[p].stable.some(c=>this._isTargetableUnicorn(p,c)));
        if (hasOwn && hasTargetUnicorn) this._queueEffect({type:'move_own_unicorn_steal_unicorn',playerId:pid});
        else this.addLog(`${card.name}: no valid Unicorns to swap`);
        break;
      }
      case 'look_hand_take_one': case 'look_and_take':
        if(tPlayer)this._queueEffect({type:'look_and_take',playerId:pid,targetPlayerId:tPid,revealedHand:tPlayer.hand.map(c=>({...c}))});
        else return {error:'Select target player'};
        break;
      case 'all_sacrifice_unicorn': case EFFECTS.ALL_SACRIFICE: {
        const queue=this.playerOrder.filter(p=>this.players[p].stable.some(c=>this._isTargetableUnicorn(p,c)));
        for(const p of queue)this._queueEffect({type:'sacrifice_unicorn',playerId:p,source:card.name}); break;
      }
      case 'all_sacrifice_discard_shuffle_deal5': {
        // "DISCARD their hand" — all of it, no choice, happens immediately for
        // everyone. "SACRIFICE a card" (from their Stable) IS a choice, though
        // — queue one sacrifice_any per player with a stable card to sacrifice;
        // the shuffle + deal-5 happens once the LAST one resolves (thenShuffleDealFive).
        for (const p of this.playerOrder) { this.discard.push(...this.players[p].hand); this.players[p].hand=[]; }
        const targets = this.playerOrder.filter(p => this.players[p].stable.length>0);
        if (targets.length === 0) {
          this.deck=shuffle([...this.deck,...this.discard]);this.discard=[];
          for(const p of this.playerOrder)this._drawCards(p,5);
          this.addLog(`Rainbow Shitstorm!`);
        } else {
          targets.forEach((p,i) => this._queueEffect({ type:'sacrifice_any', playerId:p, source:card.name, thenShuffleDealFive: i===targets.length-1 }));
          this.addLog(`${card.name}: everyone discards their hand; each player must now sacrifice a card`);
        }
        break;
      }
      case 'sacrifice_n_destroy_n': this._queueEffect({type:'sacrifice_n_destroy_n',playerId:pid,sacrificed:[]}); break;
      case 'sacrifice_unicorn_revive_unicorn': this._queueEffect({type:'sacrifice_then_revive',playerId:pid,step:'sacrifice'}); break;
      case 'discard_two_steal_unicorn': this._queueEffect({type:'discard_n_steal_unicorn',playerId:pid,needed:2}); break;
      case 'discard_then_steal': this._queueEffect({type:'discard_then_steal',playerId:pid}); break;
      case 'search_deck_magic_play_immediately': this._queueEffect({type:'search_deck_magic_play',playerId:pid}); break;
      case 'discard_two_bring_two_babies': this._queueEffect({type:'discard_two_bring_two_babies',playerId:pid}); break;
      case EFFECTS.EXTRA_TURN: this.extraTurns[pid]=(this.extraTurns[pid]||0)+1;this.addLog(`${player.name} takes extra turn!`); break;
      case 'apocalypse_sacrifice_all_destroy_each_search': {
        // Sacrifice ALL of your own Unicorns — no choice involved, matches the text.
        for(const u of player.stable.filter(c=>this._isTargetableUnicorn(pid,c)))this.discard.push(u);
        player.stable=player.stable.filter(c=>!this._isTargetableUnicorn(pid,c));
        // "DESTROY a Unicorn card in EACH other player's Stable" — the ACTOR
        // chooses which one in each stable (standard destroy convention), not
        // auto-picked. Queue one choose_destroy per opponent who has a target.
        const targets = this.playerOrder.filter(p=>p!==pid && this.players[p].stable.some(c=>this._isTargetableUnicorn(p,c)));
        for (const p of targets) this._queueEffect({ type:'choose_destroy', playerId:pid, targetType:'unicorn', onlyPlayerId:p, source:card.name });
        if(e.searchFor)this._searchDeckPick(pid,{nameContains:e.searchFor},false,true);
        this.addLog(`${card.name}: Apocalypse!`);
        if (this.pendingEffect) return {pendingEffect:true};
        break;
      }
      case 'destroy_three_add_three_babies': this._queueEffect({type:'destroy_three_add_three_babies',playerId:pid,targetPlayerId:tPid}); break;
      case 'sacrifice_four_search_four': this._queueEffect({type:'sacrifice_four_search_four',playerId:pid}); break;
      case 'discard_up_to_two_force_sacrifice': this._queueEffect({type:'discard_up_to_two_force_sacrifice',playerId:pid}); break;
      case 'destroy_each_opponent_unicorn_offer_babies': {
        // "DESTROY a Unicorn in EACH other player's Stable" — the ACTOR chooses
        // which one (standard destroy convention), not auto-picked. "Each other
        // player MAY bring a Baby Unicorn from the Nursery" — THEIR optional
        // choice, triggered only for whoever actually lost a Unicorn.
        const targets = this.playerOrder.filter(p=>p!==pid && this.players[p].stable.some(c=>this._isTargetableUnicorn(p,c)));
        for (const p of targets) this._queueEffect({ type:'choose_destroy', playerId:pid, targetType:'unicorn', onlyPlayerId:p, thenOfferNurseryTo:p, source:'Spray Bottle of Youth' });
        this.addLog(`Spray Bottle of Youth`);
        if (this.pendingEffect) return {pendingEffect:true};
        break;
      }
      case 'all_return_baby_to_nursery': for(const p of this.playerOrder){const b=this.players[p].stable.findIndex(c=>c.type===CARD_TYPES.BABY_UNICORN);if(b!==-1)this.nursery.push(this.players[p].stable.splice(b,1)[0]);}this.addLog(`All return babies`); break;
      case 'draw_equal_to_basics_in_stable': { const n=player.stable.filter(c=>c.type===CARD_TYPES.BASIC_UNICORN).length;if(n>0){this._drawCards(pid,n);this.addLog(`${player.name} draws ${n}`);} break; }
      case 'revive_basic_draw': this._discardPick(pid,{targetType:'basic'},false,true,1); break;
      case 'destroy_all_basics_one_player': this._queueEffect({type:'destroy_all_basics_one_player',playerId:pid,targetPlayerId:tPid}); break;
      case 'search_nightmare_downgrade_into_stable': this._queueEffect({type:'search_nightmare_downgrade_into_stable',playerId:pid}); break;
      case 'remove_from_game':
        // Route through _destroyCard (byMagic=true, toRemovedFromGame=true) so this respects
        // indestructible cards (Phantom Unicorn), Kittencorn's magic-destroy immunity, all
        // discard-instead shields (Dragon Protection, Black Knight, on_sac_or_destroy), the
        // Phoenix, and on_sac_or_destroy/on_steal_or_destroy triggers — and is still
        // interceptable via Fishing Rod / Unicorn Net — instead of bypassing all of it.
        if(tPid&&tCid){
          if(!this._maybeIntercept('destroy',pid,tPid,tCid,true,{toRemovedFromGame:true})) this._destroyCard(tPid,tCid,pid,true,true);
        } else return {error:'Select target'};
        break;
      case 'force_discard_give_card_destroy_unicorn': this._queueEffect({type:'fuck_marry_kill',playerId:pid}); break;
      case 'sacrifice_revive_upgrade_from_discard': this._queueEffect({type:'sacrifice_revive_upgrade_from_discard',playerId:pid}); break;
      case 'move_own_card_pull_from_that_player': this._queueEffect({type:'move_own_card_pull_from_that_player',playerId:pid}); break;
      case 'discard_n_draw_n_extra_turn': this._queueEffect({type:'discard_n_draw_n_extra_turn',playerId:pid}); break;
      case 'destroy_then_target_may_destroy':
        if(tPid&&tCid){
          if(!this._maybeIntercept('destroy',pid,tPid,tCid,false)) this._destroyCard(tPid,tCid,pid);
          this._queueEffect({type:'may_destroy_optional',playerId:tPid,source:card.name});
        }
        else return {error:'Select target'}; break;
      case EFFECTS.NEIGH: case 'neigh_remove_from_game': break;
      // Adventures magic choice cards
      case 'choice_sacrifice_destroy_or_revive_from_discard': this._queueEffect({type:'choice_sacrifice_destroy_or_revive_from_discard',playerId:pid}); break;
      case 'choice_draw3_discard1_or_add_from_discard': this._queueEffect({type:'choice_draw3_discard1_or_add_from_discard',playerId:pid}); break;
      case 'choice_discard3_extra_turn_or_move_steal_unicorn': this._queueEffect({type:'choice_discard3_extra_turn_or_move_steal_unicorn',playerId:pid}); break;
      case 'choice_reveal_all_hands_or_take_from_all': this._queueEffect({type:'choice_reveal_all_hands_or_take_from_all',playerId:pid,revealedHands:Object.fromEntries(this.playerOrder.map(p=>[p,this.players[p].hand.map(c=>({...c}))]))}); break;
      case 'choice_revive_unicorn_or_two_unicorns_to_hand': this._queueEffect({type:'choice_revive_unicorn_or_two_unicorns_to_hand',playerId:pid}); break;
      // Intercept instants — these are played reactively (handled via playInstant flow); if somehow in magic path, treat as no-op
      case 'intercept_steal_into_your_stable': case 'intercept_sacrifice_or_destroy_add_to_hand': break;
      // Flare Gun: target player skips beginning phase and draws instead
      case 'target_skip_beginning_and_draw': {
        if(!tPid)return {error:'Select a target player'};
        this.skippedPlayers.add(tPid); this.skippedDrawPlayers.delete(tPid);
        // Grant target a draw at start of their next skipped turn by marking skip_beginning_draw
        if(!this.skipBeginningDraw)this.skipBeginningDraw={};
        this.skipBeginningDraw[tPid]=true;
        this.addLog(`${player.name}: Flare Gun — ${this.players[tPid].name} skips beginning, draws instead`);
        break;
      }
      // Nightmares: Buried Alive / other nightmares magic effects routed here if needed
      default:
        this.addLog(`${card.name} played`);
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[UU] _executeMagic: unhandled effect type '${e.type}' on card '${card.name}'`);
        }
    }
    return {ok:true};
  }

  resolvePendingEffect(pid, selectedCardIds, extra) {
    if (!this.pendingEffect) return { error:'No pending effect' };
    const eff = this.pendingEffect;
    const player = this.players[pid];
    const sel = selectedCardIds || [];
    const done = () => { this._effectDone(); return {ok:true}; };
    const doneB = () => { this._effectDoneBeginning(pid); return {ok:true}; };

    // ── Beginning choices ──────────────────────────────────────────────────────
    if (eff.type==='beginning_optional_choices' && eff.playerId===pid) {
      let endTurn = false;
      for (const ch of (eff.choices||[])) {
        if (sel.includes(ch.cardId)) {
          const sc = player.stable.find(c=>c.id===ch.cardId);
          if (sc && this._queueBeginningEffect(sc, pid) === 'END_TURN') endTurn = true;
        }
      }
      if (endTurn) {
        // A chosen effect (e.g. Rainbow Sprinkles) explicitly ends the turn —
        // this skips straight to the next player rather than doneB()'s normal
        // "return to Draw phase", and discards any other still-queued optional
        // effects for this turn, matching "immediately end your turn".
        this._endTurnNow();
        return {ok:true};
      }
      return doneB();
    }

    // ── Intercept offer (Fishing Rod / Unicorn Net) ─────────────────────────────
    // extra.intercept truthy → holder plays their counter-instant, redirecting the
    // steal/destroy/sacrifice. Otherwise (declined / no counter-instant played) the
    // original action proceeds exactly as if no intercept window had existed.
    if (eff.type==='intercept_offer' && eff.playerId===pid) {
      const { kind, action } = eff;
      const wasIntercepted = !!extra?.intercept;
      const finishIntercept = () => {
        if (action.grantNurseryTo && this.nursery.length>0) this._placeCard(action.grantNurseryTo, this.nursery.pop(), null, null);
        if (action.continuation) this._runContinuation(action.continuation, wasIntercepted);
        if (action.advance==='doneB') { this._effectDoneBeginning(action.byPid); return {ok:true}; }
        if (action.advance==='endTurn') { this._endTurnNow(); return {ok:true}; }
        return done();
      };
      if (extra?.intercept) {
        const ci = player.hand.findIndex(c=>c.id===eff.interceptCardId);
        if (ci===-1) return { error:'Intercept card not in hand' };
        const interceptCard = player.hand.splice(ci,1)[0];
        this.discard.push(interceptCard);
        const fromP = this.players[action.tPid];
        const idx = fromP?.stable.findIndex(c=>c.id===action.tCid) ?? -1;
        if (idx !== -1) {
          const grabbed = fromP.stable.splice(idx,1)[0];
          this._onUnicornLeft(action.tPid, grabbed);  // the original owner lost it, whichever way it went
          if (kind==='steal') {
            player.stable.push(grabbed);
            this.addLog(`${player.name} plays ${interceptCard.emoji} ${interceptCard.name} — intercepts and steals ${grabbed.emoji} ${grabbed.name} instead!`);
            this._onUnicornEntered(pid, grabbed);   // the interceptor's Stable gained a Unicorn
            this._enterTrigger(grabbed, pid, null, null);
          } else {
            player.hand.push(grabbed);
            this.addLog(`${player.name} plays ${interceptCard.emoji} ${interceptCard.name} — adds ${grabbed.emoji} ${grabbed.name} to hand instead!`);
          }
        } else {
          this.addLog(`${interceptCard.name}: nothing to intercept — card already gone`);
        }
        // The intercepted cost/effect never completed, so cost-triggered follow-ups
        // (thenDraw, thenDiscardPick) are skipped — only the redirect itself happens.
        return finishIntercept();
      } else {
        // Declined — the original steal/destroy/sacrifice proceeds unchanged.
        if (action.resumeType==='steal') this._stealCard(action.byPid, action.tPid, action.tCid);
        else if (action.resumeType==='sacrifice') this._sacrificeCard(action.tPid, action.tCid);
        else { this._kittenProtects = action.kittenProtects; this._destroyCard(action.tPid, action.tCid, action.byPid, action.byMagic, action.toRemovedFromGame); }
        if (action.thenDraw) this._drawCards(action.byPid, action.thenDraw);
        if (action.thenDiscardPick) this._discardPick(action.byPid, action.thenDiscardPick, false, true);
        if (action.thenRequeue) this._queueEffect(action.thenRequeue);
        return finishIntercept();
      }
    }

    // ── Rhinocorn: beginning destroy then end turn ─────────────────────────────
    if (eff.type==='beginning_destroy_end_turn' && eff.playerId===pid) {
      if (extra?.skip) { return doneB(); }
      if (extra?.targetPlayerId && extra?.targetCardId) {
        const tCard = this.players[extra.targetPlayerId]?.stable.find(c=>c.id===extra.targetCardId);
        if (!tCard || (eff.targetType && !(eff.targetType==='unicorn' ? this._isTargetableUnicorn(extra.targetPlayerId,tCard) : tCard.type===eff.targetType))) {
          return {error:'Select a Unicorn'};
        }
        this.pendingEffect = null; // about to become intercept_offer, or resolve immediately below
        const intercepted = this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false, {advance:'endTurn'});
        if (!intercepted) {
          this._destroyCard(extra.targetPlayerId, extra.targetCardId, pid);
          this._endTurnNow();   // reactions to the destroy (or a shield offer) still resolve first
        }
        return {ok:true};
      }
      return doneB();
    }

    // ── Search deck pick ───────────────────────────────────────────────────────
    if (eff.type==='search_deck_pick' && eff.playerId===pid) {
      if (sel.length>0 && eff.options) {
        const chosen = eff.options.find(c=>c.id===sel[0]);
        if (chosen) {
          const rest = eff.options.filter(c=>c.id!==chosen.id);
          if (eff.intoStable) { this._placeCard(pid, chosen, null, null); this.addLog(`${player.name} → ${chosen.emoji} ${chosen.name} into stable`); }
          else { player.hand.push(chosen); this.addLog(`${player.name} → ${chosen.name} to hand`); }
          this.deck.push(...rest); this.deck = shuffle(this.deck);
          if (eff.thenPlay) {
            // Play the magic card immediately
            const ci = player.hand.findIndex(c=>c.id===chosen.id);
            if (ci!==-1) { player.hand.splice(ci,1); this._executeMagic(pid,chosen,extra?.targetPlayerId,extra?.targetCardId); }
          }
        } else { this.deck.push(...(eff.options||[])); this.deck=shuffle(this.deck); }
      } else { this.deck.push(...(eff.options||[])); this.deck=shuffle(this.deck); }
      return done();
    }

    // ── Search nightmare downgrade into specific stable ────────────────────────
    if (eff.type==='search_nightmare_downgrade_into_stable' && eff.playerId===pid) {
      const matches = this.deck.filter(c=>c.type===CARD_TYPES.DOWNGRADE&&c.expansion==='nightmares');
      if (matches.length>0) {
        const ids=new Set(matches.map(c=>c.id)); this.deck=this.deck.filter(c=>!ids.has(c.id)); this.deck=shuffle(this.deck);
        const targetPid = extra?.targetPlayerId || pid;
        if (sel.length>0) {
          const chosen=matches.find(c=>c.id===sel[0]);
          if (chosen) { this._placeCard(targetPid, chosen, null, null); this.addLog(`${player.name}: The Cornjuring → ${chosen.emoji} ${chosen.name}`); }
          const rest=matches.filter(c=>c.id!==sel[0]); this.deck.push(...rest); this.deck=shuffle(this.deck);
        } else { this.deck.push(...matches); this.deck=shuffle(this.deck); }
      }
      return done();
    }

    // ── From discard pick ──────────────────────────────────────────────────────
    if (eff.type==='from_discard_pick' && eff.playerId===pid) {
      if (sel.length>0 && eff.options) {
        let chosen = eff.options.find(c=>c.id===sel[0]);
        if (chosen && eff.targetType) {
          const typeOk = eff.targetType==='unicorn' ? IS_UNICORN(chosen.type) : chosen.type===eff.targetType;
          if (!typeOk) chosen = null; // reject a mismatched selection rather than placing/handing it out
        }
        if (chosen) {
          const rest = eff.options.filter(c=>c.id!==chosen.id);
          if (eff.intoStable) { this._placeCard(pid, chosen, null, null); this.addLog(`${player.name} revives ${chosen.emoji} ${chosen.name} into stable`); }
          else { player.hand.push(chosen); this.addLog(`${player.name} takes ${chosen.name} from discard`); }
          this.discard.push(...rest);
          if (eff.thenDraw) this._drawCards(pid, eff.thenDraw);
        } else { this.discard.push(...(eff.options||[])); }
      } else { this.discard.push(...(eff.options||[])); }
      if (eff.endTurnAfter) {
        // Any other effect still queued behind this one would otherwise have its
        // extracted cards (e.g. a search result sitting in .options, pending a
        // player's choice) silently vanish when the queue is wiped below — salvage
        // them back to discard first so nothing is lost from the game.
        this._endTurnNow(); return {ok:true};
      }
      return eff.fromBeginning ? doneB() : done();
    }

    // ── Discard N ──────────────────────────────────────────────────────────────
    if (eff.type==='discard' && eff.playerId===pid) {
      if (sel.length < eff.amount && player.hand.length >= eff.amount) return {error:`Select ${eff.amount} card(s) to discard`};
      for (const cid of sel.slice(0,eff.amount)) { const i=player.hand.findIndex(c=>c.id===cid); if(i!==-1)this.discard.push(player.hand.splice(i,1)[0]); }
      this.addLog(`${player.name} discards ${Math.min(sel.length,eff.amount)}`);
      return done();
    }

    // discard_choice — like 'discard' but used for all-players effects (e.g. Llamacorn):
    // each affected player picks their own card; one is queued per player in turn order.
    // ── shield_offer: "if X would be destroyed/sacrificed, you MAY <cost> instead" ──
    // Queued by _offerShield (see SHIELD_RULES). The protected card has NOT moved yet.
    if (eff.type==='shield_offer' && eff.playerId===pid) {
      const finish = () => eff.fromBeginning ? doneB() : done();
      if (extra?.use) {
        if (eff.cost.kind === 'discard') {
          if (player.hand.length < eff.cost.n) return { error:`You need ${eff.cost.n} card(s) in your hand to use ${eff.shieldName}` };
          this._queueEffect({ type:'discard_choice', playerId:pid, amount:eff.cost.n, source:eff.shieldName, reactive:true, fromBeginning:eff.fromBeginning });
        } else if (player.stable.some(c => c.id === eff.shieldCardId)) {
          this._sacrificeCard(pid, eff.shieldCardId, { declined:eff.declined });
        }
        this.addLog(`${player.name}: ${eff.shieldName} — ${eff.protectedName} is saved`);
        return finish();
      }
      // Declined: the original sacrifice/destroy goes ahead (a DIFFERENT shield may still be offered).
      this._kittenProtects = eff.kittenProtects;
      if (eff.how === 'sacrifice') this._sacrificeCard(pid, eff.protectedCardId, { declined:eff.declined });
      else this._destroyCard(pid, eff.protectedCardId, eff.byPid, eff.byMagic, eff.toRemovedFromGame, { declined:eff.declined });
      return finish();
    }

    // ── wall_of_horns_offer: "you MAY pull a card at random from that player's hand" ──
    if (eff.type==='wall_of_horns_offer' && eff.playerId===pid) {
      const finish = () => eff.fromBeginning ? doneB() : done();
      if (extra?.use && !extra?.skip) {
        const attacker = this.players[eff.attackerId];
        if (attacker && attacker.hand.length > 0) {
          const ri = Math.floor(Math.random() * attacker.hand.length);
          player.hand.push(attacker.hand.splice(ri, 1)[0]);
          this.addLog(`${player.name}: ${eff.source||'Wall of Horns'} — pulls a card from ${attacker.name}`);
        }
      } else {
        this.addLog(`${player.name} declines to pull a card (${eff.source||'Wall of Horns'})`);
      }
      return finish();
    }

    if (eff.type==='discard_choice' && eff.playerId===pid) {
      const needed = Math.min(eff.amount||1, player.hand.length);
      if (sel.length < needed) return {error:`Select ${needed} card(s) to discard`};
      const justDiscarded = [];
      for (const cid of sel.slice(0,needed)) { const i=player.hand.findIndex(c=>c.id===cid); if(i!==-1){ const c=player.hand.splice(i,1)[0]; this.discard.push(c); justDiscarded.push(c); } }
      this.addLog(`${player.name} discards ${needed}${eff.source?` (${eff.source})`:''}`);
      if (eff.thenShuffleDiscard) {
        this.deck = shuffle([...this.deck, ...this.discard]); this.discard = [];
        this.addLog(`Discard pile shuffled into the deck`);
      }
      // Frenchiecorn-style chain: each victim's own discarded card(s) get
      // threaded forward through remainingTargets/gathered until everyone's
      // gone, then the actor gets to pick one of the (actually-discarded, not
      // random) cards via take_one_from_list.
      if (eff.gatherForActor) {
        const gathered = [...(eff.gathered||[]), ...justDiscarded];
        if (eff.remainingTargets && eff.remainingTargets.length > 0) {
          const [nextTarget, ...rest] = eff.remainingTargets;
          this._queueEffect({ type:'discard_choice', playerId:nextTarget, amount:1, source:eff.source, gatherForActor:eff.gatherForActor, gathered, remainingTargets:rest });
        } else if (gathered.length > 0) {
          this._queueEffect({ type:'take_one_from_list', playerId:eff.gatherForActor, options:gathered });
        }
      }
      // Hands control back to a different player's own multi-step flow (e.g.
      // Fuck. Marry. Kill: the acting player forces someone else to discard —
      // their own choice of card — then the ACTOR resumes picking who to give
      // a card to and which Unicorn to destroy).
      if (eff.resumeEffect) this._queueEffect(eff.resumeEffect);
      return eff.fromBeginning ? doneB() : done();
    }

    if (eff.type==='end_discard' && eff.playerId===pid) {
      const need = Math.min(eff.amount, player.hand.length);
      if (sel.length < need) return {error:`Select ${need} card(s) to discard`};
      for (const cid of sel.slice(0,eff.amount)) { const i=player.hand.findIndex(c=>c.id===cid); if(i!==-1)this.discard.push(player.hand.splice(i,1)[0]); }
      this.addLog(`${player.name} discards to hand limit`);
      this.pendingEffect=null; this._endPhase(); return {ok:true};
    }

    if (eff.type==='discard_extra_turn_pending' && eff.playerId===pid) {
      if (sel.length < eff.amount && player.hand.length >= eff.amount) return {error:`Select ${eff.amount} to discard`};
      for (const cid of sel.slice(0,eff.amount)) { const i=player.hand.findIndex(c=>c.id===cid); if(i!==-1)this.discard.push(player.hand.splice(i,1)[0]); }
      this.extraTurns[pid]=(this.extraTurns[pid]||0)+1; this.addLog(`${player.name} discards, takes extra turn`);
      return done();
    }

    if (eff.type==='target_discard' && eff.playerId===pid) {
      if (!sel.length) return {error:'Select a card to discard'};
      const i=player.hand.findIndex(c=>c.id===sel[0]); if(i!==-1)this.discard.push(player.hand.splice(i,1)[0]);
      this.addLog(`${player.name} discards`); return done();
    }

    // ── Choose destroy/steal/return ────────────────────────────────────────────
    if (eff.type==='choose_destroy' && eff.playerId===pid) {
      // Optional steal/destroy effects (e.g. Alluring Narwhal, Dragon Unicorn) must be
      // skippable — including when no legal target exists at all — or the game stalls
      // forever with no way to resolve this effect. (Latent bug: previously there was
      // no skip path here at all, even though this pendingEffect can be queued with
      // eff.optional:true.)
      if (extra?.skip || (!extra?.targetPlayerId && !extra?.targetCardId && eff.optional)) return done();
      if (!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Click a card in a stable to destroy it'};
      // "DESTROY a Unicorn in EACH other player's Stable" (Fire and Brimstone,
      // Zombie Apocalypse, etc.) queues one of these per opponent — restrict
      // this particular instance to that one opponent's stable so the actor
      // can't just dump every destroy on a single player.
      if (eff.onlyPlayerId && extra.targetPlayerId !== eff.onlyPlayerId) return {error:`Must destroy a Unicorn in ${this.players[eff.onlyPlayerId]?.name}'s stable`};
      // Enforce targetType restriction (e.g. Stabby the Unicorn: unicorn only)
      if (eff.targetType) {
        const fromStable = this.players[extra.targetPlayerId]?.stable;
        const targetCard = fromStable?.find(c=>c.id===extra.targetCardId);
        if (!targetCard) return {error:'Card not found in that stable'};
        const typeOk = eff.targetType==='unicorn'   ? this._isTargetableUnicorn(extra.targetPlayerId,targetCard) :
                       eff.targetType==='upgrade'    ? targetCard.type===CARD_TYPES.UPGRADE :
                       eff.targetType==='downgrade'  ? targetCard.type===CARD_TYPES.DOWNGRADE : true;
        if (!typeOk) return {error:`You can only destroy a ${eff.targetType} card`};
      }
      const remaining=(eff.count||1)-1;
      // If an interceptor is offered the destroy and DECLINES, the destroy still happens later
      // (intercept_offer resolver) — so the Nursery offer has to ride along as thenRequeue, or a
      // table with a Net in play would silently lose it.
      const nurseryOffer = eff.thenOfferNurseryTo ? { type:'take_from_nursery', playerId:eff.thenOfferNurseryTo, optional:true, source:eff.source } : null;
      const intercepted = this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false, nurseryOffer ? { thenRequeue: nurseryOffer } : {});
      if (!intercepted) {
        this._destroyCard(extra.targetPlayerId,extra.targetCardId,pid);
        // Spray Bottle of Youth: "Each other player may bring a Baby Unicorn
        // from the Nursery" — only for the player whose Unicorn was actually
        // just destroyed, and only if the destroy wasn't intercepted/blocked.
        // Their own optional choice (take_from_nursery already supports skip),
        // not an automatic grant.
        if (nurseryOffer) this._queueEffect(nurseryOffer);
      }
      if (remaining>0) this._queueEffect({...eff,count:remaining});
      return done();
    }

    if (eff.type==='may_destroy_optional' && eff.playerId===pid) {
      if (extra?.targetPlayerId&&extra?.targetCardId) {
        if (!this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false)) {
          this._destroyCard(extra.targetPlayerId,extra.targetCardId,pid);
        }
      }
      return done();
    }

    if (eff.type==='choose_steal' && eff.playerId===pid) {
      if (extra?.skip || (!extra?.targetPlayerId && !extra?.targetCardId && eff.optional)) return done();
      if (!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Click a card in a stable to steal it'};
      // Enforce targetType restriction (e.g. Alluring Narwhal: upgrade only)
      if (eff.targetType) {
        const fromStable = this.players[extra.targetPlayerId]?.stable;
        const targetCard = fromStable?.find(c=>c.id===extra.targetCardId);
        if (!targetCard) return {error:'Card not found in that stable'};
        const typeOk = eff.targetType==='upgrade'  ? targetCard.type===CARD_TYPES.UPGRADE :
                       eff.targetType==='unicorn'   ? this._isTargetableUnicorn(extra.targetPlayerId,targetCard) :
                       eff.targetType==='downgrade' ? targetCard.type===CARD_TYPES.DOWNGRADE : true;
        if (!typeOk) return {error:`You can only steal a ${eff.targetType} card`};
      }
      if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false)) {
        this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
      }
      return done();
    }

    if (eff.type==='choose_return' && eff.playerId===pid) {
      if (extra?.skip) return done();
      if (!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Click a card in a stable to return it'};
      this._returnToHand(extra.targetPlayerId,extra.targetCardId,pid); return done();
    }

    // ── Sacrifice variants (all routed through _sacrificeCard) ─────────────────
    if (eff.type==='sacrifice_unicorn' && eff.playerId===pid) {
      const nextInQueue = eff._queue?.length>0
        ? { type:'requeue', effect:{type:'sacrifice_unicorn',playerId:eff._queue[0],_queue:eff._queue.slice(1)} }
        : null;
      if (!player.stable.some(c=>this._isTargetableUnicorn(pid,c))) {
        // No valid (unprotected) Unicorn to sacrifice — nothing happens, per "Cards that
        // affect Unicorn cards do not affect your Pandas/Reindeer".
        this.addLog(`${player.name}: no valid Unicorn to sacrifice — skipped`);
        if (nextInQueue) this._queueEffect(nextInQueue.effect);
        return done();
      }
      if (!sel.length) return {error:'Select a unicorn to sacrifice'};
      if (!player.stable.find(c=>c.id===sel[0]&&this._isTargetableUnicorn(pid,c))) return {error:'Select a Unicorn'};
      const cid = sel[0];
      const intercepted = this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', continuation:nextInQueue});
      if (!intercepted) {
        const r=this._sacrificeCard(pid,cid);
        if(r?.error) return r;
        if (eff.thenDraw) this._drawCards(pid, eff.thenDraw);
        if (nextInQueue) this._queueEffect(nextInQueue.effect);
      }
      return done();
    }

    if (eff.type==='sacrifice_any' && eff.playerId===pid) {
      const finish = () => eff.fromBeginning ? doneB() : done();
      const afterAll = () => {
        // Rainbow Shitstorm: after every player's chosen sacrifice has resolved,
        // shuffle the discard pile into the deck and deal everyone a fresh hand
        // of 5 — flagged only on the LAST queued sacrifice_any so it fires once.
        if (eff.thenShuffleDealFive) {
          this.deck = shuffle([...this.deck, ...this.discard]); this.discard = [];
          for (const p of this.playerOrder) { this.players[p].hand = []; this._drawCards(p, 5); }
          this.addLog(`Rainbow Shitstorm: discard shuffled into deck, everyone deals a fresh hand of 5`);
        }
        // Caffeine Overload: "SACRIFICE a card, then DRAW N cards."
        if (eff.thenDraw) this._drawCards(pid, eff.thenDraw);
      };
      // Caffeine Overload: "you MAY sacrifice a card" — a real decline option,
      // not just an empty-stable auto-skip.
      if (extra?.skip && eff.optional) { this.addLog(`${player.name} declines to sacrifice`); return finish(); }
      if (!player.stable.length) { this.addLog(`${player.name}: nothing to sacrifice — skipped`); afterAll(); return finish(); }
      if (!sel.length) return {error:'Select a card to sacrifice'};
      if (!player.stable.find(c=>c.id===sel[0])) return {error:'Not in your stable'};
      const cid = sel[0];
      const intercepted = this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', advance: eff.fromBeginning?'doneB':'done'});
      if (!intercepted) {
        const r=this._sacrificeCard(pid,cid);
        if(r?.error) return r;
        afterAll();
      }
      return finish();
    }

    if (eff.type==='sacrifice_unicorn_tiny_stable' && eff.playerId===pid) {
      if (!sel.length) return {error:'Select a unicorn to sacrifice (Tiny Stable)'};
      if (player.stable.find(c=>c.id===sel[0]&&this._isTargetableUnicorn(pid,c))) {
        if (!this._maybeIntercept('destroy', pid, pid, sel[0], false, {resumeType:'sacrifice'})) this._sacrificeCard(pid,sel[0]);
      }
      return done();
    }

    if (eff.type==='sacrifice_unicorn_then_draw' && eff.playerId===pid) {
      const hasUnicorn = player.stable.some(c=>this._isTargetableUnicorn(pid,c));
      if (extra?.skip || (!sel.length && (eff.optional || !hasUnicorn))) return doneB();
      if (!sel.length) return {error:'Select a unicorn to sacrifice'};
      const si=player.stable.findIndex(c=>c.id===sel[0]&&this._isTargetableUnicorn(pid,c)); if(si===-1)return {error:'Select a Unicorn'};
      const cid=sel[0];
      if (!this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', advance:'doneB', thenDraw:eff.draw||1})) {
        this._sacrificeCard(pid,cid); this._drawCards(pid,eff.draw||1);
        this.addLog(`${player.name} sacrifices unicorn, draws ${eff.draw||1}`);
      }
      return doneB();
    }

    if (eff.type==='sacrifice_basic_draw_three' && eff.playerId===pid) {
      const hasBasic = player.stable.some(c=>c.type===CARD_TYPES.BASIC_UNICORN);
      // No feasibility check existed at all before this fix — if the player had zero
      // Basic Unicorns in their stable when this card resolved, the game had no way
      // to ever close this pendingEffect (mandatory selection with an impossible pool).
      if (extra?.skip || !hasBasic) { this.addLog(`${player.name}: no Basic Unicorn to sacrifice — skipped`); return done(); }
      if (!sel.length) return {error:'Select a Basic Unicorn to sacrifice'};
      const si=player.stable.findIndex(c=>c.id===sel[0]&&c.type===CARD_TYPES.BASIC_UNICORN); if(si===-1)return {error:'Select a Basic Unicorn'};
      const cid=sel[0];
      if (!this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', thenDraw:3})) {
        this._sacrificeCard(pid,cid); this._drawCards(pid,3); this.addLog(`${player.name} sacrifices basic, draws 3`);
      }
      return done();
    }

    if (eff.type==='sacrifice_unicorn_destroy_unicorn' && eff.playerId===pid) {
      // Unicorn of Death (the only card using this type) is a beginning-phase
      // trigger — every exit must return to the Draw phase (doneB), not end
      // the action phase (done) — the Gift Inspector bug class — and "you MAY
      // sacrifice" needs an actual decline option, which was missing entirely.
      const finish = () => eff.fromBeginning ? doneB() : done();
      if (extra?.skip && eff.optional && !eff.sacrificeDone) { this.addLog(`${player.name} declines`); return finish(); }
      if (!eff.sacrificeDone) {
        if (!player.stable.some(c=>this._isTargetableUnicorn(pid,c))) {
          this.addLog(`${player.name}: no valid Unicorn to sacrifice — skipped`);
          this.pendingEffect={...eff,sacrificeDone:true}; return {ok:true};
        }
        if (!sel.length) return {error:'Select a unicorn to sacrifice'};
        const si=player.stable.findIndex(c=>c.id===sel[0]&&this._isTargetableUnicorn(pid,c)); if(si===-1)return {error:'Select a Unicorn'};
        const cid=sel[0];
        const intercepted = this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', thenRequeue:{...eff,sacrificeDone:true}, advance: eff.fromBeginning?'doneB':'done'});
        if (!intercepted) {
          this._sacrificeCard(pid,cid); this.addLog(`${player.name} sacrifices`);
          this.pendingEffect={...eff,sacrificeDone:true}; return {ok:true};
        }
        return finish();
      }
      if (!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Select a unicorn to destroy'};
      if (!this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false, {advance: eff.fromBeginning?'doneB':'done'})) this._destroyCard(extra.targetPlayerId,extra.targetCardId,pid);
      return finish();
    }

    if (eff.type==='sacrifice_then_revive' && eff.playerId===pid) {
      if (eff.step==='sacrifice') {
        if (extra?.skip) return done();
        if (!player.stable.some(c=>this._isTargetableUnicorn(pid,c))) {
          this.addLog(`${player.name}: no valid Unicorn to sacrifice — skipped`);
          return done();
        }
        if (!sel.length) return {error:'Select a unicorn to sacrifice'};
        const si=player.stable.findIndex(c=>c.id===sel[0]&&this._isTargetableUnicorn(pid,c)); if(si===-1)return {error:'Select a Unicorn'};
        const cid=sel[0];
        const intercepted = this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', thenDiscardPick:{targetType:'unicorn'}});
        if (!intercepted) {
          this._sacrificeCard(pid,cid); this.addLog(`${player.name} sacrifices`);
          this._discardPick(pid,{targetType:'unicorn'},false,true);
        }
        // Whether intercepted (deferred) or resolved directly above, advance to whatever's
        // now queued (the intercept offer, a from_discard_pick, or nothing at all).
        this.pendingEffect = null;
        if (this.pendingEffectQueue.length > 0) this.pendingEffect = this.pendingEffectQueue.shift();
        return {ok:true};
      }
    }

    if (eff.type==='sacrifice_then_destroy_two' && eff.playerId===pid) {
      if (eff.step==='sacrifice') {
        if (!sel.length) return {error:'Select a card to sacrifice'};
        if (!player.stable.some(c=>c.id===sel[0])) return {error:'Not in your stable'};
        const cid=sel[0];
        const intercepted = this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', thenRequeue:{type:'choose_destroy',playerId:pid,count:2}});
        if (!intercepted) {
          this._sacrificeCard(pid,cid);
          this.addLog(`${player.name} sacrifices`); this.pendingEffect={type:'choose_destroy',playerId:pid,count:2}; return {ok:true};
        }
        return done();
      }
    }

    if (eff.type==='sacrifice_then_destroy_one' && eff.playerId===pid) {
      // Glitter Bomb (the only card using this type) is a beginning-phase
      // trigger — every exit here must return to the Draw phase (doneB), not
      // end the action phase (done), or the player's turn gets cut short the
      // instant this resolves (the same bug class as Gift Inspector).
      const finish = () => eff.fromBeginning ? doneB() : done();
      if (extra?.skip && eff.optional && !eff.sacrificeDone) { this.addLog(`${player.name} declines to sacrifice`); return finish(); }
      if (!eff.sacrificeDone) {
        if (!player.stable.length) { this.pendingEffect={...eff,sacrificeDone:true}; return {ok:true}; }
        if (!sel.length) return {error:'Select a card to sacrifice'};
        if (!player.stable.some(c=>c.id===sel[0])) return {error:'Not in your stable'};
        const cid=sel[0];
        const intercepted = this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', thenRequeue:{...eff,sacrificeDone:true}, advance: eff.fromBeginning?'doneB':'done'});
        if (!intercepted) {
          this._sacrificeCard(pid,cid);
          this.pendingEffect={...eff,sacrificeDone:true}; return {ok:true};
        }
        return finish();
      }
      if (!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Select a card to destroy'};
      if (!this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false, {advance: eff.fromBeginning?'doneB':'done'})) this._destroyCard(extra.targetPlayerId,extra.targetCardId,pid);
      return finish();
    }

    if (eff.type==='discard_two_unicorns_revive' && eff.playerId===pid) {
      if (extra?.skip) return done();
      if (!eff.discardDone) {
        if (sel.length<2) return {error:'Select 2 Unicorn cards from hand to discard (or skip)'};
        let discarded=0;
        for(const cid of sel){const i=player.hand.findIndex(c=>c.id===cid&&IS_UNICORN(c.type));if(i!==-1&&discarded<2){this.discard.push(player.hand.splice(i,1)[0]);discarded++;}}
        if(discarded<2) return {error:'Select 2 Unicorn cards'};
        const found=this._discardPick(pid,{targetType:'unicorn'},false,true);
        if(!found) return done();
        this.pendingEffect = null;
        if (this.pendingEffectQueue.length > 0) this.pendingEffect = this.pendingEffectQueue.shift();
        return {ok:true};
      }
    }

    if (eff.type==='sacrifice_n_destroy_n' && eff.playerId===pid) {
      if (!eff.sacrificeDone) {
        if (extra?.skip) return done();
        if (!player.stable.some(c=>this._isTargetableUnicorn(pid,c))) {
          this.addLog(`${player.name}: no valid Unicorn to sacrifice — skipped`);
          return done();
        }
        if (!sel.length) return {error:'Select unicorns to sacrifice (any number)'};
        const validIds = sel.filter(cid => player.stable.some(c=>c.id===cid&&this._isTargetableUnicorn(pid,c)));
        if (validIds.length===0) return {error:'Select at least one Unicorn from your stable'};
        this._processMultiSacrifice(pid, validIds, 0, 0, 'sacrifice_n_destroy_n');
        return done();
      }
      if(eff.destroyCount>0&&extra?.targetPlayerId&&extra?.targetCardId){
        const rem=eff.destroyCount-1;
        const nextStep = rem>0 ? {type:'requeue', effect:{...eff,destroyCount:rem}} : null;
        const intercepted = this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false, {continuation:nextStep});
        if (!intercepted) {
          this._destroyCard(extra.targetPlayerId,extra.targetCardId,pid);
          if (nextStep) this._queueEffect(nextStep.effect);
        }
      }
      return done();
    }

    // ── Look/peek effects ──────────────────────────────────────────────────────
    if (eff.type==='look_top_keep_one' && eff.playerId===pid) {
      if (sel.length>0&&eff.options) {
        const kept=eff.options.find(c=>c.id===sel[0]);
        if(kept)player.hand.push(kept);
        const rest=eff.options.filter(c=>c.id!==sel[0]);
        if(eff.discardRest)this.discard.push(...rest); else this.deck.unshift(...rest);
        this.addLog(`${player.name} keeps a card from top of deck`);
      } else if(eff.options){this.deck.unshift(...eff.options);}
      return done();
    }

    if ((eff.type==='look_deck_return_order'||eff.type==='look_deck_return_same')&&eff.playerId===pid) {
      if(eff.options){const ordered=sel.map(id=>eff.options.find(c=>c.id===id)).filter(Boolean);const rest=eff.options.filter(c=>!sel.includes(c.id));this.deck.unshift(...ordered,...rest);}
      return eff.fromBeginning ? doneB() : done();
    }

    if (eff.type==='look_and_take'&&eff.playerId===pid) {
      if(sel.length>0&&eff.targetPlayerId){const tp=this.players[eff.targetPlayerId];const hi=tp.hand.findIndex(c=>c.id===sel[0]);if(hi!==-1){player.hand.push(tp.hand.splice(hi,1)[0]);this.addLog(`${player.name} takes card from ${tp.name}`);}}
      return done();
    }

    if (eff.type==='take_one_from_list'&&eff.playerId===pid) {
      if(sel.length>0&&eff.options){const chosen=eff.options.find(c=>c.id===sel[0]);if(chosen){const di=this.discard.findIndex(c=>c.id===chosen.id);if(di!==-1)this.discard.splice(di,1);player.hand.push(chosen);this.addLog(`${player.name} takes ${chosen.name}`);}}
      return done();
    }

    if (eff.type==='discard_look_top_three_keep_one'&&eff.playerId===pid) {
      if(!eff.discardDone){
        if (extra?.skip) return done();
        if(!sel.length)return {error:'Select a card to discard'};
        const di=player.hand.findIndex(c=>c.id===sel[0]);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);
        const top=this.deck.splice(0,3);
        this.pendingEffect={type:'look_top_keep_one',playerId:pid,options:top,discardRest:true};return {ok:true};
      }
    }

    if (eff.type==='move_hand_to_bottom_deck'&&eff.playerId===pid) {
      if (player.hand.length===0) return doneB();
      if(!sel.length)return {error:'Select a card to move to bottom of deck'};
      const di=player.hand.findIndex(c=>c.id===sel[0]);if(di!==-1){this.deck.push(player.hand.splice(di,1)[0]);this.addLog(`${player.name} moves card to bottom`);}
      return doneB();
    }

    // ── Discard then X ─────────────────────────────────────────────────────────
    if (eff.type==='discard_then_steal'&&eff.playerId===pid) {
      if(!eff.discardDone){
        if (extra?.skip && eff.optional) return done();
        if(!sel.length)return {error:'Select a card to discard'};const di=player.hand.findIndex(c=>c.id===sel[0]);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);this.pendingEffect={...eff,discardDone:true};return {ok:true};}
      if (extra?.skip && eff.optional) return done();
      if(!extra?.targetPlayerId||!extra?.targetCardId)return {error:'Select a card to steal'};
      if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false)) this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
      return done();
    }

    if ((eff.type==='discard_n_steal_unicorn'||eff.type==='discard_two_steal_unicorn')&&eff.playerId===pid) {
      const needed=eff.needed||2;
      if(!eff.discardDone){
        if (player.hand.length < needed) {
          // Can't pay the discard cost at all — skip the effect entirely rather than
          // stalling forever on a selection that can never be satisfied.
          this.addLog(`${player.name}: not enough cards to discard — skipped`);
          return eff.fromBeginning ? doneB() : done();
        }
        if(sel.length<needed)return {error:`Select ${needed} cards to discard`};
        for(const cid of sel.slice(0,needed)){const di=player.hand.findIndex(c=>c.id===cid);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);}
        if (!this._hasUnicornTarget(pid, true)) {
          this.addLog(`${player.name}: no Unicorn to steal`);
          return eff.fromBeginning ? doneB() : done();
        }
        this.pendingEffect={...eff,discardDone:true};return {ok:true};
      }
      if(!extra?.targetPlayerId||!extra?.targetCardId)return {error:'Select a unicorn to steal'};
      const tgt=this.players[extra.targetPlayerId]?.stable.find(c=>c.id===extra.targetCardId);
      if(tgt&&!this._isTargetableUnicorn(extra.targetPlayerId,tgt))return {error:'You must steal a Unicorn card'};
      if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false, {advance: eff.fromBeginning?'doneB':'done'})) {
        this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
      }
      return eff.fromBeginning ? doneB() : done();
    }

    if (eff.type==='discard_two_steal_any'&&eff.playerId===pid) {
      if(!eff.discardDone){
        if (extra?.skip) return done();
        if(sel.length<2)return {error:'Select 2 cards to discard'};for(const cid of sel.slice(0,2)){const di=player.hand.findIndex(c=>c.id===cid);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);}this.pendingEffect={...eff,discardDone:true};return {ok:true};}
      if (extra?.skip) return done();
      if(!extra?.targetPlayerId||!extra?.targetCardId)return {error:'Select a card to steal'};
      if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false)) this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
      return done();
    }

    if (eff.type==='discard_two_destroy_unicorn'&&eff.playerId===pid) {
      // Stable Artillery (the only card using this type) is a beginning-phase
      // trigger — must return to the Draw phase (doneB), not end the action
      // phase (done), same bug class as Gift Inspector.
      const finish = () => eff.fromBeginning ? doneB() : done();
      if (extra?.skip && eff.optional && !eff.discardDone) { this.addLog(`${player.name} declines`); return finish(); }
      if(!eff.discardDone){
        if (player.hand.length < 2) { this.addLog(`${player.name}: not enough cards to discard — skipped`); return finish(); }
        if(sel.length<2)return {error:'Select 2 cards to discard'};for(const cid of sel.slice(0,2)){const di=player.hand.findIndex(c=>c.id===cid);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);}
        if (!this._hasUnicornTarget(pid, false)) { this.addLog(`${player.name}: no Unicorn to destroy`); return finish(); }
        this.pendingEffect={...eff,discardDone:true};return {ok:true};}
      if(!extra?.targetPlayerId||!extra?.targetCardId)return {error:'Select a unicorn to destroy'};
      if (!this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false, {advance: eff.fromBeginning?'doneB':'done'})) this._destroyCard(extra.targetPlayerId,extra.targetCardId,pid);
      return finish();
    }

    // Extremely Fertile Unicorn (the only card using this type) is a
    // beginning-phase trigger — must return to Draw phase (doneB), not end the
    // action phase (done); and "you MAY discard" needs an actual decline,
    // which was missing (both the Gift Inspector bug class, together).
    if (eff.type==='discard_then_nursery'&&eff.playerId===pid) {
      if (extra?.skip && eff.optional) { this.addLog(`${player.name} declines`); return eff.fromBeginning ? doneB() : done(); }
      if(!sel.length)return {error:'Select a card to discard'};
      const di=player.hand.findIndex(c=>c.id===sel[0]);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);
      if(this.nursery.length>0){this._placeCard(pid,this.nursery.pop(),null,null);this.addLog(`${player.name} gets Baby Unicorn`);}
      return eff.fromBeginning ? doneB() : done();
    }

    if (eff.type==='discard_then_search_upgrade_into_stable'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      if(!sel.length)return {error:'Select a card to discard'};
      const di=player.hand.findIndex(c=>c.id===sel[0]);
      if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);
      // _searchDeckPick queues a 'search_deck_pick' sub-effect (since pendingEffect is
      // still set here, it lands in pendingEffectQueue) — done() is what pops the queue
      // and surfaces it. (Latent bug: this used to hand-set discardDone:true and return
      // without calling done(), so the queued sub-effect was never surfaced and the
      // game stalled forever on this already-completed step.)
      this._searchDeckPick(pid,{targetType:'upgrade'},false,true);
      return done();
    }

    if (eff.type==='discard_two_bring_two_babies'&&eff.playerId===pid) {
      if(!eff.discardDone){
        if (player.hand.length < 2) { this.addLog(`${player.name}: not enough cards to discard — skipped`); return done(); }
        if(sel.length<2)return {error:'Select 2 cards to discard'};for(const cid of sel.slice(0,2)){const di=player.hand.findIndex(c=>c.id===cid);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);}this.pendingEffect={...eff,discardDone:true};return {ok:true};}
      for(let i=0;i<2;i++){if(this.nursery.length>0)this._placeCard(pid,this.nursery.pop(),null,null);}this.addLog(`${player.name} brings 2 babies from nursery`);return done();
    }

    if (eff.type==='discard_search_magic_play'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      if(!sel.length)return {error:'Select a card to discard'};
      const di=player.hand.findIndex(c=>c.id===sel[0]);
      if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);
      this._searchDeckPick(pid,{targetType:'magic'},true,false,true);
      return done();
    }

    if (eff.type==='search_deck_magic_play'&&eff.playerId===pid) {
      const found=this._searchDeckPick(pid,{targetType:'magic'},true,false);
      return done();
    }

    if (eff.type==='discard_up_to_two_force_sacrifice'&&eff.playerId===pid) {
      const toDiscard=sel.slice(0,2);
      for(const cid of toDiscard){const di=player.hand.findIndex(c=>c.id===cid);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);}
      const n=toDiscard.length;
      if(n>0){const targets=this.playerOrder.filter(p=>p!==pid&&this.players[p].stable.some(c=>this._isTargetableUnicorn(p,c)));for(let i=0;i<Math.min(n,targets.length);i++)this._queueEffect({type:'sacrifice_unicorn',playerId:targets[i],source:'Prismatic Bray'});}
      return done();
    }

    if (eff.type==='sacrifice_four_search_four'&&eff.playerId===pid) {
      if(!eff.sacrificeDone){
        const toSac=sel.slice(0,4);if(toSac.length<1)return {error:'Select up to 4 unicorns to sacrifice'};
        this._processMultiSacrifice(pid, toSac, 0, 0, 'sacrifice_four_search_four');
        return done();
      }
      const n=eff.searchCount||4;
      const matches=this.deck.filter(c=>IS_UNICORN(c.type)).slice(0,n);
      const ids=new Set(matches.map(c=>c.id));this.deck=this.deck.filter(c=>!ids.has(c.id));this.deck=shuffle(this.deck);
      // Route through proper placement so enter triggers fire
      for(const m of matches) this._placeCard(pid,m,null,null);
      this.addLog(`${player.name} searches for ${matches.length} unicorns`);return done();
    }

    if (eff.type==='destroy_three_add_three_babies'&&eff.playerId===pid) {
      const targetId=eff.targetPlayerId||extra?.targetPlayerId;if(!targetId)return {error:'Select a target player'};
      const tp=this.players[targetId];
      const unis=tp.stable.filter(c=>this._isTargetableUnicorn(targetId,c)).slice(0,3);
      for(const u of unis){tp.stable=tp.stable.filter(c=>c.id!==u.id);this.discard.push(u);}
      for(let i=0;i<3;i++){if(this.nursery.length>0)this._placeCard(targetId,this.nursery.pop(),null,null);}
      this.addLog(`${player.name}: A Cute Attack on ${tp.name}`);return done();
    }

    if (eff.type==='destroy_all_basics_one_player'&&eff.playerId===pid) {
      const targetId=eff.targetPlayerId||extra?.targetPlayerId;if(!targetId)return {error:'Select a target player'};
      this._processDestroyAllBasics(pid, targetId);
      return done();
    }

    if (eff.type==='sacrifice_magical_search_basic'&&eff.playerId===pid) {
      if(!sel.length)return {error:'Select a Magical Unicorn to sacrifice'};
      const si=player.stable.findIndex(c=>c.id===sel[0]&&c.type===CARD_TYPES.MAGICAL_UNICORN);if(si===-1)return {error:'Select a Magical Unicorn'};
      const cid=sel[0];
      if (!this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', advance:'doneB'})) {
        this._sacrificeCard(pid,cid);
        this._searchDeckPick(pid,{targetType:'basic'},false,true);
        this.addLog(`${player.name}: Black Hole`);
      }
      return doneB();
    }

    // Nightmare: Existential Dread (the only card using this type) is a
    // beginning-phase trigger — must return to the Draw phase (doneB), not
    // end the action phase (done). Also was missing the "nobody has a
    // Downgrade to steal at all" auto-skip that this mandatory effect needs.
    if (eff.type==='steal_downgrade'&&eff.playerId===pid) {
      const finish = () => eff.fromBeginning ? doneB() : done();
      if (!this.playerOrder.some(p=>this.players[p].stable.some(c=>c.type===CARD_TYPES.DOWNGRADE))) {
        this.addLog(`${player.name}: no Downgrade anywhere to steal — skipped`);
        return finish();
      }
      if(!extra?.targetPlayerId||!extra?.targetCardId)return {error:'Click a Downgrade to steal'};
      const tp=this.players[extra.targetPlayerId];
      if(!tp?.stable.some(c=>c.id===extra.targetCardId&&c.type===CARD_TYPES.DOWNGRADE))return {error:'That isn\'t a Downgrade — click a Downgrade card in any Stable to steal it'};
      if(tp.stable.some(c=>c.id===extra.targetCardId&&c.type===CARD_TYPES.DOWNGRADE)){
        if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false, {advance: eff.fromBeginning?'doneB':'done'})) {
          this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
        }
      }
      return finish();
    }

    if (eff.type==='steal_baby'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      if (!this._stealTargetsOfType(pid, CARD_TYPES.BABY_UNICORN).length) { this.addLog(`${player.name}: no Baby Unicorn to steal`); return done(); }
      if(!extra?.targetPlayerId||!extra?.targetCardId)return {error:'Click a Baby Unicorn to steal'};
      const chk=this._checkStealPick(pid, extra, CARD_TYPES.BABY_UNICORN, 'Baby Unicorn'); if (chk.error) return chk;
      if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false)) {
        this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
      }
      return done();
    }

    if (eff.type==='move_own_unicorn_steal_unicorn'&&eff.playerId===pid) {
      if(!sel.length||!extra?.targetPlayerId||!extra?.targetCardId)return {error:'Select your unicorn + target card'};
      const si=player.stable.findIndex(c=>c.id===sel[0]&&this._isTargetableUnicorn(pid,c));
      if(si===-1)return {error:'Select a Unicorn in your own stable to move'};
      const tp=this.players[extra.targetPlayerId];
      if(!tp)return {error:'Invalid target player'};
      const tCard=tp.stable.find(c=>c.id===extra.targetCardId);
      if(!tCard||!this._isTargetableUnicorn(extra.targetPlayerId,tCard))return {error:'Select a Unicorn in the target stable to steal'};
      this._placeCard(extra.targetPlayerId,this._liftFromStable(pid,si),null,null);
      if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false)) this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
      return done();
    }

    // Re-Target: "Move an Upgrade or Downgrade card from any player's Stable to any OTHER
    // player's Stable." Every way this can't be done is an ERROR the player can retry from — it
    // used to silently do nothing and still use up the card (a Unicorn picked as the source,
    // the same Stable chosen twice) and ignored Saved by the Sigil / Dragon's Blessing.
    if (eff.type==='move_upgrade_or_downgrade_between_stables'&&eff.playerId===pid) {
      if(extra?.skip)return done();
      const { sourcePlayerId, sourceCardId, targetPlayerId } = extra || {};
      if(!sourcePlayerId||!sourceCardId||!targetPlayerId) return {error:'Choose an Upgrade or Downgrade card, then the player whose Stable it moves to'};
      const sp=this.players[sourcePlayerId], tp=this.players[targetPlayerId];
      if(!sp||!tp) return {error:'Invalid player'};
      if(sourcePlayerId===targetPlayerId) return {error:'Choose a DIFFERENT Stable to move it to'};
      const si=sp.stable.findIndex(c=>c.id===sourceCardId);
      if(si===-1) return {error:'That card is not in that Stable'};
      const moving=sp.stable[si];
      if(moving.type!==CARD_TYPES.UPGRADE&&moving.type!==CARD_TYPES.DOWNGRADE) return {error:`${moving.name} is not an Upgrade or Downgrade card — only those can be moved`};
      const blocked=this._cardEntryBlocker(moving,targetPlayerId);
      if(blocked) return {error:blocked};
      const card=this._liftFromStable(sourcePlayerId,si);
      this._placeCard(targetPlayerId,card,null,null);
      this.addLog(`${player.name} moves ${card.emoji} ${card.name} from ${sp.name}'s Stable to ${tp.name}'s`);
      return done();
    }

    if (eff.type==='destroy_upgrade_or_sacrifice_downgrade'&&eff.playerId===pid) {
      if(extra?.skip||(!extra?.targetPlayerId&&!extra?.targetCardId&&eff.optional))return done();
      if(!extra?.targetPlayerId||!extra?.targetCardId)return {error:'Click an Upgrade to DESTROY or a Downgrade to SACRIFICE (or skip)'};
      const tp=this.players[extra.targetPlayerId];if(!tp)return {error:'Invalid target player'};
      const ci=tp.stable.findIndex(c=>c.id===extra.targetCardId);
      if(ci===-1)return {error:'Card not found in stable'};
      const t=tp.stable[ci];
      if(t.type!==CARD_TYPES.UPGRADE&&t.type!==CARD_TYPES.DOWNGRADE)return {error:'Must target an Upgrade or Downgrade card'};
      if(t.type===CARD_TYPES.UPGRADE){
        if (!this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false)) this._destroyCard(extra.targetPlayerId,extra.targetCardId,pid);
      } else if(t.type===CARD_TYPES.DOWNGRADE){
        if (!this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false, {resumeType:'sacrifice'})) this._sacrificeCard(extra.targetPlayerId,extra.targetCardId);
      }
      return done();
    }

    if (eff.type==='move_downgrade_to_opponent'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      if(!sel.length||!extra?.targetPlayerId)return {error:'Select your downgrade + target player'};
      const si=player.stable.findIndex(c=>c.id===sel[0]&&c.type===CARD_TYPES.DOWNGRADE);
      if(si!==-1){const blk=this._cardEntryBlocker(player.stable[si],extra.targetPlayerId); if(blk) return {error:blk};}
      if(si!==-1){const card=player.stable.splice(si,1)[0];this._placeCard(extra.targetPlayerId,card,null,null);this.addLog(`${player.name} moves ${card.emoji} ${card.name} to ${this.players[extra.targetPlayerId].name}`);}
      return done();
    }

    if (eff.type==='move_downgrade_steal_upgrade'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      if(!sel.length||!extra?.targetPlayerId)return {error:'Select your downgrade + target player'};
      const si=player.stable.findIndex(c=>c.id===sel[0]&&c.type===CARD_TYPES.DOWNGRADE);
      if(si!==-1){const blk=this._cardEntryBlocker(player.stable[si],extra.targetPlayerId); if(blk) return {error:blk};}
      if(si!==-1){this._placeCard(extra.targetPlayerId,player.stable.splice(si,1)[0],null,null);}
      if(extra?.targetCardId){const ci=this.players[extra.targetPlayerId].stable.findIndex(c=>c.id===extra.targetCardId&&c.type===CARD_TYPES.UPGRADE);if(ci!==-1){const card=this.players[extra.targetPlayerId].stable.splice(ci,1)[0];this._placeCard(pid,card,null,null);this.addLog(`${player.name}: Orcicorn Raider — steals ${card.emoji} ${card.name}`);}}
      return done();
    }

    if (eff.type==='play_upgrade_from_hand'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      if(!sel.length)return {error:'Select an Upgrade card from hand'};
      const di=player.hand.findIndex(c=>c.id===sel[0]&&c.type===CARD_TYPES.UPGRADE);
      if(di===-1)return {error:'That isn\'t an Upgrade — select an Upgrade card from your hand'};
      if(di!==-1){const card=player.hand.splice(di,1)[0];this._placeCard(pid,card,null,null);this.addLog(`${player.name} plays ${card.emoji} ${card.name} from hand`);}
      return done();
    }

    if (eff.type==='play_basic_from_hand'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      if(!sel.length)return {error:'Select a Basic Unicorn card from hand'};
      const di=player.hand.findIndex(c=>c.id===sel[0]&&c.type===CARD_TYPES.BASIC_UNICORN);
      if(di===-1)return {error:'Select a Basic Unicorn'};
      const card=player.hand.splice(di,1)[0];this._placeCard(pid,card,null,null);this.addLog(`${player.name} plays ${card.emoji} ${card.name} from hand`);
      return done();
    }

    if (eff.type==='take_from_nursery'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      if(this.nursery.length>0){this._placeCard(pid,this.nursery.pop(),null,null);this.addLog(`${player.name} takes Baby from Nursery`);}
      return done();
    }

    if (eff.type==='draw_per_basic_in_stable'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      this._drawCards(pid,eff.amount||0); this.addLog(`${player.name} draws ${eff.amount||0}`);
      return done();
    }

    if (eff.type==='choose_opponent_pull_random'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      if (!extra?.targetPlayerId) return {error:'Click a player to pull a random card from'};
      if (extra.targetPlayerId === pid) return {error:'You must target an opponent'};
      const tp = this.players[extra.targetPlayerId];
      if (tp && tp.hand.length>0) {
        const ri = Math.floor(Math.random()*tp.hand.length);
        player.hand.push(tp.hand.splice(ri,1)[0]);
        this.addLog(`${player.name} pulls a random card from ${tp.name}`);
      }
      return done();
    }

    if (eff.type==='return_one_each_stable'&&eff.playerId===pid) {
      if(!eff.remaining || eff.remaining.length===0) return done();
      if(!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Click a card in a remaining stable to return it to hand'};
      if(!eff.remaining.includes(extra.targetPlayerId)) return {error:'That player has already had a card returned'};
      const tp=this.players[extra.targetPlayerId];const si=tp.stable.findIndex(c=>c.id===extra.targetCardId);
      if(si===-1)return {error:'Card not found in that stable'};
      tp.hand.push(tp.stable.splice(si,1)[0]);
      const rem=eff.remaining.filter(p=>p!==extra.targetPlayerId);
      if(rem.length>0){this.pendingEffect={...eff,remaining:rem};return {ok:true};}
      return done();
    }

    if (eff.type==='discard_two_return_all_opponents_one'&&eff.playerId===pid) {
      if(!eff.discardDone){
        if (extra?.skip) return done();
        if (player.hand.length < 2) { this.addLog(`${player.name}: not enough cards to discard — skipped`); return done(); }
        if(sel.length<2)return {error:'Select 2 cards to discard'};
        for(const cid of sel.slice(0,2)){const di=player.hand.findIndex(c=>c.id===cid);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);}
        const targets=this.playerOrder.filter(p=>p!==pid&&this.players[p].stable.length>0);
        // Once the discard is paid, the return-to-opponents step is mandatory — drop
        // `optional` so the client's generic Skip control doesn't reappear for it.
        this.pendingEffect={type:eff.type,playerId:pid,discardDone:true,remaining:targets};return {ok:true};
      }
      if(extra?.targetPlayerId&&extra?.targetCardId&&eff.remaining){
        this._returnToHand(extra.targetPlayerId,extra.targetCardId,pid);
        const rem=eff.remaining.filter(p=>p!==extra.targetPlayerId);
        if(rem.length>0){this.pendingEffect={...eff,remaining:rem};return {ok:true};}
      }
      return done();
    }

    if (eff.type==='discard_n_others_discard_n'&&eff.playerId===pid) {
      // "DISCARD any number of cards" genuinely includes zero (the client's
      // "Discard 0" button has always sent an empty selection for this type —
      // this check was blocking it).
      const n=sel.length;for(const cid of sel){const di=player.hand.findIndex(c=>c.id===cid);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);}
      // Each other player chooses which of their own cards to discard — queue one
      // discard_choice effect per opponent (in turn order) rather than picking randomly.
      if (n>0) {
        const others = this.playerOrder.filter(p=>p!==pid && this.players[p].hand.length>0);
        for (const p of others) this._queueEffect({ type:'discard_choice', playerId:p, amount:n, source:'Unicorn of Pestilence' });
      }
      this.addLog(`${player.name} discards ${n}, all others must discard ${n}`);return done();
    }

    if (eff.type==='discard_remove_from_game'&&eff.playerId===pid) {
      if(!eff.discardDone){if (extra?.skip) return done(); if(!sel.length)return {error:'Select a card to discard'};const di=player.hand.findIndex(c=>c.id===sel[0]);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);this.pendingEffect={type:eff.type,playerId:pid,discardDone:true};return {ok:true};}
      if(!extra?.targetPlayerId||!extra?.targetCardId)return {error:'Select a card to remove from game'};
      const tp=this.players[extra.targetPlayerId];const si=tp.stable.findIndex(c=>c.id===extra.targetCardId);
      if(si!==-1){this.removedFromGame.push(tp.stable.splice(si,1)[0]);this.addLog(`Card removed from game`);}
      return done();
    }

    if (eff.type==='discard_n_draw_n_extra_turn'&&eff.playerId===pid) {
      // "DISCARD any number of cards" genuinely includes zero — the extra turn
      // isn't conditioned on actually discarding anything. The client's
      // "Discard 0" button has always sent an empty selection for this type —
      // this check was blocking it from ever working.
      const n=sel.length;for(const cid of sel){const di=player.hand.findIndex(c=>c.id===cid);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);}
      if (n>0) this._drawCards(pid,n);
      this.extraTurns[pid]=(this.extraTurns[pid]||0)+1;
      this.addLog(`${player.name} discards ${n}, draws ${n}, extra turn`);return done();
    }

    if (eff.type==='sacrifice_revive_upgrade_from_discard'&&eff.playerId===pid) {
      if(!eff.sacrificeDone){
        if(!sel.length)return {error:'Select a card to sacrifice'};
        const cid = sel[0];
        const intercepted = this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', thenRequeue:{...eff,sacrificeDone:true}});
        if (!intercepted) {
          const r=this._sacrificeCard(pid,cid);if(r?.error)return r;
          this.pendingEffect={...eff,sacrificeDone:true};return {ok:true};
        }
        return done();
      }
      const found=this._discardPick(pid,{targetType:'upgrade'},false,true);if(!found)return done();return {ok:true};
    }

    if (eff.type==='move_unicorn_any_stable_not_own'&&eff.playerId===pid) {
      if (extra?.skip) return done();
      if(!sel.length||!extra?.sourcePlayerId||!extra?.targetPlayerId)return {error:'Select unicorn + source + target stable'};
      if(extra.targetPlayerId===pid)return {error:'Cannot move to own stable'};
      const sp=this.players[extra.sourcePlayerId];const si=sp.stable.findIndex(c=>c.id===sel[0]&&this._isTargetableUnicorn(extra.sourcePlayerId,c));
      if(si!==-1){const card=this._liftFromStable(extra.sourcePlayerId,si);this._placeCard(extra.targetPlayerId,card,null,null);this.addLog(`${player.name} moves ${card.emoji} ${card.name} to ${this.players[extra.targetPlayerId].name}`);}
      return done();
    }

    if (eff.type==='move_own_card_pull_from_that_player'&&eff.playerId===pid) {
      if(!sel.length||!extra?.targetPlayerId)return {error:'Select a card from your stable + target player'};
      const si=player.stable.findIndex(c=>c.id===sel[0]);if(si!==-1){const card=this._liftFromStable(pid,si);this._placeCard(extra.targetPlayerId,card,null,null);}
      const tp=this.players[extra.targetPlayerId];if(tp.hand.length>0){const ri=Math.floor(Math.random()*tp.hand.length);player.hand.push(tp.hand.splice(ri,1)[0]);this.addLog(`${player.name}: Gift Receipt`);}
      return done();
    }

    if (eff.type==='fuck_marry_kill'&&eff.playerId===pid) {
      // Three steps, in the order the card's own text lists them: (1) force
      // another player to DISCARD a card — their own choice, not the actor's —
      // (2) give a card from your hand to a player, (3) destroy a Unicorn.
      if(!eff.discardStepDone){
        const opponents = this.playerOrder.filter(p=>p!==pid && this.players[p].hand.length>0);
        if (opponents.length === 0) {
          // nobody has a card to discard — skip straight to the give-a-card step
          this.pendingEffect={...eff,discardStepDone:true}; return {ok:true};
        }
        if(!extra?.targetPlayerId) return {error:'Select a player to force a discard from'};
        if(!this.players[extra.targetPlayerId] || this.players[extra.targetPlayerId].hand.length===0) return {error:'That player has no cards to discard'};
        // Queue the victim's own discard_choice, then resume THIS flow (for the
        // acting player, still mid-give/mid-destroy) once they've picked their card.
        this._queueEffect({ type:'discard_choice', playerId:extra.targetPlayerId, amount:1, source:'Fuck. Marry. Kill', resumeEffect:{...eff, discardStepDone:true} });
        return done();
      }
      if(!eff.step1Done){
        if (player.hand.length === 0) { this.pendingEffect={...eff,step1Done:true}; return {ok:true}; }
        if(!sel.length||!extra?.targetPlayerId)return {error:'Select a card to give + a target player'};
        const di=player.hand.findIndex(c=>c.id===sel[0]);if(di!==-1){this.players[extra.targetPlayerId].hand.push(player.hand.splice(di,1)[0]);}
        this.pendingEffect={...eff,step1Done:true};return {ok:true};}
      if(!extra?.targetPlayerId||!extra?.targetCardId)return {error:'Now select a unicorn to destroy'};
      if (!this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false)) this._destroyCard(extra.targetPlayerId,extra.targetCardId,pid);
      return done();
    }

    if (eff.type==='move_self_steal_and_draw'&&eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if(!extra?.targetPlayerId)return {error:'Select a player to move this card to'};
      // Step 1: Move the Bardicorn itself to the target stable
      const sourceCardId = eff.sourceCardId;
      if (sourceCardId) {
        const si = player.stable.findIndex(c=>c.id===sourceCardId);
        if (si!==-1) {
          const bardicorn = this._liftFromStable(pid,si);
          this._placeCard(extra.targetPlayerId, bardicorn, null, null);
          this.addLog(`${player.name} moves ${bardicorn.emoji} ${bardicorn.name} to ${this.players[extra.targetPlayerId].name}'s stable`);
        }
      }
      // Step 2: Draw a card (happens regardless of whether the steal below is intercepted)
      this._drawCards(pid,1);
      this.addLog(`${player.name}: Charming Bardicorn`);
      // Step 3: Steal a unicorn from that player (if chosen)
      if(extra?.targetCardId) {
        if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false, {advance:'doneB'})) {
          this._stealCard(pid, extra.targetPlayerId, extra.targetCardId);
        }
      }
      return doneB();
    }

    // ── discard_then_draw_beginning (Claw Machine) ────────────────────────────
    if (eff.type==='discard_then_draw_beginning' && eff.playerId===pid) {
      if (!eff.discardDone) {
        if (!sel.length) {
          if (eff.optional) return doneB();
          return {error:'Select a card from hand to discard'};
        }
        const di = player.hand.findIndex(c=>c.id===sel[0]);
        if (di!==-1) this.discard.push(player.hand.splice(di,1)[0]);
        this._drawCards(pid, eff.draw||1);
        this.addLog(`${player.name}: Claw Machine — discard 1, draw ${eff.draw||1}`);
        return doneB();
      }
    }

    // ── choose_players_draw_each (Unicorn Rainbow Princess) ───────────────────
    // "choose any number of players. DRAW cards equal to the number of chosen
    // players [you]. Each chosen player MAY draw a card [them, optionally]."
    // Previously: nobody drew the actor's own count-based draw at all, and the
    // chosen players' draws were forced instead of optional.
    if (eff.type==='choose_players_draw_each'&&eff.playerId===pid) {
      const chosen = (Array.isArray(extra?.chosenPlayerIds) ? extra.chosenPlayerIds : sel).filter(p=>this.players[p]);
      const names = chosen.map(p=>this.players[p]?.name).filter(Boolean).join(', ');
      if (chosen.length > 0) this._drawCards(pid, chosen.length);
      this.addLog(`${player.name}: Unicorn Rainbow Princess — chose ${names||'nobody'}, draws ${chosen.length}`);
      for (const p of chosen) this._queueEffect({ type:'draw_n_optional', playerId:p, amount:1, optional:true, source:'Unicorn Rainbow Princess' });
      return done();
    }

    // ── discard_unicorn_revive_unicorn_end_turn (Zombie Unicorn) ──────────────
    if (eff.type==='discard_unicorn_revive_unicorn_end_turn'&&eff.playerId===pid) {
      if (!eff.discardDone) {
        const hasUnicornInHand = player.hand.some(c=>IS_UNICORN(c.type));
        if (!hasUnicornInHand) {
          // Nothing to discard — end the turn immediately rather than stalling forever
          // on a selection that can never be satisfied.
          this._endTurnNow(); return {ok:true};
        }
        if (!sel.length) return {error:'Select a Unicorn card from hand to discard'};
        const di = player.hand.findIndex(c=>c.id===sel[0]&&IS_UNICORN(c.type));
        if (di===-1) return {error:'Select a Unicorn card to discard'};
        this.discard.push(player.hand.splice(di,1)[0]);
        const found = this._discardPick(pid,{targetType:'unicorn'},false,true,0,true);
        if (!found) {
          // No unicorns to revive — end turn immediately
          this._endTurnNow(); return {ok:true};
        }
        // Success. _discardPick (with endTurnAfter) has queued the "which Unicorn do you bring
        // back?" prompt — present it now. Resolving that pick is what ends the turn (see
        // from_discard_pick → _endTurnNow). An earlier change here wiped the queue and ended
        // the turn immediately, so the Unicorn was never actually revived.
        const pi = this.pendingEffectQueue.findIndex(e => e?.type === 'from_discard_pick');
        if (pi > 0) this.pendingEffectQueue.unshift(...this.pendingEffectQueue.splice(pi, 1));
        this.pendingEffect = null;
        if (this.pendingEffectQueue.length > 0) this.pendingEffect = this.pendingEffectQueue.shift();
        return {ok:true};
      }
      return done();
    }

    // ── Dragon's Fortune: sacrifice self, take extra turn ─────────────────────
    if (eff.type==='sacrifice_self_take_extra_turn' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (eff.sourceCardId && player.stable.some(c=>c.id===eff.sourceCardId)) {
        if (!this._maybeIntercept('destroy', pid, pid, eff.sourceCardId, false, {resumeType:'sacrifice', advance:'doneB'})) {
          this._sacrificeCard(pid, eff.sourceCardId);
          this.extraTurns[pid]=(this.extraTurns[pid]||0)+1;
          this.addLog(`${player.name}: Dragon's Fortune — sacrifices itself, extra turn!`);
        }
      }
      return doneB();
    }

    // ── Dragon Skies: "move a Unicorn card from YOUR Stable to the bottom of
    // the deck, then DRAW a card" — a downgrade's drawback for its OWNER, not
    // a free choice of ANY player's stable (which the card's text never says,
    // and wouldn't make sense as a downgrade penalty if it let the owner
    // dump an opponent's unicorn instead of suffering their own loss). ──
    if (eff.type==='move_unicorn_to_deck_draw' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!player.stable.some(c=>this._isTargetableUnicorn(pid,c))) { this.addLog(`${player.name}: no Unicorn to move — skipped`); return doneB(); }
      if (!extra?.targetCardId) return {error:'Click a Unicorn in your own Stable to move it to the deck'};
      const si=player.stable.findIndex(c=>c.id===extra.targetCardId&&this._isTargetableUnicorn(pid,c));
      if (si===-1) return {error:'Select a Unicorn in your own Stable'};
      const c=player.stable.splice(si,1)[0];this.deck.push(c);this.deck=shuffle(this.deck);this._drawCards(pid,1);this.addLog(`${player.name}: Dragon Skies — ${c.name} to deck, draws 1`);
      return doneB();
    }

    // ── Special Delivery: take baby from nursery, skip action phase ───────────
    if (eff.type==='nursery_skip_action' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if(this.nursery.length>0){this._placeCard(pid,this.nursery.pop(),null,null);this.addLog(`${player.name}: Special Delivery — Baby from Nursery`);}
      this.skippedActionPlayers.add(pid);
      return doneB();
    }

    // ── Force opponent discard (Bitchiest Unicorn) ────────────────────────────
    if (eff.type==='force_opponent_discard' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!extra?.targetPlayerId) return {error:'Select an opponent player to force discard'};
      // The targeted player chooses which of their own card(s) to discard —
      // not a random pick. fromBeginning:true so returning from the queue
      // goes back to the acting player's Draw Phase, not ends their turn.
      this._queueEffect({ type:'discard_choice', playerId:extra.targetPlayerId, amount:eff.amount||1, source:'The Bitchiest Unicorn', fromBeginning:true });
      this.addLog(`${player.name}: The Bitchiest Unicorn — ${this.players[extra.targetPlayerId].name} must discard ${eff.amount||1}`);
      return doneB();
    }

    // ── Move self (Polyamorous Unicorn) to target stable, steal a unicorn ─────
    if (eff.type==='move_self_steal_unicorn' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!extra?.targetPlayerId) return {error:'Select a target player to move Polyamorous Unicorn to'};
      if (eff.sourceCardId) {
        const si=player.stable.findIndex(c=>c.id===eff.sourceCardId);
        if(si!==-1){this._placeCard(extra.targetPlayerId,this._liftFromStable(pid,si),null,null);}
      }
      if(extra?.targetCardId) {
        if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false, {advance:'doneB'})) {
          this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
        }
      }
      this.addLog(`${player.name}: Polyamorous Unicorn moves, steals`);
      return doneB();
    }

    // ── Pony Play: pull random from target, target skips draw phase ───────────
    if (eff.type==='pull_random_skip_draw' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!extra?.targetPlayerId) return {error:'Select a target player'};
      const tp=this.players[extra.targetPlayerId];
      if(tp.hand.length>0){const ri=Math.floor(Math.random()*tp.hand.length);player.hand.push(tp.hand.splice(ri,1)[0]);this.addLog(`${player.name}: Pony Play — pulls from ${tp.name}`);}
      this.skippedDrawPlayers.add(extra.targetPlayerId);
      return doneB();
    }

    // ── Temp steal basic (Naked Narwhal) ──────────────────────────────────────
    if (eff.type==='steal_basic_temp' && eff.playerId===pid) {
      if (!this._stealTargetsOfType(pid, CARD_TYPES.BASIC_UNICORN).length) { this.addLog(`${player.name}: no Basic Unicorn to steal`); return done(); }
      if (!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Click a Basic Unicorn to steal temporarily'};
      const chk=this._checkStealPick(pid, extra, CARD_TYPES.BASIC_UNICORN, 'Basic Unicorn'); if (chk.error) return chk;
      const tp=this.players[extra.targetPlayerId];
      const si=tp.stable.findIndex(c=>c.id===extra.targetCardId&&c.type===CARD_TYPES.BASIC_UNICORN);
      if(si!==-1){
        const stolen=tp.stable.splice(si,1)[0];
        player.stable.push({...stolen,_tempFrom:extra.targetPlayerId});
        if(!this.tempSteals)this.tempSteals=[];
        this.tempSteals.push({pid,cardId:stolen.id,returnTo:extra.targetPlayerId});
        this.addLog(`${player.name}: Naked Narwhal steals ${stolen.name} until next turn`);
        this._onUnicornLeft(extra.targetPlayerId, stolen);
        this._onUnicornEntered(pid, stolen);
        this._enterTrigger(stolen, pid, null, null);
      }
      return done();
    }

    // ── Temp steal baby (Free Candy Unicorn) ──────────────────────────────────
    if (eff.type==='steal_baby_temp' && eff.playerId===pid) {
      if (!this._stealTargetsOfType(pid, CARD_TYPES.BABY_UNICORN).length) { this.addLog(`${player.name}: no Baby Unicorn to steal`); return done(); }
      if (!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Click a Baby Unicorn to steal temporarily'};
      const chk=this._checkStealPick(pid, extra, CARD_TYPES.BABY_UNICORN, 'Baby Unicorn'); if (chk.error) return chk;
      const tp=this.players[extra.targetPlayerId];
      const si=tp.stable.findIndex(c=>c.id===extra.targetCardId&&c.type===CARD_TYPES.BABY_UNICORN);
      if(si!==-1){
        const stolen=tp.stable.splice(si,1)[0];
        player.stable.push({...stolen,_tempFrom:extra.targetPlayerId});
        if(!this.tempSteals)this.tempSteals=[];
        this.tempSteals.push({pid,cardId:stolen.id,returnTo:extra.targetPlayerId});
        this.addLog(`${player.name}: Free Candy Unicorn steals ${stolen.name} until next turn`);
        this._onUnicornLeft(extra.targetPlayerId, stolen);
        this._onUnicornEntered(pid, stolen);
        this._enterTrigger(stolen, pid, null, null);
      }
      return done();
    }

    // ── Ancient Ritual: sacrifice unicorn, draw 3 ─────────────────────────────
    if (eff.type==='sacrifice_unicorn_draw_three' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!sel.length) return {error:'Select a unicorn to sacrifice'};
      const si=player.stable.findIndex(c=>c.id===sel[0]&&this._isTargetableUnicorn(pid,c));
      if(si===-1) return {error:'Select a Unicorn'};
      const cid = sel[0];
      if (!this._maybeIntercept('destroy', pid, pid, cid, false, {resumeType:'sacrifice', advance:'doneB', thenDraw:3})) {
        this._sacrificeCard(pid,cid); this._drawCards(pid,3);
        this.addLog(`${player.name}: Ancient Ritual — sacrifice, draw 3`);
      }
      return doneB();
    }

    // ── Pit Covered in Leaves: sacrifice self (upgrade), steal a unicorn ──────
    // ── Shark With a Horn: "you may SACRIFICE this card, then DESTROY a Unicorn
    // card." Single up-front decision — decline before anything happens; once
    // committed, the sacrifice happens and a mandatory choose_destroy follows. ──
    if (eff.type==='sacrifice_self_destroy_unicorn' && eff.playerId===pid) {
      if (extra?.skip) return done();
      if (eff.sourceCardId && player.stable.some(c=>c.id===eff.sourceCardId)) {
        const intercepted = this._maybeIntercept('destroy', pid, pid, eff.sourceCardId, false, {
          resumeType:'sacrifice', thenRequeue:{type:'choose_destroy',playerId:pid,targetType:'unicorn'}
        });
        if (intercepted) return done(); // safe: pops queue, surfaces the intercept_offer
        this._sacrificeCard(pid, eff.sourceCardId);
        this.addLog(`${player.name}: Shark With a Horn — sacrifices itself`);
      }
      this.pendingEffect = {type:'choose_destroy', playerId:pid, targetType:'unicorn'};
      return {ok:true};
    }

    // ── Stowaway Unicorn: "you may DRAW a card and reveal it..." — confirm/skip
    // before drawing, so a bad Downgrade can't be forced into the stable. ──
    if (eff.type==='draw_reveal_if_unicorn_upgrade_downgrade_into_stable' && eff.playerId===pid) {
      if (extra?.skip) return done();
      const drawn = this.deck.shift();
      if (drawn) {
        if ([CARD_TYPES.BASIC_UNICORN,CARD_TYPES.MAGICAL_UNICORN,CARD_TYPES.BABY_UNICORN,CARD_TYPES.UPGRADE,CARD_TYPES.DOWNGRADE].includes(drawn.type)) {
          this._placeCard(pid,drawn,null,null); this.addLog(`${player.name} places ${drawn.emoji} ${drawn.name} in stable`);
        } else { player.hand.push(drawn); this.addLog(`${player.name} draws ${drawn.emoji} ${drawn.name}`); }
      }
      return done();
    }

    // ── Dragon Turtle Unicorn / Paranormal Affection: "you may DRAW a card"
    // — confirm/skip before drawing, since a forced draw can force a
    // hand-limit discard the player never agreed to. ──
    if (eff.type==='draw_n_optional' && eff.playerId===pid) {
      if (extra?.skip) return done();
      // Jack the Reapercorn: "you may draw a card. If that card is a Neigh
      // card, you may reveal it and draw a second card." Both draws are
      // optional — reuses this same prompt twice rather than a bespoke effect
      // type, so it gets the normal Draw/Skip UI for free.
      if (eff.revealIfNeighBonus) {
        const drawn = this.deck.shift();
        if (drawn) {
          player.hand.push(drawn);
          this.addLog(`${player.name} draws ${drawn.name}`);
          if (drawn.effect?.type===EFFECTS.NEIGH || drawn.effect?.type==='neigh_remove_from_game') {
            this._queueEffect({ type:'draw_n_optional', playerId:pid, amount:1, optional:true, source:eff.source });
          }
        }
        return done();
      }
      this._drawCards(pid, eff.amount||1);
      this.addLog(`${player.name} draws ${eff.amount||1}`);
      return done();
    }

    if (eff.type==='sacrifice_self_steal_unicorn' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!eff.sacrificeDone) {
        if (eff.sourceCardId && player.stable.some(c=>c.id===eff.sourceCardId)) {
          const intercepted = this._maybeIntercept('destroy', pid, pid, eff.sourceCardId, false, {
            resumeType:'sacrifice', advance:'doneB', thenRequeue:{...eff,sacrificeDone:true}
          });
          if (intercepted) return doneB(); // safe: pops queue, surfaces the intercept_offer
          this._sacrificeCard(pid, eff.sourceCardId);
          this.addLog(`${player.name}: Pit — sacrifices itself`);
        }
        this.pendingEffect={...eff,sacrificeDone:true}; return {ok:true};
      }
      if(!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Click a unicorn to STEAL'};
      if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false, {advance:'doneB'})) {
        this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
      }
      return doneB();
    }

    // ── Royal Hooves: pull random from target instead of drawing ──────────────
    if (eff.type==='pull_random_instead_of_draw' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!extra?.targetPlayerId) return {error:'Select a target player to pull from'};
      const tp=this.players[extra.targetPlayerId];
      if(tp.hand.length>0){const ri=Math.floor(Math.random()*tp.hand.length);player.hand.push(tp.hand.splice(ri,1)[0]);this.addLog(`${player.name}: Royal Hooves pulls from ${tp.name}`);}
      // Skip the draw phase for current player
      this.skippedDrawPlayers.add(pid);
      return doneB();
    }

    // ── Vagabond Unicorn: discard 1, pull random from opponent ────────────────
    if (eff.type==='discard_pull_random_from_opponent' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!eff.discardDone) {
        if (!sel.length) return {error:'Select a card to discard'};
        const di=player.hand.findIndex(c=>c.id===sel[0]); if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);
        this.pendingEffect={...eff,discardDone:true}; return {ok:true};
      }
      if (!extra?.targetPlayerId) return {error:'Select a target player to pull from'};
      const tp=this.players[extra.targetPlayerId];
      if(tp.hand.length>0){const ri=Math.floor(Math.random()*tp.hand.length);player.hand.push(tp.hand.splice(ri,1)[0]);this.addLog(`${player.name}: Vagabond Unicorn pulls from ${tp.name}`);}
      return doneB();
    }

    // ── Survivalist Unicorn: discard 1, sacrifice opponent's downgrade ─────────
    if (eff.type==='discard_then_sacrifice_downgrade' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!eff.discardDone) {
        if (!sel.length) return {error:'Select a card to discard'};
        const di=player.hand.findIndex(c=>c.id===sel[0]); if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);
        this.pendingEffect={...eff,discardDone:true}; return {ok:true};
      }
      if (!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Click a Downgrade in any stable to sacrifice'};
      const tp=this.players[extra.targetPlayerId];
      const si=tp ? tp.stable.findIndex(c=>c.id===extra.targetCardId&&c.type===CARD_TYPES.DOWNGRADE) : -1;
      if(si===-1)return {error:'That isn\'t a Downgrade — click a Downgrade card in any Stable to sacrifice it'};
      if(si!==-1){
        if (!this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false, {resumeType:'sacrifice', advance:'doneB'})) {
          this._sacrificeCard(extra.targetPlayerId,extra.targetCardId);
          this.addLog(`${player.name}: Survivalist — sacrifices ${tp.name}'s downgrade`);
        }
      }
      return doneB();
    }

    // ── Adventures choice cards ────────────────────────────────────────────────
    if (eff.type==='choice_steal_baby_or_revive_basic' && eff.playerId===pid) {
      if (extra?.skip) return done();
      if (extra?.choice==='a') { // steal baby
        if(!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Click a Baby Unicorn to steal'};
        const chk=this._checkStealPick(pid, extra, CARD_TYPES.BABY_UNICORN, 'Baby Unicorn'); if (chk.error) return chk;
        if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false)) {
          this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
        }
      } else if (extra?.choice==='b') { // revive basic from discard
        this._discardPick(pid,{targetType:'basic'},false,true);
        return done();
      } else return {error:'Choose: [a] Steal Baby Unicorn  or  [b] Revive Basic from discard'};
      return done();
    }

    if (eff.type==='choice_discard_hand_draw3_or_trade_hands' && eff.playerId===pid) {
      if (extra?.skip) return done();
      if (extra?.choice==='a') { // discard hand, draw 3
        this.discard.push(...player.hand); player.hand=[]; this._drawCards(pid,3);
        this.addLog(`${player.name}: Hornswoggler — discard hand, draw 3`);
      } else if (extra?.choice==='b') { // trade hands with target
        if(!extra?.targetPlayerId) return {error:'Choose a player to trade hands with'};
        const tp=this.players[extra.targetPlayerId];
        [player.hand,tp.hand]=[tp.hand,player.hand];
        this.addLog(`${player.name}: Hornswoggler — trade hands with ${tp.name}`);
      } else return {error:'Choose: [a] Discard hand draw 3  or  [b] Trade hands with a player'};
      return done();
    }

    if (eff.type==='choice_steal_upgrade_or_move_downgrade' && eff.playerId===pid) {
      if (extra?.skip) return done();
      if (extra?.choice==='a') { // steal an upgrade
        if(!extra?.targetPlayerId||!extra?.targetCardId) return {error:'Click an Upgrade to steal'};
        const tp=this.players[extra.targetPlayerId];
        if(!tp?.stable.some(c=>c.id===extra.targetCardId&&c.type===CARD_TYPES.UPGRADE)) return {error:'That isn\'t an Upgrade — click an Upgrade card in any Stable to steal it'};
        if(tp.stable.some(c=>c.id===extra.targetCardId&&c.type===CARD_TYPES.UPGRADE)){
          if (!this._maybeIntercept('steal', pid, extra.targetPlayerId, extra.targetCardId, false)) {
            this._stealCard(pid,extra.targetPlayerId,extra.targetCardId);
          }
        }
      } else if (extra?.choice==='b') { // move downgrade
        if(!sel.length||!extra?.targetPlayerId) return {error:'Select your downgrade + target player'};
        const si=player.stable.findIndex(c=>c.id===sel[0]&&c.type===CARD_TYPES.DOWNGRADE);
        if(si!==-1){const blk=this._cardEntryBlocker(player.stable[si],extra.targetPlayerId); if(blk) return {error:blk};}
        if(si!==-1){const card=player.stable.splice(si,1)[0];this._placeCard(extra.targetPlayerId,card,null,null);this.addLog(`${player.name}: Pillaging Pirate — moves ${card.emoji} ${card.name}`);}
      } else return {error:'Choose: [a] Steal an Upgrade  or  [b] Move a Downgrade to opponent'};
      return done();
    }

    if (eff.type==='choice_force_all_discard_or_draw' && eff.playerId===pid) {
      if (extra?.skip) return done();
      if (extra?.choice==='a') { // each opponent chooses their own card to discard
        const opponents = this.playerOrder.filter(p=>p!==pid && this.players[p].hand.length>0);
        for (const p of opponents) this._queueEffect({ type:'discard_choice', playerId:p, amount:1, source:'Salty Seadogicorn' });
        this.addLog(`${player.name}: Salty Seadogicorn — all opponents must discard 1`);
      } else if (extra?.choice==='b') { // all players draw
        for(const p of this.playerOrder)this._drawCards(p,1);
        this.addLog(`${player.name}: Salty Seadogicorn — all players draw 1`);
      } else return {error:'Choose: [a] Force all opponents to discard 1  or  [b] All players draw 1'};
      return done();
    }

    if (eff.type==='choice_sacrifice_destroy_or_revive_from_discard' && eff.playerId===pid) {
      if (extra?.choice==='a') { // sacrifice then destroy
        this._queueEffect({type:'sacrifice_then_destroy_one',playerId:pid});
        return done();
      } else if (extra?.choice==='b') { // revive from discard
        this._discardPick(pid,{targetType:'unicorn'},false,true);
        return done();
      }
      return {error:'Choose: [a] Sacrifice unicorn then destroy unicorn  or  [b] Revive unicorn from discard'};
    }

    if (eff.type==='choice_draw3_discard1_or_add_from_discard' && eff.playerId===pid) {
      if (extra?.choice==='a') { // draw 3, discard 1
        this._drawCards(pid,3); this._queueEffect({type:'discard',playerId:pid,amount:1});
        return done();
      } else if (extra?.choice==='b') { // add card from discard to hand
        this._discardPick(pid,{},true,false);
        return done();
      }
      return {error:'Choose: [a] Draw 3 then discard 1  or  [b] Take a card from discard to hand'};
    }

    if (eff.type==='choice_discard3_extra_turn_or_move_steal_unicorn' && eff.playerId===pid) {
      if (extra?.choice==='a') { // discard 3, take extra turn
        this._queueEffect({type:'discard_n_draw_n_extra_turn',playerId:pid});
        // Actually: just discard 3 and get extra turn (no draw)
        this.pendingEffect={type:'discard_for_extra_turn',playerId:pid,amount:3};
        return {ok:true};
      } else if (extra?.choice==='b') { // move own unicorn, steal one
        this._queueEffect({type:'move_own_unicorn_steal_unicorn',playerId:pid});
        return done();
      }
      return {error:'Choose: [a] Discard 3 take extra turn  or  [b] Move unicorn to opponent, steal one'};
    }

    if (eff.type==='discard_for_extra_turn' && eff.playerId===pid) {
      const n=eff.amount||3;
      if(sel.length<Math.min(n,player.hand.length))return {error:`Select ${n} cards to discard`};
      for(const cid of sel.slice(0,n)){const di=player.hand.findIndex(c=>c.id===cid);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);}
      this.extraTurns[pid]=(this.extraTurns[pid]||0)+1;
      this.addLog(`${player.name}: Mysterious Compass — discards ${Math.min(sel.length,n)}, extra turn`);
      return done();
    }

    if (eff.type==='choice_reveal_all_hands_or_take_from_all' && eff.playerId===pid) {
      if (extra?.choice==='a') { // reveal all hands (already provided in effect)
        this.addLog(`${player.name}: Silver Tongue — all hands revealed`);
        return done();
      } else if (extra?.choice==='b') { // take 1 card from each opponent
        for(const p of this.playerOrder){
          if(p!==pid&&this.players[p].hand.length>0){
            const ri=Math.floor(Math.random()*this.players[p].hand.length);
            player.hand.push(this.players[p].hand.splice(ri,1)[0]);
          }
        }
        this.addLog(`${player.name}: Silver Tongue — takes 1 from each opponent`);
        return done();
      }
      return {error:'Choose: [a] Reveal all hands  or  [b] Take 1 card from each opponent'};
    }

    if (eff.type==='choice_revive_unicorn_or_two_unicorns_to_hand' && eff.playerId===pid) {
      if (extra?.choice==='a') { // revive unicorn from discard into stable
        this._discardPick(pid,{targetType:'unicorn'},false,true);
        return done();
      } else if (extra?.choice==='b') { // return 2 unicorns from discard to hand
        const unis=this.discard.filter(c=>IS_UNICORN(c.type)).slice(0,2);
        const ids=new Set(unis.map(c=>c.id));this.discard=this.discard.filter(c=>!ids.has(c.id));
        player.hand.push(...unis);
        this.addLog(`${player.name}: Unicorn Shovel — 2 unicorns to hand`);
        return done();
      }
      return {error:'Choose: [a] Revive unicorn into stable  or  [b] Return 2 unicorns from discard to hand'};
    }

    // ── Poltergeist Swipe: skip draw phase, pull random from target ───────────
    if (eff.type==='skip_draw_pull_random' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!extra?.targetPlayerId) return {error:'Select a target player to pull from'};
      const tp=this.players[extra.targetPlayerId];
      if(tp.hand.length>0){const ri=Math.floor(Math.random()*tp.hand.length);player.hand.push(tp.hand.splice(ri,1)[0]);this.addLog(`${player.name}: Poltergeist Swipe pulls from ${tp.name}`);}
      this.skippedDrawPlayers.add(pid); // skip own draw phase
      return doneB();
    }

    // ── Strange Craft Project: "you may DISCARD 3 cards, then remove a card
    // in ANY PLAYER'S STABLE from the game" — this was removing a card from
    // the DISCARD PILE instead, a completely different (and far less
    // impactful) target zone than the card's actual text. ─────────────────
    if (eff.type==='discard_three_remove_from_game' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!eff.discardDone) {
        if (sel.length<Math.min(3,player.hand.length)) return {error:'Select 3 cards to discard'};
        for(const cid of sel.slice(0,3)){const di=player.hand.findIndex(c=>c.id===cid);if(di!==-1)this.discard.push(player.hand.splice(di,1)[0]);}
        this.pendingEffect={...eff,discardDone:true}; return {ok:true};
      }
      if(!extra?.targetPlayerId||!extra?.targetCardId) return {error:"Click a card in any player's Stable to remove from the game"};
      const tp=this.players[extra.targetPlayerId];
      if (!tp) return {error:'Invalid target player'};
      if (!this._maybeIntercept('destroy', pid, extra.targetPlayerId, extra.targetCardId, false, {advance:'doneB'})) {
        const si=tp.stable.findIndex(c=>c.id===extra.targetCardId);
        if(si!==-1){
          const c=tp.stable.splice(si,1)[0];
          this.removedFromGame.push(c);
          this.addLog(`${player.name}: Strange Craft Project — ${c.name} removed from the game`);
        }
      }
      return doneB();
    }

    // ── Nightmare: Buried Alive ───────────────────────────────────────────────
    // Ghost Guide: "you may DRAW a card and reveal it. If it is an Upgrade or
    // Downgrade card, bring it into your Stable." (otherwise it just stays in
    // hand, per the implementation's existing — and reasonable — reading of
    // an unstated case). Beginning-phase trigger: doneB(), not done().
    if (eff.type==='draw_reveal_if_upgrade_downgrade_into_stable' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      const drawn=this.deck.shift();
      if(drawn){
        if(drawn.type===CARD_TYPES.UPGRADE||drawn.type===CARD_TYPES.DOWNGRADE){
          this._placeCard(pid,drawn,null,null); this.addLog(`${player.name}: Ghost Guide → ${drawn.name} into stable`);
        } else { player.hand.push(drawn); this.addLog(`${player.name}: Ghost Guide → ${drawn.name} to hand`); }
      }
      return doneB();
    }

    if (eff.type==='sacrifice_unicorn_or_self_return' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!eff.choiceMade) {
        if (extra?.choice==='a') { // sacrifice a unicorn
          if (!sel.length) return {error:'Select a unicorn to sacrifice'};
          const si=player.stable.findIndex(c=>c.id===sel[0]&&this._isTargetableUnicorn(pid,c));
          if(si===-1) return {error:'Select a Unicorn'};
          if (!this._maybeIntercept('destroy', pid, pid, sel[0], false, {resumeType:'sacrifice', advance:'doneB'})) {
            this._sacrificeCard(pid,sel[0]);
            this.addLog(`${player.name}: Buried Alive — sacrifices unicorn`);
          }
          return doneB();
        } else if (extra?.choice==='b') { // sacrifice itself (the downgrade), then return a card from discard
          if (eff.sourceCardId && player.stable.some(c=>c.id===eff.sourceCardId)) {
            const intercepted = this._maybeIntercept('destroy', pid, pid, eff.sourceCardId, false, {
              resumeType:'sacrifice', advance:'doneB',
              thenRequeue:{ type:'buried_alive_return_from_discard', playerId:pid }
            });
            if (intercepted) return doneB();
            this._sacrificeCard(pid, eff.sourceCardId);
            this.addLog(`${player.name}: Buried Alive sacrifices itself`);
          }
          this._discardPick(pid,{},true,false);
          return doneB();
        }
        return {error:'Choose: [a] Sacrifice a unicorn  or  [b] Sacrifice Buried Alive, return card from discard'};
      }
    }

    // Buried Alive choice b, resumed after a declined intercept on its own self-sacrifice
    if (eff.type==='buried_alive_return_from_discard' && eff.playerId===pid) {
      this._discardPick(pid,{},true,false);
      return doneB();
    }

    // ── Critical Hit: on_magic_play — optionally sacrifice to replay last magic ─
    if (eff.type==='critical_hit_optional' && eff.playerId===pid) {
      if (extra?.skip) return done();
      // Find Critical Hit upgrade in stable
      const ch = player.stable.find(c => c.effect?.type==='sacrifice_self_replay_magic');
      if (!ch) return done();
      // Find last magic card in discard
      const lastMagicIdx = this.discard.slice().reverse().findIndex(c => c.type===CARD_TYPES.MAGIC);
      if (lastMagicIdx === -1) return done();
      // Check intercept BEFORE touching the discard pile, so a grabbed Critical Hit leaves
      // the pending magic card untouched (the whole replay never happens if its cost is intercepted).
      if (this._maybeIntercept('destroy', pid, pid, ch.id, false)) return done();
      const absIdx = this.discard.length - 1 - lastMagicIdx;
      const lastMagic = this.discard.splice(absIdx, 1)[0];
      // Sacrifice Critical Hit
      this._sacrificeCard(pid, ch.id);
      this.addLog(`${player.name}: Critical Hit — sacrifices itself to replay ${lastMagic.name}`);
      this.discard.push(lastMagic);
      return this._executeMagic(pid, lastMagic, null, null) || done();
    }

    // ── Unicorn Survival Kit: already handled in shield chain ─────────────────
    if (eff.type==='discard_two_instead' && eff.playerId===pid) { return done(); }

    // ── Angel Unicorn: sacrifice itself (beginning), revive unicorn from discard ─
    if (eff.type==='sacrifice_self_revive_unicorn' && eff.playerId===pid) {
      if (extra?.skip) return doneB();
      if (!eff.sacrificeDone && eff.sourceCardId && player.stable.some(c=>c.id===eff.sourceCardId)) {
        const intercepted = this._maybeIntercept('destroy', pid, pid, eff.sourceCardId, false, {
          resumeType:'sacrifice', advance:'doneB',
          thenRequeue:{...eff, sacrificeDone:true}
        });
        if (intercepted) return doneB();
        this._sacrificeCard(pid, eff.sourceCardId);
        this.addLog(`${player.name}: Angel Unicorn — sacrifices itself`);
      }
      const unis=this.discard.filter(c=>IS_UNICORN(c.type));
      if(unis.length===0) return doneB();
      const unisIds = new Set(unis.map(c=>c.id));
      this.discard = this.discard.filter(c=>!unisIds.has(c.id));
      this.pendingEffect={...eff,sacrificeDone:true,options:unis};
      this._queueEffect({type:'from_discard_pick',playerId:pid,options:unis,intoStable:true,targetType:'unicorn',fromBeginning:eff.fromBeginning});
      return doneB();
    }

    // ── Bungee Jumping Unicorn: on leave — sacrifice downgrade or return to hand
    if (eff.type==='choice_sacrifice_downgrade_or_return_hand' && eff.playerId===pid) {
      if (extra?.skip) return done();
      if (extra?.choice==='a') { // sacrifice a downgrade
        if(!extra?.targetCardId) return {error:'Click a Downgrade in your stable to sacrifice'};
        const si=player.stable.findIndex(c=>c.id===extra.targetCardId&&c.type===CARD_TYPES.DOWNGRADE);
        if(si===-1) return {error:'That isn\'t a Downgrade in your Stable — click one of your Downgrade cards'};
        if(si!==-1){
          if (!this._maybeIntercept('destroy', pid, pid, extra.targetCardId, false, {resumeType:'sacrifice'})) {
            this._sacrificeCard(pid,extra.targetCardId);
            this.addLog(`${player.name}: Bungee — sacrifices downgrade`);
          }
        }
      } else if (extra?.choice==='b') { // return a card from stable to hand
        if(!extra?.targetCardId) return {error:'Click a card in your stable to return to hand'};
        const si=player.stable.findIndex(c=>c.id===extra.targetCardId);
        if(si!==-1){player.hand.push(player.stable.splice(si,1)[0]);this.addLog(`${player.name}: Bungee — returns card to hand`);}
      } else return {error:'Choose: [a] Sacrifice a Downgrade  or  [b] Return a card to hand'};
      return done();
    }

    // ── First Mer-mate Unicorn: on leave — draw 2 or play basic from hand ─────
    if (eff.type==='choice_draw_two_or_play_basic' && eff.playerId===pid) {
      if (extra?.skip) return done();
      if (extra?.choice==='a') { // draw 2
        this._drawCards(pid,2); this.addLog(`${player.name}: First Mer-mate — draws 2`);
      } else if (extra?.choice==='b') { // play a basic unicorn from hand free
        if(!sel.length) return {error:'Select a Basic Unicorn from your hand'};
        const di=player.hand.findIndex(c=>c.id===sel[0]&&c.type===CARD_TYPES.BASIC_UNICORN);
        if(di===-1) return {error:'Select a Basic Unicorn'};
        const basic=player.hand.splice(di,1)[0]; this._placeCard(pid,basic,null,null);
        this.addLog(`${player.name}: First Mer-mate — plays ${basic.emoji} ${basic.name} free`);
      } else return {error:'Choose: [a] Draw 2 cards  or  [b] Play a Basic Unicorn from hand'};
      return done();
    }

    // ── Unicorn Survival Kit: on_sac_or_destroy — discard 2 instead ──────────
    // (This is a shield passive checked in _sacrificeCard/_destroyCard; resolve_effect not needed)
    // But if somehow queued, skip it.
    if (eff.type==='discard_two_instead' && eff.playerId===pid) { return done(); }

    // ── choose_opponent_discard: current player picks who must discard (Annoying Flying Unicorn) ─
    if (eff.type==='choose_opponent_discard' && eff.playerId===pid) {
      if (extra?.skip) return done();
      if (!extra?.targetPlayerId) return {error:'Click a player to force them to discard'};
      if (extra.targetPlayerId === pid) return {error:'You must target an opponent'};
      if (!this.players[extra.targetPlayerId]) return {error:'Invalid target player'};
      // Queue target_discard for the chosen opponent — will fire after this resolves
      this._queueEffect({type:'target_discard',playerId:extra.targetPlayerId,amount:eff.amount||1,source:eff.source});
      return done();
    }

    return {error:'Cannot resolve that effect right now'};
  }

  _drawCards(pid, count) {
    for (let i=0;i<count;i++) {
      if(this.deck.length===0){if(this.discard.length===0)return;this.deck=shuffle(this.discard);this.discard=[];this.addLog('Deck reshuffled');}
      if(this.deck.length>0)this.players[pid].hand.push(this.deck.shift());
    }
  }

  // ══ Reactions & replacement effects ═══════════════════════════════════════
  // Everything below used to be copy-pasted into _sacrificeCard, _destroyCard,
  // _stealCard, _placeCard and the play path (about twenty inline
  // _discardRandom calls between them). "DISCARD a card" with no "at random"
  // wording is the AFFECTED PLAYER'S choice — and these fire in the middle of
  // other effects, so they are always QUEUED (never resolved inline), marked
  // `reactive` so a turn-ending card (Rhinocorn, Zombie Unicorn, ...) still lets
  // them finish before the turn passes (see _endTurnNow).

  // Queue "<source> makes <pid> discard N cards (their choice)".
  _reactiveDiscard(pid, amount, source) {
    const p = this.players[pid];
    if (!p || p.hand.length === 0) return;
    this._queueEffect({ type:'discard_choice', playerId:pid, amount, source, reactive:true,
                        fromBeginning: this.phase === PHASES.BEGINNING });
    this.addLog(`${p.name}: ${source} — must discard ${amount}`);
  }

  // Name of the card providing a passive, for log lines/prompts.
  _passiveSource(pid, type, fallback) {
    return this._getPassives(pid).find(p => p.type === type)?.sourceCard?.name || fallback;
  }

  // A Unicorn card entered `pid`'s Stable (played, placed from deck/discard,
  // stolen, intercepted...). Barbed Wire, Tiny Stable, Gingerbread Stable.
  _onUnicornEntered(pid, card) {
    if (!card || !IS_UNICORN(card.type)) return;
    if (this._hasPassive(pid,'on_unicorn_enter_or_leave'))
      this._reactiveDiscard(pid, 1, this._passiveSource(pid,'on_unicorn_enter_or_leave','Barbed Wire'));
    if (this._hasPassive(pid,'tiny_stable_limit')) {
      const limit = this._getPassives(pid).find(p=>p.type==='tiny_stable_limit')?.limit||5;
      if (this._unicornCount(pid) > limit) this._queueEffect({ type:'sacrifice_unicorn_tiny_stable', playerId:pid, reactive:true });
    }
    // Gingerbread Stable: "you MAY draw a card"
    if (this._hasPassive(pid,'on_unicorn_enter'))
      this._queueEffect({ type:'draw_n_optional', playerId:pid, amount:1, optional:true, reactive:true,
                          source:this._passiveSource(pid,'on_unicorn_enter','Gingerbread Stable') });
  }

  // A Unicorn card left `pid`'s Stable by any route (sacrificed, destroyed,
  // stolen, returned to hand, moved). Barbed Wire.
  _onUnicornLeft(pid, card) {
    if (!card || !IS_UNICORN(card.type)) return;
    if (this._hasPassive(pid,'on_unicorn_enter_or_leave'))
      this._reactiveDiscard(pid, 1, this._passiveSource(pid,'on_unicorn_enter_or_leave','Barbed Wire'));
  }

  // Take the card at stable index `si` out of `pid`'s Stable to MOVE it somewhere
  // (not a sacrifice/destroy). Fires the "leaves your Stable" reaction that the
  // inline `stable.splice(...)` at each move site used to skip.
  _liftFromStable(pid, si) {
    const card = this.players[pid].stable.splice(si, 1)[0];
    this._onUnicornLeft(pid, card);
    return card;
  }

  // Can `card` be moved into `toPid`'s Stable? Returns an error message, or null if it can.
  // A Downgrade can't be PLAYED onto a Stable protected by Saved by the Sigil or Dragon's
  // Blessing (see playCard) — and a MOVED Downgrade (Re-Target, Pillaging Pirate, Orcicorn Raider...)
  // used to walk straight past both. Checked BEFORE the card is lifted, so a refusal costs nothing.
  _cardEntryBlocker(card, toPid) {
    const t = this.players[toPid];
    if (!t) return 'Invalid target player';
    if (card.type !== CARD_TYPES.DOWNGRADE) return null;
    if (this._hasPassive(toPid,'block_downgrades_self_protected'))
      return `${t.name} is protected by Saved by the Sigil — Downgrades cannot be moved onto them`;
    if (this._hasPassive(toPid,'downgrades_have_no_effect'))
      return `${t.name} is protected by Dragon's Blessing — Downgrades have no effect there`;
    return null;
  }

  // "Each time you STEAL or DESTROY a card" — Naughty List. Only ever the ACTOR.
  _onStealOrDestroy(pid) {
    if (!pid || !this.players[pid]) return;
    for (const sc of this.players[pid].stable) {
      if (sc.effect?.trigger === 'on_steal_or_destroy' && sc.effect?.type === EFFECTS.DISCARD)
        this._reactiveDiscard(pid, sc.effect.amount||1, sc.name);
    }
  }

  // A card was removed from `ownerPid`'s Stable by being sacrificed or destroyed.
  // Called by BOTH _sacrificeCard and _destroyCard — previously two near-copies.
  _onCardRemoved(ownerPid, card, how, byPid) {
    this._onUnicornLeft(ownerPid, card);
    // Unicorn Overboard: "Each time one of your UNICORN cards is sacrificed or
    // destroyed, DISCARD a card." (It used to fire for any card at all.)
    if (IS_UNICORN(card.type)) {
      for (const sc of this.players[ownerPid].stable) {
        if (sc.effect?.trigger === 'on_sac_or_destroy' && sc.effect?.type === EFFECTS.DISCARD)
          this._reactiveDiscard(ownerPid, sc.effect.amount||1, sc.name);
      }
    }
    if (how === 'destroy') this._onStealOrDestroy(byPid);
  }

  // ── Shields ("if X would be destroyed/sacrificed, you MAY <cost> instead") ──
  // Returns { shield, cost } for the first applicable shield the owner hasn't
  // already declined for this removal, or null.
  _findShield(ownerPid, card, how, declined = []) {
    const owner = this.players[ownerPid];
    for (const sc of owner.stable) {
      const e = sc.effect;
      if (!e || declined.includes(sc.id)) continue;
      const rule = SHIELD_RULES.find(r => r.match(e));
      if (!rule || !rule.how.includes(how)) continue;
      if (IS_UNICORN(sc.type) && this._unicornsNeutralized(ownerPid)) continue; // Blinding Light etc.
      if (rule.scope === 'self'    && sc.id !== card.id) continue;
      if (rule.scope === 'unicorn' && (!IS_UNICORN(card.type) || sc.id === card.id)) continue;
      if (rule.cost.kind === 'discard' && owner.hand.length < rule.cost.n) continue; // can't pay
      return { shield: sc, cost: rule.cost };
    }
    return null;
  }

  // If a shield applies, queue the owner's yes/no and return true — the caller
  // must then leave the card exactly where it is (it is resolved in the
  // 'shield_offer' case of resolvePendingEffect). Returns false if nothing applies.
  _offerShield(ownerPid, card, how, ctx = {}) {
    const found = this._findShield(ownerPid, card, how, ctx.declined || []);
    if (!found) return false;
    this._queueEffect({
      type:'shield_offer', playerId:ownerPid, how,
      protectedCardId:card.id, protectedName:card.name,
      shieldCardId:found.shield.id, shieldName:found.shield.name, cost:found.cost,
      byPid:ctx.byPid, byMagic:!!ctx.byMagic, toRemovedFromGame:!!ctx.toRemovedFromGame,
      kittenProtects:this._kittenProtects, declined:[...(ctx.declined||[]), found.shield.id],
      reactive:true, fromBeginning: this.phase === PHASES.BEGINNING,
    });
    return true;
  }

  // "...then immediately end your turn." Drops everything still queued for the
  // turn (salvaging any cards parked in those effects' options) EXCEPT
  // reactions — a Barbed Wire discard or a shield offer is a mandatory
  // consequence of something that already happened this turn, and must still
  // resolve; the turn then passes as soon as they have (_effectDone*).
  // Replaces six hand-copied "clear the queue and advance" blocks.
  _endTurnNow() {
    const reactions = [this.pendingEffect, ...this.pendingEffectQueue].filter(e => e?.reactive);
    this.pendingEffectQueue = this.pendingEffectQueue.filter(e => !e?.reactive);
    this._salvageQueuedOptions();
    this.pendingEffect = null; this.pendingEffectQueue = [];
    if (reactions.length > 0) {
      this.pendingEffect = reactions.shift();
      this.pendingEffectQueue = reactions;
      this._endTurnAfterEffects = true;
      return;
    }
    this._advanceTurn();
  }

  // ── Central _sacrificeCard: all sacrifice paths route through here ───────────
  // Returns { redirected:true } if an intercept absorbed the sacrifice,
  // { card } on normal sacrifice, { error } if card not found.
  // opts.declined: ids of shields the owner already said no to for THIS removal
  // (so the retry after a declined offer doesn't ask again, and a second,
  // different shield can still be offered).
  _sacrificeCard(pid, cid, opts = {}) {
    const player = this.players[pid];
    const idx = player.stable.findIndex(c => c.id === cid);
    if (idx === -1) return { error:'Card not in stable' };
    const card = player.stable[idx];

    // cannot_be_sacrificed_or_destroyed — indestructible; also Saved by the Sigil
    if (card.effect?.type === 'cannot_be_sacrificed_or_destroyed'
        || card.effect?.type === 'block_downgrades_self_protected') {
      this.addLog(`${card.name} cannot be sacrificed!`); return { redirected:true };
    }

    // on_leave return_to_hand_self — e.g. Festive Flying Unicorn, Flying Krampuscorn
    if (card.effect?.onLeave?.type === 'return_to_hand_self') {
      player.stable.splice(idx, 1);
      player.hand.push(card);
      this.addLog(`${card.name} returns to ${player.name}'s hand instead of being sacrificed`);
      this._onUnicornLeft(pid, card);
      return { redirected:true };
    }

    // on_sac_destroy_return_hand → return to Nursery (Nightmare baby unicorns)
    if (card.effect?.trigger === 'on_sac_destroy_return_hand' && card.effect?.type === 'return_to_nursery_instead') {
      player.stable.splice(idx, 1);
      this.nursery.unshift(card);
      this.addLog(`${card.name} returns to Nursery instead of being sacrificed`);
      this._onUnicornLeft(pid, card);
      return { redirected:true };
    }

    // Shields ("you MAY <cost> instead") — the owner is asked; the card stays put until they answer.
    if (this._offerShield(pid, card, 'sacrifice', { byPid:pid, declined:opts.declined })) return { redirected:true, deferred:true };

    // Normal sacrifice
    player.stable.splice(idx, 1);
    this.discard.push(card);
    this.addLog(`${player.name} sacrifices their ${card.emoji} ${card.name}`);
    this._onCardRemoved(pid, card, 'sacrifice', pid);

    // on_leave triggers on the sacrificed card
    if (card.effect?.trigger === 'on_leave') {
      // This is the sacrificed card's own ability firing, not whatever caused the
      // sacrifice — recompute the source from THIS card, not the outer context.
      this._kittenProtects = (card.type === CARD_TYPES.UPGRADE || card.type === CARD_TYPES.DOWNGRADE);
      if (card.effect.type === EFFECTS.DESTROY) this._queueEffect({type:'choose_destroy',playerId:pid,targetType:card.effect.targetType||null,optional:true});
      if ([EFFECTS.FROM_DISCARD,'from_discard'].includes(card.effect.type)) {
        this._discardPick(pid, card.effect, card.effect.addToHand!==false, card.effect.intoStable===true);
      }
      if (card.effect.type === 'choice_sacrifice_downgrade_or_return_hand') this._queueEffect({type:'choice_sacrifice_downgrade_or_return_hand',playerId:pid});
      if (card.effect.type === 'choice_draw_two_or_play_basic') this._queueEffect({type:'choice_draw_two_or_play_basic',playerId:pid});
    }
    if (card.effect?.onLeave?.type === 'sacrifice_a_card') this._queueEffect({type:'sacrifice_any',playerId:pid,source:card.name});

    return { card };
  }

  // ── Route a card into its correct destination (stable/discard/execute) ───────
  // Used by search results and effects that place cards directly from deck/discard
  _placeCard(pid, card, tPid, tCid) {
    const player = this.players[pid];
    switch (card.type) {
      case CARD_TYPES.BABY_UNICORN:
      case CARD_TYPES.BASIC_UNICORN:
      case CARD_TYPES.MAGICAL_UNICORN:
        // Queen Bee: block basics from entering other players' stables
        if (card.type===CARD_TYPES.BASIC_UNICORN) {
          for (const p of this.playerOrder) {
            if (p!==pid && this._hasPassive(p,'block_basic_to_others')) {
              this.discard.push(card); this.addLog(`Queen Bee blocks ${card.emoji} ${card.name}!`); return;
            }
          }
          // Extreme Adventurer: block basics entering own stable
          if (this._hasPassive(pid,'block_basic_unicorns_own_stable')) {
            this.discard.push(card); this.addLog(`${card.emoji} ${card.name} blocked from own stable`); return;
          }
        }
        // Humbug: Magical Unicorn cards cannot enter your Stable
        if (card.type===CARD_TYPES.MAGICAL_UNICORN && this._hasPassive(pid,'block_magical_unicorns')) {
          this.discard.push(card); this.addLog(`${card.emoji} ${card.name} blocked by Humbug`); return;
        }
        player.stable.push(card);
        this.addLog(`${player.name} adds ${card.emoji} ${card.name} to stable`);
        this._onUnicornEntered(pid, card);
        this._enterTrigger(card, pid, tPid, tCid);
        if (!this.winner) {
          const w = this._checkWin();
          if (w) { this.winner = w; this.phase = PHASES.GAME_OVER; this.addLog(`🎉 ${this.players[w].name} wins!`); }
        }
        break;
      case CARD_TYPES.UPGRADE:
        player.stable.push({...card, isUpgrade:true});
        this.addLog(`${player.name} adds ${card.emoji} ${card.name} to stable`);
        this._enterTrigger(card, pid, tPid, tCid);
        break;
      case CARD_TYPES.DOWNGRADE:
        player.stable.push({...card, isDowngrade:true});
        this.addLog(`${player.name} adds ${card.emoji} ${card.name} to stable`);
        break;
      case CARD_TYPES.MAGIC:
      case CARD_TYPES.INSTANT:
        this.discard.push(card);
        this.addLog(`${player.name} plays ${card.emoji} ${card.name}`);
        this._executeMagic(pid, card, tPid, tCid);
        break;
      default:
        // Safety net — never silently place unknown card types into stable
        this.discard.push(card);
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[UU] _placeCard: unknown card type '${card.type}' for '${card.name}' — sent to discard`);
        }
    }
  }

  // opts.declined: shield ids the owner already declined for THIS removal.
  // Returns { destroyed:true, card } when the card left the Stable, otherwise
  // { destroyed:false } (blocked) or { destroyed:false, deferred:true } (a shield
  // offer is waiting on the owner — the card has NOT moved yet).
  _destroyCard(tPid, tCid, byPid, byMagic=false, toRemovedFromGame=false, opts={}) {
    const tp = this.players[tPid];
    if (this._hasPassive(tPid,'protect_from_destroy')) { this.addLog(`Destroy blocked by Rainbow Aura!`); return; }
    // Magical Kittencorn: cannot be destroyed by Magic, Upgrade, or Downgrade cards —
    // but CAN be destroyed by a Unicorn card's own ability (its actual printed rule is
    // "cannot be destroyed by Magic cards"; this codebase extends that to Upgrade/
    // Downgrade-sourced destroys too, since those aren't a Unicorn's own ability either
    // — see the `_kittenProtects` field's doc comment in the constructor for why this
    // is a single dispatch-time flag rather than a parameter threaded through every
    // call site). The old `byMagic` parameter is intentionally NOT used for this check
    // anymore — many call sites (e.g. Stable Artillery, an Upgrade) hardcoded it to
    // `false`, which incorrectly let Kittencorn be destroyed by non-Magic protected
    // sources too; it's kept in the signature only because some callers still pass it
    // for clarity/documentation at the call site.
    // Check BEFORE the main idx lookup so we can identify the target card first.
    if ((byMagic || this._kittenProtects) && this._hasPassive(tPid,'protect_from_magic_destroy')) {
      const idx2 = tp.stable.findIndex(c => c.id === tCid);
      const cardAtIdx = idx2 !== -1 ? tp.stable[idx2] : null;
      // Only block if the card being targeted IS the Kittencorn itself (has the protection effect)
      if (cardAtIdx && cardAtIdx.effect?.type === 'protection' && cardAtIdx.effect?.protectsFrom === 'magic_destroy') {
        this.addLog(`${cardAtIdx.name} cannot be destroyed by Magic, Upgrade, or Downgrade cards!`); return { destroyed:false };
      }
    }
    const idx = tp.stable.findIndex(c => c.id === tCid);
    if (idx === -1) return { destroyed:false };
    const card = tp.stable[idx];
    if (card.effect?.type==='cannot_be_sacrificed_or_destroyed' || card.effect?.type==='cannot_be_destroyed'
        || card.effect?.passive?.type==='cannot_be_destroyed'
        || card.effect?.type==='block_downgrades_self_protected') {
      this.addLog(`${card.name} cannot be destroyed!`); return { destroyed:false };
    }

    // on_leave return_to_hand_self — Festive Flying Unicorn, Flying Krampuscorn etc.
    if (card.effect?.onLeave?.type === 'return_to_hand_self') {
      tp.stable.splice(idx, 1); tp.hand.push(card);
      this.addLog(`${card.name} returns to ${tp.name}'s hand instead of being destroyed`);
      this._onUnicornLeft(tPid, card);
      return { destroyed:false };
    }

    // on_sac_destroy_return_hand → Nursery (Nightmare baby unicorns)
    if (card.effect?.trigger === 'on_sac_destroy_return_hand' && card.effect?.type === 'return_to_nursery_instead') {
      tp.stable.splice(idx, 1); this.nursery.unshift(card);
      this.addLog(`${card.name} returns to Nursery instead of being destroyed`);
      this._onUnicornLeft(tPid, card);
      return { destroyed:false };
    }

    // Shields ("you MAY <cost> instead") — Unicorn Phoenix, Black Knight, Dragon
    // Protection, Magic Elixir, Unicorn Survival Kit, Blow Up Unicorn. The owner is
    // asked; the card stays put until they answer.
    if (this._offerShield(tPid, card, 'destroy', { byPid, byMagic, toRemovedFromGame, declined:opts.declined }))
      return { destroyed:false, deferred:true };

    // Normal destroy — sent to discard, unless this destroy is itself a "remove
    // from game" effect (e.g. HEEEEERE'S STABBY), in which case it goes to
    // removedFromGame instead. Either way, every protection check above still applies.
    tp.stable.splice(idx, 1);
    if (toRemovedFromGame) {
      this.removedFromGame.push(card);
      this.addLog(`${this.players[byPid]?.name||'?'} removes ${tp.name}'s ${card.emoji} ${card.name} from the game`);
    } else {
      this.discard.push(card);
      this.addLog(`${this.players[byPid]?.name||'?'} destroys ${tp.name}'s ${card.emoji} ${card.name}`);
    }
    // Barbed Wire / Unicorn Overboard (victim) and Naughty List (the destroyer)
    this._onCardRemoved(tPid, card, 'destroy', byPid);

    // Wall of Horns: when own unicorn is destroyed by an opponent, pull random from attacker
    for (const sc of tp.stable) {
      if (sc.effect?.trigger === 'on_unicorn_destroyed' && sc.effect?.type === 'pull_random_from_attacker' &&
          IS_UNICORN(card.type) && byPid && byPid !== tPid) {
        // "you MAY pull a card at random" — an offer, not a forced pull (and not worth
        // asking when the attacker has nothing to pull).
        const attacker = this.players[byPid];
        if (attacker && attacker.hand.length > 0) {
          this._queueEffect({ type:'wall_of_horns_offer', playerId:tPid, attackerId:byPid, optional:true,
            source:sc.name, reactive:true, fromBeginning: this.phase === PHASES.BEGINNING });
        }
      }
    }

    if (card.effect?.trigger === 'on_leave') {
      // This is the just-destroyed card's own ability firing, not whatever destroyed
      // it — recompute the source from THIS card, not the outer context.
      this._kittenProtects = (card.type === CARD_TYPES.UPGRADE || card.type === CARD_TYPES.DOWNGRADE);
      if (card.effect.type === EFFECTS.DESTROY) this._queueEffect({type:'choose_destroy',playerId:tPid,targetType:card.effect.targetType||null,optional:true});
      if ([EFFECTS.FROM_DISCARD,'from_discard'].includes(card.effect.type)) {
        const found = this._discardPick(tPid, card.effect, card.effect.addToHand!==false, card.effect.intoStable===true);
        if (found) return { destroyed:true, card };
      }
      if (card.effect.type === 'choice_sacrifice_downgrade_or_return_hand') this._queueEffect({type:'choice_sacrifice_downgrade_or_return_hand',playerId:tPid});
      if (card.effect.type === 'choice_draw_two_or_play_basic') this._queueEffect({type:'choice_draw_two_or_play_basic',playerId:tPid});
    }
    if (card.effect?.onLeave?.type === 'sacrifice_a_card') this._queueEffect({type:'sacrifice_any',playerId:tPid,source:card.name});
    if (card.name === 'Dragon Unicorn') { this._kittenProtects = false; this._queueEffect({type:'choose_destroy',playerId:tPid,targetType:'unicorn',optional:true}); }
    return { destroyed:true, card };
  }

  _stealCard(byPid, fromPid, cid) {
    if(this._hasPassive(fromPid,'unicorns_cannot_be_stolen')){this.addLog(`Steal blocked!`);return;}
    const from=this.players[fromPid],to=this.players[byPid];
    const idx=from.stable.findIndex(c=>c.id===cid);if(idx===-1)return;
    const stolen=from.stable.splice(idx,1)[0];
    to.stable.push(stolen);
    this.addLog(`${to.name} steals ${stolen.emoji} ${stolen.name} from ${from.name}`);
    this._onUnicornLeft(fromPid, stolen);   // Barbed Wire on the victim (Unicorn cards only)
    this._onStealOrDestroy(byPid);          // Naughty List on the thief
    this._onUnicornEntered(byPid, stolen);  // ...and the thief's Stable just GAINED a Unicorn:
                                            // Barbed Wire / Tiny Stable / Gingerbread Stable
    // A card's "when this enters your Stable" effect fires whenever it enters ANY
    // stable, not just when originally played from hand — including via steal.
    this._enterTrigger(stolen, byPid, null, null);
  }

  _returnToHand(fromPid, cid, byPid) {
    const from=this.players[fromPid];const idx=from.stable.findIndex(c=>c.id===cid);if(idx===-1)return;
    const card=from.stable.splice(idx,1)[0];from.hand.push(card);
    this.addLog(`${this.players[byPid]?.name} returns ${card.name} to ${from.name}'s hand`);
    this._onUnicornLeft(fromPid, card);
  }

  // A player's hand limit, DERIVED from what is in play right now — never stored. The old
  // approach added/subtracted a counter once when the card was played, so the effect stayed behind
  // when the card left (destroyed, sacrificed, stolen, moved by Re-Target) and was ignored by
  // Dragon's Blessing, Blinding Light and server restarts.
  //   reduce_hand_limit / increase_hand_limit : the owner of the Stable the card sits in
  //   all_hand_limit_reduce                   : everyone, wherever the card sits (Unicorn of Famine)
  _handLimit(pid) {
    let limit = 7;
    for (const owner of this.playerOrder) {
      const stable = this.players[owner].stable;
      const downgradesNeutered = stable.some(c => c.effect?.trigger==='passive' && c.effect?.type==='downgrades_have_no_effect');
      const unicornsNeutral = this._unicornsNeutralized(owner);
      for (const c of stable) {
        if (downgradesNeutered && c.type === CARD_TYPES.DOWNGRADE) continue;   // Dragon's Blessing
        if (unicornsNeutral && IS_UNICORN(c.type)) continue;                   // Blinding Light
        for (const eff of [c.effect, c.effect?.passive]) {
          if (!eff) continue;
          if (eff.type === 'all_hand_limit_reduce') limit -= (eff.amount || 5);
          else if (owner === pid && eff.type === 'reduce_hand_limit')   limit -= (eff.amount || 4);
          else if (owner === pid && eff.type === 'increase_hand_limit') limit += (eff.amount || 3);
        }
      }
    }
    return Math.max(0, limit);
  }

  _endPhase() {
    // Check hand limits for every player, not just the current one.
    // Cards can accumulate in non-active players' hands from forced draws, pulls, etc.
    for (const pid of this.playerOrder) {
      const player = this.players[pid];
      const limit = this._handLimit(pid);
      if (player.hand.length > limit) {
        const excess = player.hand.length - limit;
        this.pendingEffect = { type:'end_discard', playerId:pid, amount:excess };
        this.addLog(`${player.name} must discard ${excess} card(s) (hand limit: ${limit})`);
        return; // re-enters _endPhase via _effectDone once that player discards
      }
    }
    this._advanceTurn();
  }

  _advanceTurn() {
    const currentPid = this.currentPlayer;
    // ── Extra turn: current player gets another go before advancing ───────────
    if ((this.extraTurns[currentPid]||0) > 0) {
      this.extraTurns[currentPid]--;
      this._endTurnAfterEffects = false;
      this._salvageQueuedOptions();
      this.phase = PHASES.BEGINNING; this.pendingEffectQueue = [];
      this.addLog(`${this.players[currentPid].name} takes an extra turn!`);
      this._beginningPhase();
      return;
    }
    // Return any expired temp-steals for the next player
    if (this.tempSteals && this.tempSteals.length>0) {
      const next=this.playerOrder[(this.currentPlayerIndex+1)%this.playerOrder.length];
      const expired=this.tempSteals.filter(ts=>ts.pid===next);
      for (const ts of expired) {
        const fromPlayer=this.players[ts.pid];const toPlayer=this.players[ts.returnTo];
        if(fromPlayer&&toPlayer){const ci=fromPlayer.stable.findIndex(c=>c.id===ts.cardId);if(ci!==-1){const c=fromPlayer.stable.splice(ci,1)[0];delete c._tempFrom;toPlayer.stable.push(c);this.addLog(`${c.name} returns to ${toPlayer.name} (temp steal ended)`);
          // The card has moved, but the enter/leave reactions (Barbed Wire, Tiny Stable,
          // Gingerbread Stable) can't be queued here — this function clears the effect
          // queue a few lines down. They fire at the top of the next Beginning phase.
          (this._returnedTempSteals = this._returnedTempSteals || []).push({ from:ts.pid, to:ts.returnTo, card:c });
        }}
      }
      this.tempSteals=this.tempSteals.filter(ts=>ts.pid!==next);
    }
    this._endTurnAfterEffects = false;
    this.currentPlayerIndex=(this.currentPlayerIndex+1)%this.playerOrder.length;
    this._salvageQueuedOptions();
    this.phase=PHASES.BEGINNING;this.pendingEffectQueue=[];
    const next=this.players[this.currentPlayer];
    if(next)this.addLog(`─── ${next.name}'s turn ───`);
    this._beginningPhase();
  }

  _unicornCount(pid) {
    let n=0;
    for(const card of this.players[pid].stable){
      if(!IS_UNICORN(card.type))continue;
      n+=(card.effect?.type==='count_as_two'||card.effect?.type==='count_double')?2:1;
    }
    return n;
  }

  _checkWin() {
    const target=this.settings.winCondition||7;
    for(const pid of this.playerOrder){
      if(this._hasPassive(pid,'cannot_win'))continue;
      if(this._hasPassive(pid,'cannot_win_with_basic')&&this.players[pid].stable.some(c=>c.type===CARD_TYPES.BASIC_UNICORN))continue;
      // Pandamonium: unicorns are pandas (not unicorns) — can never win by unicorn count
      if(this._hasPassive(pid,'unicorns_are_pandas'))continue;
      if(this._unicornCount(pid)>=target)return pid;
    }
    return null;
  }

  get currentPlayer(){return this.playerOrder[this.currentPlayerIndex];}

  addLog(msg){this.log.push({msg,ts:Date.now()});if(this.log.length>120)this.log.shift();}

  // opts.spectator: true reveals every player's hand (full "broadcast" view) regardless
  // of playerId — used for spectators, who have no player of their own to compare against.
  stateFor(playerId, opts={}) {
    const spectator = !!opts.spectator;
    const local=this.settings.localMode, debug=this.settings.debugMode;
    const revealAll = local || debug || spectator;
    const myEff = spectator
      ? this.pendingEffect
      : (this.pendingEffect&&(this.pendingEffect.playerId===playerId||this.pendingEffect.revealToPlayerId===playerId)?this.pendingEffect:null);
    return {
      phase:this.phase, currentPlayer:this.currentPlayer, playerOrder:this.playerOrder, winner:this.winner,
      deckCount:this.deck.length, discardCount:this.discard.length, discardTop:this.discard[this.discard.length-1]||null,
      discardPile:[...this.discard].reverse(), // full discard pile, most-recent first — lets players browse/search at any time
      nurseryCount:this.nursery.length, removedFromGameCount:this.removedFromGame.length, log:this.log.slice(-30),
      neighWindow:this.neighWindow, pendingCard:(this.neighWindow||this.superNeighWindow)?this.pendingCard?.card:null,
      pendingCardPlayerId:(this.neighWindow||this.superNeighWindow)?this.pendingCard?.playerId:null,
      superNeighWindow:this.superNeighWindow,
      superNeighCard:this.superNeighWindow?this.superNeighPendingCard?.card:null,
      superNeighPlayerId:this.superNeighWindow?this.superNeighPendingCard?.playerId:null,
      neighChainLength:this.superNeighWindow?this.neighChain.length:0,
      // Every opponent who could still Neigh this and hasn't yet passed or played
      // one — lets the client show "waiting on: X, Y" and knows when it can render
      // the actor's own resolve button as an actual no-op vs. a real fallback.
      neighPendingResponders:(this.neighWindow||this.superNeighWindow) ? this.neighPendingResponders() : [],
      neighIHavePassed:playerId?this.neighPassed.has(playerId):false,
      // Lets clients render a countdown and disable "Let it play"/"Let it stand"
      // until opponents have had a fair chance to Neigh.
      // Only meaningful while someone could still respond (the window has no grace period otherwise).
      neighWaitRemainingMs:((this.neighWindow||this.superNeighWindow) && this.neighPendingResponders().length>0)?this._neighWaitRemaining():0,
      neighBlocked:playerId?this._hasPassive(playerId,'cannot_play_neigh'):false,
      pendingEffect:myEff, settings:this.settings, winCondition:this.settings.winCondition||7,
      debugInfo:debug?{deckTop:this.deck.slice(0,10),fullDiscard:this.discard,removedFromGame:this.removedFromGame}:null,
      isSpectator:spectator,
      players:Object.fromEntries(this.playerOrder.map(pid2=>{
        const p=this.players[pid2];
        // Show pid2's hand to the requesting player if:
        //  - it IS the requesting player (always see own hand)
        //  - local/debug/spectator mode (all reveal every hand)
        //  - pid2 has Nanny Cam (hand_visible) in their own stable — their hand is forced visible to everyone
        const pid2HasNannyCam = this._hasPassive(pid2,'hand_visible');
        const showHand = pid2===playerId || revealAll || pid2HasNannyCam;
        return [pid2,{id:pid2,name:p.name,isHost:p.isHost,connected:p.connected,
          handCount:p.hand.length, hand:showHand?p.hand:[],
          stable:p.stable, unicornCount:this._unicornCount(pid2),
          handLimit:this._handLimit(pid2),
          handVisible:pid2!==playerId&&(pid2HasNannyCam||revealAll),
          isBot:!!p.isBot, botDifficulty:p.isBot?p.botDifficulty:undefined}];
      })),
    };
  }
}

module.exports = { Game, PHASES, MIN_NEIGH_WAIT_MS };

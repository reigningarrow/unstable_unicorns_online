const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors   = require('cors');
const path   = require('path');
const fs     = require('fs');
const { Game } = require('./game');
const { EXPANSIONS } = require('./expansions');
const { runBotStep } = require('./bot');

// ── Last-resort safety net ───────────────────────────────────────────────────
// A single malformed/unexpected input should never be able to take the whole
// process (and every other player's game) down. The per-message try/catch below
// is the primary defense; this is a backstop for anything that still slips
// through (e.g. from a timer callback or a library internal).
process.on('uncaughtException', err => {
  console.error('[UU] uncaughtException (ignored, process kept alive):', err);
});
process.on('unhandledRejection', err => {
  console.error('[UU] unhandledRejection (ignored, process kept alive):', err);
});

const app = express();
app.use(cors());
app.use(express.json());

const clientBuildPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuildPath));

const server = http.createServer(app);
// maxPayload caps a single WebSocket message at 64 KiB — far more than any real
// game message needs — so a client can't tie up the server parsing huge frames.
const wss    = new WebSocket.Server({ server, maxPayload: 64 * 1024 });

// ── Room state ────────────────────────────────────────────────────────────────
const rooms = {};
const MAX_ROOMS = 1000; // hard cap so spamming room creation can't grow memory unbounded

// ── Persistence ───────────────────────────────────────────────────────────────
const SAVE_FILE = path.join(__dirname, 'rooms_snapshot.json');
let   saveTimer = null;

function persistRooms() {
  // Only persist rooms that have started and still have players
  const snapshot = {};
  for (const [rid, room] of Object.entries(rooms)) {
    const g = room.game;
    if (g.phase === 'waiting') continue;           // not started — skip
    if (Object.keys(g.players).length === 0) continue; // empty — skip
    try {
      snapshot[rid] = {
        phase:      g.phase,
        settings:   g.settings,
        players:    g.players,
        deck:       g.deck,
        discard:    g.discard,
        nursery:    g.nursery,
        removedFromGame: g.removedFromGame || [],
        log:        g.log,
        currentPlayerIndex: g.currentPlayerIndex,
        playerOrder: g.playerOrder,
        winCondition: g.winCondition,
        pendingEffect: g.pendingEffect,
        pendingEffectQueue: g.pendingEffectQueue,
        pendingCard: g.pendingCard,
        neighWindow: g.neighWindow,
        skippedActionPlayers: [...(g.skippedActionPlayers || new Set())],
        extraActionsThisTurn: g.extraActionsThisTurn || 0,
        globalHandLimitModifiers: g.globalHandLimitModifiers || 0,
        actionsUsedThisTurn: g.actionsUsedThisTurn || 0,
      };
    } catch (e) {
      console.warn('[UU] persist: failed to serialise room', rid, e.message);
    }
  }
  fs.writeFile(SAVE_FILE, JSON.stringify(snapshot, null, 2), err => {
    if (err) console.warn('[UU] persist: write failed:', err.message);
  });
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistRooms, 1500); // debounce — 1.5 s after last change
}

function loadPersistedRooms() {
  if (!fs.existsSync(SAVE_FILE)) return;
  try {
    const raw  = fs.readFileSync(SAVE_FILE, 'utf8');
    const snap = JSON.parse(raw);
    let   n    = 0;
    for (const [rid, data] of Object.entries(snap)) {
      if (!data.players || Object.keys(data.players).length === 0) continue;
      const g = new Game(rid);
      // Restore all fields
      g.phase          = data.phase;
      g.settings       = data.settings || {};
      g.players        = data.players;
      g.deck           = data.deck;
      g.discard        = data.discard;
      g.nursery        = data.nursery;
      g.removedFromGame = data.removedFromGame || [];
      g.log            = data.log || [];
      g.currentPlayerIndex = data.currentPlayerIndex || 0;
      g.playerOrder    = data.playerOrder || Object.keys(data.players);
      g.winCondition   = data.winCondition || 7;
      g.pendingEffect  = data.pendingEffect || null;
      g.pendingEffectQueue = data.pendingEffectQueue || [];
      g.pendingCard    = data.pendingCard || null;
      g.neighWindow    = data.neighWindow || false;
      g.skippedActionPlayers = new Set(data.skippedActionPlayers || []);
      g.extraActionsThisTurn = data.extraActionsThisTurn || 0;
      g.globalHandLimitModifiers = data.globalHandLimitModifiers || 0;
      g.actionsUsedThisTurn = data.actionsUsedThisTurn || 0;
      // Mark all players as disconnected — they'll reconnect via WS
      for (const p of Object.values(g.players)) p.connected = false;
      rooms[rid] = { game: g, clients: {} };
      n++;
    }
    if (n > 0) console.log(`[UU] Restored ${n} room(s) from snapshot`);
  } catch (e) {
    console.warn('[UU] persist: load failed (starting fresh):', e.message);
  }
}

// Load persisted rooms on startup
loadPersistedRooms();

// ── Bot scheduler ─────────────────────────────────────────────────────────────
// After every state change, give any bot players in the room a chance to act.
// Runs one bot action at a time (not a silent batch) so humans watching can
// actually follow what happened, with a short "thinking" delay between moves.
// A per-room flag prevents overlapping tick chains from broadcastState firing
// again mid-loop; an iteration cap is a last-resort safety valve in case some
// future change reintroduces a true infinite loop (bot.js's own circuit
// breaker should make this essentially unreachable in practice).
const BOT_TICK_SAFETY_CAP = 500;

function scheduleBotTick(roomId) {
  const room = rooms[roomId];
  if (!room || room.botTicking) return;
  room.botTicking = true;
  botTickLoop(roomId, 0);
}

function botTickLoop(roomId, iterations) {
  const room = rooms[roomId];
  if (!room) return;
  const game = room.game;
  if (game.winner || iterations > BOT_TICK_SAFETY_CAP) {
    if (iterations > BOT_TICK_SAFETY_CAP) console.error(`[UU] Bot tick loop for room ${roomId} exceeded safety cap — stopping.`);
    room.botTicking = false;
    return;
  }
  const botIds = game.playerOrder.filter(pid => game.players[pid]?.isBot);
  if (!botIds.length) { room.botTicking = false; return; }

  let kind = null, didAct = false, waitMs = null;
  for (const pid of botIds) {
    let res;
    try { res = runBotStep(game, pid, game.players[pid].botDifficulty); }
    catch (err) { console.error(`[UU] Bot step threw for room ${roomId}, player ${pid} (ignored):`, err); continue; }
    if (res?.acted) { kind = res.kind; waitMs = res.waitMs ?? null; didAct = true; break; } // one action per tick
  }

  if (!didAct) { room.botTicking = false; return; } // nothing to do right now

  // 'neigh_wait' means nothing actually changed (a bot is deliberately holding
  // off on closing its own neigh window so a human has time to react) — skip
  // the state broadcast, since there's nothing new to tell anyone.
  if (kind !== 'neigh_wait') {
    broadcastState(roomId);
    if (game.winner) {
      broadcast(roomId, { type:'game_over', winner: game.winner, name: game.players[game.winner]?.name });
      room.botTicking = false;
      return;
    }
  }
  // Pacing: longer "thinking" pause for turn actions and before closing a neigh
  // window (gives human opponents a beat to react), shorter for quick decisions.
  // 'neigh_wait' is polled at a bounded interval (not the full remaining wait in
  // one jump) so other bots still get their own regular chance to act — e.g. a
  // second bot deciding whether to counter-Neigh — instead of being blocked for
  // up to the full MIN_HUMAN_NEIGH_WAIT_MS by one bot's wait.
  const delay = kind === 'turn_action' ? 700 + Math.random() * 600
    : (kind === 'neigh_resolve' || kind === 'superneigh_resolve') ? 1300
    : (kind === 'neigh_decision' || kind === 'superneigh_decision') ? 450
    : kind === 'neigh_wait' ? Math.min(1000, waitMs || 1000)
    : 350;
  setTimeout(() => botTickLoop(roomId, iterations + 1), delay);
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────
function broadcastState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const spectatorCount = Object.keys(room.spectators || {}).length;
  for (const pid of Object.keys(room.clients)) {
    const ws = room.clients[pid];
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type:'state_update', state: { ...room.game.stateFor(pid), spectatorCount } }));
    }
  }
  if (room.spectators) {
    const specState = JSON.stringify({ type:'state_update', state: { ...room.game.stateFor(null, {spectator:true}), spectatorCount } });
    for (const ws of Object.values(room.spectators)) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(specState);
    }
  }
  scheduleSave();
  scheduleBotTick(roomId);
}

function broadcast(roomId, msg, excludePlayerId) {
  const room = rooms[roomId];
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const [pid, ws] of Object.entries(room.clients)) {
    if (pid !== excludePlayerId && ws?.readyState === WebSocket.OPEN) ws.send(data);
  }
  if (room.spectators) {
    for (const ws of Object.values(room.spectators)) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
}

// ── REST endpoints ────────────────────────────────────────────────────────────
// Simple in-memory rate limit on room creation: max 20 rooms per IP per 10 minutes.
// Not a substitute for a real reverse-proxy rate limiter in production, but stops
// trivial "spam POST /api/rooms forever" memory-exhaustion DoS out of the box.
const ROOM_CREATE_LIMIT = 20;
const ROOM_CREATE_WINDOW_MS = 10 * 60 * 1000;
const roomCreateLog = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const hits = (roomCreateLog.get(ip) || []).filter(t => now - t < ROOM_CREATE_WINDOW_MS);
  hits.push(now);
  roomCreateLog.set(ip, hits);
  return hits.length > ROOM_CREATE_LIMIT;
}

app.post('/api/rooms', (req, res) => {
  if (Object.keys(rooms).length >= MAX_ROOMS) return res.status(503).json({ error:'Server is at capacity, try again shortly' });
  if (isRateLimited(req.ip)) return res.status(429).json({ error:'Too many rooms created — try again later' });
  let roomId;
  do { roomId = Math.random().toString(36).substr(2,6).toUpperCase(); } while (rooms[roomId]);
  rooms[roomId] = { game: new Game(roomId), clients: {} };
  res.json({ roomId });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error:'Room not found' });
  res.json({ roomId: req.params.roomId, phase: room.game.phase, playerCount: Object.keys(room.game.players).length });
});

app.get('/api/expansions', (req, res) => {
  res.json(Object.entries(EXPANSIONS).map(([id,e]) => ({
    id, name:e.name, description:e.desc||e.description, cardCount:e.cardCount, ageRating:e.ageRating, color:e.color
  })));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath,'index.html'), err => {
    if (err) res.status(200).send('🦄 Unstable Unicorns server running.');
  });
});

// ── WebSocket handler ─────────────────────────────────────────────────────────
const MAX_NAME_LEN = 24;
const MAX_CHAT_LEN = 500;
const isNonEmptyString = (v, maxLen) => typeof v === 'string' && v.length > 0 && v.length <= maxLen;

wss.on('connection', ws => {
  let playerId = null, roomId = null, spectatorId = null;

  ws.on('error', err => {
    console.error('[UU] WebSocket connection error (ignored):', err.message);
  });

  ws.on('message', raw => {
    // Every branch below can throw on unexpected input shapes (wrong types, missing
    // fields, etc). A single malformed message must never be allowed to crash the
    // whole process and disconnect every other room — so the entire handler runs
    // inside a try/catch, and the sender gets an error back instead.
    try {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      const { type } = msg;
      if (typeof type !== 'string') return;

      if (type === 'join_spectator') {
        const { room } = msg;
        if (!isNonEmptyString(room, 12)) { ws.send(JSON.stringify({type:'error',error:'Room required'})); return; }
        const rid = room.toUpperCase();
        const r = rooms[rid];
        if (!r) { ws.send(JSON.stringify({type:'error',error:'Room not found'})); return; }
        spectatorId = uuidv4(); roomId = rid;
        if (!r.spectators) r.spectators = {};
        r.spectators[spectatorId] = ws;
        ws.send(JSON.stringify({type:'joined_spectator', roomId}));
        ws.send(JSON.stringify({type:'state_update', state: r.game.stateFor(null, {spectator:true})}));
        return;
      }

      if (type === 'join') {
        const { name, room } = msg;
        if (!isNonEmptyString(name, MAX_NAME_LEN) || !isNonEmptyString(room, 12)) {
          ws.send(JSON.stringify({type:'error',error:`Name (max ${MAX_NAME_LEN} chars) and room required`})); return;
        }
        const rid = room.toUpperCase();
        const r   = rooms[rid];
        if (!r) { ws.send(JSON.stringify({type:'error',error:'Room not found'})); return; }

        // Reconnect: player ID already known and exists in game
        if (typeof msg.playerId === 'string' && r.game.players[msg.playerId]) {
          playerId = msg.playerId; roomId = rid;
          r.clients[playerId] = ws;
          r.game.reconnectPlayer(playerId);
          ws.send(JSON.stringify({type:'joined',playerId,roomId,isHost:r.game.players[playerId].isHost}));
          broadcastState(roomId); return;
        }

        // New player
        playerId = uuidv4(); roomId = rid;
        const result = r.game.addPlayer(playerId, name);
        if (result.error) { ws.send(JSON.stringify({type:'error',error:result.error})); return; }
        r.clients[playerId] = ws;
        ws.send(JSON.stringify({type:'joined',playerId,roomId,isHost:r.game.players[playerId].isHost}));
        broadcastState(roomId); return;
      }

      if (!playerId || !roomId) { ws.send(JSON.stringify({type:'error',error:'Not in a game'})); return; }
      const room_obj = rooms[roomId]; if (!room_obj) return;
      const game = room_obj.game;

      const send_err = e => ws.send(JSON.stringify({type:'error',error:e}));
      const handle = (fn, ...args) => {
        const r = fn(...args);
        if (r?.error) { send_err(r.error); broadcastState(roomId); }
        else {
          broadcastState(roomId);
          if (r?.gameOver) broadcast(roomId, {type:'game_over', winner:r.winner, name:game.players[r.winner]?.name});
        }
      };

      switch (type) {
        case 'update_settings':
          if (!game.players[playerId]?.isHost) { send_err('Only host'); return; }
          game.updateSettings(msg.settings && typeof msg.settings === 'object' ? msg.settings : {}); broadcastState(roomId); break;
        case 'add_bot': {
          if (!game.players[playerId]?.isHost) { send_err('Only host can add bots'); return; }
          const difficulty = ['easy','medium','hard'].includes(msg.difficulty) ? msg.difficulty : 'medium';
          const name = isNonEmptyString(msg.name, MAX_NAME_LEN) ? msg.name : undefined;
          handle(game.addBot.bind(game), name, difficulty);
          break;
        }
        case 'remove_bot': {
          if (!game.players[playerId]?.isHost) { send_err('Only host can remove bots'); return; }
          if (!isNonEmptyString(msg.botId, 64)) { send_err('botId required'); return; }
          handle(game.removeBot.bind(game), msg.botId);
          break;
        }
        case 'start_game':
          if (!game.players[playerId]?.isHost) { send_err('Only host can start'); return; }
          handle(game.startGame.bind(game)); broadcast(roomId, {type:'game_started'}); break;
        case 'draw_card':        handle(game.drawCard.bind(game), playerId); break;
        case 'action_draw':      handle(game.actionDrawCard.bind(game), playerId); break;
        case 'play_card':        handle(game.playCard.bind(game), playerId, msg.cardId, msg.targetPlayerId, msg.targetCardId); break;
        case 'play_neigh':       handle(game.playInstant.bind(game), playerId, msg.cardId); break;
        case 'resolve_neigh':    handle(game.resolveNeigh.bind(game), playerId); break;
        case 'resolve_effect':   handle(game.resolvePendingEffect.bind(game), playerId, msg.selectedCardIds, msg.extra); break;
        case 'debug_action':     handle(game.debugAction.bind(game), playerId, msg.action, msg.payload||{}); break;
        case 'chat': {
          if (!isNonEmptyString(msg.text, MAX_CHAT_LEN)) return;
          const name = game.players[playerId]?.name || '?';
          broadcast(roomId, {type:'chat', name, text:msg.text}); break;
        }
        default: send_err(`Unknown: ${type}`);
      }
    } catch (err) {
      console.error('[UU] Error handling message (ignored, connection kept alive):', err);
      try { ws.send(JSON.stringify({type:'error', error:'Internal error processing your request'})); } catch { /* socket may already be closed */ }
    }
  });

  ws.on('close', () => {
    if (playerId && roomId && rooms[roomId]) {
      rooms[roomId].game.removePlayer(playerId);
      delete rooms[roomId].clients[playerId];
      broadcastState(roomId);
    }
    if (spectatorId && roomId && rooms[roomId]?.spectators) {
      delete rooms[roomId].spectators[spectatorId];
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🦄 Unstable Unicorns on port ${PORT}`));

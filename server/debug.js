// debug.js — Debug middleware and game inspector for Unstable Unicorns
// Enable with DEBUG=1 env var or ?debug=1 query param in the browser

const { createDeck, createBabyUnicornDeck, CARD_TYPES, EFFECTS } = require('./cards');
const { getExpansionCards, EXPANSIONS } = require('./expansions');

// ─── Card validator ───────────────────────────────────────────────────────────
// Runs at server startup and reports every card that looks wrong.

const VALID_TYPES  = new Set(Object.values(CARD_TYPES));
const VALID_EFFECTS = new Set([...Object.values(EFFECTS),
  'search_deck','all_draw','count_as_two','count_double','extra_turn',
  'skip_all_opponents','expose_hand','discard_hand','look_and_take',
  'apocalypse_plague','apocalypse_war','apocalypse_famine','apocalypse_death',
  'revive_unicorn','revive_any','revive_basic','draw_until_unicorn',
  'copy_steal','trade_card','look_deck','stash_card','play_free','heroic_charge',
  'swap_hand','look_hand','reduce_hand','hand_limit','cannot_play_unicorn',
  'skip_action','all_discard','copy_effect','copy_card','random_effect',
  'convert_to_panda','limit_stable','extra_turn_draw','ignore_neigh',
  'ignore_color','steal_on_neigh','win_at_6','ancient_bloodline',
]);

function validateCards(cards, source) {
  const issues = [];
  const nameTypeCounts = {};

  for (const card of cards) {
    const prefix = `[${source}] "${card.name}" (id=${card.id})`;

    // Missing fields
    if (!card.id)          issues.push({ level:'ERROR',   card, msg:`${prefix}: missing id` });
    if (!card.name)        issues.push({ level:'ERROR',   card, msg:`${prefix}: missing name` });
    if (!card.type)        issues.push({ level:'ERROR',   card, msg:`${prefix}: missing type` });
    if (!card.description) issues.push({ level:'WARNING', card, msg:`${prefix}: missing description` });
    if (!card.emoji)       issues.push({ level:'WARNING', card, msg:`${prefix}: missing emoji` });

    // Invalid type
    if (!VALID_TYPES.has(card.type))
      issues.push({ level:'ERROR', card, msg:`${prefix}: unknown type "${card.type}"` });

    // Effect validation
    if (card.effect) {
      if (!card.effect.type)
        issues.push({ level:'ERROR', card, msg:`${prefix}: effect has no .type` });
      else if (!VALID_EFFECTS.has(card.effect.type))
        issues.push({ level:'WARNING', card, msg:`${prefix}: unknown effect type "${card.effect.type}" — may be unimplemented` });
    }

    // Type-specific checks
    if (card.type === CARD_TYPES.MAGIC && card.effect?.type === EFFECTS.NEIGH)
      issues.push({ level:'ERROR', card, msg:`${prefix}: Neigh! effect on a MAGIC card — should be INSTANT` });

    if (card.type === CARD_TYPES.BASIC_UNICORN && card.effect)
      issues.push({ level:'WARNING', card, msg:`${prefix}: Basic Unicorn has an effect — should it be Magical?` });

    if (card.type === CARD_TYPES.INSTANT && card.effect?.type !== EFFECTS.NEIGH)
      issues.push({ level:'WARNING', card, msg:`${prefix}: Instant card with non-Neigh effect "${card.effect?.type}"` });

    // Track duplicates
    const key = `${card.name}::${card.type}`;
    nameTypeCounts[key] = (nameTypeCounts[key] || 0) + 1;
  }

  // Flag cards with same name but different types (potential misclassification)
  const nameGroups = {};
  for (const card of cards) {
    nameGroups[card.name] = nameGroups[card.name] || new Set();
    nameGroups[card.name].add(card.type);
  }
  for (const [name, types] of Object.entries(nameGroups)) {
    if (types.size > 1)
      issues.push({ level:'WARNING', card: { name }, msg:`[${source}] "${name}" exists with multiple types: ${[...types].join(', ')} — check for misclassification` });
  }

  return issues;
}

function runStartupValidation() {
  console.log('\n🔍 DEBUG: Running card validation…');
  const allIssues = [];

  // Base deck
  try {
    const baseCards = createDeck();
    const baseIssues = validateCards(baseCards, 'base');
    allIssues.push(...baseIssues);
    console.log(`  Base deck: ${baseCards.length} cards, ${baseIssues.length} issue(s)`);
  } catch (e) {
    console.error('  ERROR loading base deck:', e.message);
  }

  // Baby unicorns
  try {
    const babies = createBabyUnicornDeck();
    console.log(`  Baby unicorns: ${babies.length} cards`);
  } catch (e) {
    console.error('  ERROR loading baby unicorns:', e.message);
  }

  // Each expansion
  for (const [id, exp] of Object.entries(EXPANSIONS)) {
    try {
      const expCards = exp.cards();
      const expIssues = validateCards(expCards, `expansion:${id}`);
      allIssues.push(...expIssues);
      console.log(`  Expansion "${id}": ${expCards.length} cards, ${expIssues.length} issue(s)`);
    } catch (e) {
      console.error(`  ERROR loading expansion "${id}":`, e.message);
    }
  }

  // Print all issues grouped by level
  const errors   = allIssues.filter(i => i.level === 'ERROR');
  const warnings = allIssues.filter(i => i.level === 'WARNING');

  if (errors.length) {
    console.log(`\n  ❌ ERRORS (${errors.length}):`);
    for (const i of errors) console.log(`     ${i.msg}`);
  }
  if (warnings.length) {
    console.log(`\n  ⚠️  WARNINGS (${warnings.length}):`);
    for (const i of warnings) console.log(`     ${i.msg}`);
  }
  if (!allIssues.length) {
    console.log('  ✅ No issues found');
  }

  console.log('');
  return allIssues;
}

// ─── Debug HTTP endpoints ─────────────────────────────────────────────────────
function attachDebugRoutes(app, rooms) {
  // GET /debug — full server state snapshot
  app.get('/debug', (req, res) => {
    const snapshot = {
      ts: new Date().toISOString(),
      rooms: Object.fromEntries(
        Object.entries(rooms).map(([id, room]) => [id, {
          phase:         room.game.phase,
          playerCount:   Object.keys(room.game.players).length,
          deckCount:     room.game.deck.length,
          discardCount:  room.game.discard.length,
          currentPlayer: room.game.currentPlayer,
          pendingEffect: room.game.pendingEffect,
          neighWindow:   room.game.neighWindow,
          players: Object.fromEntries(
            Object.entries(room.game.players).map(([pid, p]) => [pid, {
              name:         p.name,
              connected:    p.connected,
              handCount:    p.hand.length,
              stableCount:  p.stable.length,
              stable:       p.stable.map(c => `${c.name}(${c.type})`),
              hand:         p.hand.map(c => `${c.name}(${c.type})`),
            }])
          ),
          log: room.game.log.slice(-10).map(l => l.msg),
        }])
      ),
      cardValidation: (() => {
        const issues = [];
        try { issues.push(...validateCards(createDeck(), 'base')); } catch {}
        for (const [id, exp] of Object.entries(EXPANSIONS)) {
          try { issues.push(...validateCards(exp.cards(), `expansion:${id}`)); } catch {}
        }
        return { errors: issues.filter(i=>i.level==='ERROR').map(i=>i.msg), warnings: issues.filter(i=>i.level==='WARNING').map(i=>i.msg) };
      })(),
    };
    res.json(snapshot);
  });

  // GET /debug/cards — full card list with types and effects
  app.get('/debug/cards', (req, res) => {
    const expansion = req.query.expansion;
    let cards;
    if (expansion) {
      cards = EXPANSIONS[expansion]?.cards() || [];
    } else {
      cards = createDeck();
    }
    res.json(cards.map(c => ({
      id: c.id, name: c.name, type: c.type, color: c.color,
      effect: c.effect, emoji: c.emoji, expansion: c.expansion || 'base',
      description: c.description,
    })));
  });

  // GET /debug/cards/types — summary grouped by type
  app.get('/debug/cards/types', (req, res) => {
    const all = [
      ...createDeck(),
      ...Object.keys(EXPANSIONS).flatMap(id => {
        try { return EXPANSIONS[id].cards(); } catch { return []; }
      }),
    ];
    const byType = {};
    for (const c of all) {
      byType[c.type] = byType[c.type] || [];
      byType[c.type].push({ name: c.name, effect: c.effect?.type || null, expansion: c.expansion || 'base' });
    }
    res.json(byType);
  });

  // GET /debug/room/:id — live state of one room
  app.get('/debug/room/:id', (req, res) => {
    const room = rooms[req.params.id.toUpperCase()];
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({
      phase:         room.game.phase,
      currentPlayer: room.game.currentPlayer,
      pendingEffect: room.game.pendingEffect,
      pendingCard:   room.game.pendingCard?.card?.name || null,
      neighWindow:   room.game.neighWindow,
      settings:      room.game.settings,
      deck:          room.game.deck.length,
      discard:       room.game.discard.length,
      log:           room.game.log.slice(-20).map(l => l.msg),
      players: Object.fromEntries(
        Object.entries(room.game.players).map(([pid, p]) => [pid, {
          name:      p.name,
          connected: p.connected,
          hand:      p.hand.map(c => ({ id:c.id, name:c.name, type:c.type, effect:c.effect?.type||null })),
          stable:    p.stable.map(c => ({ id:c.id, name:c.name, type:c.type, effect:c.effect?.type||null })),
        }])
      ),
    });
  });

  console.log('🔧 Debug routes active: GET /debug  /debug/cards  /debug/cards/types  /debug/room/:id');
}

// ─── WebSocket debug logger ───────────────────────────────────────────────────
function debugWsLog(direction, playerId, msg) {
  const ts  = new Date().toISOString().slice(11, 23);
  const pid = playerId ? playerId.slice(0, 8) : 'unknown';
  const body = typeof msg === 'object' ? JSON.stringify(msg) : msg;
  console.log(`  [WS ${direction}] ${ts} player=${pid} ${body.slice(0, 200)}`);
}

// ─── Client-side debug panel (injected as a script tag) ──────────────────────
// This is served as /debug-client.js and auto-injects a panel into the page
const CLIENT_DEBUG_SCRIPT = `
(function() {
  var DEBUG_ENABLED = localStorage.getItem('uu_debug') === '1' || new URLSearchParams(location.search).get('debug') === '1';
  if (!DEBUG_ENABLED) return;

  if (localStorage.getItem('uu_debug') !== '1') localStorage.setItem('uu_debug', '1');

  var log = [];
  var panel, logDiv;

  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'uu-debug-panel';
    panel.style.cssText = 'position:fixed;bottom:0;right:0;width:400px;max-height:320px;background:#0a0a1a;border:1px solid #3a1f6e;border-radius:8px 0 0 0;font:11px monospace;color:#ccc;z-index:9999;display:flex;flex-direction:column;overflow:hidden;';

    var header = document.createElement('div');
    header.style.cssText = 'padding:5px 10px;background:#1a0a3a;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;';
    header.innerHTML = '<span style="color:#b44fff;font-weight:bold">🔧 UU Debug</span><span style="display:flex;gap:6px"><a href="/debug" target="_blank" style="color:#4fb8ff;text-decoration:none">Server</a> <a href="/debug/cards" target="_blank" style="color:#4fffa0;text-decoration:none">Cards</a> <button onclick="document.getElementById(\\'uu-debug-panel\\').remove();localStorage.removeItem(\\'uu_debug\\')" style="background:none;border:none;color:#ff5555;cursor:pointer;font-size:11px">✕</button></span>';

    logDiv = document.createElement('div');
    logDiv.style.cssText = 'flex:1;overflow-y:auto;padding:5px 10px;';

    var footer = document.createElement('div');
    footer.style.cssText = 'padding:4px 10px;background:#0d0618;font-size:10px;color:#555;flex-shrink:0;';
    footer.textContent = '?debug=1 or localStorage.uu_debug=1 to toggle. Showing last 100 WS events.';

    panel.appendChild(header);
    panel.appendChild(logDiv);
    panel.appendChild(footer);
    document.body.appendChild(panel);
  }

  function addEntry(direction, data) {
    var ts = new Date().toISOString().slice(11,23);
    log.push({ ts, direction, data });
    if (log.length > 100) log.shift();
    if (!logDiv) return;
    var row = document.createElement('div');
    row.style.cssText = 'border-bottom:1px solid #1a1a2a;padding:2px 0;word-break:break-all;';
    var color = direction === 'IN' ? '#4fffa0' : '#4fb8ff';
    var str = typeof data === 'object' ? JSON.stringify(data) : String(data);
    row.innerHTML = '<span style="color:#555">' + ts + '</span> <span style="color:' + color + '">' + direction + '</span> ' + str.slice(0, 300);
    logDiv.appendChild(row);
    logDiv.scrollTop = logDiv.scrollHeight;
  }

  // Patch WebSocket
  var OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    var ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    var origSend = ws.send.bind(ws);
    ws.send = function(data) {
      try { addEntry('OUT', JSON.parse(data)); } catch { addEntry('OUT', data); }
      return origSend(data);
    };
    var origOnMessage = null;
    Object.defineProperty(ws, 'onmessage', {
      set: function(fn) {
        origOnMessage = fn;
        ws._onmessage_wrapped = function(e) {
          try { addEntry('IN', JSON.parse(e.data)); } catch { addEntry('IN', e.data); }
          return fn && fn(e);
        };
        ws.addEventListener('message', ws._onmessage_wrapped);
      },
      get: function() { return origOnMessage; }
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
  window.WebSocket.CONNECTING = OrigWS.CONNECTING;
  window.WebSocket.OPEN       = OrigWS.OPEN;
  window.WebSocket.CLOSING    = OrigWS.CLOSING;
  window.WebSocket.CLOSED     = OrigWS.CLOSED;

  // Patch console.error
  var origError = console.error.bind(console);
  console.error = function() {
    addEntry('ERR', Array.from(arguments).join(' '));
    origError.apply(console, arguments);
  };

  // Global error handler
  window.addEventListener('error', function(e) {
    addEntry('ERR', e.message + ' (' + e.filename + ':' + e.lineno + ')');
  });
  window.addEventListener('unhandledrejection', function(e) {
    addEntry('ERR', 'Unhandled promise rejection: ' + e.reason);
  });

  createPanel();
  addEntry('SYS', 'Debug mode active. Patches: WebSocket, console.error, window.error');
})();
`;

module.exports = { runStartupValidation, attachDebugRoutes, debugWsLog, CLIENT_DEBUG_SCRIPT };

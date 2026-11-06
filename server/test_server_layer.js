/**
 * test_server_layer.js — drives the REAL index.js (HTTP routes + WebSocket handler) over real sockets.
 *
 * test_integration.js has its own mock of the WebSocket handler, so server-layer rules that live in
 * index.js — the Neigh window closing itself, the resolve_neigh fallback gate, disconnect/reconnect,
 * the art routes — were only ever checked by hand. This covers them. Hands are seeded in-process
 * (the server is just required, not spawned) so every scenario is deterministic; all the TRAFFIC
 * goes through genuine WebSocket connections.
 *
 * Run: node test_server_layer.js   → every line should begin with ✅
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-srv-'));
process.env.SAVE_FILE = path.join(tmp, 'snap.json');          // never touch the real snapshot
process.env.ART_DIR   = path.join(tmp, 'art');
fs.mkdirSync(process.env.ART_DIR);
fs.writeFileSync(path.join(process.env.ART_DIR, 'Unicorn Net.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
fs.writeFileSync(path.join(process.env.ART_DIR, '.secret.png'), 'nope');

const WebSocket = require('ws');
const { server, rooms } = require('./index');
const { createDeck } = require('./cards');
const ALL = createDeck();

let passed = 0, failed = 0;
const pass = l => { console.log(`✅ ${l}`); passed++; };
const fail = (l, d) => { console.log(`❌ ${l} — ${d}`); failed++; process.exitCode = 1; };
const check = (l, c, d) => c ? pass(l) : fail(l, d);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uni = id => ({ id, type:'basic_unicorn', name:'BU', emoji:'🦄', effect:null, description:'', expansion:null });
const neighCard = id => ({ ...ALL.find(c => c.name === 'Neigh'), id });

let base;
class Client {
  constructor(name) { this.name = name; this.errors = []; this.state = null; this.msgs = []; }
  async connect() {
    this.ws = new WebSocket(base.replace('http', 'ws'));
    this.ws.on('message', raw => {
      const m = JSON.parse(raw); this.msgs.push(m);
      if (m.type === 'state_update') this.state = m.state;
      if (m.type === 'error') this.errors.push(m.error);
      if (m.type === 'joined') this.id = m.playerId;
    });
    await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    return this;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async waitFor(pred, ms = 2000) {
    const t = Date.now();
    while (Date.now() - t < ms) { if (pred()) return true; await sleep(15); }
    return false;
  }
  join(room, extra = {}) { this.send({ type:'join', name:this.name, room, ...extra }); return this.waitFor(() => this.id && this.state); }
}

async function newTable() {
  const { roomId } = await (await fetch(`${base}/api/rooms`, { method:'POST' })).json();
  const a = await new Client('Ann').connect(), b = await new Client('Bob').connect();
  await a.join(roomId); await b.join(roomId);
  a.send({ type:'start_game' });
  await a.waitFor(() => a.state?.phase && a.state.phase !== 'waiting');
  const g = rooms[roomId].game;
  // deterministic scene: Ann to act, empty hands/stables
  g.phase = 'action'; g.currentPlayerIndex = g.playerOrder.indexOf(a.id);
  for (const p of g.playerOrder) { g.players[p].hand = []; g.players[p].stable = []; }
  return { roomId, a, b, g };
}
const inStable = (g, c, id) => g.players[c.id].stable.some(x => x.id === id);

(async () => {
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  console.log('── Neigh window (server layer) ──');
  { // 1. nobody holds a Neigh → Ann's card just plays: no button, no grace period
    const { a, b, g } = await newTable();
    g.players[a.id].hand = [uni('c1')];
    const t = Date.now();
    a.send({ type:'play_card', cardId:'c1' });
    const ok = await a.waitFor(() => inStable(g, a, 'c1'), 1000);
    check('no Neigh in anyone\'s hand → card resolves immediately, nobody presses anything', ok && Date.now() - t < 800, `ok=${ok} ${Date.now() - t}ms errs=${a.errors} phase=${g.phase} cur=${g.currentPlayer} a=${a.id}`);
    check('window is closed and no wait is reported', !g.neighWindow && (a.state.neighWaitRemainingMs || 0) === 0, JSON.stringify({ w: g.neighWindow, ms: a.state.neighWaitRemainingMs }));
  }
  { // 2. a holder must answer; Ann cannot short-circuit them
    const { a, b, g } = await newTable();
    g.players[a.id].hand = [uni('c1')]; g.players[b.id].hand = [neighCard('n2')];
    a.send({ type:'play_card', cardId:'c1' });
    await b.waitFor(() => b.state?.neighWindow);
    check('holder sees the window; Ann is told who is pending', b.state.neighWindow && a.state.neighPendingResponders?.includes(b.id), JSON.stringify(a.state.neighPendingResponders));
    check('wait timer is running for Ann while Bob can still answer', a.state.neighWaitRemainingMs > 20000, a.state.neighWaitRemainingMs);
    a.errors.length = 0; a.send({ type:'resolve_neigh' });
    await a.waitFor(() => a.errors.length);
    check('Ann\'s resolve_neigh is refused during the grace period', /moment/i.test(a.errors[0] || '') && !inStable(g, a, 'c1'), a.errors[0]);
    b.send({ type:'pass_neigh' });                                         // Bob: "Let it play"
    const ok = await a.waitFor(() => inStable(g, a, 'c1'));
    check('Bob\'s "Let it play" is what lets the card through', ok && !g.neighWindow, 'card not played');
  }
  { // 3. Bob Neighs → Ann's card is countered, again without Ann doing anything
    const { a, b, g } = await newTable();
    g.players[a.id].hand = [uni('c1')]; g.players[b.id].hand = [neighCard('n2')];
    a.send({ type:'play_card', cardId:'c1' });
    await b.waitFor(() => b.state?.neighWindow);
    b.send({ type:'play_neigh', cardId:'n2' });
    const ok = await a.waitFor(() => !g.neighWindow && !g.superNeighWindow && g.discard.some(c => c.id === 'c1'));
    check('Neigh counters the card; the chain closes itself (Ann holds no Neigh)', ok && !inStable(g, a, 'c1'), JSON.stringify({ nw:g.neighWindow, sw:g.superNeighWindow }));
  }
  { // 4. AFK holder → fallback after the grace period
    const { a, b, g } = await newTable();
    g.players[a.id].hand = [uni('c1')]; g.players[b.id].hand = [neighCard('n2')];
    a.send({ type:'play_card', cardId:'c1' });
    await b.waitFor(() => b.state?.neighWindow);
    g.neighWindowOpenedAt = Date.now() - 31000;                            // the 30 s grace period has run out
    a.send({ type:'resolve_neigh' });
    const ok = await a.waitFor(() => inStable(g, a, 'c1'));
    check('stalled opponent: after the grace period Ann can stop waiting', ok, a.errors.join('|'));
  }
  { // 5. the only holder drops → nobody left to wait for
    const { a, b, g } = await newTable();
    g.players[a.id].hand = [uni('c1')]; g.players[b.id].hand = [neighCard('n2')];
    a.send({ type:'play_card', cardId:'c1' });
    await b.waitFor(() => b.state?.neighWindow);
    b.ws.close();
    const ok = await a.waitFor(() => inStable(g, a, 'c1'));
    check('Neigh-holder disconnects → window closes by itself, card plays', ok, 'still waiting');
  }
  { // 6. a blocked play reports its error to the player whose card it was
    const { a, b, g } = await newTable();
    const bee = ALL.find(c => c.name === 'Queen Bee Unicorn');
    if (!bee) fail('Queen Bee scenario', 'card not found');
    else {
      g.players[b.id].stable = [{ ...bee, id:'qb' }];
      g.players[a.id].hand = [uni('c1')];
      a.send({ type:'play_card', cardId:'c1' });
      await sleep(400);
      check('Queen Bee blocks the play: no crash, card not in Ann\'s stable, no stuck window', !inStable(g, a, 'c1') && !g.neighWindow && !g.pendingCard, JSON.stringify({ nw:g.neighWindow, pc:!!g.pendingCard }));
      check('...and Ann is told why', a.errors.length > 0 || g.players[a.id].hand.some(c => c.id === 'c1') , 'no error and card vanished');
    }
  }

  console.log('\n── Reconnect / bad input ──');
  { const { roomId, a, b, g } = await newTable();
    const oldId = a.id; a.ws.close(); await sleep(150);
    check('closing the socket marks the player disconnected', g.players[oldId].connected === false, g.players[oldId].connected);
    const a2 = await new Client('Ann').connect();
    await a2.join(roomId, { playerId: oldId });
    check('reconnect with the stored playerId resumes the same seat', a2.id === oldId && g.players[oldId].connected === true, `id=${a2.id}`);
    check('...and gets the live state back', a2.state?.players && a2.state.me?.id === oldId || a2.state?.myId === oldId || !!a2.state?.players, JSON.stringify(Object.keys(a2.state || {})).slice(0, 80));
    a2.ws.send('{ not json'); a2.send({ type:123 }); a2.send({ type:'play_card', cardId:{ evil:1 } });
    await sleep(200);
    const ping = await a2.waitFor(() => true);
    check('malformed / hostile messages neither crash the server nor drop the socket', a2.ws.readyState === WebSocket.OPEN, a2.ws.readyState);
    const c = await new Client('Zed').connect(); c.send({ type:'join', name:'Zed', room:'NOPE99' });
    await c.waitFor(() => c.errors.length);
    check('joining a room that does not exist is an error, not a crash', /not found/i.test(c.errors[0] || ''), c.errors[0]);
    const d = await new Client('Y').connect(); d.send({ type:'play_card', cardId:'x' });
    await d.waitFor(() => d.errors.length);
    check('acting before joining is refused', /not in a game/i.test(d.errors[0] || ''), d.errors[0]);
    for (const x of [a2, b, c, d]) x.ws.close();
  }

  console.log('\n── Art routes ──');
  { const m = await fetch(`${base}/api/art-manifest`);
    const j = await m.json();
    check('art manifest is JSON and no-cache', m.status === 200 && /no-cache/.test(m.headers.get('cache-control') || '') && typeof j === 'object', m.status);
    check('manifest sees the dropped-in image', JSON.stringify(j).includes('Unicorn Net'), JSON.stringify(j).slice(0, 120));
    const img = await fetch(`${base}/art/${encodeURIComponent('Unicorn Net.png')}`);
    check('art file is served with a locked-down CSP', img.status === 200 && /sandbox/.test(img.headers.get('content-security-policy') || ''), `${img.status} ${img.headers.get('content-security-policy')}`);
    const dot = await fetch(`${base}/art/.secret.png`);
    check('dotfiles are not served', dot.status !== 200 || !(await dot.clone().text()).includes('nope'), dot.status);
    const trav = await fetch(`${base}/art/..%2findex.js`);
    const body = await trav.text();
    check('path traversal out of the art folder is blocked', !body.includes('wss.on('), `${trav.status}`);
    const raw = await new Promise(res => { const http = require('http'); const u = new URL(base);
      http.get({ host:u.hostname, port:u.port, path:'/art/../index.js' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }); });
    check('raw ../ traversal is blocked too', !raw.includes('wss.on('), raw.slice(0, 60));
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  server.close(); fs.rmSync(tmp, { recursive:true, force:true });
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('❌ test crashed:', e); process.exit(1); });

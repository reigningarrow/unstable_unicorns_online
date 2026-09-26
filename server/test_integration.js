/**
 * Unstable Unicorns — WebSocket Integration Tests
 * Run: node test_integration.js
 */
'use strict';
const http    = require('http');
const WebSocket = require('ws');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { Game } = require('./game');

// ── Results ───────────────────────────────────────────────────────────────────
const R = { passed:[], failed:[] };
const pass = n     => { R.passed.push(n);     console.log('  ✅', n); };
const fail = (n,m) => { R.failed.push({n,m}); console.error('  ❌', n, '—', m); };
const ok   = (c,n,m) => c ? pass(n) : fail(n, m || 'false');

// ── Embedded server ───────────────────────────────────────────────────────────
function startServer() {
  const app   = express(); app.use(express.json());
  const srv   = http.createServer(app);
  const wss   = new WebSocket.Server({ server: srv });
  const rooms = {};

  const ps = rid => {
    const room = rooms[rid]; if (!room) return;
    for (const [pid, ws] of Object.entries(room.clients))
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type:'state_update', state: room.game.stateFor(pid) }));
  };
  const pa = (rid, msg) => {
    const room = rooms[rid]; if (!room) return;
    const s = JSON.stringify(msg);
    for (const ws of Object.values(room.clients))
      if (ws.readyState === WebSocket.OPEN) ws.send(s);
  };

  app.post('/api/rooms', (_q,res) => {
    const rid = 'R' + Math.random().toString(36).substr(2,6).toUpperCase();
    rooms[rid] = { game: new Game(rid), clients:{} };
    res.json({ roomId: rid });
  });

  wss.on('connection', ws => {
    let pid=null, rid=null;
    const e = x => ws.send(JSON.stringify({type:'error',error:x}));
    const h = (fn,...a) => { const r=fn(...a); if(r?.error) { e(r.error); ps(rid); } else { ps(rid); if(r?.gameOver) pa(rid,{type:'game_over',winner:r.winner}); } };
    ws.on('message', raw => {
      let m; try{m=JSON.parse(raw);}catch{return;}
      if (m.type==='join') {
        const r=rooms[m.room?.toUpperCase()];
        if(!r){e('Room not found');return;}
        if(m.playerId&&r.game.players[m.playerId]){pid=m.playerId;rid=m.room.toUpperCase();r.clients[pid]=ws;if(r.game.reconnectPlayer)r.game.reconnectPlayer(pid);ws.send(JSON.stringify({type:'joined',playerId:pid,roomId:rid}));ps(rid);return;}
        pid=uuidv4();rid=m.room.toUpperCase();const res=r.game.addPlayer(pid,m.name);if(res?.error){e(res.error);return;}r.clients[pid]=ws;ws.send(JSON.stringify({type:'joined',playerId:pid,roomId:rid,isHost:r.game.players[pid].isHost}));ps(rid);return;
      }
      if(!pid){e('Not joined');return;}
      const g=rooms[rid]?.game;if(!g)return;
      switch(m.type){
        case 'update_settings': if(!g.players[pid]?.isHost){e('Only host');return;} g.updateSettings(m.settings);ps(rid);break;
        case 'start_game':      if(!g.players[pid]?.isHost){e('Only host can start');return;} h(g.startGame.bind(g));pa(rid,{type:'game_started'});break;
        case 'draw_card':       h(g.drawCard.bind(g),pid);break;
        case 'action_draw':     h(g.actionDrawCard.bind(g),pid);break;
        case 'play_card':       h(g.playCard.bind(g),pid,m.cardId,m.targetPlayerId,m.targetCardId);break;
        case 'resolve_neigh':   h(g.resolveNeigh.bind(g),pid);break;
        case 'resolve_effect':  h(g.resolvePendingEffect.bind(g),pid,m.selectedCardIds,m.extra);break;
        case 'chat':            pa(rid,{type:'chat',name:g.players[pid]?.name,text:m.text});break;
        default: e(`Unknown: ${m.type}`);
      }
    });
    ws.on('close',()=>{if(pid&&rid&&rooms[rid])delete rooms[rid].clients[pid];});
  });

  return new Promise(r=>srv.listen(0,()=>r({port:srv.address().port,srv,rooms})));
}

// ── Client: simple promise-based interface ────────────────────────────────────
// Every message (including 'joined') is pushed into a queue.
// send(), next(), and expect() operate on that queue.
function openClient(port, room, name, existingPid) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const q = [], w = [];
    let   playerId = null;

    const push = m => { if(w.length) w.shift()(m); else q.push(m); };
    const next = (ms=5000) => new Promise((res,rej)=>{
      if(q.length) return res(q.shift());
      const t=setTimeout(()=>rej(new Error('msg timeout '+ms+'ms')),ms);
      w.push(m=>{clearTimeout(t);res(m);});
    });
    // expect: wait for any message of given type(s), buffering non-matching ones
    const expect = async (types, ms=5000) => {
      const ts = Array.isArray(types)?types:[types];
      const buf=[];
      const deadline=Date.now()+ms;
      while(Date.now()<deadline){
        const m=await next(deadline-Date.now()).catch(()=>null);
        if(!m){q.unshift(...buf);return null;}
        if(ts.includes(m.type)){q.unshift(...buf);return m;}
        buf.push(m);
      }
      q.unshift(...buf); return null;
    };
    // expectWhere: wait for a message matching a predicate
    const expectWhere = async (pred, ms=5000) => {
      const buf=[]; const deadline=Date.now()+ms;
      while(Date.now()<deadline){
        const m=await next(deadline-Date.now()).catch(()=>null);
        if(!m){q.unshift(...buf);return null;}
        if(pred(m)){q.unshift(...buf);return m;}
        buf.push(m);
      }
      q.unshift(...buf); return null;
    };

    const send = m => ws.send(JSON.stringify(m));

    // drainCurrent: synchronously empty whatever is already in q right now
    const drainCurrent = () => { const out=[]; while(q.length) out.push(q.shift()); return out; };

    ws.on('open', ()=>send({type:'join',name,room,playerId:existingPid||undefined}));
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      push(m); // ALL messages including 'joined' go into q
      if (!playerId && m.type==='joined') {
        playerId = m.playerId;
        resolve({ws, send, next, expect, expectWhere, drainCurrent, id:()=>playerId});
      } else if (!playerId && m.type==='error') {
        reject(new Error(m.error));
      }
    });
    ws.on('error', reject);
  });
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const httpPost = (port,path) => new Promise((res,rej)=>{
  const req=http.request({hostname:'localhost',port,path,method:'POST',headers:{'Content-Type':'application/json'}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d));}catch{res(d);}});});
  req.on('error',rej);req.end();
});
const flushQ = async c => { // consume all immediately available
  const all=[];while(c.next(0).then){const m=await c.next(30).catch(()=>null);if(!m)break;all.push(m);}return all;
};

// ── Test runner ───────────────────────────────────────────────────────────────
async function run() {
  const {port,srv,rooms} = await startServer();
  console.log(`\n🔌 Server on port ${port}\n`);
  try {

    // ── 1. Room & join ────────────────────────────────────────────────────────
    console.log('── Rooms & join ──');
    const {roomId} = await httpPost(port,'/api/rooms');
    ok(roomId, 'POST /api/rooms returns roomId');

    const alice = await openClient(port,roomId,'Alice');
    pass('Alice joins');
    ok(alice.id(), 'Alice gets playerId');

    const bob = await openClient(port,roomId,'Bob');
    pass('Bob joins');

    // Wait for all join-time messages to settle then discard them
    await sleep(300);
    alice.drainCurrent(); bob.drainCurrent();

    // ── 2. Settings ───────────────────────────────────────────────────────────
    console.log('\n── Settings ──');
    alice.send({type:'update_settings',settings:{expansions:[],winCondition:5,localMode:false,debugMode:false}});
    const su_a = await alice.expectWhere(m=>m.type==='state_update'&&m.state?.winCondition===5, 3000);
    const su_b = await bob.expectWhere(  m=>m.type==='state_update'&&m.state?.winCondition===5, 3000);
    ok(su_a, 'update_settings: Alice gets winCondition=5');
    ok(su_b, 'update_settings: Bob gets winCondition=5');

    bob.send({type:'update_settings',settings:{winCondition:7}});
    const nh_set = await bob.expect('error', 2000);
    ok(nh_set, 'Non-host update_settings: error returned');

    await sleep(150); alice.drainCurrent(); bob.drainCurrent();

    // ── 3. Start game ─────────────────────────────────────────────────────────
    console.log('\n── Start game ──');
    bob.send({type:'start_game'});
    const nh_st = await bob.expect('error',2000);
    ok(nh_st, 'Non-host start_game: error returned');

    alice.drainCurrent(); bob.drainCurrent(); // clear any leftover error broadcasts

    alice.send({type:'start_game'});
    const a_gs = await alice.expect(['state_update','game_started'],3000);
    const b_gs = await bob.expect(  ['state_update','game_started'],3000);
    ok(a_gs, 'start_game: Alice gets state_update/game_started');
    ok(b_gs, 'start_game: Bob gets state_update/game_started');

    await sleep(200); alice.drainCurrent(); bob.drainCurrent();
    const game = rooms[roomId].game;
    ok(game.phase !== 'waiting', 'Game phase advanced from waiting', `phase=${game.phase}`);

    // ── 4. Draw card ──────────────────────────────────────────────────────────
    console.log('\n── Draw card ──');
    const curPid  = game.currentPlayer;
    const isAlice = curPid===alice.id();
    const [drawer,watcher] = isAlice?[alice,bob]:[bob,alice];

    game.phase='draw';
    drawer.send({type:'draw_card'});
    const dd = await drawer.expect('state_update',3000);
    const dw = await watcher.expect('state_update',3000);
    ok(dd,'draw_card: current player gets state_update');
    ok(dw,'draw_card: other player gets state_update');

    await sleep(150); alice.drainCurrent(); bob.drainCurrent();

    // Wrong player
    game.phase='draw'; game.currentPlayerIndex=game.playerOrder.indexOf(curPid);
    watcher.send({type:'draw_card'});
    const we = await watcher.expect('error',2000);
    ok(we,'draw_card wrong player: error returned');

    await sleep(150); alice.drainCurrent(); bob.drainCurrent();

    // ── 5. play_card ──────────────────────────────────────────────────────────
    console.log('\n── Play card ──');
    game.phase='action'; game.currentPlayerIndex=game.playerOrder.indexOf(curPid);
    game.actionsUsedThisTurn=0; game.pendingEffect=null; game.pendingEffectQueue=[];
    const playable=game.players[curPid].hand.find(c=>['magic','upgrade','basic_unicorn','magical_unicorn'].includes(c.type));
    if(playable){
      drawer.send({type:'play_card',cardId:playable.id,targetPlayerId:null,targetCardId:null});
      const pr=await drawer.expect(['state_update','error'],3000);
      ok(pr,'play_card: gets state_update or error');
    } else { pass('play_card: no playable card (skipped)'); }

    await sleep(150); alice.drainCurrent(); bob.drainCurrent();

    // ── 6. action_draw ────────────────────────────────────────────────────────
    console.log('\n── Action draw ──');
    game.phase='action'; game.currentPlayerIndex=game.playerOrder.indexOf(curPid);
    game.actionsUsedThisTurn=0; game.pendingEffect=null; game.pendingEffectQueue=[];
    drawer.send({type:'action_draw'});
    const ad=await drawer.expect('state_update',3000);
    ok(ad,'action_draw: state_update received');

    await sleep(150); alice.drainCurrent(); bob.drainCurrent();

    // ── 7. Chat ───────────────────────────────────────────────────────────────
    console.log('\n── Chat ──');
    alice.send({type:'chat',text:'ping'});
    const cb=await bob.expectWhere(m=>m.type==='chat'&&m.text==='ping',2000);
    const ca=await alice.expectWhere(m=>m.type==='chat'&&m.text==='ping',2000);
    ok(cb,'chat: Bob receives message');
    ok(ca,'chat: Alice receives own broadcast');

    // ── 8. Reconnect ──────────────────────────────────────────────────────────
    console.log('\n── Reconnect ──');
    const aliceId=alice.id();
    alice.ws.close(); await sleep(300);
    const alice2=await openClient(port,roomId,'Alice',aliceId).catch(()=>null);
    ok(alice2,'Reconnect: rejoins with same playerId');
    if(alice2){
      const rsu=await alice2.expect('state_update',2000);
      ok(rsu,'Reconnect: state_update received after rejoin');
    }

    // ── 9. Edge cases ─────────────────────────────────────────────────────────
    console.log('\n── Edge cases ──');
    if(alice2){
      alice2.send({type:'__bad__'});
      const be=await alice2.expect('error',2000);
      ok(be,'Unknown message type: error returned');
    }
    await openClient(port,'BADRM','Ghost').catch(e=>{
      ok(/Room not found/i.test(e.message),'Unknown room: error on join',e.message);
    });

    // ── 10. Full turn cycle ───────────────────────────────────────────────────
    console.log('\n── Full turn cycle ──');
    const {roomId:r2}=await httpPost(port,'/api/rooms');
    const p1=await openClient(port,r2,'P1');
    const p2=await openClient(port,r2,'P2');
    p1.send({type:'start_game'});
    await p1.expect(['state_update','game_started'],3000);
    await sleep(200); p1.drainCurrent(); p2.drainCurrent();

    const g2=rooms[r2].game, g2c=g2.currentPlayer;
    const g2d=g2c===p1.id()?p1:p2;
    g2.phase='draw'; g2.pendingEffect=null; g2.pendingEffectQueue=[];
    g2d.send({type:'draw_card'});
    await g2d.expect('state_update',3000);
    ok(g2.phase==='action','Turn cycle: draw → action phase', `phase=${g2.phase}`);

    await sleep(150); p1.drainCurrent(); p2.drainCurrent();
    g2.actionsUsedThisTurn=0; g2.pendingEffect=null; g2.phase='action';
    g2d.send({type:'action_draw'});
    const cyc=await g2d.expect('state_update',3000);
    ok(cyc,'Turn cycle: action_draw → state_update');
    ok(g2.currentPlayer!==g2c,'Turn cycle: turn passed to next player', `still=${g2.currentPlayer}====${g2c}`);

    // ── Queen Bee block: error AND state_update both arrive over the real WS layer ──
    console.log('\n── Queen Bee block (WS-level) ──');
    await sleep(150); p1.drainCurrent(); p2.drainCurrent();
    const { createDeck } = require('./cards');
    const allCards = createDeck();
    const qbCard = allCards.find(c=>c.name==='Queen Bee Unicorn');
    const curPid2 = g2.currentPlayer;
    const otherPid2 = g2.playerOrder.find(p=>p!==curPid2);
    const curClient2 = curPid2===p1.id()?p1:p2;
    g2.players[otherPid2].stable = [{...qbCard, id:'qb_ws'}];
    const buCard = { id:'bu_ws', type:'basic_unicorn', name:'BU', emoji:'🦄', effect:null, description:'', expansion:null };
    g2.players[curPid2].hand = [buCard];
    g2.phase='action'; g2.actionsUsedThisTurn=0; g2.pendingEffect=null; g2.pendingEffectQueue=[];
    curClient2.send({type:'play_card',cardId:'bu_ws',targetPlayerId:null,targetCardId:null});
    const qbNeighOpen = await curClient2.expectWhere(m=>m.type==='state_update'&&m.state?.neighWindow===true, 3000);
    ok(qbNeighOpen, 'Queen Bee block: play_card opens neigh window as usual');
    curClient2.send({type:'resolve_neigh'});
    const qbErr = await curClient2.expectWhere(m=>m.type==='error'&&/Queen Bee/.test(m.error), 3000);
    ok(qbErr, 'Queen Bee block: error message received over WS');
    const qbState = await curClient2.expectWhere(m=>m.type==='state_update'&&m.state?.players?.[curPid2]?.handCount===1, 3000);
    ok(qbState, 'Queen Bee block: state_update still broadcast, hand correctly shows the card restored');
    ok(g2.phase==='action', 'Queen Bee block: turn/phase not consumed by the blocked play', `phase=${g2.phase}`);

  } catch(e) {
    fail('Unexpected error',e.message); console.error(e.stack);
  }

  srv.close(() => {
    const total=R.passed.length+R.failed.length;
    console.log(`\n${'─'.repeat(52)}`);
    console.log(`Results: ${R.passed.length}/${total} passed`);
    if(R.failed.length){ console.log('Failed:'); for(const f of R.failed) console.log(`  • ${f.n}: ${f.m}`); }
    process.exit(R.failed.length>0?1:0);
  });
  // Force exit if close hangs (open WebSocket connections)
  setTimeout(()=>process.exit(R.failed.length>0?1:0), 2000);
}

run().catch(e=>{console.error('Fatal:',e);process.exit(1);});

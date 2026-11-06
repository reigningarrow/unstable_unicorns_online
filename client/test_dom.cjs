/**
 * test_dom.cjs — renders the REAL React components in jsdom and checks what ends up in the DOM.
 *   • Card Art Manager: cards with art AND without, the expected file name, near-miss hints, filters
 *   • Hand panel: shrink / normal / expand
 * No browser needed. Run: npm run test:dom   (from client/)
 */
'use strict';
const fs = require('fs'), path = require('path');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const { Game } = require('../server/game');

let fails = 0, passes = 0;
const ok = (c, l, d = '') => { console.log((c ? '✅ ' : '❌ ') + l + (c ? '' : ' — ' + d)); c ? passes++ : fails++; };

(async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  global.window = window; global.document = window.document; global.localStorage = window.localStorage;
  Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));

  const manifest = { folderFound: true, matched: 2, totalCards: 4, unmatched: ['Rainbow Aura Upgrade.png'], duplicates: [],
    art: { 'Alluring Narwhal': '/art/a.png', 'Neigh': '/art/n.png' },
    missing: [{ name: 'Rainbow Aura', expansion: 'base', expected: 'Rainbow Aura.png', nearMiss: ['Rainbow Aura Upgrade.png'] },
              { name: "Neigh, M'Lord", expansion: null, expected: "Neigh, M'Lord.png", nearMiss: [] }] };
  global.fetch = window.fetch = async () => ({ ok: true, json: async () => manifest });

  // Bundle the real App.jsx, plus the three things this test needs exported.
  const srcDir = path.join(__dirname, 'src');
  const src = fs.readFileSync(path.join(srcDir, 'App.jsx'), 'utf8') + '\nexport { ArtManager, ArtStore, GameBoard };\n';
  const out = await esbuild.build({ stdin: { contents: src, resolveDir: srcDir, sourcefile: 'App.jsx', loader: 'jsx' },
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react-dom', 'react-dom/client'], logLevel: 'error' });
  const m = { exports: {} }; new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
  const { ArtManager, ArtStore, GameBoard } = m.exports;
  const React = require('react'); const { createRoot } = require('react-dom/client'); const { act } = React;
  const text = () => document.body.textContent;
  const btn = label => [...document.querySelectorAll('button')].find(b => b.textContent.includes(label));

  console.log('── Card Art Manager ──');
  let root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(ArtManager, { onClose() {} })); });
  await act(async () => { await ArtStore.loadFolder(); });
  ok(text().includes('Has art (2)') && text().includes('Missing art (2)'), 'filter chips show the counts');
  ok(!!document.querySelector('img[alt="Alluring Narwhal"]') && text().includes('Rainbow Aura') && text().includes("Neigh, M'Lord"), 'cards with art AND cards without are listed');
  ok(text().includes('Rainbow Aura.png') && text().includes("Neigh, M'Lord.png"), 'each missing card shows the expected file name');
  ok(text().includes('Close match in the folder') && text().includes('Rainbow Aura Upgrade.png'), 'a near-miss file in the folder is called out');
  ok(text().includes('2 missing'), 'footer reports the missing count');
  await act(async () => { btn('Missing art (2)').click(); });
  ok(!document.querySelector('img[alt="Alluring Narwhal"]') && text().includes('Rainbow Aura.png'), '"Missing" view hides cards that have art');
  await act(async () => { btn('Has art (2)').click(); });
  ok(!!document.querySelector('img[alt="Alluring Narwhal"]') && !text().includes('Rainbow Aura.png'), '"Has art" view hides missing cards');
  await act(async () => { btn('All').click(); });
  const input = document.querySelector('input.input[placeholder^="Search"]');
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, "m'lord"); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
  ok(text().includes("Neigh, M'Lord.png") && !text().includes('Rainbow Aura.png'), 'search filters the missing cards too');
  await act(async () => { ArtStore.set("Neigh, M'Lord", 'data:image/png;base64,AAAA'); });
  ok(!text().includes("Neigh, M'Lord.png") && text().includes('Missing art (1)'), 'uploading art moves a card out of the missing list');
  await act(async () => { root.unmount(); });

  console.log('\n── Hand panel size ──');
  const g = new Game('T'); g.addPlayer('p1', 'Ann'); g.addPlayer('p2', 'Bob'); g.updateSettings({ expansions: [], winCondition: 7 }); g.startGame();
  const state = JSON.parse(JSON.stringify(g.stateFor('p1')));
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(GameBoard, { state, playerId: 'p1', send() {}, onLeave() {}, cardScale: 1.3, setCardScale() {} })); });
  const side = () => document.querySelector('.game-board-sidebar');
  const group = () => document.querySelector('[aria-label="Hand panel size"]');
  const press = async label => { await act(async () => { group().querySelector(`button[aria-label="${label}"]`).click(); }); };
  const cards = () => [...side().querySelectorAll('.game-card')];
  const n = state.players.p1.hand.length;
  ok(!!side() && !!group(), 'sidebar and the three size buttons render');
  ok(side().style.width === '268px' && side().className.includes('hand-view-normal'), 'starts at normal width');
  ok(cards().filter(c => c.className.includes('game-card-lg')).length >= n, `all ${n} hand cards are full-size at normal`);
  await press('Expand the hand panel');
  ok(side().style.width === '480px' && side().className.includes('hand-view-max'), 'Expand → wide');
  ok(localStorage.getItem('uu_hand_view') === 'max', 'the choice is remembered');
  await press('Shrink the hand panel');
  ok(side().style.width === '208px' && side().className.includes('hand-view-min'), 'Shrink → slim');
  ok(cards().filter(c => c.className.includes('game-card-sm')).length >= n, 'hand cards switch to the small size when shrunk');
  ok(group().querySelector('[aria-pressed="true"]').getAttribute('aria-label') === 'Shrink the hand panel', 'the active size button is marked pressed');
  await press('Normal size');
  ok(side().style.width === '268px', 'back to normal');

  console.log('\n── Opponent stables fill the row ──');
  const grid = document.querySelector('.game-board-opponents');
  ok(!!grid && grid.style.gridTemplateColumns.includes('auto-fit'), 'opponents grid uses auto-fit so a lone opponent spans the full width', grid && grid.style.gridTemplateColumns);
  ok(grid.children.length === 1, 'one opponent → one stable panel');

  console.log(`\n── Results: ${passes} passed, ${fails} failed ──`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

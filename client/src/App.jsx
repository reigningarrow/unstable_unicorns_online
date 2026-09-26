import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─── Card art store (localStorage, persists across sessions) ─────────────────
const ArtStore = {
  KEY: 'uu_card_art',
  load() { try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch { return {}; } },
  save(d) { try { localStorage.setItem(this.KEY, JSON.stringify(d)); } catch {} },
  set(name, url) { const d = this.load(); d[name] = url; this.save(d); },
  get(name) { return this.load()[name] || null; },
  remove(name) { const d = this.load(); delete d[name]; this.save(d); },
  all() { return this.load(); },
};

// ─── WebSocket hook ───────────────────────────────────────────────────────────
// Key fix: handlers are stored in a ref so they always see current closure state.
// The `on` function itself is stable (never changes), so useEffect([on]) only
// fires once — but the handler fn it stores is always the latest version.
function useGameSocket(serverUrl) {
  const wsRef    = useRef(null);
  const handlers = useRef({});
  const [connected, setConnected] = useState(false);

  // Stable: registers a handler by type (overwrites previous)
  const on = useCallback((type, fn) => { handlers.current[type] = fn; }, []);

  // Stable: sends a message if socket is open
  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    let retryTimer = null;

    function connect() {
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;
      ws.onopen  = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        retryTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          // Always call the CURRENT handler (not a stale captured one)
          handlers.current[msg.type]?.(msg);
        } catch {}
      };
    }

    connect();
    return () => {
      clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, [serverUrl]); // only reconnect if URL changes

  return { connected, send, on };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const EXP_META = {
  dragons:            { name:'🐲 Dragons',            color:'#ff5533', ageRating:'14+', cardCount:29, desc:'Dragoncorns, Dragon\'s Curse, Dragon Protection, Dragon\'s Fortune, and more.' },
  unicorns_of_legend: { name:'⭐ Unicorns of Legend', color:'#4fb8ff', ageRating:'14+', cardCount:35, desc:'RPG hero unicorns — Paladins, Warlocks, Rogues. Chain Lightning, Fireball, Necromancy.' },
  rainbow_apocalypse: { name:'🌈 Rainbow Apocalypse', color:'#9b59b6', ageRating:'14+', cardCount:36, desc:'Four Unicorns of the Apocalypse (Pestilence, War, Famine, Death) vs Rainbow Sprinkles.' },
  adventures:         { name:'⚔️ Adventures',         color:'#f39c12', ageRating:'14+', cardCount:38, desc:'Pirates, fishermen, bungee jumping unicorns. Choice cards, instants that intercept steals.' },
  nsfw:               { name:'🔞 NSFW',               color:'#ff4fa3', ageRating:'18+', cardCount:32, desc:'Adults-only expansion. Raunchy unicorns with mature mechanics.', adult:true },
  christmas:          { name:'🎄 Christmas',          color:'#c0392b', ageRating:'14+', cardCount:24, desc:'Holiday unicorns — Krampuscorn, Carolers, Gingerbread Stable, and Uneaten Fruitcake.' },
  nightmares:         { name:'👻 Nightmares',         color:'#6c3483', ageRating:'14+', cardCount:35, desc:'Horror unicorns, Phantom that can\'t be destroyed, Nightmare Downgrades, Hex Neigh removes from game.' },
};

const TYPE_LABEL = { baby_unicorn:'Baby', basic_unicorn:'Basic', magical_unicorn:'Magical', magic:'Magic', instant:'Instant', upgrade:'Upgrade', downgrade:'Downgrade' };
const TYPE_BG    = { baby_unicorn:'#1e1a30', basic_unicorn:'#121e30', magical_unicorn:'#1a1030', magic:'#201e08', instant:'#201208', upgrade:'#081a10', downgrade:'#1a0808' };
const TYPE_CLR   = { baby_unicorn:'#b0d4ff', basic_unicorn:'#90bfff', magical_unicorn:'#d4b0ff', magic:'#ffe066', instant:'#ff9a3c', upgrade:'#4fffa0', downgrade:'#ff5555' };

// ─── GameCard component (no art controls - art is main-menu only) ─────────────
// ─── Zoom button — used on every card (hand, stable, Nanny Cam) to open the detail modal.
// Sized as a real touch target (not the old ~10x10px hitbox) since this was reported as
// very hard to tap, especially on mobile.
function ZoomButton({ card, onZoom, small }) {
  const size = small ? 22 : 26;
  return (
    <div
      className="zoom-btn"
      onClick={e => { e.stopPropagation(); onZoom && onZoom(card); }}
      title="View card detail"
      style={{
        position: 'absolute', bottom: 1, right: 1, zIndex: 10,
        width: size, height: size,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.25)',
        borderRadius: '50%', color: '#fff', fontSize: small ? 10 : 12,
        cursor: 'pointer', userSelect: 'none', lineHeight: 1,
        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
      }}
    >🔍</div>
  );
}

function GameCard({ card, selected, selectable, onClick, small, artMap }) {
  if (!card) return null;

  const art = artMap?.[card.name] || null;
  const bg  = TYPE_BG[card.type]  || '#1e1035';
  const clr = TYPE_CLR[card.type] || '#fff';

  return (
    <div
      className={`game-card ${small ? 'game-card-sm' : 'game-card-lg'}`}
      onClick={selectable ? onClick : undefined}
      style={{
        width: small ? 58 : 88, height: small ? 82 : 124,
        borderRadius: 10,
        background: bg,
        border: `2px solid ${selected ? '#ff4fa3' : selectable ? 'rgba(180,79,255,0.7)' : 'rgba(255,255,255,0.08)'}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
        padding: small ? '3px' : '5px 4px',
        cursor: selectable ? 'pointer' : 'default',
        touchAction: 'manipulation',
        transition: 'all 0.15s', flexShrink: 0, position: 'relative', overflow: 'hidden', userSelect: 'none',
        transform: selected ? 'translateY(-10px) scale(1.06)' : 'none',
        boxShadow: selected ? '0 8px 24px rgba(255,79,163,0.5)' : selectable ? '0 0 10px rgba(180,79,255,0.25)' : 'none',
      }}
    >
      {/* Custom artwork */}
      {art && <img src={art} alt={card.name} style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', borderRadius:8 }} />}

      {/* Card content overlay */}
      <div style={{ position:'relative', zIndex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'space-between', width:'100%', height:'100%', padding: small ? '2px' : '4px 3px' }}>
        <div style={{ fontSize: small?5.5:8, color: art?'#fff':clr, fontWeight:800, textAlign:'center', lineHeight:1.1, textShadow: art?'0 1px 4px rgba(0,0,0,1)':'none', background: art?'rgba(0,0,0,0.55)':'transparent', borderRadius:3, padding:'0 3px' }}>
          {TYPE_LABEL[card.type]}
        </div>
        {!art && <div style={{ fontSize: small?16:24 }}>{card.emoji}</div>}
        <div style={{ fontSize: small?5:7, color: art?'#fff':clr, fontWeight:700, textAlign:'center', lineHeight:1.2, textShadow: art?'0 1px 4px rgba(0,0,0,1)':'none', background: art?'rgba(0,0,0,0.6)':'transparent', borderRadius:3, padding:'0 3px', width:'100%' }}>
          {card.name}
        </div>
        {!small && !art && (
          <div style={{ fontSize:5.5, color:'rgba(255,255,255,0.5)', textAlign:'center', lineHeight:1.3 }}>
            {card.description?.slice(0,60)}{card.description?.length > 60 ? '…' : ''}
          </div>
        )}
      </div>

      {/* Expansion dot */}
      {card.expansion && (
        <div style={{ position:'absolute', top:3, right:3, zIndex:2, width:5, height:5, borderRadius:'50%', background: EXP_META[card.expansion]?.color || '#888' }} />
      )}
    </div>
  );
}

// ─── Card Detail (hover panel) — read-only in-game ───────────────────────────
function CardDetail({ card, artMap }) {
  if (!card) return null;
  const art = artMap?.[card.name] || null;
  return (
    <div className="panel animate-slide-in" style={{ padding:14, fontSize:12 }}>
      {art
        ? <img src={art} alt={card.name} style={{ width:'100%', borderRadius:8, marginBottom:8, maxHeight:120, objectFit:'cover' }} />
        : <div style={{ fontSize:28, textAlign:'center', marginBottom:6 }}>{card.emoji}</div>
      }
      <div style={{ fontWeight:800, fontSize:13, textAlign:'center', marginBottom:3 }}>{card.name}</div>
      <div style={{ fontSize:10, textAlign:'center', opacity:0.55, textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>
        {TYPE_LABEL[card.type]}{card.expansion ? ` · ${EXP_META[card.expansion]?.name}` : ''}
      </div>
      <div style={{ color:'var(--c-muted)', lineHeight:1.6 }}>{card.description}</div>
    </div>
  );
}

// ─── Art Manager (main menu only) ────────────────────────────────────────────
function ArtManager({ onClose }) {
  const [arts, setArts]     = useState(() => ArtStore.all());
  const [filter, setFilter] = useState('');
  const [uploadFor, setUploadFor] = useState(null);  // card name to upload for
  const [customName, setCustomName] = useState('');  // manual card name entry
  const fileRef = useRef(null);

  const refresh = () => setArts(ArtStore.all());
  const artNames = Object.keys(arts).filter(n => n.toLowerCase().includes(filter.toLowerCase()));

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const targetName = uploadFor || customName.trim();
    if (!targetName) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      ArtStore.set(targetName, ev.target.result);
      refresh();
      setUploadFor(null);
      setCustomName('');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const triggerUpload = (name) => {
    setUploadFor(name);
    fileRef.current?.click();
  };

  const triggerNew = () => {
    if (!customName.trim()) return;
    setUploadFor(customName.trim());
    fileRef.current?.click();
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div className="panel" style={{ width:'100%', maxWidth:640, maxHeight:'88vh', display:'flex', flexDirection:'column', overflow:'hidden' }} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--c-border)', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ fontWeight:800, fontSize:17 }}>🖼 Card Art Manager</div>
            <div style={{ fontSize:11, color:'var(--c-muted)', marginTop:3, lineHeight:1.5 }}>
              Upload custom artwork for any card. Art is saved in your browser and persists between sessions.<br/>
              Type the exact card name (e.g. <em>Narwhal Unicorn</em>, <em>Neigh!</em>, <em>Rainbow Mane</em>) then upload an image.
            </div>
          </div>
          <button className="btn btn-secondary" style={{ fontSize:12, flexShrink:0, marginLeft:12 }} onClick={onClose}>✕ Close</button>
        </div>

        {/* Add new art */}
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--c-border)', background:'rgba(180,79,255,0.05)' }}>
          <div style={{ fontSize:11, color:'var(--c-muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>Add Art for a Card</div>
          <div style={{ display:'flex', gap:8 }}>
            <input
              className="input"
              placeholder="Exact card name (e.g. Dragon Unicorn)…"
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && triggerNew()}
              style={{ flex:1 }}
            />
            <button className="btn btn-primary" style={{ fontSize:12, padding:'8px 14px' }} onClick={triggerNew} disabled={!customName.trim()}>
              📁 Upload Image
            </button>
          </div>
        </div>

        {/* Search existing */}
        <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--c-border)' }}>
          <input className="input" placeholder="Search saved art…" value={filter} onChange={e=>setFilter(e.target.value)} />
        </div>

        {/* Art grid */}
        <div style={{ flex:1, overflowY:'auto', padding:20 }}>
          {artNames.length === 0 ? (
            <div style={{ textAlign:'center', color:'var(--c-muted)', padding:'40px 20px', lineHeight:2 }}>
              {Object.keys(arts).length === 0
                ? <>No custom art yet.<br/>Enter a card name above and upload an image to get started.</>
                : 'No matches for that search.'}
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(130px, 1fr))', gap:12 }}>
              {artNames.map(name => (
                <div key={name} style={{ background:'rgba(255,255,255,0.04)', borderRadius:10, padding:10, border:'1px solid rgba(255,255,255,0.08)' }}>
                  <img src={arts[name]} alt={name} style={{ width:'100%', height:80, objectFit:'cover', borderRadius:6, marginBottom:7, display:'block' }} />
                  <div style={{ fontSize:11, fontWeight:700, marginBottom:6, lineHeight:1.3, wordBreak:'break-word' }}>{name}</div>
                  <div style={{ display:'flex', gap:5 }}>
                    <button className="btn btn-secondary" style={{ fontSize:10, padding:'4px 6px', flex:1 }} onClick={()=>triggerUpload(name)}>Replace</button>
                    <button className="btn btn-danger"    style={{ fontSize:10, padding:'4px 6px' }} onClick={()=>{ ArtStore.remove(name); refresh(); }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding:'10px 20px', borderTop:'1px solid var(--c-border)', fontSize:11, color:'var(--c-muted)', display:'flex', justifyContent:'space-between' }}>
          <span>{Object.keys(arts).length} card(s) with custom art</span>
          <span>Art is stored in your browser's localStorage</span>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleFile} />
    </div>
  );
}

// ─── Stable component ─────────────────────────────────────────────────────────
function Stable({ player, isMe, onCardSelect, selectedCardId, highlight, winCondition, artMap, onHover, onZoom, allowOwnClick }) {
  const count = player.unicornCount || 0;
  const close = count >= (winCondition || 7) - 1;

  const unicorns   = player.stable.filter(c => ['baby_unicorn','basic_unicorn','magical_unicorn'].includes(c.type));
  const modifiers  = player.stable.filter(c => c.type === 'upgrade' || c.type === 'downgrade');

  const renderCard = (card) => (
    <div key={card.id} style={{ position:'relative', display:'inline-block' }}
      onMouseEnter={()=>onHover&&onHover(card)}
      onMouseLeave={()=>onHover&&onHover(null)}
      onContextMenu={e=>{ e.preventDefault(); onZoom&&onZoom(card); }}>
      <GameCard card={card} small artMap={artMap}
        selectable={(highlight && !isMe) || (allowOwnClick && isMe)}
        selected={selectedCardId === card.id}
        onClick={() => onCardSelect?.(player.id, card.id)}
      />
      <ZoomButton card={card} onZoom={onZoom} small />
    </div>
  );

  return (
    <div style={{
      border:`2px solid ${isMe ? 'rgba(180,79,255,0.7)' : highlight ? 'rgba(255,79,163,0.7)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius:12, padding:'8px 10px',
      background: isMe ? 'rgba(180,79,255,0.05)' : 'rgba(255,255,255,0.015)',
      boxShadow: highlight ? '0 0 20px rgba(255,79,163,0.15)' : 'none', transition:'all 0.2s',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
        <span style={{ fontWeight:800, fontSize:13, color: isMe ? 'var(--c-purple)' : 'var(--c-text)' }}>
          {player.isBot ? '🤖 ' : ''}{player.name}{isMe ? ' (you)' : ''}
        </span>
        <span style={{ background: close ? 'rgba(255,224,102,0.25)' : 'rgba(180,79,255,0.2)', borderRadius:20, padding:'1px 8px', fontSize:11, fontWeight:700, color: close ? 'var(--c-yellow)' : 'var(--c-purple)' }}>
          {count}/{winCondition || 7} 🦄
        </span>
        {/* Hand count badge */}
        {!isMe && (
          <span style={{ fontSize:10, color:'var(--c-muted)', background:'rgba(255,255,255,0.06)', borderRadius:20, padding:'1px 6px' }}>
            🃏{player.handCount}
          </span>
        )}
        {!player.connected && <span style={{ fontSize:10, color:'var(--c-red)' }}>● offline</span>}
        {(player.handLimit || 7) < 7 && <span style={{ fontSize:10, color:'var(--c-red)', background:'rgba(255,85,85,0.15)', borderRadius:4, padding:'1px 5px' }}>hand≤{player.handLimit}</span>}
      </div>

      {/* Unicorn row */}
      <div className="card-row" style={{ display:'flex', flexWrap:'wrap', gap:4, minHeight:36 }}>
        {unicorns.length === 0 && modifiers.length === 0
          ? <div style={{ color:'var(--c-muted)', fontSize:11, fontStyle:'italic' }}>Empty stable</div>
          : unicorns.length === 0
            ? <div style={{ color:'var(--c-muted)', fontSize:11, fontStyle:'italic', alignSelf:'center' }}>No unicorns</div>
            : unicorns.map(renderCard)
        }
      </div>

      {/* Upgrades / Downgrades row — only shown when present */}
      {modifiers.length > 0 && (
        <div className="card-row" style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:5, paddingTop:5, borderTop:'1px solid rgba(255,255,255,0.07)' }}>
          {modifiers.map(renderCard)}
        </div>
      )}
      {/* Nanny Cam: show this player's hand to all viewers (server sends hand when handVisible) */}
      {!isMe && player.handVisible && player.hand && player.hand.length > 0 && (
        <div style={{ marginTop:8, borderTop:'1px solid rgba(255,200,0,0.2)', paddingTop:6 }}>
          <div style={{ fontSize:9, color:'rgba(255,200,0,0.7)', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>
            📷 Nanny Cam — hand visible
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
            {player.hand.map(card => (
              <div key={card.id} style={{ position:'relative', display:'inline-block' }}
                onMouseEnter={()=>onHover&&onHover(card)}
                onMouseLeave={()=>onHover&&onHover(null)}
                onContextMenu={e=>{ e.preventDefault(); onZoom&&onZoom(card); }}>
                <GameCard card={card} small artMap={artMap} />
                <ZoomButton card={card} onZoom={onZoom} small />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Game Log ─────────────────────────────────────────────────────────────────
function GameLog({ log }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log]);
  return (
    <div ref={ref} style={{ height:120, overflowY:'auto', background:'rgba(0,0,0,0.3)', borderRadius:8, padding:'8px 10px', fontSize:11, lineHeight:1.9, color:'var(--c-muted)' }}>
      {log?.map((e, i) => (
        <div key={i} style={{ color: i === log.length-1 ? 'var(--c-text)' : undefined }}>{e.msg}</div>
      ))}
    </div>
  );
}

// ─── Expansion toggle card ────────────────────────────────────────────────────
function ExpCard({ id, enabled, onToggle, disabled }) {
  const m   = EXP_META[id];
  const hex = m.color.replace('#','');
  const rgb = [0,2,4].map(i => parseInt(hex.slice(i,i+2),16)).join(',');
  return (
    <div onClick={disabled ? undefined : onToggle} style={{
      border:`2px solid ${enabled ? m.color : 'rgba(255,255,255,0.1)'}`, borderRadius:12, padding:'11px 14px',
      cursor: disabled ? 'default' : 'pointer', transition:'all 0.2s', opacity: disabled ? 0.6 : 1,
      background: enabled ? `rgba(${rgb},0.08)` : 'rgba(255,255,255,0.02)',
      boxShadow: enabled ? `0 0 18px rgba(${rgb},0.12)` : 'none',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
            <span style={{ fontWeight:800, fontSize:14, color: enabled ? m.color : 'var(--c-text)' }}>{m.name}</span>
            <span style={{ fontSize:9, borderRadius:4, padding:'1px 5px', fontWeight:700, background: m.ageRating==='18+' ? 'rgba(255,85,85,0.2)' : 'rgba(255,255,255,0.1)', color: m.ageRating==='18+' ? 'var(--c-red)' : 'var(--c-muted)' }}>{m.ageRating}</span>
            <span style={{ fontSize:10, color:'var(--c-muted)' }}>{m.cardCount} cards</span>
          </div>
          <div style={{ fontSize:11, color:'var(--c-muted)', lineHeight:1.5 }}>{m.desc}</div>
          {m.adult && <div style={{ fontSize:10, color:'var(--c-red)', marginTop:3, fontWeight:700 }}>⚠ Adult content — 18+ only</div>}
        </div>
        <div style={{ width:22, height:22, borderRadius:'50%', flexShrink:0, border:`2px solid ${enabled ? m.color : 'rgba(255,255,255,0.2)'}`, background: enabled ? m.color : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:12, fontWeight:800, transition:'all 0.2s' }}>
          {enabled ? '✓' : ''}
        </div>
      </div>
    </div>
  );
}

// ─── Card Zoom modal ──────────────────────────────────────────────────────────
function CardZoom({ card, artMap, onClose }) {
  if (!card) return null;
  const art = artMap?.[card.name] || null;
  const bg  = TYPE_BG[card.type]  || '#1e1035';
  const clr = TYPE_CLR[card.type] || '#fff';
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', zIndex:950,
      display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'var(--c-panel)', borderRadius:18, padding:20,
        maxWidth:340, width:'90vw', boxShadow:'0 20px 60px rgba(0,0,0,0.8)', cursor:'default' }}
        className="animate-bounce-in">
        {/* Large card art / emoji */}
        <div style={{ width:'100%', aspectRatio:'3/4', maxHeight:260, borderRadius:12, overflow:'hidden',
          background:bg, display:'flex', alignItems:'center', justifyContent:'center',
          marginBottom:14, position:'relative', border:`3px solid ${clr}33` }}>
          {art
            ? <img src={art} alt={card.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            : <div style={{ fontSize:72 }}>{card.emoji}</div>
          }
          <div style={{ position:'absolute', top:8, left:8, fontSize:10, fontWeight:800,
            background:'rgba(0,0,0,0.7)', color:clr, borderRadius:6, padding:'2px 7px',
            textTransform:'uppercase', letterSpacing:1 }}>
            {TYPE_LABEL[card.type]}
          </div>
          {card.expansion && (
            <div style={{ position:'absolute', top:8, right:8, fontSize:10,
              background: EXP_META[card.expansion]?.color||'#888', color:'#fff',
              borderRadius:6, padding:'2px 7px', fontWeight:700 }}>
              {EXP_META[card.expansion]?.name||card.expansion}
            </div>
          )}
        </div>
        {/* Card info */}
        <div style={{ fontWeight:900, fontSize:18, marginBottom:6, textAlign:'center' }}>
          {card.emoji} {card.name}
        </div>
        <div style={{ fontSize:11, color:'var(--c-muted)', textAlign:'center', textTransform:'uppercase',
          letterSpacing:1, marginBottom:12 }}>
          {TYPE_LABEL[card.type]}{card.expansion ? ` · ${EXP_META[card.expansion]?.name||card.expansion}` : ''}
        </div>
        <div style={{ fontSize:13, color:'var(--c-text)', lineHeight:1.7,
          background:'rgba(0,0,0,0.25)', borderRadius:10, padding:'10px 14px' }}>
          {card.description || <span style={{color:'var(--c-muted)',fontStyle:'italic'}}>No description</span>}
        </div>
        <button className="btn btn-secondary" style={{ width:'100%', marginTop:14, justifyContent:'center' }}
          onClick={onClose}>Close</button>
      </div>
    </div>
  );
}


function DiscardPileBrowser({ pile, artMap, onZoom, onClose }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = !q ? pile : pile.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.description||'').toLowerCase().includes(q) ||
    (TYPE_LABEL[c.type]||'').toLowerCase().includes(q)
  );
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', zIndex:950,
      display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'var(--c-panel)', borderRadius:18, padding:18,
        maxWidth:560, width:'92vw', maxHeight:'82vh', display:'flex', flexDirection:'column',
        boxShadow:'0 20px 60px rgba(0,0,0,0.8)', cursor:'default' }} className="animate-bounce-in">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div style={{ fontWeight:900, fontSize:16 }}>🗑️ Discard Pile ({pile.length})</div>
          <button className="btn btn-secondary" style={{ padding:'4px 10px', fontSize:12 }} onClick={onClose}>✕</button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={e=>setQuery(e.target.value)}
          placeholder="Search by name, type, or text…"
          style={{ width:'100%', padding:'8px 12px', borderRadius:10, border:'1px solid var(--c-border)',
            background:'rgba(0,0,0,0.3)', color:'var(--c-text)', fontSize:13, marginBottom:12, boxSizing:'border-box' }}
        />
        <div style={{ overflowY:'auto', flex:1, display:'flex', flexWrap:'wrap', gap:8, alignContent:'flex-start' }}>
          {filtered.length===0 && (
            <div style={{ color:'var(--c-muted)', fontSize:13, padding:'20px 0', width:'100%', textAlign:'center' }}>
              {pile.length===0 ? 'Discard pile is empty.' : 'No cards match your search.'}
            </div>
          )}
          {filtered.map((card,i) => (
            <div key={card.id+'-'+i} style={{ cursor:'pointer' }} onClick={()=>onZoom(card)} title={card.name}>
              <GameCard card={card} small artMap={artMap} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


function LeaveConfirm({ onConfirm, onCancel }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div className="panel animate-bounce-in" style={{ padding:28, maxWidth:320, textAlign:'center' }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🚪</div>
        <div style={{ fontWeight:800, fontSize:17, marginBottom:8 }}>Leave the game?</div>
        <div style={{ color:'var(--c-muted)', fontSize:13, marginBottom:20, lineHeight:1.6 }}>
          You'll return to the main menu. Your opponents will continue without you.
        </div>
        <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
          <button className="btn btn-danger" onClick={onConfirm}>Leave Game</button>
          <button className="btn btn-secondary" onClick={onCancel}>Stay</button>
        </div>
      </div>
    </div>
  );
}

// ─── Join / Main Menu ─────────────────────────────────────────────────────────
function JoinScreen({ onJoin, onWatch, onPlayVsBot, initialRoom, onOpenArtManager }) {
  const [name, setName]       = useState(() => localStorage.getItem('uu_name') || '');
  const [room, setRoom]       = useState(initialRoom || '');
  const [creating, setCreating] = useState(false);
  const [startingBotGame, setStartingBotGame] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState('medium');
  const [error, setError]     = useState('');

  const doCreate = async () => {
    if (!name.trim()) { setError('Enter your name first'); return; }
    setCreating(true); setError('');
    try {
      const r = await fetch('/api/rooms', { method:'POST' });
      if (!r.ok) throw new Error('Server error');
      const { roomId } = await r.json();
      localStorage.setItem('uu_name', name.trim());
      onJoin(name.trim(), roomId);
    } catch (e) {
      setError('Could not create room — is the server running?');
      setCreating(false);
    }
  };

  const doPlayVsBot = async () => {
    if (!name.trim()) { setError('Enter your name first'); return; }
    setStartingBotGame(true); setError('');
    await onPlayVsBot(name.trim(), botDifficulty);
    setStartingBotGame(false);
  };

  const doJoin = () => {
    if (!name.trim()) { setError('Enter your name first'); return; }
    if (!room.trim()) { setError('Enter a room code'); return; }
    setError('');
    localStorage.setItem('uu_name', name.trim());
    onJoin(name.trim(), room.trim().toUpperCase());
  };

  const doWatch = () => {
    if (!room.trim()) { setError('Enter a room code to watch'); return; }
    setError('');
    onWatch(room.trim().toUpperCase());
  };

  return (
    <div style={{ maxWidth:420, margin:'80px auto', padding:'0 16px' }}>
      <div style={{ textAlign:'center', marginBottom:36 }}>
        <div className="animate-float" style={{ fontSize:68, marginBottom:10 }}>🦄</div>
        <h1 className="font-title" style={{ fontSize:38, background:'linear-gradient(135deg,#ff4fa3,#b44fff,#4fb8ff)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', marginBottom:6 }}>
          Unstable Unicorns
        </h1>
        <p style={{ color:'var(--c-muted)', fontSize:13 }}>Build a unicorn army. Betray your friends.</p>
      </div>

      <div className="panel" style={{ padding:24 }}>
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11, color:'var(--c-muted)', display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:1 }}>Your Name</label>
          <input className="input" placeholder="Unicorn Lord…" value={name} onChange={e=>setName(e.target.value)} maxLength={20} onKeyDown={e=>e.key==='Enter'&&doCreate()} autoFocus />
        </div>
        <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', marginBottom:10 }} onClick={doCreate} disabled={creating}>
          {creating ? '⏳ Creating…' : '✨ Create New Game'}
        </button>

        {/* Play vs Bot quick-start */}
        <div style={{ border:'1.5px solid rgba(180,79,255,0.25)', background:'rgba(180,79,255,0.06)', borderRadius:12, padding:12, marginBottom:14 }}>
          <div style={{ fontSize:11, color:'var(--c-purple)', fontWeight:700, marginBottom:8 }}>🤖 PLAY VS BOT — jump right in, solo</div>
          <div style={{ display:'flex', gap:4, marginBottom:8 }}>
            {['easy','medium','hard'].map(d => (
              <button key={d} onClick={()=>setBotDifficulty(d)}
                style={{ flex:1, fontSize:11, padding:'6px 0', borderRadius:7, textTransform:'capitalize', cursor:'pointer',
                  border:`1.5px solid ${botDifficulty===d?'var(--c-purple)':'rgba(255,255,255,0.1)'}`,
                  background: botDifficulty===d?'rgba(180,79,255,0.18)':'transparent',
                  color: botDifficulty===d?'var(--c-purple)':'var(--c-muted)', fontWeight:700 }}>
                {d}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary" style={{ width:'100%', justifyContent:'center' }} onClick={doPlayVsBot} disabled={startingBotGame}>
            {startingBotGame ? '⏳ Setting up…' : '🤖 Play vs Bot'}
          </button>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
          <div style={{ flex:1, height:1, background:'var(--c-border)' }}/>
          <span style={{ color:'var(--c-muted)', fontSize:11, textTransform:'uppercase' }}>or join</span>
          <div style={{ flex:1, height:1, background:'var(--c-border)' }}/>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <input className="input" placeholder="Room code (e.g. AB12CD)…" value={room}
            onChange={e=>setRoom(e.target.value.toUpperCase())} maxLength={8}
            onKeyDown={e=>e.key==='Enter'&&doJoin()} style={{ flex:1 }} />
          <button className="btn btn-secondary" onClick={doJoin}>Join →</button>
        </div>
        <div style={{ textAlign:'center', marginTop:10 }}>
          <button className="btn btn-secondary" style={{ fontSize:11 }} onClick={doWatch}>
            👀 Watch this room (spectate, no name needed)
          </button>
        </div>
        {error && <div style={{ color:'var(--c-red)', fontSize:12, marginTop:10, fontWeight:600 }}>⚠ {error}</div>}
      </div>

      {/* Art Manager entry */}
      <div style={{ marginTop:16, textAlign:'center' }}>
        <button className="btn btn-secondary" style={{ fontSize:12 }} onClick={onOpenArtManager}>
          🖼 Manage Card Artwork
        </button>
      </div>

      <div style={{ textAlign:'center', marginTop:12, fontSize:11, color:'var(--c-muted)', lineHeight:2 }}>
        2–8 players · Base game + 7 expansion packs · Self-hostable
      </div>
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
function LobbyScreen({ players, isHost, roomId, onStart, onSettings, settings, onLeave, onAddBot, onRemoveBot }) {
  const [exps, setExps]       = useState(settings?.expansions || []);
  const [winCond, setWinCond] = useState(settings?.winCondition || 7);
  const [copied, setCopied]   = useState(false);
  const [nsfwPending, setNsfwPending] = useState(false); // NSFW age gate
  const [botDifficulty, setBotDifficulty] = useState('medium');
  const BOT_NAMES = ['Rainbow Rex','Sparkle Sam','Glitter Gus','Chaos Cassie','Neigh Nancy','Prism Pete'];

  // Keep in sync when host settings are broadcast to non-host players
  useEffect(() => {
    setExps(settings?.expansions || []);
    setWinCond(settings?.winCondition || 7);
  }, [settings]);

  const shareUrl = `${window.location.origin}?room=${roomId}`;
  const copy = () => { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(()=>setCopied(false),2000); };

  const toggleExp = (id) => {
    // NSFW expansion requires age confirmation before enabling
    if (id === 'nsfw' && !exps.includes('nsfw')) {
      setNsfwPending(true);
      return;
    }
    const next = exps.includes(id) ? exps.filter(e=>e!==id) : [...exps, id];
    setExps(next);
    onSettings({ expansions:next, winCondition:winCond });
  };

  const confirmNsfw = () => {
    const next = [...exps, 'nsfw'];
    setExps(next);
    onSettings({ expansions:next, winCondition:winCond });
    setNsfwPending(false);
  };

  const changeWin = (n) => {
    setWinCond(n);
    onSettings({ expansions:exps, winCondition:n });
  };

  const totalCards = 105 + exps.reduce((a,id)=>a+(EXP_META[id]?.cardCount||0),0);

  return (
    <div style={{ maxWidth:760, margin:'0 auto', padding:'24px 16px', display:'flex', gap:20, flexWrap:'wrap' }}>

      {/* NSFW age confirmation gate */}
      {nsfwPending && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div className="panel animate-bounce-in" style={{ padding:32, maxWidth:360, textAlign:'center', border:'2px solid rgba(255,79,163,0.5)' }}>
            <div style={{ fontSize:44, marginBottom:10 }}>🔞</div>
            <div className="font-title" style={{ fontSize:20, color:'var(--c-pink)', marginBottom:8 }}>Adults Only</div>
            <div style={{ color:'var(--c-text)', fontSize:13, lineHeight:1.7, marginBottom:6 }}>
              The <strong>NSFW expansion</strong> contains sexually explicit content intended for adults aged <strong>18 and over</strong>.
            </div>
            <div style={{ color:'var(--c-muted)', fontSize:12, lineHeight:1.6, marginBottom:22 }}>
              By enabling this expansion, you confirm that <em>all players</em> at this table are 18 or older and consent to adult content.
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <button className="btn btn-primary" onClick={confirmNsfw} style={{ background:'linear-gradient(135deg,#ff4fa3,#b44fff)' }}>
                ✓ I'm 18+ — Enable
              </button>
              <button className="btn btn-secondary" onClick={()=>setNsfwPending(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Left column */}
      <div style={{ flex:'1 1 280px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
          <div>
            <div className="animate-float" style={{ fontSize:42 }}>🦄</div>
            <h1 className="font-title" style={{ fontSize:24, background:'linear-gradient(135deg,#ff4fa3,#b44fff,#4fb8ff)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
              Unstable Unicorns
            </h1>
          </div>
          <button className="btn btn-secondary" style={{ fontSize:11, alignSelf:'flex-start' }} onClick={onLeave}>← Leave</button>
        </div>

        {/* Room code */}
        <div className="panel" style={{ padding:14, marginBottom:10 }}>
          <div style={{ fontSize:11, color:'var(--c-muted)', marginBottom:5 }}>ROOM CODE — share this with friends</div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div className="font-title" style={{ fontSize:28, letterSpacing:6, color:'var(--c-yellow)', flex:1 }}>{roomId}</div>
            <button className="btn btn-secondary" onClick={copy} style={{ fontSize:11, padding:'6px 10px' }}>{copied?'✓ Copied':'📋 Copy Link'}</button>
          </div>
        </div>

        {/* Players */}
        <div className="panel" style={{ padding:14, marginBottom:10 }}>
          <div style={{ fontSize:11, color:'var(--c-muted)', marginBottom:8 }}>PLAYERS ({Object.keys(players).length}/8)</div>
          {Object.values(players).map(p => (
            <div key={p.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background: p.isBot?'var(--c-purple)':(p.connected?'var(--c-green)':'var(--c-red)'), flexShrink:0 }}/>
              <span style={{ fontWeight:700, fontSize:13 }}>{p.isBot ? '🤖 ' : ''}{p.name}</span>
              {p.isHost && <span style={{ fontSize:10, background:'rgba(255,224,102,0.15)', color:'var(--c-yellow)', borderRadius:4, padding:'1px 6px' }}>HOST</span>}
              {p.isBot && (
                <span style={{ fontSize:10, background:'rgba(180,79,255,0.15)', color:'var(--c-purple)', borderRadius:4, padding:'1px 6px', textTransform:'capitalize' }}>
                  {p.botDifficulty || 'medium'}
                </span>
              )}
              {p.isBot && isHost && (
                <button
                  onClick={() => onRemoveBot(p.id)}
                  title="Remove bot"
                  style={{ marginLeft:'auto', background:'none', border:'none', color:'var(--c-muted)', cursor:'pointer', fontSize:14, padding:'2px 6px', lineHeight:1 }}
                >✕</button>
              )}
            </div>
          ))}
          {isHost && Object.keys(players).length < 8 && (
            <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize:11, color:'var(--c-muted)', marginBottom:6 }}>ADD A BOT OPPONENT</div>
              <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                <div style={{ display:'flex', gap:4 }}>
                  {['easy','medium','hard'].map(d => (
                    <button key={d} onClick={()=>setBotDifficulty(d)}
                      style={{ fontSize:11, padding:'6px 10px', borderRadius:7, textTransform:'capitalize', cursor:'pointer',
                        border:`1.5px solid ${botDifficulty===d?'var(--c-purple)':'rgba(255,255,255,0.1)'}`,
                        background: botDifficulty===d?'rgba(180,79,255,0.18)':'transparent',
                        color: botDifficulty===d?'var(--c-purple)':'var(--c-muted)', fontWeight:700 }}>
                      {d}
                    </button>
                  ))}
                </div>
                <button className="btn btn-secondary" style={{ fontSize:11, padding:'6px 12px' }}
                  onClick={() => {
                    const used = new Set(Object.values(players).filter(p=>p.isBot).map(p=>p.name));
                    const name = BOT_NAMES.find(n => !used.has(n)) || `Bot ${Object.keys(players).length}`;
                    onAddBot(name, botDifficulty);
                  }}>
                  🤖 Add Bot
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Win condition + modes (host only) */}
        {isHost && (
          <div className="panel" style={{ padding:14, marginBottom:10 }}>
            <div style={{ fontSize:11, color:'var(--c-muted)', marginBottom:8 }}>WIN CONDITION</div>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:12 }}>
              <span style={{ fontSize:12 }}>First to</span>
              {[5,6,7,8].map(n => (
                <button key={n} onClick={()=>changeWin(n)} style={{ width:32, height:32, borderRadius:8, border:`2px solid ${winCond===n?'var(--c-purple)':'rgba(255,255,255,0.1)'}`, background: winCond===n?'rgba(180,79,255,0.2)':'transparent', color: winCond===n?'var(--c-purple)':'var(--c-muted)', cursor:'pointer', fontWeight:800, fontSize:13 }}>{n}</button>
              ))}
              <span style={{ fontSize:11, color:'var(--c-muted)' }}>unicorns · ~{totalCards} cards</span>
            </div>
            <div style={{ fontSize:11, color:'var(--c-muted)', marginBottom:8 }}>GAME MODES</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {[
                { key:'localMode', icon:'🖥️', label:'Local Mode', desc:'All hands visible — play on one screen, pass between players' },
                { key:'debugMode', icon:'🐛', label:'Debug Mode', desc:'Host can see all cards, skip turns, draw specific cards' },
              ].map(({ key, icon, label, desc }) => {
                const enabled = settings?.[key] || false;
                return (
                  <div key={key}
                    onClick={() => onSettings({ expansions:exps, winCondition:winCond, [key]:!enabled, ...(key==='localMode'?{}:{localMode:settings?.localMode||false}), ...(key==='debugMode'?{}:{debugMode:settings?.debugMode||false}) })}
                    style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:8, cursor:'pointer',
                      background: enabled?'rgba(79,255,160,0.08)':'rgba(255,255,255,0.03)',
                      border:`1.5px solid ${enabled?'rgba(79,255,160,0.4)':'rgba(255,255,255,0.08)'}`,
                      transition:'all 0.15s' }}>
                    <span style={{ fontSize:16 }}>{icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, fontWeight:800, color: enabled?'var(--c-green)':'var(--c-text)' }}>{label}</div>
                      <div style={{ fontSize:10, color:'var(--c-muted)', marginTop:1 }}>{desc}</div>
                    </div>
                    <div style={{ width:20, height:20, borderRadius:'50%', border:`2px solid ${enabled?'var(--c-green)':'rgba(255,255,255,0.2)'}`, background:enabled?'var(--c-green)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'white', fontWeight:800 }}>
                      {enabled?'✓':''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Start button */}
        {isHost ? (
          <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', fontSize:15, padding:14 }}
            onClick={onStart} disabled={Object.keys(players).length < 2}>
            🚀 Start Game{Object.keys(players).length < 2 ? ' (need 2+ players)' : ` — ${Object.keys(players).length} players`}
          </button>
        ) : (
          <div style={{ textAlign:'center', color:'var(--c-muted)', fontSize:13, padding:14, background:'rgba(255,255,255,0.03)', borderRadius:12 }}>
            ⏳ Waiting for the host to start the game…
          </div>
        )}
      </div>

      {/* Right column — expansions */}
      <div style={{ flex:'1 1 300px' }}>
        <div style={{ fontSize:11, color:'var(--c-muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>
          {isHost ? '⚙️ Expansion Packs — toggle on/off' : '📦 Expansion Packs (set by host)'}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
          {Object.keys(EXP_META).map(id => (
            <ExpCard key={id} id={id} enabled={exps.includes(id)} onToggle={()=>toggleExp(id)} disabled={!isHost} />
          ))}
        </div>
        {!isHost && <div style={{ fontSize:11, color:'var(--c-muted)', textAlign:'center', marginTop:8 }}>Only the host can enable or disable expansions</div>}
      </div>
    </div>
  );
}

// ─── Game Over ────────────────────────────────────────────────────────────────
function Confetti({ active }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const particles = useRef([]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);

    const COLORS = ['#ffe066','#ff9a3c','#ff4fb0','#b44fff','#4fffb0','#4fb0ff','#ffffff'];
    const SHAPES = ['rect','circle','ribbon'];
    const COUNT  = 180;

    const spawn = () => ({
      x:     Math.random() * canvas.width,
      y:     -20 - Math.random() * 80,
      w:     6 + Math.random() * 8,
      h:     4 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      vx:    (Math.random() - 0.5) * 2.5,
      vy:    2.5 + Math.random() * 4,
      spin:  (Math.random() - 0.5) * 0.25,
      angle: Math.random() * Math.PI * 2,
      alpha: 1,
      life:  1,
      decay: 0.003 + Math.random() * 0.004,
    });

    particles.current = Array.from({ length: COUNT }, spawn);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.current.forEach(p => {
        p.x     += p.vx;
        p.y     += p.vy;
        p.vy    += 0.07;           // gravity
        p.angle += p.spin;
        p.life  -= p.decay;
        p.alpha  = Math.max(0, p.life);

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;

        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === 'ribbon') {
          ctx.fillRect(-p.w / 2, -p.h / 4, p.w, p.h / 2);
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      });

      // Respawn dead particles for 5 s, then let them drain
      particles.current = particles.current.map(p =>
        p.life <= 0 && p._age < 300 ? { ...spawn(), _age: (p._age || 0) + 1 } : p
      ).filter(p => p.life > 0 || !p._age || p._age < 300);

      if (particles.current.length > 0) rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [active]);

  if (!active) return null;
  return (
    <canvas ref={canvasRef} style={{
      position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999,
    }} />
  );
}

function GameOverScreen({ winner, players, winCondition, playerId, onBackToMenu }) {
  const isWinner   = playerId && playerId === winner;
  const winnerName = players?.[winner]?.name ?? 'Someone';
  const sorted     = Object.values(players ?? {}).sort((a, b) => (b.unicornCount || 0) - (a.unicornCount || 0));

  // Stagger the standings rows in
  const [visRows, setVisRows] = useState(0);
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => { i++; setVisRows(i); if (i >= sorted.length) clearInterval(t); }, 180);
    return () => clearInterval(t);
  }, [sorted.length]);

  return (
    <>
      <Confetti active={isWinner} />

      <div className="animate-bounce-in" style={{
        textAlign: 'center', padding: '40px 24px',
        maxWidth: 520, margin: '60px auto',
        background: 'rgba(255,255,255,0.03)',
        border: '2px solid rgba(255,224,102,0.25)',
        borderRadius: 20,
        boxShadow: isWinner ? '0 0 60px rgba(255,224,102,0.15), 0 0 120px rgba(180,79,255,0.1)' : 'none',
      }}>

        {/* Trophy / sad emoji */}
        <div className="animate-float" style={{ fontSize: 90, lineHeight: 1, marginBottom: 8 }}>
          {isWinner ? '🏆' : '🦄'}
        </div>

        {/* Winner headline */}
        <h1 className="font-title" style={{
          fontSize: 42, margin: '8px 0 4px',
          background: 'linear-gradient(135deg,#ffe066,#ff9a3c,#ff4fb0)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          lineHeight: 1.1,
        }}>
          {isWinner ? 'You Win!' : `${winnerName} Wins!`}
        </h1>

        <p style={{ color: 'var(--c-muted)', fontSize: 14, marginBottom: 28 }}>
          {isWinner
            ? `You assembled ${winCondition || 7} unicorns and conquered the stable! 🎉`
            : `${winnerName} assembled ${winCondition || 7} unicorns first.`}
        </p>

        {/* Final standings */}
        <div className="panel" style={{ padding: '4px 0', marginBottom: 28, textAlign: 'left' }}>
          <div style={{ padding: '8px 16px 6px', fontSize: 10, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Final Standings
          </div>
          {sorted.map((p, i) => (
            <div key={p.id} className={i < visRows ? 'animate-slide-in' : ''} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 16px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              opacity: i < visRows ? 1 : 0,
              transition: 'opacity 0.3s',
              background: p.id === winner ? 'rgba(255,224,102,0.06)' : 'transparent',
            }}>
              <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`}
              </span>
              <span style={{
                flex: 1, fontWeight: p.id === winner ? 800 : 500,
                color: p.id === winner ? 'var(--c-yellow)' : 'var(--c-text)',
              }}>
                {p.isBot ? '🤖 ' : ''}{p.name}
                {p.id === playerId && p.id !== winner && <span style={{ color: 'var(--c-muted)', fontSize: 11, marginLeft: 6 }}>(you)</span>}
              </span>
              <span style={{ color: 'var(--c-purple)', fontWeight: 700 }}>{p.unicornCount || 0} 🦄</span>
            </div>
          ))}
        </div>

        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 15 }}
          onClick={onBackToMenu}>
          ← Back to Menu
        </button>
      </div>
    </>
  );
}

// ─── Game Board ───────────────────────────────────────────────────────────────
function GameBoard({ state, playerId, send, onLeave }) {
  const [selCardId, setSelCardId]         = useState(null);
  const [multiSelIds, setMultiSelIds]     = useState([]);   // for multi-select effects
  const [chosenPlayerIds, setChosenPlayerIds] = useState([]); // for choose_players_draw_each
  const [moveUpgState, setMoveUpgState]   = useState(null); // {sourcePlayerId, sourceCardId} for move_upgrade_or_downgrade
  const [swapState, setSwapState]         = useState(null); // {ownCardId} for move_own_unicorn_steal_unicorn (Unicorn Swap)
  const [dominatrixState, setDominatrixState] = useState(null); // {sourcePlayerId, sourceCardId} for move_unicorn_any_stable_not_own (Dominatrix Whip)
  const [choiceStep, setChoiceStep]       = useState(null); // null | 'a' | 'b' | 'b_pick_card' | {choice:'b',cardId} — follow-up target selection for choice_* cards whose A/B option needs a stable/hand/player target (Cutthroat Captain, Pillaging Pirate, Hornswoggler, Bungee Jumping, First Mer-mate)
  const [downgradeMoveState, setDowngradeMoveState] = useState(null); // {cardId, targetPlayerId?} for move_downgrade_to_opponent (White Elephantcorn/Playful Puppet), move_downgrade_steal_upgrade (Orcicorn Raider), move_own_card_pull_from_that_player (Gift Receipt)
  const [targetMode, setTargetMode]       = useState(null);
  const [tgtPid, setTgtPid]               = useState(null);
  const [tgtCid, setTgtCid]               = useState(null);
  const [hoverCard, setHoverCard]   = useState(null);
  const [zoomedCard, setZoomedCard] = useState(null); // click-to-enlarge modal
  const [showDiscardPile, setShowDiscardPile] = useState(false); // full discard pile browser modal
  const [chat, setChat]             = useState('');
  const [chatLog, setChatLog]       = useState([]);
  const [showLeave, setShowLeave]   = useState(false);
  const [showDebug, setShowDebug]   = useState(false);
  // Local mode: which player's perspective we're viewing
  const [localViewPid, setLocalViewPid] = useState(playerId);
  const chatRef = useRef(null);
  const [artMap] = useState(() => ArtStore.all());

  // In local mode, we view from localViewPid's perspective; otherwise always our own
  const localMode = state.settings?.localMode;
  const debugMode = state.settings?.debugMode;
  const effectivePid  = localMode ? localViewPid : playerId;
  const me            = state.players[effectivePid];
  const isMyTurn      = state.currentPlayer === effectivePid;
  const currentPlayer = state.players[state.currentPlayer];
  const { phase, pendingEffect, winCondition, neighWindow, neighBlocked, superNeighWindow } = state;
  const isMyEffect    = pendingEffect?.playerId === effectivePid; // true even on opponent's turn (e.g. AFU force-discard)
  const selCard       = me?.hand?.find(c => c.id === selCardId);
  const hasNeigh      = !neighBlocked && me?.hand?.some(c => c.effect?.type === 'neigh' || c.effect?.type === 'neigh_remove_from_game');
  const myNeigh       = me?.hand?.find(c => c.effect?.type === 'neigh' || c.effect?.type === 'neigh_remove_from_game');
  // Neigh, Super Neigh (cannot itself be Neighed), and Hex Neigh (removes from game
  // instead of discarding) are meaningfully different — dedupe by name so the player
  // can pick exactly which one to play instead of the game silently choosing for them.
  const myNeighOptions = (() => {
    const seen = new Set(); const opts = [];
    for (const c of (me?.hand || [])) {
      if (c.effect?.type !== 'neigh' && c.effect?.type !== 'neigh_remove_from_game') continue;
      if (seen.has(c.name)) continue;
      seen.add(c.name); opts.push(c);
    }
    return opts;
  })();

  // Sync localViewPid to current player in local mode
  useEffect(() => {
    if (localMode && state.currentPlayer) setLocalViewPid(state.currentPlayer);
  }, [localMode, state.currentPlayer]);

  // Effects that require clicking a stable card
  const STABLE_EFFECTS = new Set(['choose_destroy','choose_steal','choose_return',
    'sacrifice_unicorn_destroy_unicorn','sacrifice_n_destroy_n','discard_remove_from_game',
    'steal_downgrade','steal_baby','discard_two_destroy_unicorn','discard_n_steal_unicorn',
    'discard_two_steal_unicorn','discard_two_steal_any','discard_then_steal','fuck_marry_kill',
    'steal_basic_temp','steal_baby_temp','move_unicorn_to_deck_draw','sacrifice_unicorn_draw_three',
    'sacrifice_unicorn_or_self_return','sacrifice_self_steal_unicorn','sacrifice_then_destroy_one',
    'discard_then_sacrifice_downgrade','destroy_upgrade_or_sacrifice_downgrade','beginning_destroy_end_turn',
    'may_destroy_optional','all_may_destroy_unicorn','discard_two_return_all_opponents_one',
    'return_one_each_stable']);
  const needsStableClick  = pendingEffect && STABLE_EFFECTS.has(pendingEffect.type) && 
    (pendingEffect.discardDone || pendingEffect.sacrificeDone || pendingEffect.step1Done ||
     ['choose_destroy','choose_steal','choose_return','steal_downgrade','steal_baby',
      'steal_basic_temp','steal_baby_temp','move_unicorn_to_deck_draw',
      'destroy_upgrade_or_sacrifice_downgrade','beginning_destroy_end_turn',
      'may_destroy_optional','all_may_destroy_unicorn','return_one_each_stable'].includes(pendingEffect.type) ||
     (pendingEffect.type==='sacrifice_self_steal_unicorn'&&pendingEffect.sacrificeDone));
  const needsSacrifice    = ['sacrifice_unicorn','sacrifice_any','sacrifice_unicorn_tiny_stable',
    'sacrifice_unicorn_then_draw','sacrifice_basic_draw_three'].includes(pendingEffect?.type) ||
    (pendingEffect?.type === 'sacrifice_unicorn_destroy_unicorn' && !pendingEffect.sacrificeDone) ||
    (pendingEffect?.type === 'sacrifice_then_revive' && pendingEffect.step==='sacrifice') ||
    (pendingEffect?.type === 'sacrifice_then_destroy_two' && pendingEffect.step==='sacrifice') ||
    (pendingEffect?.type === 'sacrifice_then_destroy_one' && !pendingEffect.sacrificeDone) ||
    (pendingEffect?.type === 'sacrifice_n_destroy_n' && !pendingEffect.sacrificeDone) ||
    (pendingEffect?.type === 'sacrifice_revive_upgrade_from_discard' && !pendingEffect.sacrificeDone);
  const needsDestroyStep  = (pendingEffect?.type === 'sacrifice_unicorn_destroy_unicorn' && pendingEffect.sacrificeDone) ||
    (pendingEffect?.type === 'sacrifice_n_destroy_n' && pendingEffect.sacrificeDone);

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chatLog]);

  // Reset multi-select state when pending effect changes
  useEffect(() => {
    setMultiSelIds([]);
    setChosenPlayerIds([]);
    setMoveUpgState(null);
    setChoiceStep(null);
    setDowngradeMoveState(null);
  }, [pendingEffect?.type]);

  // Effects where the player can select MULTIPLE hand cards before confirming
  const MULTI_SEL_EFFECTS = new Set([
    'sacrifice_n_destroy_n','sacrifice_four_search_four',
    'discard_n_others_discard_n','discard_n_draw_n_extra_turn','discard_up_to_two_force_sacrifice',
    'discard_two_steal_any','discard_two_destroy_unicorn','discard_n_steal_unicorn',
    'discard_two_steal_unicorn','discard_two_unicorns_revive','discard_two_return_all_opponents_one',
    'discard_extra_turn_pending','discard_three_remove_from_game','discard_for_extra_turn',
    'discard_two_bring_two_babies',
  ]);
  // Also treat plain 'discard' as multi-select when amount > 1
  const effectNeedsMulti = pendingEffect && (
    MULTI_SEL_EFFECTS.has(pendingEffect.type) ||
    (['discard','end_discard','target_discard','discard_choice'].includes(pendingEffect.type) && (pendingEffect.amount||1) > 1)
  );
  const isMultiSelEffect = effectNeedsMulti && !pendingEffect.sacrificeDone && !pendingEffect.discardDone;

  const toggleMultiSel = (id) => {
    setMultiSelIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev,id]);
  };

  const selectCard = (id) => {
    if (isMultiSelEffect) { toggleMultiSel(id); return; }
    if (selCardId === id) { setSelCardId(null); setTargetMode(null); return; }
    setSelCardId(id); setTargetMode(null); setTgtPid(null); setTgtCid(null);
  };

  const getCardTargetNeeds = (card) => {
    if (!card) return null;
    // Downgrades always need a player target
    if (card.type === 'downgrade') return 'player';
    const t = card.effect?.type;
    // Unicorn cards whose effect fires on 'enter' or 'beginning' resolve their target
    // interactively via a pendingEffect once they're already in the stable (e.g.
    // Americorn's pull_random_hand → choose_opponent_pull_random, Rhinocorn's destroy →
    // beginning_destroy_end_turn) — they never need an upfront stable target just to
    // play the card. Matches server's playCard() isEnterTrigger exemption for
    // mustHaveStable exactly. (mustHavePlayer has no such exemption — e.g. Fisherman
    // Unicorn's look_hand_take_one still needs the player picked before playing — so
    // that branch below is intentionally left unaffected.)
    const isEnterOrBeginningUnicorn = ['baby_unicorn','basic_unicorn','magical_unicorn'].includes(card.type) &&
      (card.effect?.trigger === 'enter' || card.effect?.trigger === 'beginning');
    // Must have a specific card in a specific stable
    if (!isEnterOrBeginningUnicorn && ['steal','destroy','return_to_hand','return_to_deck',
         'sacrifice_self_destroy_unicorn',
         'destroy_then_target_may_destroy','remove_from_game','pull_random_hand'].includes(t)) return 'stable';
    // Must have a player (but not necessarily a specific card)
    if (['skip_turn','trade_hands','force_discard',
         'force_discard_give_card_destroy_unicorn',
         'look_hand_take_one','look_and_take',
         'destroy_all_basics_one_player'].includes(t)) return 'player';
    return null;
  };

  // In 2-player mode: the only valid opponent
  const opponents = state.playerOrder.filter(p => p !== effectivePid);
  const soloOpponent = opponents.length === 1 ? opponents[0] : null;

  const handlePlayCard = () => {
    if (!selCardId) return;
    const needs = getCardTargetNeeds(selCard);
    // 2-player shortcut: auto-select the only opponent for player-target cards
    if (needs === 'player' && !tgtPid) {
      if (soloOpponent) {
        send({ type:'play_card', cardId:selCardId, targetPlayerId:soloOpponent, targetCardId:tgtCid });
        setSelCardId(null); setTargetMode(null); setTgtPid(null); setTgtCid(null);
        return;
      }
      setTargetMode('player'); return;
    }
    if (needs === 'stable' && (!tgtPid || !tgtCid)) { setTargetMode('stable'); return; }
    send({ type:'play_card', cardId:selCardId, targetPlayerId:tgtPid, targetCardId:tgtCid });
    setSelCardId(null); setTargetMode(null); setTgtPid(null); setTgtCid(null);
  };

  const handleStableClick = (pid, cid) => {
    if (targetMode === 'stable') { setTgtPid(pid); setTgtCid(cid); return; }

    // ── move_downgrade_to_opponent / move_downgrade_steal_upgrade / move_own_card_pull_from_that_player:
    //    step 1 — click your own stable card to move (Downgrade-only for the first two, any card for Gift Receipt) ──
    if (['move_downgrade_to_opponent','move_downgrade_steal_upgrade','move_own_card_pull_from_that_player'].includes(pendingEffect?.type)
        && pendingEffect.playerId === effectivePid) {
      if (!downgradeMoveState && pid === effectivePid) {
        setDowngradeMoveState({ cardId: cid });
        return;
      }
      // step 2 (Orcicorn Raider only) — after a target player is chosen, optionally click
      // a card in THEIR stable to also steal it as part of the same move.
      if (pendingEffect.type === 'move_downgrade_steal_upgrade' && downgradeMoveState?.targetPlayerId && pid === downgradeMoveState.targetPlayerId) {
        send({ type:'resolve_effect', selectedCardIds:[downgradeMoveState.cardId], extra:{ targetPlayerId:downgradeMoveState.targetPlayerId, targetCardId:cid } });
        setDowngradeMoveState(null);
        return;
      }
    }

    // ── move_upgrade_or_downgrade_between_stables: two-step pick ──────────────
    if (pendingEffect?.type === 'move_upgrade_or_downgrade_between_stables' && pendingEffect.playerId === effectivePid) {
      if (!moveUpgState) {
        // Step 1: click source upgrade/downgrade
        setMoveUpgState({ sourcePlayerId: pid, sourceCardId: cid });
        return;
      } else {
        // Step 2: click target stable header (any card in target stable, or target player)
        send({ type:'resolve_effect', selectedCardIds:[], extra:{ sourcePlayerId:moveUpgState.sourcePlayerId, sourceCardId:moveUpgState.sourceCardId, targetPlayerId:pid } });
        setMoveUpgState(null);
        return;
      }
    }

    // ── move_unicorn_any_stable_not_own (Dominatrix Whip): step 1 of 2 ─────────
    if (pendingEffect?.type === 'move_unicorn_any_stable_not_own' && pendingEffect.playerId === effectivePid && !dominatrixState) {
      setDominatrixState({ sourcePlayerId: pid, sourceCardId: cid });
      return;
    }

    // ── move_own_unicorn_steal_unicorn (Unicorn Swap): two-step pick ──────────
    if (pendingEffect?.type === 'move_own_unicorn_steal_unicorn' && pendingEffect.playerId === effectivePid) {
      if (!swapState) {
        // Step 1: must click a Unicorn in YOUR OWN stable
        if (pid !== effectivePid) return;
        setSwapState({ ownCardId: cid });
        return;
      } else {
        // Step 2: must click a Unicorn in ANOTHER player's stable
        if (pid === effectivePid) return;
        send({ type:'resolve_effect', selectedCardIds:[swapState.ownCardId], extra:{ targetPlayerId:pid, targetCardId:cid } });
        setSwapState(null);
        return;
      }
    }

    // ── move_self_steal_and_draw: pick a unicorn to steal from chosen player ──
    if (pendingEffect?.type === 'move_self_steal_and_draw' && pendingEffect.playerId === effectivePid) {
      if (tgtPid && pid === tgtPid) {
        // Already picked the target player; now pick the unicorn card to steal
        send({ type:'resolve_effect', selectedCardIds:[], extra:{ targetPlayerId:tgtPid, targetCardId:cid } });
        setTgtPid(null); setTgtCid(null);
        return;
      }
    }

    // ── move_self_steal_unicorn (Polyamorous Unicorn): pick a unicorn to also steal ──
    if (pendingEffect?.type === 'move_self_steal_unicorn' && pendingEffect.playerId === effectivePid) {
      if (tgtPid && pid === tgtPid) {
        send({ type:'resolve_effect', selectedCardIds:[], extra:{ targetPlayerId:tgtPid, targetCardId:cid } });
        setTgtPid(null); setTgtCid(null);
        return;
      }
    }

    // ── Choice-card follow-up target selection (cards whose A/B option needs a
    //    stable-card target that the generic Choice A/B buttons can't supply) ──
    if (pendingEffect?.type === 'choice_steal_baby_or_revive_basic' && pendingEffect.playerId === effectivePid && choiceStep === 'a') {
      send({ type:'resolve_effect', selectedCardIds:[], extra:{ choice:'a', targetPlayerId:pid, targetCardId:cid } });
      setChoiceStep(null); return;
    }
    if (pendingEffect?.type === 'choice_steal_upgrade_or_move_downgrade' && pendingEffect.playerId === effectivePid) {
      if (choiceStep === 'a') {
        send({ type:'resolve_effect', selectedCardIds:[], extra:{ choice:'a', targetPlayerId:pid, targetCardId:cid } });
        setChoiceStep(null); return;
      }
      if (choiceStep === 'b_pick_card' && pid === effectivePid) {
        setChoiceStep({ choice:'b', cardId:cid }); return;
      }
    }
    if (pendingEffect?.type === 'choice_sacrifice_downgrade_or_return_hand' && pendingEffect.playerId === effectivePid && pid === effectivePid && (choiceStep === 'a' || choiceStep === 'b')) {
      send({ type:'resolve_effect', selectedCardIds:[], extra:{ choice:choiceStep, targetCardId:cid } });
      setChoiceStep(null); return;
    }

    if (needsStableClick || needsDestroyStep) {
      send({ type:'resolve_effect', selectedCardIds:[], extra:{ targetPlayerId:pid, targetCardId:cid } });
      setTgtPid(null); setTgtCid(null); return;
    }
    if (needsSacrifice && pid === effectivePid) {
      send({ type:'resolve_effect', selectedCardIds:[cid] }); return;
    }
  };

  const sendChat = () => {
    if (!chat.trim()) return;
    send({ type:'chat', text:chat });
    setChatLog(p => [...p.slice(-50), { name:me?.name, text:chat }]);
    setChat('');
  };

  const phaseLabel = { beginning:'Beginning', draw:'Draw ↓', action:'Action ▶', end:'End', game_over:'Game Over' }[phase] || phase;
  const isHost = state.players[playerId]?.isHost;

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden', flexDirection:'column' }}>
      {showLeave && <LeaveConfirm onConfirm={onLeave} onCancel={()=>setShowLeave(false)} />}
      {zoomedCard && <CardZoom card={zoomedCard} artMap={artMap} onClose={()=>setZoomedCard(null)} />}
      {showDiscardPile && (
        <DiscardPileBrowser
          pile={state.discardPile||[]}
          artMap={artMap}
          onZoom={c=>{ setZoomedCard(c); }}
          onClose={()=>setShowDiscardPile(false)}
        />
      )}

      {/* Header */}
      <div className="game-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', rowGap:6, padding:'7px 14px', background:'rgba(0,0,0,0.5)', borderBottom:'1px solid var(--c-border)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', rowGap:6 }}>
          <button className="btn btn-secondary" style={{ fontSize:11, padding:'5px 10px' }} onClick={()=>setShowLeave(true)}>← Menu</button>
          <span style={{ fontSize:18 }}>🦄</span>
          <span className="font-title game-header-title" style={{ fontSize:15, color:'var(--c-purple)' }}>Unstable Unicorns</span>
          {localMode && <span style={{ fontSize:10, background:'rgba(79,255,160,0.15)', color:'var(--c-green)', borderRadius:4, padding:'2px 6px', fontWeight:700 }}>🖥️ LOCAL</span>}
          {debugMode && <button className="btn btn-secondary" style={{ fontSize:10, padding:'3px 8px', color:'var(--c-orange)' }} onClick={()=>setShowDebug(v=>!v)}>🐛 DEBUG</button>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', rowGap:6 }}>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',rowGap:6}}>
            <span style={{ fontSize:11, color:'var(--c-muted)' }}>📦{state.deckCount} <span style={{cursor:'pointer',textDecoration:'underline dotted'}} onClick={()=>setShowDiscardPile(true)} title="Browse discard pile">🗑{state.discardCount}</span>{state.removedFromGameCount>0?` 🚫${state.removedFromGameCount}`:''}</span>
            {state.discardTop && (
              <div style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer'}}
                onMouseEnter={()=>setHoverCard(state.discardTop)}
                onMouseLeave={()=>setHoverCard(h=>h?.id===state.discardTop?.id?null:h)}
                onClick={()=>setZoomedCard(state.discardTop)}>
                <span className="game-header-topLabel" style={{fontSize:9,color:'var(--c-muted)'}}>top:</span>
                <GameCard card={state.discardTop} small artMap={artMap} />
              </div>
            )}
          </div>
          <span style={{ background: isMyTurn?'rgba(79,255,160,0.15)':'rgba(180,79,255,0.12)', color: isMyTurn?'var(--c-green)':'var(--c-purple)', borderRadius:6, padding:'3px 10px', fontWeight:700, textTransform:'uppercase', fontSize:10, whiteSpace:'nowrap' }}>
            {isMyTurn ? '👑 Your Turn' : `${currentPlayer?.name||'?'}'s Turn`} — {phaseLabel}
          </span>
        </div>
      </div>

      {/* Local mode: player switcher */}
      {localMode && (
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', background:'rgba(79,255,160,0.06)', borderBottom:'1px solid rgba(79,255,160,0.15)', flexShrink:0 }}>
          <span style={{ fontSize:11, color:'var(--c-green)', fontWeight:700 }}>🖥️ Viewing as:</span>
          {state.playerOrder.map(pid => (
            <button key={pid} onClick={()=>{ setLocalViewPid(pid); setSelCardId(null); setTargetMode(null); setTgtPid(null); setTgtCid(null); }}
              style={{ fontSize:11, padding:'3px 10px', borderRadius:6, border:`2px solid ${pid===effectivePid?'var(--c-green)':'rgba(255,255,255,0.1)'}`,
                background: pid===effectivePid?'rgba(79,255,160,0.2)':'transparent',
                color: pid===effectivePid?'var(--c-green)':'var(--c-muted)',
                cursor:'pointer', fontWeight: pid===effectivePid?800:400,
                outline: state.currentPlayer===pid?'2px solid rgba(255,224,102,0.5)':'none' }}>
              {state.players[pid].name}{state.currentPlayer===pid?' 👑':''}
            </button>
          ))}
        </div>
      )}

      {/* Debug panel */}
      {debugMode && showDebug && (
        <div style={{ background:'rgba(255,154,60,0.08)', borderBottom:'1px solid rgba(255,154,60,0.3)', padding:'8px 14px', flexShrink:0 }}>
          <div style={{ fontSize:11, color:'var(--c-orange)', fontWeight:800, marginBottom:8 }}>🐛 Debug Panel (host only)</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            <button className="btn btn-secondary" style={{ fontSize:10 }} onClick={()=>send({type:'debug_action',action:'skip_turn',payload:{}})}>⏭ Skip Turn</button>
            <button className="btn btn-secondary" style={{ fontSize:10 }} onClick={()=>send({type:'debug_action',action:'set_phase',payload:{phase:'action'}})}>→ Force Action Phase</button>
            <button className="btn btn-secondary" style={{ fontSize:10 }} onClick={()=>send({type:'debug_action',action:'clear_pending',payload:{}})}>✕ Clear Pending</button>
            <button className="btn btn-danger" style={{ fontSize:10 }} onClick={()=>{ if(window.confirm('Win the game now?')) send({type:'debug_action',action:'win_now',payload:{playerId:effectivePid}}); }}>🏆 Win Now</button>
          </div>
          {state.debugInfo?.deckTop?.length > 0 && (
            <div style={{ marginTop:8 }}>
              <div style={{ fontSize:10, color:'var(--c-muted)', marginBottom:4 }}>Top 10 deck cards (click to draw to current player):</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                {state.debugInfo.deckTop.map(c => (
                  <button key={c.id} onClick={()=>send({type:'debug_action',action:'draw_specific',payload:{cardId:c.id,targetPlayerId:effectivePid}})}
                    style={{ fontSize:10, padding:'3px 7px', borderRadius:5, border:'1px solid rgba(255,154,60,0.3)', background:'rgba(255,154,60,0.08)', color:'var(--c-text)', cursor:'pointer' }}>
                    {c.emoji} {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="game-board-inner" style={{ display:'flex', flex:1, overflow:'hidden' }}>
        {/* Board area */}
        <div className="game-board-main" style={{ flex:1, overflowY:'auto', padding:10, display:'flex', flexDirection:'column', gap:8 }}>

          {/* Player target picker banner — hidden in 2-player (auto-selects above) */}
          {targetMode === 'player' && opponents.length > 1 && (
            <div style={{ background:'rgba(255,224,102,0.1)', border:'2px solid rgba(255,224,102,0.4)', borderRadius:12, padding:'10px 14px' }}>
              <div style={{ fontWeight:800, color:'var(--c-yellow)', marginBottom:8, fontSize:13 }}>🎯 Choose a player to target:</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {opponents.map(pid => (
                  <button key={pid} className="btn btn-danger" style={{ fontSize:12 }} onClick={()=>{ setTgtPid(pid); setTargetMode(null); }}>
                    {state.players[pid].name}
                  </button>
                ))}
                <button className="btn btn-secondary" style={{ fontSize:12 }} onClick={()=>{ setTargetMode(null); setSelCardId(null); }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Neigh window */}
          {neighWindow && (
            <div className="animate-bounce-in" style={{ background:'linear-gradient(135deg,rgba(255,154,60,0.15),rgba(255,85,85,0.15))', border:'2px solid rgba(255,154,60,0.5)', borderRadius:12, padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div>
                <div style={{ fontWeight:800, fontSize:13, marginBottom:4 }}>
                  {state.players[state.pendingCardPlayerId]?.name} is playing…
                </div>
                {state.pendingCard && (
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <GameCard card={state.pendingCard} small artMap={artMap} />
                    <div>
                      <div style={{ fontWeight:700, fontSize:12 }}>{state.pendingCard.emoji} {state.pendingCard.name}</div>
                      <div style={{ fontSize:10, color:'var(--c-muted)', marginTop:2, maxWidth:200 }}>{state.pendingCard.description?.slice(0,80)}</div>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0 }}>
                {hasNeigh && state.pendingCardPlayerId !== effectivePid && (
                  myNeighOptions.length > 1
                    ? myNeighOptions.map(c => (
                        <button key={c.id} className="btn btn-neigh" style={{fontSize:11}} onClick={()=>send({ type:'play_neigh', cardId:c.id })}>
                          🙅 {c.name}!
                        </button>
                      ))
                    : <button className="btn btn-neigh" onClick={()=>send({ type:'play_neigh', cardId:myNeigh.id })}>🙅 Neigh!</button>
                )}
                {neighBlocked && state.pendingCardPlayerId !== effectivePid && (
                  <div style={{ fontSize:10, color:'var(--c-muted)', textAlign:'center', maxWidth:120 }}>🚫 Ginormous Unicorn — can't play Neigh cards</div>
                )}
                {state.pendingCardPlayerId === effectivePid
                  ? <button className="btn btn-success" onClick={()=>send({ type:'resolve_neigh' })}>✓ Let it play</button>
                  : !hasNeigh && !neighBlocked && <div style={{ fontSize:11, color:'var(--c-muted)', textAlign:'center' }}>Waiting for {currentPlayer?.name}…</div>
                }
              </div>
            </div>
          )}

          {/* Neigh-war window — the Neigh that was just played can itself be Neighed, and so on */}
          {superNeighWindow && (
            <div className="animate-bounce-in" style={{ background:'linear-gradient(135deg,rgba(180,79,255,0.18),rgba(255,85,85,0.15))', border:'2px solid rgba(180,79,255,0.5)', borderRadius:12, padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div>
                <div style={{ fontWeight:800, fontSize:13, marginBottom:4 }}>
                  {state.neighChainLength > 1
                    ? `${state.players[state.superNeighPlayerId]?.name} Neighed that Neigh right back!`
                    : `${state.players[state.superNeighPlayerId]?.name} Neighed ${state.players[state.pendingCardPlayerId]?.name}'s ${state.pendingCard?.name}!`}
                </div>
                {state.superNeighCard && (
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <GameCard card={state.superNeighCard} small artMap={artMap} />
                    <div>
                      <div style={{ fontWeight:700, fontSize:12 }}>{state.superNeighCard.emoji} {state.superNeighCard.name}</div>
                      <div style={{ fontSize:10, color:'var(--c-muted)', marginTop:2, maxWidth:220 }}>Can this Neigh itself be Neighed?</div>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0 }}>
                {hasNeigh && state.superNeighPlayerId !== effectivePid && (
                  myNeighOptions.length > 1
                    ? myNeighOptions.map(c => (
                        <button key={c.id} className="btn btn-neigh" style={{fontSize:11}} onClick={()=>send({ type:'play_neigh', cardId:c.id })}>
                          🙅 {c.name}!
                        </button>
                      ))
                    : (
                      <button className="btn btn-neigh" onClick={()=>send({ type:'play_neigh', cardId:myNeigh.id })}>
                        🙅 Neigh it back!
                      </button>
                    )
                )}
                {neighBlocked && state.superNeighPlayerId !== effectivePid && (
                  <div style={{ fontSize:10, color:'var(--c-muted)', textAlign:'center', maxWidth:130 }}>🚫 Ginormous Unicorn — can't play Neigh cards</div>
                )}
                {state.superNeighPlayerId === effectivePid
                  ? <button className="btn btn-success" onClick={()=>send({ type:'resolve_neigh' })}>✓ Let it stand</button>
                  : !hasNeigh && !neighBlocked && <div style={{ fontSize:11, color:'var(--c-muted)', textAlign:'center' }}>Waiting for {state.players[state.superNeighPlayerId]?.name}…</div>
                }
              </div>
            </div>
          )}

          {/* Pending effect banner */}
          {pendingEffect && !neighWindow && !superNeighWindow && (
            <div className="animate-bounce-in" style={{ background: isMyEffect ? 'rgba(255,224,102,0.07)' : 'rgba(180,79,255,0.07)', border:`2px solid ${isMyEffect ? 'rgba(255,224,102,0.35)' : 'rgba(180,79,255,0.35)'}`, borderRadius:12, padding:'12px 16px' }}>
              <div style={{ fontWeight:800, color: isMyEffect ? 'var(--c-yellow)' : 'var(--c-purple)', marginBottom:8, fontSize:13 }}>
                {isMyEffect ? '⚡' : `⏳ ${state.players[pendingEffect.playerId]?.name||'?'} must:`} {
                  pendingEffect.type==='search_deck_pick'             ? `Choose a card from the deck to ${pendingEffect.intoStable?'add to stable':'add to hand'}:` :
                  pendingEffect.type==='from_discard_pick'            ? `Choose from discard pile to ${pendingEffect.intoStable?'revive into stable':'add to hand'}:` :
                  pendingEffect.type==='end_discard'                  ? `Discard ${pendingEffect.amount} card(s) to hand limit` :
                  pendingEffect.type==='discard'                      ? `Discard ${pendingEffect.amount} card(s)` :
                  pendingEffect.type==='discard_choice'                ? `${pendingEffect.source||'Effect'} — choose ${pendingEffect.amount} card(s) to DISCARD:` :
                  pendingEffect.type==='discard_extra_turn_pending'   ? `Discard ${pendingEffect.amount} cards to take an extra turn` :
                  pendingEffect.type==='choose_destroy'               ? 'Click any card in any stable to DESTROY it' :
                  pendingEffect.type==='choose_steal'                 ? 'Click any card in any stable to STEAL it' :
                  pendingEffect.type==='choose_return'                ? 'Click any card in any stable to RETURN to hand' :
                  needsSacrifice                                      ? 'Click a unicorn in YOUR stable to SACRIFICE it' :
                  needsDestroyStep                                    ? 'Now click any card in any stable to DESTROY' :
                  pendingEffect.type==='beginning_optional_choices'   ? 'Beginning phase — choose effects to activate:' :
                  pendingEffect.type==='beginning_destroy_end_turn'   ? 'DESTROY a unicorn to end your turn early (or skip):' :
                  pendingEffect.type==='look_top_keep_one'            ? 'Pick 1 card to keep from top of deck:' :
                  pendingEffect.type==='look_deck_return_order'       ? 'Click cards in order you want them on top:' :
                  pendingEffect.type==='look_and_take'                ? `Viewing ${state.players[pendingEffect.targetPlayerId]?.name}'s hand — click to take or skip:` :
                  pendingEffect.type==='take_one_from_list'           ? 'Choose one of the discarded cards to keep:' :
                  pendingEffect.type==='sacrifice_then_revive'        ? (pendingEffect.step==='sacrifice'?'Click a unicorn in YOUR stable to SACRIFICE:':'Pick a unicorn from discard to revive:') :
                  pendingEffect.type==='sacrifice_then_destroy_two'   ? 'Click a card in YOUR stable to SACRIFICE (then destroy 2):' :
                  pendingEffect.type==='sacrifice_then_destroy_one'   ? (pendingEffect.sacrificeDone?'Now click any card in any stable to DESTROY':'Click a card in YOUR stable to SACRIFICE (then destroy 1):') :
                  pendingEffect.type==='sacrifice_unicorn_destroy_unicorn' ? (pendingEffect.sacrificeDone?'Now click a unicorn to DESTROY':'Click a unicorn in YOUR stable to SACRIFICE:') :
                  pendingEffect.type==='sacrifice_n_destroy_n'        ? (pendingEffect.sacrificeDone?`Now click ${pendingEffect.destroyCount} card(s) to DESTROY`:'Click unicorns in YOUR stable to select (multi-select), then Confirm:') :
                  pendingEffect.type==='discard_then_steal'           ? (pendingEffect.discardDone?'Now click a card in any stable to STEAL':'Select a card to DISCARD first:') :
                  pendingEffect.type==='discard_n_steal_unicorn'      ? (pendingEffect.discardDone?'Now click a unicorn to STEAL':`Select ${pendingEffect.needed||2} cards to DISCARD:`) :
                  pendingEffect.type==='discard_two_steal_any'        ? (pendingEffect.discardDone?'Now click any card to STEAL':'Select 2 cards to DISCARD:') :
                  pendingEffect.type==='discard_two_destroy_unicorn'  ? (pendingEffect.discardDone?'Now click a unicorn to DESTROY':'Select 2 cards to DISCARD:') :
                  pendingEffect.type==='discard_then_nursery'         ? 'Select a card to DISCARD, then receive a Baby Unicorn:' :
                  pendingEffect.type==='discard_two_bring_two_babies' ? (pendingEffect.discardDone?'Getting 2 babies…':'Select 2 cards to DISCARD:') :
                  pendingEffect.type==='discard_remove_from_game'     ? (pendingEffect.discardDone?'Now click any card to REMOVE FROM GAME':'Select a card to DISCARD first:') :
                  pendingEffect.type==='discard_look_top_three_keep_one' ? (pendingEffect.discardDone?'Pick 1 card to keep:':'Select a card to DISCARD first:') :
                  pendingEffect.type==='discard_then_search_upgrade_into_stable' ? (pendingEffect.discardDone?'Choose an Upgrade from the deck:':'Select a card to DISCARD:') :
                  pendingEffect.type==='discard_search_magic_play'    ? (pendingEffect.discardDone?'Choose a Magic card to play:':'Select a card to DISCARD:') :
                  pendingEffect.type==='move_downgrade_to_opponent'   ? 'Select a Downgrade from YOUR stable + click target player button:' :
                  pendingEffect.type==='move_downgrade_steal_upgrade' ? 'Orcicorn Raider — move a Downgrade to another player, optionally steal an Upgrade back:' :
                  pendingEffect.type==='move_own_card_pull_from_that_player' ? 'Gift Receipt — give a card from your stable, then pull a random card from their hand:' :
                  pendingEffect.type==='destroy_upgrade_or_sacrifice_downgrade' ? `Click any Upgrade to DESTROY or any Downgrade to SACRIFICE${pendingEffect.optional?' (or skip)':''}:` :
                  pendingEffect.type==='move_upgrade_or_downgrade_between_stables' ? (moveUpgState ? `Step 2: Click any card in the TARGET stable to move it there:` : 'Step 1: Click an Upgrade or Downgrade in any stable to pick it up:') :
                  pendingEffect.type==='move_own_unicorn_steal_unicorn' ? (!swapState ? 'Unicorn Swap — Step 1: Click a Unicorn in YOUR stable to move away:' : 'Unicorn Swap — Step 2: Click a Unicorn in the TARGET stable to STEAL:') :
                  pendingEffect.type==='move_unicorn_any_stable_not_own' ? (!dominatrixState ? `Dominatrix Whip — Step 1: Click a Unicorn in ANY stable to move${pendingEffect.optional?' (or skip below)':''}:` : 'Dominatrix Whip — Step 2: Choose which player receives it:') :
                  pendingEffect.type==='steal_downgrade'              ? 'Click a Downgrade in any stable to STEAL it:' :
                  pendingEffect.type==='steal_baby'                   ? 'Click a Baby Unicorn in any stable to STEAL it:' :
                  pendingEffect.type==='move_hand_to_bottom_deck'     ? 'Select a card from your hand to move to bottom of deck:' :
                  pendingEffect.type==='play_upgrade_from_hand'       ? 'Select an Upgrade from your hand to play free:' :
                  pendingEffect.type==='return_one_each_stable'       ? `Glitter Tornado — click a highlighted card in any remaining stable (${(pendingEffect.remaining||[]).map(p=>state.players[p]?.name).join(', ')}) to return it to hand:` :
                  pendingEffect.type==='all_may_destroy_unicorn'      ? 'Optionally click a unicorn to DESTROY (or skip):' :
                  pendingEffect.type==='may_destroy_optional'         ? 'Optionally click a card to DESTROY (or skip):' :
                  pendingEffect.type==='sacrifice_four_search_four'   ? (pendingEffect.sacrificeDone?'Getting unicorns from deck…':'Select up to 4 unicorns from YOUR stable to SACRIFICE:') :
                  pendingEffect.type==='sacrifice_revive_upgrade_from_discard' ? (pendingEffect.sacrificeDone?'Choose an Upgrade from discard:':'Select a card from YOUR stable to SACRIFICE:') :
                  pendingEffect.type==='destroy_three_add_three_babies'? 'Click a player to A Cute Attack (destroy 3 unicorns, give 3 babies):' :
                  pendingEffect.type==='destroy_all_basics_one_player'? 'Click a player to DESTROY all their Basic Unicorns:' :
                  pendingEffect.type==='sacrifice_magical_search_basic'? 'Select a Magical Unicorn from YOUR stable to SACRIFICE:' :
                  pendingEffect.type==='target_discard'               ? 'Select a card from your hand to DISCARD:' :
                  pendingEffect.type==='discard_n_others_discard_n'   ? 'Select any number of cards to DISCARD (opponents discard same):' :
                  pendingEffect.type==='discard_n_draw_n_extra_turn'  ? 'Select any number of cards to DISCARD (draw same + extra turn):' :
                  pendingEffect.type==='fuck_marry_kill'              ? (!pendingEffect.step1Done?'Select a card from hand to GIVE to a player:':'Now click a unicorn to DESTROY:') :
                  pendingEffect.type==='sacrifice_n_destroy_n'        ? 'Select unicorns to sacrifice:' :
                  pendingEffect.type==='choose_players_draw_each'     ? 'Choose which players each draw 1 card (Unicorn Rainbow Princess):' :
                  pendingEffect.type==='discard_unicorn_revive_unicorn_end_turn' ? (!pendingEffect.discardDone?'Select a Unicorn from hand to DISCARD, then revive one (Zombie Unicorn — ends your turn):':'Pick a unicorn from discard to REVIVE into your stable:') :
                  pendingEffect.type==='sacrifice_self_take_extra_turn'       ? "Dragon's Fortune — Sacrifice this upgrade for an EXTRA TURN? (or skip):" :
                  pendingEffect.type==='move_unicorn_to_deck_draw'             ? 'Dragon Skies — Click a unicorn to move to bottom of deck (owner draws 1):' :
                  pendingEffect.type==='nursery_skip_action'                   ? 'Special Delivery — Take Baby from nursery + skip Action phase? (or skip):' :
                  pendingEffect.type==='force_opponent_discard'                ? 'Bitchiest Unicorn — Click an opponent player to force discard 1:' :
                  pendingEffect.type==='move_self_steal_unicorn'               ? 'Polyamorous Unicorn — Click a target player (optionally steal their unicorn):' :
                  pendingEffect.type==='pull_random_skip_draw'                 ? 'Pony Play — Click a target player to pull random (they skip draw):' :
                  pendingEffect.type==='steal_basic_temp'                      ? 'Naked Narwhal — Click a Basic Unicorn to steal until your next turn:' :
                  pendingEffect.type==='steal_baby_temp'                       ? 'Free Candy Unicorn — Click a Baby Unicorn to steal until your next turn:' :
                  pendingEffect.type==='sacrifice_unicorn_draw_three'          ? 'Ancient Ritual — Select a Unicorn in YOUR stable to SACRIFICE, then draw 3:' :
                  pendingEffect.type==='sacrifice_self_steal_unicorn'          ? (!pendingEffect.sacrificeDone ? 'Pit Covered in Leaves — sacrificing itself...' : 'Now click a unicorn to STEAL:') :
                  pendingEffect.type==='pull_random_instead_of_draw'           ? 'Royal Hooves — Click a target player to pull random (skips your draw phase):' :
                  pendingEffect.type==='discard_pull_random_from_opponent'     ? (!pendingEffect.discardDone ? 'Vagabond Unicorn — Select a card to DISCARD:' : 'Now click a target player to pull random from:') :
                  pendingEffect.type==='discard_then_sacrifice_downgrade'      ? (!pendingEffect.discardDone ? 'Survivalist Unicorn — Select a card to DISCARD:' : 'Click a Downgrade in any stable to SACRIFICE:') :
                  pendingEffect.type==='choice_steal_baby_or_revive_basic'     ? 'Cutthroat Captain — Choose [a] Steal Baby Unicorn  or  [b] Revive Basic from discard:' :
                  pendingEffect.type==='choice_discard_hand_draw3_or_trade_hands' ? 'Hornswoggler — Choose [a] Discard hand draw 3  or  [b] Trade hands with a player:' :
                  pendingEffect.type==='choice_steal_upgrade_or_move_downgrade'? 'Pillaging Pirate — Choose [a] Steal Upgrade  or  [b] Move Downgrade to opponent:' :
                  pendingEffect.type==='choice_force_all_discard_or_draw'      ? 'Salty Seadogicorn — Choose [a] Force all opponents discard 1  or  [b] All draw 1:' :
                  pendingEffect.type==='choice_sacrifice_destroy_or_revive_from_discard' ? 'Glowing Horn — Choose [a] Sacrifice+Destroy  or  [b] Revive unicorn from discard:' :
                  pendingEffect.type==='choice_draw3_discard1_or_add_from_discard' ? 'Metal Detector — Choose [a] Draw 3 discard 1  or  [b] Take card from discard:' :
                  pendingEffect.type==='choice_discard3_extra_turn_or_move_steal_unicorn' ? 'Mysterious Compass — Choose [a] Discard 3 + extra turn  or  [b] Move unicorn + steal one:' :
                  pendingEffect.type==='choice_reveal_all_hands_or_take_from_all' ? 'Silver Tongue — Choose [a] Reveal all hands  or  [b] Take 1 from each opponent:' :
                  pendingEffect.type==='choice_revive_unicorn_or_two_unicorns_to_hand' ? 'Unicorn Shovel — Choose [a] Revive unicorn into stable  or  [b] 2 unicorns to hand:' :
                  pendingEffect.type==='choice_sacrifice_downgrade_or_return_hand' ? 'Bungee Jumping — Choose [a] Sacrifice Downgrade  or  [b] Return card to hand:' :
                  pendingEffect.type==='choice_draw_two_or_play_basic'         ? 'First Mer-mate — Choose [a] Draw 2  or  [b] Play Basic Unicorn free:' :
                  pendingEffect.type==='skip_draw_pull_random'                 ? 'Poltergeist Swipe — Click a target player to pull random (you skip draw phase):' :
                  pendingEffect.type==='discard_three_remove_from_game'        ? (!pendingEffect.discardDone ? 'Strange Craft Project — Select 3 cards to DISCARD:' : 'Click a card in DISCARD PILE to remove from game:') :
                  pendingEffect.type==='sacrifice_unicorn_or_self_return'      ? 'Buried Alive — Choose [a] Sacrifice unicorn  or  [b] Sacrifice Buried Alive + return card from discard:' :
                  pendingEffect.type==='discard_for_extra_turn'                ? 'Select cards to DISCARD for an extra turn:' :
                  pendingEffect.type==='choose_opponent_discard'               ? `Annoying Flying Unicorn — Click an opponent to force them to DISCARD ${pendingEffect.amount||1} card (or skip):` :
                  pendingEffect.type==='choose_opponent_pull_random'           ? 'Americorn — Choose a player to pull a random card from their hand (or skip):' :
                  pendingEffect.type==='take_from_nursery'                     ? 'Mother Goose Unicorn — Bring a Baby Unicorn from the Nursery into your Stable?' :
                  pendingEffect.type==='play_basic_from_hand'                  ? 'Rainbow Unicorn — Choose a Basic Unicorn from your hand to bring into your Stable (or skip):' :
                  pendingEffect.type==='draw_per_basic_in_stable'              ? `Chainsaw Massicorn — Draw ${pendingEffect.amount} card${pendingEffect.amount===1?'':'s'} (1 per Basic Unicorn in your Stable)?` :
                  pendingEffect.type==='discard_then_draw_beginning'        ? (me?.hand?.length ? 'Claw Machine — Select a card to DISCARD (then draw 1):' : 'Claw Machine — no cards to discard, skipping:') :
                  pendingEffect.type==='critical_hit_optional'                 ? '⚔️ Critical Hit — Sacrifice this card to replay the last Magic card? (or skip):' :
                  pendingEffect.type==='sacrifice_self_destroy_unicorn'        ? '🦈 Shark With a Horn — Sacrifice this card, then DESTROY a Unicorn card? (or skip):' :
                  pendingEffect.type==='draw_reveal_if_unicorn_upgrade_downgrade_into_stable' ? '🎒 Stowaway Unicorn — Draw a card and reveal it? (or skip):' :
                  pendingEffect.type==='draw_n_optional'                       ? `Draw ${pendingEffect.amount||1} card${(pendingEffect.amount||1)===1?'':'s'}? (or skip):` :
                  pendingEffect.type==='intercept_offer'                       ? `🎣 Intercept! Someone is about to ${pendingEffect.kind==='steal'?'STEAL':'SACRIFICE/DESTROY'} a card — play your counter-instant? (or let it happen):` :
                  'Resolve effect'

                }
              </div>

              {/* Search deck pick */}
              {pendingEffect.type==='search_deck_pick' && pendingEffect.options && (
                <div>
                  <div style={{fontSize:11,color:'var(--c-muted)',marginBottom:6}}>{pendingEffect.options.length} card{pendingEffect.options.length!==1?'s':''} found — click one to take it:</div>
                  <div className="card-row" style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8,maxHeight:200,overflowY:'auto'}}>
                    {pendingEffect.options.map(c=>(
                      <div key={c.id} onMouseEnter={()=>setHoverCard(c)} onMouseLeave={()=>setHoverCard(null)} style={{cursor:'pointer'}}
                        onClick={()=>send({type:'resolve_effect',selectedCardIds:[c.id]})}>
                        <GameCard card={c} small artMap={artMap} selectable />
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>Skip</button>
                </div>
              )}

              {/* From discard pick */}
              {pendingEffect.type==='from_discard_pick' && pendingEffect.options && (
                <div>
                  <div style={{fontSize:11,color:'var(--c-muted)',marginBottom:6}}>{pendingEffect.options.length} card{pendingEffect.options.length!==1?'s':''} in discard — click one:</div>
                  <div className="card-row" style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8,maxHeight:200,overflowY:'auto'}}>
                    {pendingEffect.options.map(c=>(
                      <div key={c.id} onMouseEnter={()=>setHoverCard(c)} onMouseLeave={()=>setHoverCard(null)} style={{cursor:'pointer'}}
                        onClick={()=>send({type:'resolve_effect',selectedCardIds:[c.id]})}>
                        <GameCard card={c} small artMap={artMap} selectable />
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>Skip</button>
                </div>
              )}

              {/* Beginning optional choices */}
              {pendingEffect.type==='beginning_optional_choices' && pendingEffect.choices && (
                <div>
                  <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:8}}>
                    {pendingEffect.choices.map(ch=>{
                      const stableCard = me?.stable?.find(c=>c.id===ch.cardId);
                      return (
                        <div key={ch.cardId}
                          onMouseEnter={()=>stableCard&&setHoverCard(stableCard)}
                          onMouseLeave={()=>setHoverCard(null)}
                          style={{fontSize:12,padding:'6px 8px',borderRadius:8,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',cursor:'default'}}>
                          <strong>{ch.cardName}</strong>: {ch.description?.slice(0,80)}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {pendingEffect.choices.length > 1 && (
                      <button className="btn btn-primary" style={{fontSize:11}}
                        onClick={()=>send({type:'resolve_effect',selectedCardIds:pendingEffect.choices.map(c=>c.cardId)})}>
                        ✓ Activate All
                      </button>
                    )}
                    {pendingEffect.choices.map(ch=>(
                      <button key={ch.cardId} className="btn btn-primary" style={{fontSize:11}}
                        onClick={()=>send({type:'resolve_effect',selectedCardIds:[ch.cardId]})}>
                        Activate {ch.cardName}
                      </button>
                    ))}
                    <button className="btn btn-secondary" style={{fontSize:11}}
                      onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>Skip All</button>
                  </div>
                </div>
              )}

              {/* Rhinocorn: beginning destroy end turn */}
              {pendingEffect.type==='beginning_destroy_end_turn' && (
                <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>Skip</button>
              )}

              {/* Look top keep one */}
              {pendingEffect.type==='look_top_keep_one' && pendingEffect.options && (
                <div>
                  <div className="card-row" style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8}}>
                    {pendingEffect.options.map(c=>(
                      <div key={c.id} onMouseEnter={()=>setHoverCard(c)} onMouseLeave={()=>setHoverCard(null)} style={{cursor:'pointer'}}
                        onClick={()=>send({type:'resolve_effect',selectedCardIds:[c.id]})}>
                        <GameCard card={c} small artMap={artMap} selectable />
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>Return all</button>
                </div>
              )}

              {/* Look deck return order */}
              {(pendingEffect.type==='look_deck_return_order'||pendingEffect.type==='look_deck_return_same') && pendingEffect.options && (
                <div>
                  <div className="card-row" style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8}}>
                    {pendingEffect.options.map((c,i)=>(
                      <div key={c.id} onMouseEnter={()=>setHoverCard(c)} onMouseLeave={()=>setHoverCard(null)}
                        style={{cursor:'pointer',position:'relative'}}
                        onClick={()=>{
                          if(pendingEffect.type!=='look_deck_return_same'){
                            const cur=selCardId?selCardId.split(',').filter(Boolean):[];
                            if(!cur.includes(c.id)) setSelCardId([...cur,c.id].join(','));
                          }
                        }}>
                        <GameCard card={c} small artMap={artMap} selectable={pendingEffect.type!=='look_deck_return_same'} selected={selCardId?.includes(c.id)} />
                        {selCardId?.includes(c.id) && (
                          <div style={{position:'absolute',top:2,left:2,background:'var(--c-purple)',color:'white',borderRadius:'50%',width:14,height:14,fontSize:8,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800}}>
                            {selCardId.split(',').indexOf(c.id)+1}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {pendingEffect.type==='look_deck_return_same'
                    ? <button className="btn btn-primary" style={{fontSize:11}} onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>OK (return as-is)</button>
                    : <div style={{display:'flex',gap:6}}>
                        <button className="btn btn-primary" style={{fontSize:11}}
                          disabled={(selCardId?.split(',').filter(Boolean).length||0)!==pendingEffect.options.length}
                          onClick={()=>{send({type:'resolve_effect',selectedCardIds:selCardId?.split(',').filter(Boolean)||[]});setSelCardId(null);}}>
                          ✓ Confirm Order
                        </button>
                        <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>Return as-is</button>
                      </div>
                  }
                </div>
              )}

              {/* Look and take */}
              {pendingEffect.type==='look_and_take' && pendingEffect.revealedHand && (
                <div>
                  <div className="card-row" style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8}}>
                    {pendingEffect.revealedHand.map(c=>(
                      <div key={c.id} onMouseEnter={()=>setHoverCard(c)} onMouseLeave={()=>setHoverCard(null)} style={{cursor:'pointer'}}
                        onClick={()=>send({type:'resolve_effect',selectedCardIds:[c.id]})}>
                        <GameCard card={c} small artMap={artMap} selectable />
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>Skip</button>
                </div>
              )}

              {/* Take one from list */}
              {pendingEffect.type==='take_one_from_list' && pendingEffect.options && (
                <div>
                  <div className="card-row" style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8}}>
                    {pendingEffect.options.map(c=>(
                      <div key={c.id} onMouseEnter={()=>setHoverCard(c)} onMouseLeave={()=>setHoverCard(null)} style={{cursor:'pointer'}}
                        onClick={()=>send({type:'resolve_effect',selectedCardIds:[c.id]})}>
                        <GameCard card={c} small artMap={artMap} selectable />
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>Skip</button>
                </div>
              )}

              {/* Hand discard (select from hand then confirm) — single card only */}
              {(['discard','end_discard','discard_extra_turn_pending','target_discard',
                'discard_then_draw_beginning','discard_choice'].includes(pendingEffect.type) ||
                (['discard_then_steal','discard_remove_from_game','discard_then_nursery',
                  'discard_look_top_three_keep_one','discard_then_search_upgrade_into_stable',
                  'discard_search_magic_play','discard_unicorn_revive_unicorn_end_turn',
                  'discard_pull_random_from_opponent','discard_then_sacrifice_downgrade',
                  'move_hand_to_bottom_deck','play_upgrade_from_hand',
                 ].includes(pendingEffect.type) && !pendingEffect.discardDone)
              ) && !isMultiSelEffect && (
                <>
                  <button className="btn btn-danger" disabled={!selCardId} style={{marginTop:4}}
                    onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[selCardId]}); setSelCardId(null); }}>
                    {pendingEffect.type==='move_hand_to_bottom_deck' ? 'Move Selected Card to Bottom of Deck'
                      : pendingEffect.type==='play_upgrade_from_hand' ? 'Play Selected Card'
                      : 'Discard Selected Card'}
                  </button>
                  {pendingEffect.type==='discard_then_draw_beginning' && (
                    <button className="btn btn-secondary" style={{fontSize:11,marginTop:4}}
                      onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>
                      Skip (hand empty)
                    </button>
                  )}
                  {pendingEffect.optional && pendingEffect.type!=='discard_then_draw_beginning' && (
                    <button className="btn btn-secondary" style={{fontSize:11,marginTop:4}}
                      onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}}); setSelCardId(null); }}>
                      Skip
                    </button>
                  )}
                </>
              )}

              {/* Multi-discard: confirm selection from hand */}
              {isMultiSelEffect && !pendingEffect.sacrificeDone && !pendingEffect.discardDone && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:4}}>
                  <button className="btn btn-danger" disabled={multiSelIds.length===0}
                    onClick={()=>{ send({type:'resolve_effect',selectedCardIds:multiSelIds}); setMultiSelIds([]); }}>
                    Confirm Selection ({multiSelIds.length}{pendingEffect.amount ? ` / ${pendingEffect.amount}` : ''} selected)
                  </button>
                  {['discard_n_others_discard_n','discard_n_draw_n_extra_turn','discard_up_to_two_force_sacrifice',
                    'discard','end_discard'].includes(pendingEffect.type) && (
                    <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>{send({type:'resolve_effect',selectedCardIds:[]});setMultiSelIds([]);}}>Discard 0</button>
                  )}
                  {pendingEffect.optional && (
                    <button className="btn btn-secondary" style={{fontSize:11}}
                      onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}}); setMultiSelIds([]); }}>
                      Skip
                    </button>
                  )}
                </div>
              )}

              {/* Optional destroy/skip */}
              {(pendingEffect.type==='all_may_destroy_unicorn'||pendingEffect.type==='may_destroy_optional') && (
                <button className="btn btn-secondary" style={{fontSize:11,marginTop:4}}
                  onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{}})}>Skip (don't destroy)</button>
              )}

              {/* Player target buttons */}
              {['destroy_three_add_three_babies','destroy_all_basics_one_player'].includes(pendingEffect.type) && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:4}}>
                  {opponents.map(p=>(
                    <button key={p} className="btn btn-danger" style={{fontSize:11}}
                      onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{targetPlayerId:p}})}>
                      Target {state.players[p].name}
                    </button>
                  ))}
                </div>
              )}

              {/* choose_players_draw_each: multi-checkbox player picker (Unicorn Rainbow Princess) */}
              {pendingEffect.type==='choose_players_draw_each' && (
                <div>
                  <div style={{fontSize:11,color:'var(--c-muted)',marginBottom:6}}>Check players who will draw 1 card:</div>
                  <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:8}}>
                    {state.playerOrder.map(p=>(
                      <label key={p} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,padding:'4px 8px',borderRadius:6,background:chosenPlayerIds.includes(p)?'rgba(180,79,255,0.18)':'rgba(255,255,255,0.04)',border:`1px solid ${chosenPlayerIds.includes(p)?'rgba(180,79,255,0.5)':'rgba(255,255,255,0.08)'}`}}>
                        <input type="checkbox" checked={chosenPlayerIds.includes(p)} onChange={()=>setChosenPlayerIds(prev=>prev.includes(p)?prev.filter(x=>x!==p):[...prev,p])} />
                        {state.players[p].name}{p===effectivePid?' (you)':''}
                      </label>
                    ))}
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    <button className="btn btn-primary" style={{fontSize:11}}
                      onClick={()=>{send({type:'resolve_effect',selectedCardIds:[],extra:{chosenPlayerIds}});setChosenPlayerIds([]);}}>
                      ✓ Confirm ({chosenPlayerIds.length} draw)
                    </button>
                    <button className="btn btn-secondary" style={{fontSize:11}}
                      onClick={()=>{send({type:'resolve_effect',selectedCardIds:[],extra:{chosenPlayerIds:[]}});setChosenPlayerIds([]);}}>
                      Skip (none draw)
                    </button>
                  </div>
                </div>
              )}

              {/* ── Choice card A/B buttons ───────────────────────────────────── */}
              {[
                'choice_steal_baby_or_revive_basic',
                'choice_discard_hand_draw3_or_trade_hands',
                'choice_steal_upgrade_or_move_downgrade',
                'choice_force_all_discard_or_draw',
                'choice_sacrifice_destroy_or_revive_from_discard',
                'choice_draw3_discard1_or_add_from_discard',
                'choice_discard3_extra_turn_or_move_steal_unicorn',
                'choice_reveal_all_hands_or_take_from_all',
                'choice_revive_unicorn_or_two_unicorns_to_hand',
                'choice_sacrifice_downgrade_or_return_hand',
                'choice_draw_two_or_play_basic',
              ].includes(pendingEffect?.type) && !choiceStep && (() => {
                const labelMap = {
                  choice_steal_baby_or_revive_basic:['Steal Baby Unicorn','Revive Basic from Discard'],
                  choice_discard_hand_draw3_or_trade_hands:['Discard Hand, Draw 3','Trade Hands with Player'],
                  choice_steal_upgrade_or_move_downgrade:['Steal an Upgrade','Move a Downgrade to Opponent'],
                  choice_force_all_discard_or_draw:['Force All Opponents Discard 1','All Players Draw 1'],
                  choice_sacrifice_destroy_or_revive_from_discard:['Sacrifice + Destroy Unicorn','Revive Unicorn from Discard'],
                  choice_draw3_discard1_or_add_from_discard:['Draw 3, Discard 1','Take Card from Discard'],
                  choice_discard3_extra_turn_or_move_steal_unicorn:['Discard 3, Extra Turn','Move Own Unicorn + Steal One'],
                  choice_reveal_all_hands_or_take_from_all:['Reveal All Hands','Take 1 from Each Opponent'],
                  choice_revive_unicorn_or_two_unicorns_to_hand:['Revive Unicorn into Stable','Return 2 Unicorns to Hand'],
                  choice_sacrifice_downgrade_or_return_hand:['Sacrifice a Downgrade','Return a Card to Hand'],
                  choice_draw_two_or_play_basic:['Draw 2 Cards','Play Basic Unicorn Free'],
                };
                const [labelA, labelB] = labelMap[pendingEffect.type] || ['Option A','Option B'];
                // Options that need a stable/hand/player target beyond the button
                // click itself are routed into a follow-up picker (choiceStep) —
                // see the "Choice-card follow-up" block below and the matching
                // cases in handleStableClick — instead of sending an incomplete
                // resolve_effect that the server can only ever reject.
                const followupA = ['choice_steal_baby_or_revive_basic','choice_steal_upgrade_or_move_downgrade','choice_sacrifice_downgrade_or_return_hand'].includes(pendingEffect.type);
                const followupB = ['choice_discard_hand_draw3_or_trade_hands','choice_steal_upgrade_or_move_downgrade','choice_sacrifice_downgrade_or_return_hand','choice_draw_two_or_play_basic'].includes(pendingEffect.type);
                return (
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                    <button className="btn btn-primary" style={{fontSize:12}}
                      onClick={()=> followupA
                        ? setChoiceStep('a')
                        : send({type:'resolve_effect',selectedCardIds:multiSelIds.length?multiSelIds:selCardId?[selCardId]:[],extra:{choice:'a',targetPlayerId:tgtPid}})}>
                      A: {labelA}
                    </button>
                    <button className="btn btn-secondary" style={{fontSize:12}}
                      onClick={()=> followupB
                        ? setChoiceStep(pendingEffect.type==='choice_steal_upgrade_or_move_downgrade' ? 'b_pick_card' : 'b')
                        : send({type:'resolve_effect',selectedCardIds:[],extra:{choice:'b',targetPlayerId:tgtPid}})}>
                      B: {labelB}
                    </button>
                    <button className="btn btn-secondary" style={{fontSize:11,opacity:0.6}}
                      onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                      Skip
                    </button>
                  </div>
                );
              })()}

              {/* ── Choice-card follow-up target selection ──────────────────────
                  Cutthroat Captain (A: steal a Baby Unicorn from any stable) */}
              {choiceStep === 'a' && pendingEffect?.type === 'choice_steal_baby_or_revive_basic' && (
                <div style={{marginTop:6}}>
                  <div style={{fontSize:11,color:'var(--c-yellow)',marginBottom:6}}>👆 Click a Baby Unicorn in any stable to STEAL</div>
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>setChoiceStep(null)}>✕ Cancel</button>
                </div>
              )}

              {/* Pillaging Pirate (A: steal an Upgrade from any stable) */}
              {choiceStep === 'a' && pendingEffect?.type === 'choice_steal_upgrade_or_move_downgrade' && (
                <div style={{marginTop:6}}>
                  <div style={{fontSize:11,color:'var(--c-yellow)',marginBottom:6}}>👆 Click an Upgrade in any stable to STEAL</div>
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>setChoiceStep(null)}>✕ Cancel</button>
                </div>
              )}
              {/* Pillaging Pirate (B step 1: click your own Downgrade to move) */}
              {choiceStep === 'b_pick_card' && pendingEffect?.type === 'choice_steal_upgrade_or_move_downgrade' && (
                <div style={{marginTop:6}}>
                  <div style={{fontSize:11,color:'var(--c-yellow)',marginBottom:6}}>👆 Click a Downgrade in YOUR stable to move</div>
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>setChoiceStep(null)}>✕ Cancel</button>
                </div>
              )}
              {/* Pillaging Pirate (B step 2: pick which opponent receives it) */}
              {choiceStep?.choice === 'b' && choiceStep?.cardId && pendingEffect?.type === 'choice_steal_upgrade_or_move_downgrade' && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {opponents.map(p=>(
                    <button key={p} className="btn btn-danger" style={{fontSize:11}}
                      onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[choiceStep.cardId],extra:{choice:'b',targetPlayerId:p}}); setChoiceStep(null); }}>
                      Move downgrade to {state.players[p]?.name}
                    </button>
                  ))}
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>setChoiceStep(null)}>✕ Cancel</button>
                </div>
              )}

              {/* Hornswoggler (B: pick a player to trade hands with) */}
              {choiceStep === 'b' && pendingEffect?.type === 'choice_discard_hand_draw3_or_trade_hands' && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {opponents.map(p=>(
                    <button key={p} className="btn btn-danger" style={{fontSize:11}}
                      onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[],extra:{choice:'b',targetPlayerId:p}}); setChoiceStep(null); }}>
                      Trade hands with {state.players[p]?.name}
                    </button>
                  ))}
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>setChoiceStep(null)}>✕ Cancel</button>
                </div>
              )}

              {/* Bungee Jumping (A: sacrifice own Downgrade / B: return own card to hand) */}
              {(choiceStep === 'a' || choiceStep === 'b') && pendingEffect?.type === 'choice_sacrifice_downgrade_or_return_hand' && (
                <div style={{marginTop:6}}>
                  <div style={{fontSize:11,color:'var(--c-yellow)',marginBottom:6}}>
                    👆 {choiceStep==='a' ? 'Click a Downgrade in YOUR stable to SACRIFICE' : 'Click any card in YOUR stable to return to hand'}
                  </div>
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>setChoiceStep(null)}>✕ Cancel</button>
                </div>
              )}

              {/* First Mer-mate (B: select a Basic Unicorn from hand, then confirm) */}
              {choiceStep === 'b' && pendingEffect?.type === 'choice_draw_two_or_play_basic' && (
                <div style={{marginTop:6}}>
                  <div style={{fontSize:11,color:'var(--c-yellow)',marginBottom:6}}>Select a Basic Unicorn from your hand, then confirm:</div>
                  <button className="btn btn-danger" disabled={!selCardId}
                    onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[selCardId],extra:{choice:'b'}}); setSelCardId(null); setChoiceStep(null); }}>
                    Play Selected Card
                  </button>
                  <button className="btn btn-secondary" style={{fontSize:11,marginLeft:6}} onClick={()=>setChoiceStep(null)}>✕ Cancel</button>
                </div>
              )}

              {/* ── Opponent-picker for single-target beginning effects ──────────
                  The Bitchiest Unicorn / Pony Play / Royal Hooves / Poltergeist Swipe:
                  each needs exactly one target player and nothing else. */}
              {['force_opponent_discard','pull_random_skip_draw','pull_random_instead_of_draw','skip_draw_pull_random']
                .includes(pendingEffect?.type) && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {opponents.map(p=>(
                    <button key={p} className="btn btn-danger" style={{fontSize:11}}
                      onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{targetPlayerId:p}})}>
                      Target {state.players[p]?.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Polyamorous Unicorn: pick which player's stable to move to, then optionally steal a unicorn from them */}
              {pendingEffect?.type==='move_self_steal_unicorn' && !tgtPid && (
                <div style={{marginTop:6}}>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {opponents.map(p=>(
                      <button key={p} className="btn btn-primary" style={{fontSize:11}}
                        onClick={()=>setTgtPid(p)}>
                        → {state.players[p]?.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {pendingEffect?.type==='move_self_steal_unicorn' && tgtPid && (
                <div style={{fontSize:11,color:'var(--c-yellow)',marginTop:6}}>
                  👆 Optionally click a unicorn in {state.players[tgtPid]?.name}'s stable to also STEAL it (or <button className="btn btn-secondary" style={{fontSize:10,padding:'2px 6px',display:'inline'}} onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[],extra:{targetPlayerId:tgtPid}}); setTgtPid(null); }}>move only, no steal</button>)
                </div>
              )}

              {/* White Elephantcorn / Playful Puppet Unicorn / Orcicorn Raider / Gift Receipt:
                  step 1 prompt + step 2 opponent picker (+ step 3 for Orcicorn Raider's optional steal) */}
              {['move_downgrade_to_opponent','move_downgrade_steal_upgrade','move_own_card_pull_from_that_player'].includes(pendingEffect?.type) && !downgradeMoveState && (
                <div style={{fontSize:11,color:'var(--c-yellow)',marginTop:6}}>
                  👆 Click a {pendingEffect.type==='move_own_card_pull_from_that_player' ? 'card' : 'Downgrade'} in YOUR stable to move
                </div>
              )}
              {['move_downgrade_to_opponent','move_own_card_pull_from_that_player'].includes(pendingEffect?.type) && downgradeMoveState && !downgradeMoveState.targetPlayerId && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {opponents.map(p=>(
                    <button key={p} className="btn btn-danger" style={{fontSize:11}}
                      onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[downgradeMoveState.cardId],extra:{targetPlayerId:p}}); setDowngradeMoveState(null); }}>
                      Move to {state.players[p]?.name}
                    </button>
                  ))}
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>setDowngradeMoveState(null)}>✕ Cancel</button>
                </div>
              )}
              {pendingEffect?.type==='move_downgrade_steal_upgrade' && downgradeMoveState && !downgradeMoveState.targetPlayerId && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {opponents.map(p=>(
                    <button key={p} className="btn btn-primary" style={{fontSize:11}}
                      onClick={()=>setDowngradeMoveState(s=>({...s,targetPlayerId:p}))}>
                      → {state.players[p]?.name}
                    </button>
                  ))}
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>setDowngradeMoveState(null)}>✕ Cancel</button>
                </div>
              )}
              {pendingEffect?.type==='move_downgrade_steal_upgrade' && downgradeMoveState?.targetPlayerId && (
                <div style={{fontSize:11,color:'var(--c-yellow)',marginTop:6}}>
                  👆 Optionally click an Upgrade in {state.players[downgradeMoveState.targetPlayerId]?.name}'s stable to also STEAL it (or <button className="btn btn-secondary" style={{fontSize:10,padding:'2px 6px',display:'inline'}} onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[downgradeMoveState.cardId],extra:{targetPlayerId:downgradeMoveState.targetPlayerId}}); setDowngradeMoveState(null); }}>move only, no steal</button>)
                </div>
              )}

              {/* ── Skip buttons for optional beginning effects ───────────────── */}
              {['sacrifice_self_take_extra_turn','move_unicorn_to_deck_draw',
                'nursery_skip_action','force_opponent_discard','move_self_steal_unicorn',
                'pull_random_skip_draw','sacrifice_unicorn_draw_three','sacrifice_self_steal_unicorn',
                'pull_random_instead_of_draw','discard_pull_random_from_opponent',
                'discard_then_sacrifice_downgrade','skip_draw_pull_random',
                'discard_three_remove_from_game','sacrifice_unicorn_or_self_return',
                'choose_opponent_discard',
              ].includes(pendingEffect?.type) && (
                <button className="btn btn-secondary" style={{fontSize:11,marginTop:6}}
                  onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                  Skip
                </button>
              )}

              {/* ── Annoying Flying Unicorn: pick opponent to force discard ─── */}
              {pendingEffect?.type==='choose_opponent_discard' && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {opponents.map(p=>(
                    <button key={p} className="btn btn-danger" style={{fontSize:11}}
                      onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{targetPlayerId:p}})}>
                      Force {state.players[p]?.name} to discard
                    </button>
                  ))}
                </div>
              )}

              {/* ── Vagabond Unicorn: pick opponent to pull a random card from (after discard) ── */}
              {pendingEffect?.type==='discard_pull_random_from_opponent' && pendingEffect.discardDone && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {opponents.map(p=>(
                    <button key={p} className="btn btn-danger" style={{fontSize:11}}
                      onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{targetPlayerId:p}})}>
                      Pull random from {state.players[p]?.name}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Americorn: pick opponent to pull a random card from ──────── */}
              {pendingEffect?.type==='choose_opponent_pull_random' && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {opponents.map(p=>(
                    <button key={p} className="btn btn-danger" style={{fontSize:11}}
                      onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{targetPlayerId:p}})}>
                      Pull random from {state.players[p]?.name}
                    </button>
                  ))}
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Mother Goose Unicorn: confirm/skip, no selection needed ──── */}
              {pendingEffect?.type==='take_from_nursery' && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  <button className="btn btn-primary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>
                    🍼 Bring a Baby Unicorn from the Nursery
                  </button>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Chainsaw Massicorn: confirm/skip, no selection needed ────── */}
              {pendingEffect?.type==='draw_per_basic_in_stable' && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  <button className="btn btn-primary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[]})}>
                    🎴 Draw {pendingEffect.amount} card{pendingEffect.amount===1?'':'s'}
                  </button>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Rainbow Unicorn: pick a Basic Unicorn from hand, then confirm ── */}
              {pendingEffect?.type==='play_basic_from_hand' && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  <button className="btn btn-danger" disabled={!selCardId} style={{fontSize:11}}
                    onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[selCardId]}); setSelCardId(null); }}>
                    Play Selected Basic Unicorn
                  </button>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Dominatrix Whip: step 1 skip (optional effect, no valid/desired move) ── */}
              {pendingEffect?.type==='move_unicorn_any_stable_not_own' && !dominatrixState && pendingEffect.optional && (
                <div style={{marginTop:6}}>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Dominatrix Whip: step 2 — pick destination player (any stable but your own) ── */}
              {pendingEffect?.type==='move_unicorn_any_stable_not_own' && dominatrixState && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {opponents.map(p=>(
                    <button key={p} className="btn btn-danger" style={{fontSize:11}}
                      onClick={()=>{
                        send({type:'resolve_effect',selectedCardIds:[dominatrixState.sourceCardId],
                          extra:{sourcePlayerId:dominatrixState.sourcePlayerId,targetPlayerId:p}});
                        setDominatrixState(null);
                      }}>
                      Move to {state.players[p]?.name}
                    </button>
                  ))}
                  <button className="btn btn-secondary" style={{fontSize:11}} onClick={()=>setDominatrixState(null)}>
                    ✕ Cancel
                  </button>
                </div>
              )}

              {/* ── Critical Hit: activate or skip ───────────────────────────── */}
              {pendingEffect?.type==='critical_hit_optional' && isMyEffect && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                  <button className="btn btn-primary" style={{fontSize:12}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{}})}>
                    ⚔️ Activate — Sacrifice Critical Hit, replay last Magic
                  </button>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Shark With a Horn: activate (sacrifice, then destroy) or skip ── */}
              {pendingEffect?.type==='sacrifice_self_destroy_unicorn' && isMyEffect && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                  <button className="btn btn-primary" style={{fontSize:12}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{}})}>
                    🦈 Activate — Sacrifice this card, then DESTROY a Unicorn
                  </button>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Stowaway Unicorn: activate (draw + reveal) or skip ─────────── */}
              {pendingEffect?.type==='draw_reveal_if_unicorn_upgrade_downgrade_into_stable' && isMyEffect && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                  <button className="btn btn-primary" style={{fontSize:12}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{}})}>
                    🎒 Activate — Draw and reveal a card
                  </button>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Dragon Turtle Unicorn / Paranormal Affection: optional draw ── */}
              {pendingEffect?.type==='draw_n_optional' && isMyEffect && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                  <button className="btn btn-primary" style={{fontSize:12}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{}})}>
                    🃏 Draw {pendingEffect.amount||1} card{(pendingEffect.amount||1)>1?'s':''}
                  </button>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Chainsaw Unicorn / Targeted Destruction etc: optional skip ── */}
              {pendingEffect?.type==='destroy_upgrade_or_sacrifice_downgrade' && pendingEffect.optional && isMyEffect && (
                <div style={{marginTop:6}}>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── choose_destroy / choose_steal / choose_return: "you may" skip ──
                  (e.g. Stabby the Unicorn, Dragon Unicorn, Berserkercorn, Paladin
                  Unicorn, Alluring Narwhal, Shark With a Horn) — these previously had
                  no way to decline at all, forcing a target pick even on cards whose
                  text says "you may". ──────────────────────────────────────────── */}
              {['choose_destroy','choose_steal','choose_return'].includes(pendingEffect?.type) && pendingEffect.optional && isMyEffect && (
                <div style={{marginTop:6}}>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── move_upgrade_or_downgrade_between_stables: optional skip ──── */}
              {pendingEffect?.type==='move_upgrade_or_downgrade_between_stables' && pendingEffect.optional && isMyEffect && !moveUpgState && (
                <div style={{marginTop:6}}>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Generic fallback: any other optional ("you may") pendingEffect
                  that doesn't already render its own skip control above. Sending
                  extra:{skip:true} is safe even for types that don't recognize it —
                  the server just returns an error, which surfaces as a toast rather
                  than corrupting any state — so this is a safety net for the long
                  tail of "you may" cards rather than a promise every one has been
                  individually verified. ─────────────────────────────────────────── */}
              {pendingEffect?.optional && isMyEffect && ![
                'search_deck_pick','from_discard_pick','beginning_optional_choices','beginning_destroy_end_turn',
                'look_top_keep_one','look_deck_return_order','look_deck_return_same','look_and_take','take_one_from_list',
                'discard','end_discard','discard_extra_turn_pending','target_discard','discard_then_draw_beginning','discard_choice',
                'discard_n_others_discard_n','discard_n_draw_n_extra_turn','discard_up_to_two_force_sacrifice',
                'all_may_destroy_unicorn','may_destroy_optional','choose_players_draw_each',
                'choice_steal_baby_or_revive_basic','choice_discard_hand_draw3_or_trade_hands','choice_steal_upgrade_or_move_downgrade',
                'choice_force_all_discard_or_draw','choice_sacrifice_destroy_or_revive_from_discard','choice_draw3_discard1_or_add_from_discard',
                'choice_discard3_extra_turn_or_move_steal_unicorn','choice_reveal_all_hands_or_take_from_all',
                'choice_revive_unicorn_or_two_unicorns_to_hand','choice_sacrifice_downgrade_or_return_hand','choice_draw_two_or_play_basic',
                'sacrifice_self_take_extra_turn','move_unicorn_to_deck_draw','nursery_skip_action','force_opponent_discard',
                'move_self_steal_unicorn','pull_random_skip_draw','sacrifice_unicorn_draw_three','sacrifice_self_steal_unicorn',
                'pull_random_instead_of_draw','discard_pull_random_from_opponent','discard_then_sacrifice_downgrade',
                'skip_draw_pull_random','discard_three_remove_from_game','sacrifice_unicorn_or_self_return','choose_opponent_discard',
                'critical_hit_optional','destroy_upgrade_or_sacrifice_downgrade','intercept_offer','move_self_steal_and_draw',
                'sacrifice_self_destroy_unicorn','draw_reveal_if_unicorn_upgrade_downgrade_into_stable','draw_n_optional',
                'choose_destroy','choose_steal','choose_return','move_upgrade_or_downgrade_between_stables','choose_opponent_pull_random',
              ].includes(pendingEffect.type) && (
                <div style={{marginTop:6}}>
                  <button className="btn btn-secondary" style={{fontSize:11}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{skip:true}})}>
                    Skip
                  </button>
                </div>
              )}

              {/* ── Intercept offer: play counter-instant (Fishing Rod / Unicorn Net) or decline ── */}
              {pendingEffect?.type==='intercept_offer' && isMyEffect && (() => {
                const cardName = pendingEffect.kind==='steal' ? 'Fishing Rod' : 'Unicorn Net';
                const cardEmoji = me?.hand?.find(c=>c.id===pendingEffect.interceptCardId)?.emoji || '🎣';
                const actionLabel = pendingEffect.kind==='steal'
                  ? 'move it into YOUR stable instead'
                  : 'add it to YOUR hand instead';
                return (
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                    <button className="btn btn-primary" style={{fontSize:12}}
                      onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{intercept:true}})}>
                      {cardEmoji} Play {cardName} — {actionLabel}
                    </button>
                    <button className="btn btn-secondary" style={{fontSize:11}}
                      onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{intercept:false}})}>
                      Let it happen
                    </button>
                  </div>
                );
              })()}

              {/* ── Buried Alive A/B ─────────────────────────────────────────── */}
              {pendingEffect?.type==='sacrifice_unicorn_or_self_return' && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                  <button className="btn btn-danger" style={{fontSize:12}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:selCardId?[selCardId]:[],extra:{choice:'a'}})}>
                    A: Sacrifice Unicorn
                  </button>
                  <button className="btn btn-secondary" style={{fontSize:12}}
                    onClick={()=>send({type:'resolve_effect',selectedCardIds:[],extra:{choice:'b'}})}>
                    B: Sacrifice Buried Alive
                  </button>
                </div>
              )}

              {/* ── Temp steal confirm buttons ────────────────────────────────── */}
              {(pendingEffect?.type==='steal_basic_temp'||pendingEffect?.type==='steal_baby_temp') && (
                <div style={{fontSize:11,color:'var(--c-muted)',marginTop:6}}>
                  👆 Click a {pendingEffect.type==='steal_basic_temp'?'Basic':'Baby'} Unicorn in an opponent's stable
                </div>
              )}

              {/* fuck_marry_kill step 1: give a card — show player picker below hand selection */}

              {pendingEffect.type==='fuck_marry_kill' && !pendingEffect.step1Done && selCardId && (
                <div style={{marginTop:8}}>
                  {soloOpponent ? (
                    // 2-player: auto-fire immediately
                    (() => { setTimeout(()=>{ send({type:'resolve_effect',selectedCardIds:[selCardId],extra:{targetPlayerId:soloOpponent}}); setSelCardId(null); },0); return null; })()
                  ) : (
                    <>
                      <div style={{fontSize:11,color:'var(--c-muted)',marginBottom:5}}>Now choose who to give it to:</div>
                      <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                        {opponents.map(p=>(
                          <button key={p} className="btn btn-primary" style={{fontSize:11}}
                            onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[selCardId],extra:{targetPlayerId:p}}); setSelCardId(null); }}>
                            Give to {state.players[p].name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* fuck_marry_kill step 2: destroy a unicorn — prompt is via needsDestroyStep / stable click */}
              {pendingEffect.type==='fuck_marry_kill' && pendingEffect.step1Done && (
                <div style={{fontSize:11,color:'var(--c-yellow)',marginTop:6}}>
                  👆 Click a unicorn in any stable to DESTROY it
                </div>
              )}

              {/* move_upgrade_or_downgrade_between_stables: two-step status */}
              {pendingEffect.type==='move_upgrade_or_downgrade_between_stables' && (
                <div style={{marginTop:6}}>
                  {moveUpgState ? (
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      <div style={{fontSize:11,color:'var(--c-green)'}}>✓ Card selected — now click any card in the destination stable</div>
                      <button className="btn btn-secondary" style={{fontSize:10}} onClick={()=>setMoveUpgState(null)}>✕ Cancel</button>
                    </div>
                  ) : (
                    <div style={{fontSize:11,color:'var(--c-muted)'}}>Click any Upgrade (green) or Downgrade (red) card in any stable to pick it up</div>
                  )}
                </div>
              )}

              {/* move_own_unicorn_steal_unicorn (Unicorn Swap): two-step status */}
              {pendingEffect.type==='move_own_unicorn_steal_unicorn' && (
                <div style={{marginTop:6}}>
                  {swapState ? (
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      <div style={{fontSize:11,color:'var(--c-green)'}}>✓ Your Unicorn selected — now click a Unicorn in the TARGET stable to steal</div>
                      <button className="btn btn-secondary" style={{fontSize:10}} onClick={()=>setSwapState(null)}>✕ Cancel</button>
                    </div>
                  ) : (
                    <div style={{fontSize:11,color:'var(--c-muted)'}}>Click a Unicorn in your own stable to move it to another player</div>
                  )}
                </div>
              )}

              {/* move_self_steal_and_draw: player picker then unicorn picker */}
              {pendingEffect.type==='move_self_steal_and_draw' && !tgtPid && (
                <div style={{marginTop:6}}>
                  <div style={{fontSize:11,color:'var(--c-muted)',marginBottom:5}}>Choose which player's stable to move to (then pick a unicorn to steal):</div>
                  <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                    {opponents.map(p=>(
                      <button key={p} className="btn btn-primary" style={{fontSize:11}}
                        onClick={()=>setTgtPid(p)}>
                        → {state.players[p].name}
                      </button>
                    ))}
                    <button className="btn btn-secondary" style={{fontSize:11}}
                      onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[],extra:{targetPlayerId:opponents[0],skip:true}}); }}>
                      Skip
                    </button>
                  </div>
                </div>
              )}
              {pendingEffect.type==='move_self_steal_and_draw' && tgtPid && (
                <div style={{fontSize:11,color:'var(--c-yellow)',marginTop:6}}>
                  👆 Now click a unicorn in {state.players[tgtPid]?.name}'s stable to STEAL (or <button className="btn btn-secondary" style={{fontSize:10,padding:'2px 6px',display:'inline'}} onClick={()=>{ send({type:'resolve_effect',selectedCardIds:[],extra:{targetPlayerId:tgtPid}}); setTgtPid(null); }}>skip steal</button>)
                </div>
              )}
            </div>
          )}

          {/* Opponents' stables */}
          <div>
            <div style={{ fontSize:10, color:'var(--c-muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>Opponents</div>
            <div className="game-board-opponents" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:8 }}>
              {state.playerOrder.filter(pid=>pid!==effectivePid).map(pid => (
                <Stable key={pid} player={state.players[pid]} isMe={false} artMap={artMap}
                  highlight={targetMode==='stable' || needsStableClick || needsDestroyStep ||
                    ['steal_downgrade','steal_baby','beginning_destroy_end_turn','may_destroy_optional',
                     'all_may_destroy_unicorn','choose_destroy','choose_steal',
                     'move_upgrade_or_downgrade_between_stables',
                     'destroy_upgrade_or_sacrifice_downgrade',
                     'move_self_steal_and_draw'].includes(pendingEffect?.type) ||
                    (pendingEffect?.type==='move_self_steal_and_draw' && pid===tgtPid) ||
                    (pendingEffect?.type==='move_self_steal_unicorn' && pid===tgtPid) ||
                    (pendingEffect?.type==='move_downgrade_steal_upgrade' && pid===downgradeMoveState?.targetPlayerId) ||
                    (pendingEffect?.type==='move_own_unicorn_steal_unicorn' && !!swapState) ||
                    (pendingEffect?.type==='move_unicorn_any_stable_not_own' && !dominatrixState) ||
                    (pendingEffect?.type==='return_one_each_stable' && pendingEffect?.remaining?.includes(pid))}
                  onCardSelect={handleStableClick} selectedCardId={tgtCid}
                  winCondition={winCondition}
                  onHover={setHoverCard}
                  onZoom={setZoomedCard}
                />
              ))}
            </div>
          </div>

          {/* My stable */}
          {me && (
            <div>
              <div style={{ fontSize:10, color:'var(--c-muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>
                {me.name}'s Stable {localMode && effectivePid!==playerId ? '(viewing)' : '(you)'}
              </div>
              <Stable player={me} isMe={true} artMap={artMap} winCondition={winCondition}
                highlight={needsSacrifice || ((pendingEffect?.type==='destroy_upgrade_or_sacrifice_downgrade' || pendingEffect?.type==='beginning_destroy_end_turn') && pendingEffect?.playerId===effectivePid) || (pendingEffect?.type==='move_own_unicorn_steal_unicorn' && !swapState && pendingEffect?.playerId===effectivePid) || (pendingEffect?.type==='move_unicorn_any_stable_not_own' && !dominatrixState && pendingEffect?.playerId===effectivePid) || (['move_downgrade_to_opponent','move_downgrade_steal_upgrade','move_own_card_pull_from_that_player'].includes(pendingEffect?.type) && !downgradeMoveState && pendingEffect?.playerId===effectivePid) || (pendingEffect?.type==='return_one_each_stable' && pendingEffect?.remaining?.includes(effectivePid))}
                onCardSelect={handleStableClick}
                selectedCardId={tgtCid}
                onHover={setHoverCard}
                onZoom={setZoomedCard}
                allowOwnClick={needsSacrifice||((pendingEffect?.type==='move_upgrade_or_downgrade_between_stables'||pendingEffect?.type==='destroy_upgrade_or_sacrifice_downgrade'||pendingEffect?.type==='beginning_destroy_end_turn')&&pendingEffect?.playerId===effectivePid)||(pendingEffect?.type==='move_own_unicorn_steal_unicorn'&&!swapState&&pendingEffect?.playerId===effectivePid)||(pendingEffect?.type==='move_unicorn_any_stable_not_own'&&!dominatrixState&&pendingEffect?.playerId===effectivePid)||(['move_downgrade_to_opponent','move_downgrade_steal_upgrade','move_own_card_pull_from_that_player'].includes(pendingEffect?.type)&&!downgradeMoveState&&pendingEffect?.playerId===effectivePid)||(pendingEffect?.type==='return_one_each_stable'&&pendingEffect?.remaining?.includes(effectivePid))}
              />
            </div>
          )}

          {/* Game log */}
          <div>
            <div style={{ fontSize:10, color:'var(--c-muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>Game Log</div>
            <GameLog log={state.log} />
          </div>
        </div>

        {/* Right sidebar — hand + actions + chat */}
        <div className="game-board-sidebar" style={{ width:268, flexShrink:0, borderLeft:'1px solid var(--c-border)', display:'flex', flexDirection:'column', overflow:'hidden', background:'rgba(0,0,0,0.25)' }}>
          <div style={{ flex:1, overflowY:'auto', padding:10 }}>
            <div style={{ fontSize:10, color:'var(--c-muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:7 }}>
              {me?.name}'s Hand ({me?.hand?.length||0}){(me?.handLimit||7)<7?` · limit ${me.handLimit}`:''}
            </div>

            {/* Last played card — distinct from the full discard pile below */}
            {state.discardTop && !hoverCard && (
              <div style={{marginBottom:6,padding:'8px 10px',background:'rgba(255,255,255,0.04)',borderRadius:10,border:'1px solid var(--c-border)'}}>
                <div style={{fontSize:9,color:'var(--c-muted)',textTransform:'uppercase',letterSpacing:1,marginBottom:5}}>Last Played</div>
                <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                  <GameCard card={state.discardTop} artMap={artMap} />
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:800,fontSize:12,marginBottom:2}}>{state.discardTop.emoji} {state.discardTop.name}</div>
                    <div style={{fontSize:9,color:'var(--c-muted)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4}}>
                      {TYPE_LABEL[state.discardTop.type]}{state.discardTop.expansion ? ` · ${EXP_META[state.discardTop.expansion]?.name||state.discardTop.expansion}` : ''}
                    </div>
                    <div style={{fontSize:10,color:'var(--c-muted)',lineHeight:1.5}}>{state.discardTop.description}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Full discard pile browser — always available, not tied to any card effect */}
            <button className="btn btn-secondary" style={{ width:'100%', justifyContent:'center', fontSize:11, marginBottom:10 }}
              onClick={()=>setShowDiscardPile(true)}>
              🗑️ Browse Discard Pile ({state.discardCount||0})
            </button>



            {/* Hand cards */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:10 }}>
              {(me?.hand||[]).map(card => (
                <div key={card.id} style={{ position:'relative', display:'inline-block' }}
                  onMouseEnter={()=>setHoverCard(card)}
                  onMouseLeave={()=>setHoverCard(h=>h?.id===card.id?null:h)}
                  onContextMenu={e=>{ e.preventDefault(); setZoomedCard(card); }}
                >
                  <GameCard card={card} artMap={artMap}
                    selectable={(isMyTurn || isMyEffect) && (phase==='action' || phase==='end' || !!pendingEffect) && !neighWindow && !superNeighWindow}
                    selected={isMultiSelEffect ? multiSelIds.includes(card.id) : selCardId === card.id}
                    onClick={() => selectCard(card.id)}
                  />
                  {/* Zoom button — proper touch-target size, not the old ~10x10px hitbox */}
                  <ZoomButton card={card} onZoom={setZoomedCard} />
                </div>
              ))}
              {!me?.hand?.length && <div style={{ color:'var(--c-muted)', fontSize:11, fontStyle:'italic' }}>No cards in hand</div>}
            </div>

            {/* Card detail on hover */}
            {hoverCard && <CardDetail card={hoverCard} artMap={artMap} />}

            {/* Action buttons */}
            {isMyTurn && !neighWindow && !superNeighWindow && !pendingEffect && (
              <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:7 }}>
                {phase === 'draw' && (
                  <button className="btn btn-primary" style={{ justifyContent:'center' }} onClick={()=>send({ type:'draw_card' })}>
                    🎴 Draw Card
                  </button>
                )}
                {phase === 'action' && (
                  <>
                    {targetMode === 'stable' ? (
                      <>
                        <div style={{ fontSize:11, color:'var(--c-yellow)', background:'rgba(255,224,102,0.08)', borderRadius:8, padding:'7px 10px', lineHeight:1.5 }}>
                          🎯 Click a card in an opponent's stable to target it
                        </div>
                        <div style={{ display:'flex', gap:6 }}>
                          <button className="btn btn-primary" disabled={!tgtCid} onClick={handlePlayCard}>✓ Confirm Target</button>
                          <button className="btn btn-secondary" onClick={()=>{ setTargetMode(null); setSelCardId(null); setTgtPid(null); setTgtCid(null); }}>✕ Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-primary" disabled={!selCardId} onClick={handlePlayCard} style={{ justifyContent:'center' }}>
                          {selCard ? `▶ Play ${selCard.emoji} ${selCard.name}` : '▶ Select a card from hand'}
                        </button>
                        <button className="btn btn-secondary" onClick={()=>send({ type:'action_draw' })} style={{ justifyContent:'center' }}>
                          🎴 Draw instead
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Waiting indicator */}
            {(!isMyTurn || neighWindow) && !superNeighWindow && !pendingEffect && (
              <div style={{ marginTop:10, fontSize:11, color:'var(--c-muted)', textAlign:'center', background:'rgba(255,255,255,0.03)', borderRadius:8, padding:10 }}>
                {neighWindow && state.pendingCardPlayerId !== effectivePid
                  ? `${state.players[state.pendingCardPlayerId]?.name} is playing a card…`
                  : neighWindow
                    ? `Waiting to see if your card gets Neighed…`
                    : `Waiting for ${currentPlayer?.name}…`}
              </div>
            )}
          </div>

          {/* Chat */}
          <div style={{ borderTop:'1px solid var(--c-border)', padding:8, flexShrink:0 }}>
            <div style={{ fontSize:10, color:'var(--c-muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>Chat</div>
            <div ref={chatRef} style={{ height:68, overflowY:'auto', fontSize:11, lineHeight:1.7, marginBottom:6, color:'var(--c-muted)' }}>
              {chatLog.map((m,i) => <div key={i}><strong style={{ color:'var(--c-text)' }}>{m.name}:</strong> {m.text}</div>)}
            </div>
            <div style={{ display:'flex', gap:5 }}>
              <input className="input" style={{ fontSize:11, padding:'6px 8px' }} placeholder="Say something…"
                value={chat} onChange={e=>setChat(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') sendChat(); }}
              />
              <button className="btn btn-secondary" style={{ padding:'6px 8px', fontSize:11 }} onClick={sendChat}>↵</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
// ─── Spectator view (read-only, full hand reveal) ────────────────────────────
function SpectatorBoard({ state, onLeave }) {
  const [artMap] = useState(() => ArtStore.all());
  const { players, playerOrder, currentPlayer, phase, log, discardTop, discardCount, deckCount,
          spectatorCount, winner, winCondition, pendingEffect, neighWindow, superNeighWindow,
          pendingCard, pendingCardPlayerId, superNeighCard, superNeighPlayerId, neighChainLength } = state;
  const isUnicorn = t => t==='baby_unicorn' || t==='basic_unicorn' || t==='magical_unicorn';
  const isModifier = t => t==='upgrade' || t==='downgrade';

  return (
    <div style={{ maxWidth:1100, margin:'20px auto', padding:'0 16px 40px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:20 }}>👀 Spectating</div>
          <div style={{ fontSize:12, color:'var(--c-muted)' }}>
            Phase: {phase} · Turn: {players[currentPlayer]?.name || '—'}
            {spectatorCount != null && ` · ${spectatorCount} watching`}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={onLeave}>← Stop Watching</button>
      </div>

      {winner && (
        <div className="panel animate-bounce-in" style={{ padding:16, marginBottom:16, textAlign:'center', fontWeight:800, fontSize:15 }}>
          🎉 {players[winner]?.name} wins! (first to {winCondition} unicorns)
        </div>
      )}

      {neighWindow && (
        <div className="panel" style={{ padding:'10px 14px', marginBottom:16, fontSize:12, border:'1.5px solid rgba(255,154,60,0.5)' }}>
          🙅 {players[pendingCardPlayerId]?.name} is playing {pendingCard?.emoji} {pendingCard?.name} — waiting to see if it's Neighed…
        </div>
      )}
      {superNeighWindow && (
        <div className="panel" style={{ padding:'10px 14px', marginBottom:16, fontSize:12, border:'1.5px solid rgba(180,79,255,0.5)' }}>
          {neighChainLength > 1
            ? `🙅 ${players[superNeighPlayerId]?.name} Neighed that Neigh right back with ${superNeighCard?.name} — waiting to see if it's Neighed again…`
            : `🙅 ${players[superNeighPlayerId]?.name} Neighed ${players[pendingCardPlayerId]?.name}'s ${pendingCard?.name} with ${superNeighCard?.name} — waiting to see if it's Neighed again…`}
        </div>
      )}
      {pendingEffect && !neighWindow && !superNeighWindow && (
        <div className="panel" style={{ padding:'10px 14px', marginBottom:16, fontSize:12, border:'1.5px solid rgba(255,224,102,0.35)' }}>
          ⏳ {players[pendingEffect.playerId]?.name} must resolve: <span style={{ opacity:0.7 }}>{pendingEffect.type}</span>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:16, marginBottom:16 }}>
        {playerOrder.map(pid => {
          const p = players[pid];
          const isTurn = pid === currentPlayer;
          const unicorns = p.stable.filter(c => isUnicorn(c.type));
          const modifiers = p.stable.filter(c => isModifier(c.type));
          return (
            <div key={pid} className="panel" style={{ padding:12, border: isTurn ? '2px solid var(--c-purple)' : undefined }}>
              <div style={{ fontWeight:800, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span>{p.name}{isTurn ? ' 🎯' : ''}</span>
                <span style={{ fontSize:11, color:'var(--c-muted)' }}>{p.unicornCount}/{winCondition} 🦄</span>
              </div>
              <div style={{ fontSize:10, color:'var(--c-muted)', marginBottom:4, letterSpacing:0.5 }}>STABLE</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:8, minHeight:40 }}>
                {unicorns.length === 0 && <span style={{ fontSize:11, opacity:0.4 }}>(empty)</span>}
                {unicorns.map(c => <GameCard key={c.id} card={c} small artMap={artMap} />)}
              </div>
              {modifiers.length > 0 && (
                <>
                  <div style={{ fontSize:10, color:'var(--c-muted)', marginBottom:4, letterSpacing:0.5 }}>UPGRADES / DOWNGRADES</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:8 }}>
                    {modifiers.map(c => <GameCard key={c.id} card={c} small artMap={artMap} />)}
                  </div>
                </>
              )}
              <div style={{ fontSize:10, color:'var(--c-muted)', marginBottom:4, letterSpacing:0.5 }}>HAND ({p.handCount})</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                {(p.hand||[]).map(c => <GameCard key={c.id} card={c} small artMap={artMap} />)}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div className="panel" style={{ padding:12 }}>
          <div style={{ fontWeight:800, marginBottom:8, fontSize:12, letterSpacing:0.5 }}>DECK & DISCARD</div>
          <div style={{ fontSize:12, color:'var(--c-muted)', marginBottom:8 }}>Deck: {deckCount} cards · Discard: {discardCount} cards</div>
          {discardTop && <GameCard card={discardTop} small artMap={artMap} />}
        </div>
        <div className="panel" style={{ padding:12, maxHeight:220, overflowY:'auto' }}>
          <div style={{ fontWeight:800, marginBottom:8, fontSize:12, letterSpacing:0.5 }}>LOG</div>
          {[...(log||[])].reverse().map((entry, i) => (
            <div key={i} style={{ fontSize:11, color:'var(--c-muted)', marginBottom:4, lineHeight:1.4 }}>{entry.msg}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen]         = useState('join');
  const [playerId, setPlayerId]     = useState(null);
  const [roomId, setRoomId]         = useState(null);
  const [gameState, setGameState]   = useState(null);
  const [error, setError]           = useState('');
  const [showArtMgr, setShowArtMgr] = useState(false);
  const [isSpectating, setIsSpectating] = useState(false);

  // Use refs to avoid stale closures in WS handlers
  const screenRef    = useRef(screen);
  const playerIdRef  = useRef(playerId);
  const roomIdRef    = useRef(roomId);
  const pendingBotDifficulty = useRef(null); // set by "Play vs Bot" quick-start
  useEffect(() => { screenRef.current   = screen;    }, [screen]);
  useEffect(() => { playerIdRef.current = playerId;  }, [playerId]);
  useEffect(() => { roomIdRef.current   = roomId;    }, [roomId]);

  const initialRoom = new URLSearchParams(window.location.search).get('room');

  const wsUrl = window.location.protocol === 'https:'
    ? `wss://${window.location.host}`
    : `ws://${window.location.host.replace(':5173', ':3001')}`;

  const { connected, send, on } = useGameSocket(wsUrl);

  // ── Register WS message handlers ──────────────────────────────────────────
  // These are re-registered on every render so they always see fresh state.
  // The handlers object in useGameSocket is a ref, so the latest fn is always called.
  on('joined', (msg) => {
    setPlayerId(msg.playerId);
    setRoomId(msg.roomId);
    setIsSpectating(false);
    setScreen('lobby');
    setError('');
    localStorage.setItem('uu_pid',  msg.playerId);
    localStorage.setItem('uu_room', msg.roomId);
    if (pendingBotDifficulty.current) {
      send({ type:'add_bot', difficulty: pendingBotDifficulty.current });
      pendingBotDifficulty.current = null;
    }
  });

  on('joined_spectator', (msg) => {
    setRoomId(msg.roomId);
    setPlayerId(null);
    setIsSpectating(true);
    setScreen('spectate');
    setError('');
  });

  on('state_update', (msg) => {
    setGameState(msg.state);
    if (isSpectating) return; // spectator screen doesn't change based on phase
    const p = msg.state.phase;
    if      (p === 'waiting')   setScreen('lobby');
    else if (p === 'game_over') setScreen('gameover');
    else                        setScreen('game');
  });

  on('game_started', () => setScreen('game'));
  on('game_over',    () => setScreen('gameover'));
  on('error', (msg) => {
    // Detect stale-session errors (room gone after server restart)
    const isStaleSession = /room not found|unknown room|player not found/i.test(msg.error || '');
    if (isStaleSession) {
      localStorage.removeItem('uu_pid');
      localStorage.removeItem('uu_room');
      setPlayerId(null); setRoomId(null); setGameState(null); setScreen('join');
      setError('⚠ Session expired (server may have restarted). Please create or join a new room.');
    } else {
      setError(msg.error);
    }
    setTimeout(() => setError(''), 6000);
  });

  // ── Auto-reconnect after page refresh ─────────────────────────────────────
  // When WS connects, if we have stored credentials, rejoin automatically.
  useEffect(() => {
    if (!connected) return;
    const pid  = localStorage.getItem('uu_pid');
    const room = localStorage.getItem('uu_room');
    const name = localStorage.getItem('uu_name');
    if (pid && room && name && !playerId) {
      send({ type:'join', name, room, playerId:pid });
    }
  }, [connected]); // eslint-disable-line

  const handleJoin     = (name, room) => send({ type:'join', name, room });
  const handleWatch    = (room) => send({ type:'join_spectator', room });
  const handlePlayVsBot = async (name, difficulty) => {
    localStorage.setItem('uu_name', name);
    try {
      const r = await fetch('/api/rooms', { method:'POST' });
      if (!r.ok) throw new Error('Server error');
      const { roomId: newRoomId } = await r.json();
      pendingBotDifficulty.current = difficulty || 'medium';
      send({ type:'join', name, room: newRoomId });
    } catch (e) {
      setError('Could not create room — is the server running?');
      setTimeout(() => setError(''), 6000);
    }
  };
  const handleStart    = () => send({ type:'start_game' });
  const handleSettings = (settings) => send({ type:'update_settings', settings });
  const handleAddBot   = (name, difficulty) => send({ type:'add_bot', name, difficulty });
  const handleRemoveBot = (botId) => send({ type:'remove_bot', botId });
  const handleLeave    = () => {
    // Clear session
    localStorage.removeItem('uu_pid');
    localStorage.removeItem('uu_room');
    setScreen('join');
    setGameState(null);
    setPlayerId(null);
    setRoomId(null);
    setIsSpectating(false);
    window.history.replaceState({}, '', window.location.pathname);
  };

  return (
    <div>
      {/* Connection indicator */}
      <div
        style={{ position:'fixed', top:10, left:10, zIndex:999, width:8, height:8, borderRadius:'50%', background: connected?'var(--c-green)':'var(--c-red)', boxShadow: connected?'0 0 8px rgba(79,255,160,0.6)':'0 0 8px rgba(255,85,85,0.6)', transition:'background 0.3s' }}
        title={connected ? 'Connected' : 'Reconnecting…'}
      />

      {/* Error toast */}
      {error && (
        <div onClick={()=>setError('')} style={{ position:'fixed', top:16, left:'50%', transform:'translateX(-50%)', background:'rgba(255,85,85,0.18)', border:'1.5px solid rgba(255,85,85,0.5)', borderRadius:10, padding:'10px 20px', fontSize:13, zIndex:1000, color:'var(--c-red)', fontWeight:700, cursor:'pointer', maxWidth:'90vw', textAlign:'center', lineHeight:1.5 }}>
          {error} <span style={{opacity:0.6,fontSize:11,marginLeft:8}}>(click to dismiss)</span>
        </div>
      )}

      {/* Art Manager (only from main menu) */}
      {showArtMgr && <ArtManager onClose={()=>setShowArtMgr(false)} />}

      {screen === 'join' && (
        <JoinScreen
          onJoin={handleJoin}
          onWatch={handleWatch}
          onPlayVsBot={handlePlayVsBot}
          initialRoom={initialRoom}
          onOpenArtManager={() => setShowArtMgr(true)}
        />
      )}

      {screen === 'spectate' && gameState && (
        <SpectatorBoard state={gameState} onLeave={handleLeave} />
      )}

      {screen === 'lobby' && gameState && (
        <LobbyScreen
          players={gameState.players}
          isHost={gameState.players[playerId]?.isHost}
          roomId={roomId}
          onStart={handleStart}
          onSettings={handleSettings}
          settings={gameState.settings}
          onLeave={handleLeave}
          onAddBot={handleAddBot}
          onRemoveBot={handleRemoveBot}
        />
      )}

      {screen === 'game' && gameState && playerId && (
        <GameBoard
          state={gameState}
          playerId={playerId}
          send={send}
          onLeave={handleLeave}
        />
      )}

      {screen === 'gameover' && gameState && (
        <GameOverScreen
          winner={gameState.winner}
          players={gameState.players}
          winCondition={gameState.winCondition}
          playerId={playerId}
          onBackToMenu={handleLeave}
        />
      )}
    </div>
  );
}

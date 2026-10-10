# 🦄 Unstable Unicorns Online

> **Build a unicorn army. Betray your friends.**

A self-hostable, real-time multiplayer web implementation of the Unstable Unicorns card game. One person hosts, everyone plays in their browser — no app installs required.

---

## ⚡ Quick Start

```bash
git clone <your-repo>
cd unstable-unicorns
chmod +x setup.sh && ./setup.sh
# Then:
cd server && node index.js
# Open http://localhost:3001
```

---

## 🎮 How to Play (Online)

1. **Host** runs the server on their machine (or VPS)
2. **Host** opens the URL, creates a game, and shares the room code
3. **Friends** open the same URL and enter the room code
4. **Host** clicks **Start Game** when everyone is ready
5. Play proceeds in turns — draw, then play a card (or draw again)

---

## 🏗 Architecture

```
unstable-unicorns/
├── server/
│   ├── index.js       # Express + WebSocket server
│   ├── game.js        # Game state machine
│   ├── cards.js       # Full card deck definitions
│   └── package.json
├── client/
│   ├── src/
│   │   ├── App.jsx    # Full React game UI
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── Dockerfile
├── setup.sh
└── README.md
```

**Stack:** Node.js + Express + WebSockets (ws) + React + Vite  
**No database** — game state is all in-memory (restarts on server reboot)

---

## 🚀 Hosting Options

### Local (LAN party)
```bash
cd server && node index.js
# Share http://<your-local-ip>:3001 with people on the same WiFi
```

### Cloud / VPS (DigitalOcean, Railway, Render, Fly.io)
```bash
PORT=8080 node server/index.js
```
Make sure to build the client first and point the server to `client/dist`.

### Docker
```bash
docker build -t unstable-unicorns .
docker run -p 3001:3001 unstable-unicorns
```

### Railway (1-click)
1. Push to GitHub
2. Connect repo to Railway
3. Set `npm run setup && npm start` as the build/start command

---

## 🃏 Cards Implemented

**Base game with ~80 cards:**

| Type | Count | Description |
|------|-------|-------------|
| Baby Unicorns | 8 | Start in the nursery |
| Basic Unicorns | 9 | No special effects |
| Magical Unicorns | 16 | Enter-stable powers |
| Magic | 18 | Spell effects |
| Instant | 8 | Neigh! / Super Neigh! |
| Upgrade | 10 | Stable buffs |
| Downgrade | 8 | Opponent debuffs |

### Key Effects Working
- ✅ Draw cards on enter
- ✅ Destroy opponent cards
- ✅ Steal unicorns
- ✅ Neigh! / Super Neigh! window
- ✅ Return cards to hand/deck
- ✅ Discard effects
- ✅ Hand limit (7 cards) enforcement
- ✅ Win condition (7 unicorns)
- ✅ Turn skip mechanic
- ✅ Protection upgrades

---

## 🔧 Development

```bash
# Run server + client separately (hot reload)
# Terminal 1:
cd server && node index.js

# Terminal 2:
cd client && npm run dev
# Open http://localhost:5173
```

---

## 📜 Rules Summary

1. **Beginning Phase** — Trigger any start-of-turn stable effects
2. **Draw Phase** — Draw 1 card (or more with bonuses)
3. **Action Phase** — Play 1 card from your hand, OR draw 1 more card
4. **End Phase** — Discard down to 7 cards if needed

**Win:** Be the first to collect 7 unicorns in your stable.

**Neigh!** — Any player can play a Neigh! card after another player announces their play. A Super Neigh! cannot be countered.

---

## ⚠️ Legal Note

This is a **fan-made implementation** for personal/private use. Unstable Unicorns is a trademark of TeeTurtle LLC. Please support the creators by [buying the physical game](https://unstablegames.com).

---

## 🤝 Contributing

PRs welcome! Areas to extend:
- Add expansion packs (NSFW, Dragons, etc.)
- Persistent rooms with reconnect codes  
- Sound effects
- Card animations
- Mobile responsive layout
- Spectator mode

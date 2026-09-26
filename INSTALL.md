# 🦄 Unstable Unicorns Online — Install & Hosting Guide

## What You Get

A real-time multiplayer Unstable Unicorns card game that:
- Runs entirely from your computer (or any server)
- Players join through their **web browser** — no app installs
- Supports **2–8 players**
- Includes the **base game + 5 expansion packs** (toggleable per game)

---

## Requirements

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 18 or newer | `node --version` |
| npm | included with Node | `npm --version` |

Download Node.js from: https://nodejs.org (choose "LTS")

---

## Quick Start (5 minutes)

### Step 1 — Extract the zip

Unzip `unstable-unicorns-online.zip` anywhere on your computer.

```
unstable-unicorns/
├── server/         ← game server (Node.js)
├── client/         ← web frontend (React, pre-built)
├── setup.sh        ← one-command setup (Mac/Linux)
├── setup.bat       ← one-command setup (Windows)
├── Dockerfile      ← optional Docker deploy
└── INSTALL.md      ← this file
```

### Step 2 — Install dependencies

**Mac / Linux:**
```bash
cd unstable-unicorns
chmod +x setup.sh
./setup.sh
```

**Windows (Command Prompt or PowerShell):**
```bat
cd unstable-unicorns
setup.bat
```

**Manual (any OS):**
```bash
cd unstable-unicorns/server
npm install

cd ../client
npm install
npm run build
```

### Step 3 — Start the server

```bash
cd unstable-unicorns/server
node index.js
```

You should see:
```
🦄 Unstable Unicorns server on port 3001
   http://localhost:3001
```

### Step 4 — Open the game

Open your browser and go to: **http://localhost:3001**

---

## Playing With Friends (Same WiFi)

If your friends are on the **same home network or WiFi**:

1. Find your local IP address:
   - **Mac/Linux:** `ifconfig | grep "inet " | grep -v 127`
   - **Windows:** `ipconfig` → look for "IPv4 Address"

2. Start the server as normal: `node index.js`

3. Share your local IP, e.g. `http://192.168.1.42:3001`

4. Friends open that URL — done!

---

## Playing Over the Internet (Online with Anyone)

To let people connect from **outside your home network**, you need to either:

### Option A — Port Forwarding (Free, requires router access)

1. Log into your router admin panel (usually `http://192.168.1.1`)
2. Find "Port Forwarding" settings
3. Forward **external port 3001** → **your PC's local IP, port 3001**
4. Find your public IP at https://whatismyip.com
5. Share `http://<your-public-ip>:3001` with friends

### Option B — ngrok (Free tunnel, no router changes)

1. Download ngrok: https://ngrok.com/download
2. Run: `ngrok http 3001`
3. ngrok gives you a URL like `https://abc123.ngrok.io`
4. Share that URL — it works from anywhere!

### Option C — Deploy to a cloud server (permanent)

**Railway (free tier, easiest):**
1. Push this folder to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Set build command: `cd client && npm install && npm run build`
4. Set start command: `cd server && node index.js`
5. Railway gives you a public URL

**Render (free tier):**
1. Push to GitHub
2. Go to https://render.com → New Web Service
3. Build: `cd client && npm install && npm run build`
4. Start: `cd server && node index.js`

**DigitalOcean / VPS (full control):**
```bash
# On the server:
git clone <your-repo>
cd unstable-unicorns
./setup.sh
PORT=80 node server/index.js   # run on port 80 for easy access
# Or use pm2 for background running:
npm install -g pm2
pm2 start server/index.js --name unicorns
pm2 save
```

### Option D — Docker (any platform)

```bash
docker build -t unstable-unicorns .
docker run -d -p 3001:3001 --name unicorns unstable-unicorns
```

Or with Docker Compose (create `docker-compose.yml`):
```yaml
version: '3'
services:
  game:
    build: .
    ports:
      - "3001:3001"
    restart: unless-stopped
```
Then: `docker-compose up -d`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Port the server listens on |
| `NODE_ENV` | `development` | Set to `production` for deployment |

Example:
```bash
PORT=8080 NODE_ENV=production node server/index.js
```

---

## How to Play

### Starting a Game
1. Host opens the game URL and clicks **Create New Game**
2. A 6-character **room code** appears (e.g. `ABC123`)
3. Share the room code OR copy the link and send it to friends
4. Friends enter the room code on the same URL
5. **Host clicks Start Game** (needs 2+ players)

### Turn Structure
Each turn has 4 phases, shown in the top bar:

| Phase | What happens |
|-------|-------------|
| **Beginning** | Start-of-turn stable effects trigger automatically |
| **Draw** | Click "Draw Card" to draw 1 card (upgrades may give more) |
| **Action** | Play 1 card from your hand, OR click "Draw Instead" to draw a second card |
| **End** | If you have more than 7 cards, discard down to 7 |

### Neigh! Window
When a player plays a card, a **Neigh window** appears. During this brief window:
- Any player with a **Neigh!** card can click **🙅 Neigh!** to cancel it
- A **Super Neigh!** cannot be countered by a regular Neigh!
- The playing player clicks **✓ Let it play** to confirm (or wait if no one neighs)

### Card Types

| Type | Color | Effect |
|------|-------|--------|
| 🐴 Baby Unicorn | White | Starts in nursery; 1 per player at game start |
| 🦄 Basic Unicorn | Blue | No special effects; just adds to your count |
| ✨ Magical Unicorn | Purple | Has enter-stable effects (draw, steal, destroy…) |
| 💛 Magic | Yellow | Instant spell effects; goes to discard after use |
| 🟠 Instant | Orange | Can be played any time (Neigh!, etc.) |
| 🟢 Upgrade | Green | Stays in your stable; gives ongoing bonuses |
| 🔴 Downgrade | Red | Played on opponents; gives them penalties |

### Winning
First player to collect **7 unicorns** in their stable wins.
(The host can change this to 5, 6, 7, or 8 in the lobby settings.)

---

## Expansion Packs

Expansions are toggled by the **host in the lobby** before the game starts.
Each expansion adds new cards shuffled into the main deck.

### 🐲 Dragons (27 cards, 14+)
Dragon-themed Dragoncorns with fire-breathing mechanics.
- **Baby Dragoncorns** replace some nursery babies
- **Dragon's Curse** reduces opponent hand limits
- **Scorched Stables** destroys a card at the start of each turn
- **Dragon Turtle** protects your unicorns from destruction
- **Angry Dragoncorn** destroys any card on entry

### 🔞 NSFW (20 cards, 18+)
Adult-themed expansion — enable only with appropriate players.
- **Chastity Belt** upgrade: unicorns can't be stolen
- **Blue Balls** downgrade: target can't play unicorns
- **One Night Stand**: steal a unicorn for 1 turn
- **Kinky Unicorn**: swap hands with any player
- **Dominatrix Unicorn**: force opponent to discard 2 cards of your choice

### 🌈 Rainbow Apocalypse (18 cards, 14+)
Two factions: Rainbow Sprinkles vs the Four Unicorns of the Apocalypse.
- **Pestilence**: all other players sacrifice a unicorn
- **War**: destroy 2 cards
- **Famine**: all opponents discard to 3 cards
- **Death**: destroys ALL upgrades and downgrades in play
- **Double Rainbow Unicorn**: counts as 2 unicorns toward your win total

### ⚔️ Adventures (21 cards, 14+)
Quests, heroes, and curses.
- **Knight Unicorn**: saves one unicorn from destruction per turn
- **Ranger Unicorn**: look at top 3 deck cards, keep 1
- **Heroic Charge**: play a unicorn without using your action
- **Tavern Brawl**: everyone sacrifices a unicorn (you choose whose)
- **Cursed Artifact**: reduces target's hand limit to 4

### ⭐ Unicorns of Legend (22 cards, 14+)
Mythological creatures from global folklore.
- **Pegacorn**: take an extra turn
- **Kirin**: all opponents skip their next draw phase
- **Crown of Legends** upgrade: win with only **6** unicorns
- **Sleipnir**: ignores the first Neigh! played against it
- **Baku**: force any player to discard their entire hand, draw 3 new cards

---

## Troubleshooting

**"Room not found" error**
- Make sure you're typing the room code exactly (it's case-insensitive)
- The server must still be running — it loses rooms if restarted

**Players can't connect**
- Check the server is running (`node index.js` in the server folder)
- For local play: make sure everyone is on the same WiFi
- For internet play: check your port forwarding or use ngrok

**Game gets stuck**
- If a card effect requires a target and nothing happens, check for a yellow prompt banner at the top of the board
- The current player may need to confirm an effect

**"Cannot find module" errors**
- Run `npm install` inside the `server/` folder again

**White screen / app won't load**
- The client needs to be built: `cd client && npm run build`
- Then restart the server

**Port already in use**
```bash
PORT=3002 node server/index.js
```

---

## Development Mode (Hot Reload)

For developers who want to modify the code:

**Terminal 1 — Server:**
```bash
cd server
node index.js
```

**Terminal 2 — Client (with hot reload):**
```bash
cd client
npm run dev
```

Open `http://localhost:5173` (not 3001) during development.

---

## File Structure Reference

```
unstable-unicorns/
├── server/
│   ├── index.js        WebSocket + HTTP server
│   ├── game.js         Game state machine & rules engine
│   ├── cards.js        Base game card definitions (~80 cards)
│   ├── expansions.js   5 expansion packs (~110 cards)
│   └── package.json
├── client/
│   ├── src/
│   │   ├── App.jsx     Full game UI (lobby, board, cards)
│   │   ├── main.jsx    React entry point
│   │   └── index.css   Styles & theme
│   ├── dist/           Pre-built production files (served by server)
│   └── package.json
├── Dockerfile
├── setup.sh            Mac/Linux setup script
├── setup.bat           Windows setup script
├── INSTALL.md          This file
└── README.md           Quick-reference overview
```

---

## Legal Notice

This is a fan-made implementation for **personal, private use only**.
Unstable Unicorns™ is the intellectual property of TeeTurtle / Unstable Games.
Please support the creators by purchasing the physical game: https://unstablegames.com

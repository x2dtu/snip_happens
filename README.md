# Snip Happens

A cooperative wire-cutting deduction game for 2–5 players, playable in the browser. Any seat can be a human (joining over WebSockets) or an AI teammate. Rules are in [rules.md](rules.md).

## Run it

Dependencies come from the public npm registry (see `.npmrc`).

```bash
npm install
npm run dev        # http://127.0.0.1:3000
```

Production: `npm run build && npm start`.

Create a room, add AI teammates and/or share the 4-letter code, then start the mission. Each browser tab is its own player, so you can test multiplayer by opening several tabs.

## Playing with friends

The server listens on `127.0.0.1` only, so nobody else on your network can reach it by default. There's no login: anyone who can reach the server can create or join rooms. To play with people on other machines, prefer an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 you@host`). Setting `HOST=0.0.0.0` exposes the game to everyone who can reach your machine, so only do that on a network you trust.

## Layout

| Path | What |
|---|---|
| `src/game/engine.ts` | Rules engine: setup, actions, win/loss, per-player redacted views |
| `src/game/ai.ts` | AI teammate. It only sees its own redacted view, so it can't cheat |
| `src/server/rooms.ts` | Socket.IO rooms, seats, AI turn scheduling |
| `server.ts` | Custom Next.js + Socket.IO server |
| `app/` | Next.js UI (home, lobby, game board) |
| `scripts/simulate.ts` | `npm run simulate [n]`: AI-only games to sanity-check the engine and AI |
| `scripts/e2e.ts` | `npm run e2e` (with the server running): two socket clients + one AI play a full mission, checking that hidden wires never leak |

## Not implemented yet

- Equipment cards and a numbered mission campaign (rules.md doesn't specify their effects). The lobby offers wire-mix presets instead.
- "X out of Y" hidden wire setups.

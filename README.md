# Snip Happens

A cooperative wire-cutting deduction game for 2–5 players, playable in the browser. Any seat can be a human (joining over WebSockets) or an AI teammate. Rules are in [rules.md](rules.md).

## Run it

Dependencies come from the public npm registry (see `.npmrc`).

```bash
npm install
npm run dev        # http://127.0.0.1:3000
```

Production: `npm run build && npm start`.

In a two-player game each player runs two boards (laid out like a four-player game), and each board gets its own opening info token.

Create a room, add AI teammates and/or share the 4-letter code, then start the mission. Each browser tab is its own player, so you can test multiplayer by opening several tabs.

## Playing with friends

The server listens on `127.0.0.1` only, so nobody else on your network can reach it by default. There's no login: anyone who can reach the server can create or join rooms. To play with people on other machines, prefer an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 you@host`). Setting `HOST=0.0.0.0` exposes the game to everyone who can reach your machine, so only do that on a network you trust.

## Deploying (free, on Render)

The app needs a long-running Node process for WebSockets, so it can't run on Vercel's serverless functions. Render's free web service works as-is:

1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and pick the repo. It reads `render.yaml`.
3. Open the `onrender.com` URL and share room links from there.

Free instances sleep after about 15 minutes idle, and the first visit after that takes 30–60s to wake. Rooms live in memory, so they're cleared on sleep or redeploy. Keep it to a single instance. The game has no accounts, so anyone with the URL can create or join rooms. Room creation is capped to limit abuse.

## Layout

| Path | What |
|---|---|
| `src/game/engine.ts` | Rules engine: setup, actions, win/loss, per-player redacted views |
| `src/game/ai.ts` | AI teammate. It only sees its own redacted view, so it can't cheat |
| `src/server/rooms.ts` | Socket.IO rooms, seats, AI turn scheduling |
| `server.ts` | Custom Next.js + Socket.IO server |
| `app/` | Next.js UI (home, lobby, game board) |
| `scripts/simulate.ts` | `npm run simulate [n] [-- --equipment]`: AI-only games to sanity-check the engine and AI |
| `scripts/equipment-test.ts` | `npm test`: rules tests for every equipment card |
| `scripts/e2e.ts` | `npm run e2e [-- --two]` (with the server running): two socket clients + one AI play a full mission, checking that hidden wires never leak |

## Equipment

The host can draw up to 6 of the 12 equipment cards (`src/game/equipment.ts`). A card unlocks once two blue wires of its number are cut, and each card is single use. Cards whose text says "during a Dual Cut" or "your turn" (3, 5, 9, 10, 11) can only be used on your own turn. Anyone can use the rest at any time unless a choice is pending.

House rulings where the card text is open:
- Triple/Super Detector misses work like the twin probe: the info token goes on a blue wire if there is one, otherwise a yellow, and the teammate picks if several qualify. Detectors never trigger a red wire.
- Stabilizer: a red wire hit while stabilized is revealed safely, and a miss still places its info token.
- Walkie-Talkies: info tokens move with the wire, and = / ≠ labels on swapped wires are removed.

## Not implemented yet

- A numbered mission campaign. The lobby offers wire-mix presets instead.

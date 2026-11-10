import type { Server, Socket } from "socket.io";
import { chooseAction } from "../game/ai";
import { actingPlayer, applyAction, clampSettings, createGame, MAX_PLAYERS, MIN_PLAYERS, viewFor } from "../game/engine";
import type { Action, GameSettings, GameState } from "../game/types";
import type { LobbyView, RoomUpdate } from "./protocol";

interface Seat {
  kind: "human" | "ai";
  name: string;
  /** Secret per-browser-tab session id for humans; never sent to other clients. */
  token?: string;
}

interface Room {
  code: string;
  hostToken: string;
  seats: Seat[];
  settings: GameSettings;
  game: GameState | null;
  /** Seat order snapshot used by the running game. */
  gameSeats: Seat[];
  nextCaptain: number;
  aiTimer: NodeJS.Timeout | null;
  lastActive: number;
}

const AI_NAMES = ["Sparky", "Fuse", "Pliers", "Volt", "Tinker", "Ohm", "Bolt"];
const AI_DELAY_MS = 1100;
const ROOM_TTL_MS = 60 * 60 * 1000;

const rooms = new Map<string, Room>();

function cleanName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/[^\p{L}\p{N} _'.-]/gu, "").trim().slice(0, 20) : "";
  return s || "Player";
}
const validToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9-]{16,64}$/.test(t);
const validCode = (c: unknown): c is string => typeof c === "string" && /^[A-Z]{4}$/.test(c);

function newCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (;;) {
    let c = "";
    for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
    if (!rooms.has(c)) return c;
  }
}

function aiName(room: Room): string {
  const used = new Set(room.seats.map((s) => s.name));
  return AI_NAMES.find((n) => !used.has(n)) ?? `Bot ${room.seats.length + 1}`;
}

export function registerRooms(io: Server) {
  const roomSockets = (code: string) => io.in(code).fetchSockets();

  async function broadcast(room: Room) {
    room.lastActive = Date.now();
    const sockets = await roomSockets(room.code);
    const connected = new Set(sockets.map((s) => s.data.token as string));
    for (const s of sockets) {
      const token = s.data.token as string;
      const seatIdx = room.seats.findIndex((x) => x.token === token);
      const gameIdx = room.gameSeats.findIndex((x) => x.token === token);
      const lobby: LobbyView = {
        code: room.code,
        seats: room.seats.map((x) => ({
          kind: x.kind,
          name: x.name,
          connected: x.kind === "ai" || (!!x.token && connected.has(x.token)),
          isHost: x.token === room.hostToken,
        })),
        settings: room.settings,
        you: seatIdx,
        isHost: token === room.hostToken,
      };
      const update: RoomUpdate = { lobby, game: room.game ? viewFor(room.game, gameIdx) : null };
      s.emit("room:update", update);
    }
    scheduleAi(room);
  }

  function scheduleAi(room: Room) {
    if (room.aiTimer || !room.game) return;
    const g = room.game;
    if (g.phase !== "opening" && g.phase !== "playing") return;
    const who = actingPlayer(g);
    if (g.players[who].kind !== "ai") return;
    room.aiTimer = setTimeout(() => {
      room.aiTimer = null;
      if (!room.game || room.game !== g) return;
      const now = actingPlayer(g);
      if (g.players[now].kind !== "ai") return;
      const action = chooseAction(viewFor(g, now));
      const err = action ? applyAction(g, now, action) : "AI had no move";
      if (err) console.error(`[room ${room.code}] AI error: ${err}`);
      void broadcast(room);
    }, AI_DELAY_MS);
  }

  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (now - room.lastActive > ROOM_TTL_MS) {
        if (room.aiTimer) clearTimeout(room.aiTimer);
        rooms.delete(code);
      }
    }
  }, 5 * 60 * 1000).unref();

  io.on("connection", (socket: Socket) => {
    const reply = (ack: unknown, payload: object) => {
      if (typeof ack === "function") ack(payload);
    };
    const current = (): Room | null => {
      const code = socket.data.code as string | undefined;
      return code ? (rooms.get(code) ?? null) : null;
    };
    const isHost = (room: Room) => socket.data.token === room.hostToken;

    socket.on("room:create", (msg: { name?: unknown; token?: unknown }, ack) => {
      if (!validToken(msg?.token)) return reply(ack, { error: "Bad session." });
      const code = newCode();
      const room: Room = {
        code,
        hostToken: msg.token,
        seats: [{ kind: "human", name: cleanName(msg.name), token: msg.token }],
        settings: clampSettings({}),
        game: null,
        gameSeats: [],
        nextCaptain: 0,
        aiTimer: null,
        lastActive: Date.now(),
      };
      rooms.set(code, room);
      reply(ack, { code });
    });

    socket.on("room:join", async (msg: { code?: unknown; name?: unknown; token?: unknown }, ack) => {
      const code = typeof msg?.code === "string" ? msg.code.toUpperCase() : "";
      if (!validCode(code) || !validToken(msg?.token)) return reply(ack, { error: "Bad room code." });
      const room = rooms.get(code);
      if (!room) return reply(ack, { error: "That room doesn't exist (it may have expired)." });
      const token = msg.token;
      const existing = room.seats.find((s) => s.token === token);
      const inGame = room.gameSeats.some((s) => s.token === token);
      if (!existing && !inGame) {
        if (room.game && room.game.phase !== "won" && room.game.phase !== "lost") {
          // Mid-mission: join as a spectator only.
        } else if (room.seats.length >= MAX_PLAYERS) {
          return reply(ack, { error: "Room is full." });
        } else {
          room.seats.push({ kind: "human", name: cleanName(msg.name), token });
        }
      }
      if (socket.data.code && socket.data.code !== code) await socket.leave(socket.data.code);
      socket.data.code = code;
      socket.data.token = token;
      await socket.join(code);
      reply(ack, { ok: true });
      void broadcast(room);
    });

    socket.on("room:addAi", () => {
      const room = current();
      if (!room || !isHost(room) || room.seats.length >= MAX_PLAYERS) return;
      room.seats.push({ kind: "ai", name: aiName(room) });
      void broadcast(room);
    });

    socket.on("room:removeSeat", (seat: unknown) => {
      const room = current();
      if (!room || !isHost(room) || !Number.isInteger(seat)) return;
      const s = room.seats[seat as number];
      if (!s || s.token === room.hostToken) return;
      room.seats.splice(seat as number, 1);
      void broadcast(room);
    });

    socket.on("room:settings", (settings: Partial<GameSettings>) => {
      const room = current();
      if (!room || !isHost(room)) return;
      room.settings = clampSettings(settings ?? {});
      void broadcast(room);
    });

    socket.on("room:start", (_: unknown, ack) => {
      const room = current();
      if (!room || !isHost(room)) return reply(ack, { error: "Only the host can start." });
      if (room.seats.length < MIN_PLAYERS) return reply(ack, { error: `Need at least ${MIN_PLAYERS} players.` });
      if (room.game && (room.game.phase === "opening" || room.game.phase === "playing"))
        return reply(ack, { error: "A mission is already running." });
      if (room.aiTimer) clearTimeout(room.aiTimer);
      room.aiTimer = null;
      room.gameSeats = room.seats.map((s) => ({ ...s }));
      const captain = room.nextCaptain % room.seats.length;
      room.nextCaptain = captain + 1;
      room.game = createGame(room.gameSeats, room.settings, captain);
      reply(ack, { ok: true });
      void broadcast(room);
    });

    socket.on("room:abort", () => {
      const room = current();
      if (!room || !isHost(room) || !room.game) return;
      if (room.aiTimer) clearTimeout(room.aiTimer);
      room.aiTimer = null;
      room.game = null;
      void broadcast(room);
    });

    socket.on("game:action", (action: Action, ack) => {
      const room = current();
      if (!room?.game) return reply(ack, { error: "No mission running." });
      const idx = room.gameSeats.findIndex((s) => s.kind === "human" && s.token === socket.data.token);
      if (idx < 0) return reply(ack, { error: "You're spectating this mission." });
      const err = applyAction(room.game, idx, action);
      reply(ack, err ? { error: err } : { ok: true });
      if (!err) void broadcast(room);
    });

    socket.on("disconnect", () => {
      const room = current();
      if (room) void broadcast(room);
    });
  });
}

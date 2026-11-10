// Smoke test against a running server: two "human" socket clients plus one AI play a full mission.
// Usage: npm start (in another terminal), then: npx tsx scripts/e2e.ts [url]
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { chooseAction } from "../src/game/ai";
import type { RoomUpdate } from "../src/server/protocol";

const url = process.argv[2] ?? "http://127.0.0.1:3000";
const ack = <T>(s: Socket, ev: string, payload?: unknown) => new Promise<T>((r) => s.emit(ev, payload, r));

async function main() {
  const host = io(url);
  const guest = io(url);
  const hostTok = randomUUID();
  const guestTok = randomUUID();

  const { code } = await ack<{ code: string }>(host, "room:create", { name: "Alice", token: hostTok });
  console.log("room", code);
  await ack(host, "room:join", { code, name: "Alice", token: hostTok });
  await ack(guest, "room:join", { code, name: "Bob", token: guestTok });
  host.emit("room:addAi");
  host.emit("room:settings", { yellowCount: 2, yellowDrawn: 3, redCount: 1, redDrawn: 2 });

  // Guest must not be able to start or change settings.
  const denied = await ack<{ error?: string }>(guest, "room:start");
  if (!denied.error) throw new Error("guest was allowed to start");

  let lastLog = "";
  const done = new Promise<string>((resolve) => {
    for (const s of [host, guest]) {
      let busy = false;
      s.on("room:update", async (u: RoomUpdate) => {
        const g = u.game;
        if (!g) return;
        // Hidden-info check: a client must never see other players' uncut values (until the end).
        if (g.phase === "opening" || g.phase === "playing") {
          g.players.forEach((p, pi) => {
            if (pi !== g.you && p.wires.some((w) => !w.cut && w.value !== undefined)) throw new Error("leaked hidden wire");
          });
          if (g.pending && "actorWire" in g.pending && g.pending.actorWire !== undefined) throw new Error("leaked actor wire");
        }
        const line = g.log[g.log.length - 1];
        if (s === host && line !== lastLog) {
          lastLog = line;
          console.log("  ", line);
        }
        if (g.phase === "won" || g.phase === "lost") return resolve(g.phase);
        const actor = g.pending ? g.pending.target : g.turn;
        if (actor !== g.you || busy) return;
        busy = true;
        const action = chooseAction(g);
        const res = await ack<{ error?: string }>(s, "game:action", action);
        busy = false;
        if (res.error) throw new Error(`action rejected: ${res.error}`);
      });
    }
  });

  const started = await ack<{ error?: string }>(host, "room:start");
  if (started.error) throw new Error(started.error);
  const result = await done;
  console.log("RESULT:", result);
  host.close();
  guest.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

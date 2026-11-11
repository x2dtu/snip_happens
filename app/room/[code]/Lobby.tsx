"use client";
import { useState } from "react";
import { emitAck, getSocket } from "../../../src/client/socket";
import { MAX_DRAWN, MAX_EQUIPMENT, MAX_PLAYERS, MAX_RED, MAX_YELLOW, MIN_PLAYERS, PRESETS } from "../../../src/game/engine";
import type { LobbyView } from "../../../src/server/protocol";

export default function Lobby({ lobby }: { lobby: LobbyView }) {
  const [error, setError] = useState("");
  const socket = getSocket();
  const { settings, isHost } = lobby;
  const link = typeof window !== "undefined" ? `${window.location.origin}/room/${lobby.code}` : "";

  async function start() {
    const res = await emitAck("room:start");
    if (res.error) setError(res.error);
  }

  return (
    <main className="lobby">
      <h1 className="logo small">
        Snip <span>Happens</span>
      </h1>
      <div className="card">
        <h2>
          Room <span className="code">{lobby.code}</span>
        </h2>
        <p className="muted">
          Share this code or link: <code>{link}</code>
        </p>

        <h3>
          Crew ({lobby.seats.length}/{MAX_PLAYERS})
        </h3>
        <ul className="seats">
          {lobby.seats.map((s, i) => (
            <li key={i} className={s.connected ? "" : "offline"}>
              <span className="seat-name">
                {s.kind === "ai" ? "🤖 " : "🧑 "}
                {s.name}
                {i === lobby.you && " (you)"}
                {s.isHost && <span className="tag">host</span>}
                {!s.connected && <span className="tag">offline</span>}
              </span>
              {isHost && !s.isHost && (
                <button className="link" onClick={() => socket.emit("room:removeSeat", i)}>
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {isHost && lobby.seats.length < MAX_PLAYERS && (
          <button onClick={() => socket.emit("room:addAi")}>+ Add AI teammate</button>
        )}

        <h3>Mission</h3>
        {isHost ? (
          <div className="presets">
            {PRESETS.map((p) => {
              const active = (["yellowCount", "yellowDrawn", "redCount", "redDrawn"] as const).every((k) => p.settings[k] === settings[k]);
              return (
                <button key={p.name} className={active ? "preset active" : "preset"} onClick={() => socket.emit("room:settings", { ...p.settings, equipmentCount: settings.equipmentCount })}>
                  <b>{p.name}</b>
                  <span>{p.description}</span>
                </button>
              );
            })}
            <div className="custom">
              <CountPair
                label="Yellow"
                count={settings.yellowCount}
                drawn={settings.yellowDrawn}
                maxCount={MAX_YELLOW}
                onChange={(yellowCount, yellowDrawn) => socket.emit("room:settings", { ...settings, yellowCount, yellowDrawn })}
              />
              <CountPair
                label="Red"
                count={settings.redCount}
                drawn={settings.redDrawn}
                maxCount={MAX_RED}
                onChange={(redCount, redDrawn) => socket.emit("room:settings", { ...settings, redCount, redDrawn })}
              />
              <div className="row count-pair">
                <span>Equipment:</span>
                <input
                  type="number"
                  min={0}
                  max={MAX_EQUIPMENT}
                  value={settings.equipmentCount}
                  onChange={(e) => socket.emit("room:settings", { ...settings, equipmentCount: Number(e.target.value) })}
                />
                <span className="muted">cards drawn at random (0–{MAX_EQUIPMENT})</span>
              </div>
            </div>
          </div>
        ) : (
          <p>
            48 blue, {describe(settings.yellowCount, settings.yellowDrawn)} yellow, {describe(settings.redCount, settings.redDrawn)} red wires, {settings.equipmentCount} equipment. Waiting for the host to start…
          </p>
        )}

        {isHost && (
          <button className="primary big" disabled={lobby.seats.length < MIN_PLAYERS} onClick={start}>
            {lobby.seats.length < MIN_PLAYERS ? `Need ${MIN_PLAYERS}+ players` : "Start mission"}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}

const describe = (count: number, drawn: number) => (drawn > count ? `${count} of ${drawn}` : String(count));

function CountPair({
  label,
  count,
  drawn,
  maxCount,
  onChange,
}: {
  label: string;
  count: number;
  drawn: number;
  maxCount: number;
  onChange: (count: number, drawn: number) => void;
}) {
  return (
    <div className="row count-pair">
      <span>{label}:</span>
      <input type="number" min={0} max={maxCount} value={count} onChange={(e) => {
        const c = Number(e.target.value);
        onChange(c, Math.max(c, drawn));
      }} />
      <span className="muted">in play, out of</span>
      <input type="number" min={count} max={Math.max(count, MAX_DRAWN)} value={drawn} onChange={(e) => onChange(count, Number(e.target.value))} />
      <span className="muted">drawn</span>
    </div>
  );
}

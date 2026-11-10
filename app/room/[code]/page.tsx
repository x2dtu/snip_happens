"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { emitAck, getName, getSocket, getToken, setName } from "../../../src/client/socket";
import type { RoomUpdate } from "../../../src/server/protocol";
import Game from "./Game";
import Lobby from "./Lobby";

export default function RoomPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = String(rawCode).toUpperCase();
  const [update, setUpdate] = useState<RoomUpdate | null>(null);
  const [error, setError] = useState("");
  const [needName, setNeedName] = useState(false);
  const [name, setNameState] = useState("");
  const [joined, setJoined] = useState(false);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const n = getName();
    if (!n) setNeedName(true);
    else setNameState(n);
  }, []);

  useEffect(() => {
    if (needName || !name) return;
    const socket = getSocket();
    const join = async () => {
      const res = await emitAck("room:join", { code, name, token: getToken() });
      if (res.error) setError(res.error);
      else setJoined(true);
    };
    const onUpdate = (u: RoomUpdate) => setUpdate(u);
    const onConnect = () => {
      setConnected(true);
      void join();
    };
    const onDisconnect = () => setConnected(false);
    socket.on("room:update", onUpdate);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) void join();
    return () => {
      socket.off("room:update", onUpdate);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [code, name, needName]);

  if (needName) {
    return (
      <main className="home">
        <h1 className="logo">
          Snip <span>Happens</span>
        </h1>
        <div className="card home-card">
          <label>
            Your name
            <input value={name} maxLength={20} onChange={(e) => setNameState(e.target.value)} autoFocus />
          </label>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() => {
              setName(name.trim());
              setNeedName(false);
            }}
          >
            Join room {code}
          </button>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="home">
        <div className="card home-card">
          <p className="error">{error}</p>
          <a href="/">Back home</a>
        </div>
      </main>
    );
  }

  if (!joined || !update) return <main className="home">Connecting…</main>;

  return (
    <>
      {!connected && <div className="banner warn">Reconnecting to the server…</div>}
      {update.game ? <Game update={update} /> : <Lobby lobby={update.lobby} />}
    </>
  );
}

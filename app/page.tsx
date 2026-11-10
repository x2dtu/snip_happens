"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { emitAck, getName, getToken, setName } from "../src/client/socket";

export default function Home() {
  const router = useRouter();
  const [name, setNameState] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setNameState(getName()), []);

  async function create() {
    setBusy(true);
    setName(name);
    const res = await emitAck<{ code?: string; error?: string }>("room:create", { name, token: getToken() });
    setBusy(false);
    if (res.error || !res.code) return setError(res.error ?? "Couldn't create a room.");
    router.push(`/room/${res.code}`);
  }

  function join() {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) return setError("Room codes are 4 letters.");
    setName(name);
    router.push(`/room/${c}`);
  }

  return (
    <main className="home">
      <h1 className="logo">
        Snip <span>Happens</span>
      </h1>
      <p className="tagline">
        One bomb. Everyone's holding part of the wiring. Nobody can say what's in their hand. Cut every wire
        together, and don't touch the red ones.
      </p>
      <div className="card home-card">
        <label>
          Your name
          <input value={name} maxLength={20} onChange={(e) => setNameState(e.target.value)} placeholder="Agent Pliers" />
        </label>
        <button className="primary" disabled={busy || !name.trim()} onClick={create}>
          Create a room
        </button>
        <div className="divider">or join one</div>
        <div className="row">
          <input
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            className="code-input"
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button disabled={!name.trim()} onClick={join}>
            Join
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
      <details className="card rules">
        <summary>How to play</summary>
        <ul>
          <li>Everyone shares one bomb. Its wires are dealt out and each stand is sorted low to high. You see only your own values.</li>
          <li>Before play, everyone shows one of their blue wires with an info token.</li>
          <li>
            <b>Two players:</b> each player runs two boards, each sorted on its own and each with its own opening info
            token. A twin probe must target two wires on the same board.
          </li>
          <li>
            <b>Dual cut:</b> point at a teammate&apos;s wire and call a value you hold. Right: both wires are cut. Wrong:
            the detonator ticks and an info token reveals that wire. Red: boom.
          </li>
          <li>
            <b>Solo cut:</b> if you hold every remaining copy of a value, cut them all.
          </li>
          <li>
            <b>Reveal reds:</b> if only red wires are left on your stand, reveal them safely.
          </li>
          <li>
            <b>Twin probe:</b> once per mission, point at two of a teammate&apos;s wires with one call. A red wire won&apos;t
            explode when probed.
          </li>
          <li>Yellow wires match any other yellow. The team survives (players − 1) mistakes.</li>
          <li>No talking about your hand! Only reason about public information.</li>
        </ul>
      </details>
    </main>
  );
}

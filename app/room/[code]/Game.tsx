"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { emitAck, getSocket } from "../../../src/client/socket";
import { boardName, boardsNeedingToken } from "../../../src/game/engine";
import { canRevealReds, provableSoloCuts } from "../../../src/game/helpers";
import type { Action, GameView, Highlight, WireView } from "../../../src/game/types";
import type { RoomUpdate } from "../../../src/server/protocol";

type Mode = "cut" | "probe";

export default function Game({ update }: { update: RoomUpdate }) {
  const view = update.game!;
  const { lobby } = update;
  const me = view.you;
  const [mode, setMode] = useState<Mode>("cut");
  const [sel, setSel] = useState<{ target: number; wires: number[] } | null>(null);
  // Which of your own wires you're calling with. Local-only: never sent until the cut is submitted.
  const [myWire, setMyWire] = useState<number | null>(null);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const playing = view.phase === "opening" || view.phase === "playing";
  const actor = view.pending ? view.pending.target : view.turn;
  const myMove = playing && me >= 0 && actor === me;
  const myPending = myMove && !!view.pending;
  const solos = useMemo(() => (me >= 0 ? provableSoloCuts(view) : []), [view, me]);
  const reds = me >= 0 && canRevealReds(view);

  // Reset selection whenever the turn changes.
  useEffect(() => {
    setSel(null);
    setMyWire(null);
    setError("");
    if (view.players[me]?.probeUsed) setMode("cut");
  }, [view.turn, view.phase, view.pending, me, view.players]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [view.log.length]);

  async function send(action: Action) {
    setError("");
    const res = await emitAck("game:action", action);
    if (res.error) setError(res.error);
    setSel(null);
    setMyWire(null);
  }

  /** Sends the cut once both halves (teammate wire(s) + your wire) are chosen, in either order. */
  function trySend(nextSel: typeof sel, nextMine: number | null) {
    const complete = !!nextSel && (mode === "cut" ? nextSel.wires.length === 1 : nextSel.wires.length === 2);
    if (!complete || nextMine === null) return;
    if (mode === "cut") void send({ type: "dualCut", target: nextSel!.target, wire: nextSel!.wires[0], myWire: nextMine });
    else void send({ type: "twinProbe", target: nextSel!.target, wires: [nextSel!.wires[0], nextSel!.wires[1]], myWire: nextMine });
  }

  function clickWire(player: number, wire: number) {
    if (!myMove) return;
    const w = view.players[player].wires[wire];
    if (myPending) {
      if (player === me && view.pending!.wires.includes(wire)) void send({ type: "choosePending", wire });
      return;
    }
    if (view.phase === "opening") {
      if (player === me && w.color === "blue") void send({ type: "opening", wire });
      return;
    }
    if (player === me) {
      // Your own wire: its value is the call, and it's the copy cut on success.
      if (w.cut || w.color === "red") return;
      const next = myWire === wire ? null : wire;
      setMyWire(next);
      trySend(sel, next);
      return;
    }
    if (w.cut) return;
    let next: { target: number; wires: number[] };
    if (mode === "cut") next = { target: player, wires: [wire] };
    // Twin probe: both wires on the same board.
    else if (!sel || sel.target !== player || view.players[player].wires[sel.wires[0]]?.stand !== w.stand)
      next = { target: player, wires: [wire] };
    else if (sel.wires.includes(wire)) next = { target: player, wires: sel.wires.filter((x) => x !== wire) };
    else next = { target: player, wires: [...sel.wires.slice(-1), wire] };
    setSel(next);
    trySend(next, myWire);
  }

  const ready = !!sel && (mode === "cut" ? sel.wires.length === 1 : sel.wires.length === 2);

  // Seat order: me at the bottom, others clockwise starting after me.
  const n = view.players.length;
  const base = me >= 0 ? me : 0;
  const others = Array.from({ length: n }, (_, i) => (base + i) % n).filter((i) => i !== me);

  let prompt = "";
  if (view.phase === "won") prompt = "🎉 Bomb defused! Every wire is cut.";
  else if (view.phase === "lost") prompt = `💥 Boom. ${view.lostReason ?? ""}`;
  else if (myPending)
    prompt =
      view.pending!.kind === "probeReveal"
        ? "Both probed wires match. Pick which one to reveal."
        : "Pick which probed wire gets the info token.";
  else if (myMove && view.phase === "opening")
    prompt =
      view.players[me].stands > 1
        ? `Pick a blue wire on board ${boardsNeedingToken(view.players[me]).map(boardName).join(" / ")} to show with an info token.`
        : "Pick one of your blue wires to show with an info token.";
  else if (myMove && ready) prompt = "Now click one of your own wires to call its value.";
  else if (myMove && myWire !== null)
    prompt = mode === "probe" ? "Now pick two wires on one teammate." : "Now pick a teammate's wire to cut.";
  else if (myMove)
    prompt =
      mode === "probe"
        ? "Twin probe: pick two wires on one teammate and one of your own wires, in any order."
        : "Your turn: pick a teammate's wire and one of your own wires, in any order.";
  else if (me < 0) prompt = `Spectating. Waiting on ${view.players[actor].name}…`;
  else prompt = `Waiting on ${view.players[actor].name}…`;

  return (
    <main className="game">
      <header className="topbar">
        <div className="logo small">
          Snip <span>Happens</span>
        </div>
        <div className="code">Room {lobby.code}</div>
        <Detonator view={view} />
      </header>

      <Tracker view={view} />

      <section className="stands">
        {others.map((p) => (
          <Stand key={p} view={view} player={p} sel={sel} onClick={clickWire} actor={actor} />
        ))}
      </section>

      <section className={`prompt ${view.phase}`}>{prompt}</section>

      {me >= 0 && (
        <section className="mine">
          <Stand view={view} player={me} sel={sel} onClick={clickWire} actor={actor} mine callable={myMove && !myPending && view.phase === "playing" && myWire === null}
            ownSel={myWire} />
          {myMove && view.phase === "playing" && !myPending && (
            <div className="controls">
              <div className="modes">
                <button className={mode === "cut" ? "active" : ""} onClick={() => (setMode("cut"), setSel(null), setMyWire(null))}>
                  ✂️ Dual cut
                </button>
                <button
                  className={mode === "probe" ? "active" : ""}
                  disabled={view.players[me].probeUsed}
                  onClick={() => (setMode("probe"), setSel(null), setMyWire(null))}
                  title="Once per mission: point at two wires with one call"
                >
                  🔍 Twin probe {view.players[me].probeUsed && "(used)"}
                </button>
                {solos.map((c) => (
                  <button key={String(c)} className="good" onClick={() => send({ type: "soloCut", call: c })}>
                    Solo cut all {c === "yellow" ? "yellows" : `${c}s`}
                  </button>
                ))}
                {reds && (
                  <button className="danger" onClick={() => send({ type: "revealReds" })}>
                    Reveal my reds
                  </button>
                )}
              </div>
              <p className="muted hint">
                Only you see which of your wires you pick; it&apos;s only revealed if the cut succeeds. Click a selected wire again to
                deselect it.
              </p>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {!playing && lobby.isHost && (
        <div className="endbar">
          <button className="primary big" onClick={() => getSocket().emit("room:abort")}>
            Back to lobby
          </button>
        </div>
      )}
      {playing && lobby.isHost && (
        <button className="link abort" onClick={() => confirm("Abandon this mission?") && getSocket().emit("room:abort")}>
          abandon mission
        </button>
      )}

      <aside className="log" ref={logRef}>
        {view.log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </aside>
    </main>
  );
}

function Detonator({ view }: { view: GameView }) {
  const left = view.maxMistakes - view.mistakes;
  return (
    <div className="detonator" title={`The team can survive ${Math.max(0, left - 1)} more mistake(s)`}>
      <span className="muted">Detonator</span>
      {Array.from({ length: view.maxMistakes }, (_, i) => (
        <span key={i} className={`notch ${i < view.mistakes ? "spent" : ""} ${i === view.maxMistakes - 1 ? "last" : ""}`} />
      ))}
    </div>
  );
}

type PinState = "cut" | "in" | "maybe" | "out";

function pinStates(view: GameView, color: "yellow" | "red", cands: number[], inPlay: number) {
  const cut = new Set<number>();
  const mine = new Set<number>();
  view.players.forEach((p, pi) =>
    p.wires.forEach((w) => {
      if (w.color !== color) return;
      if (w.cut) cut.add(w.value!);
      else if (pi === view.you) mine.add(w.value!);
    }),
  );
  const leftInPlay = inPlay - cut.size;
  const leftCands = cands.filter((c) => !cut.has(c)).length;
  const out = new Map<number, { state: PinState; mine: boolean }>();
  for (const c of cands) {
    const state: PinState = cut.has(c) ? "cut" : leftInPlay <= 0 ? "out" : leftInPlay >= leftCands ? "in" : "maybe";
    out.set(c, { state, mine: mine.has(c) });
  }
  return out;
}

function Pin({ color, value, state, mine }: { color: "yellow" | "red"; value: number; state: PinState; mine: boolean }) {
  const desc = { cut: "cut", in: "in play", maybe: "maybe in play", out: "not in play" }[state];
  return (
    <span className={`pin ${color} ${state} ${mine ? "mine" : ""}`} title={`${color} ${value.toFixed(1)}: ${desc}${mine ? " (you hold it)" : ""}`}>
      {state === "maybe" ? "?" : state === "cut" ? "✓" : state === "out" ? "✕" : ""}
    </span>
  );
}

function Tracker({ view }: { view: GameView }) {
  const { settings } = view;
  const yellow = pinStates(view, "yellow", view.yellowCandidates, settings.yellowCount);
  const red = pinStates(view, "red", view.redCandidates, settings.redCount);
  return (
    <section className="tracker">
      <div className="board">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((v) => {
          const y = yellow.get(v + 0.1);
          const r = red.get(v + 0.5);
          return (
            <Fragment key={v}>
              <div className={`track ${view.blueCut[v] === 4 ? "done" : ""}`} title={`${view.blueCut[v]}/4 cut`}>
                <b>{v}</b>
                <span className="pips">
                  {[0, 1, 2, 3].map((k) => (
                    <i key={k} className={k < view.blueCut[v] ? "on" : ""} />
                  ))}
                </span>
              </div>
              {v < 12 && (
                <div className={`gap ${y || r ? "has-pins" : ""}`}>
                  {y && <Pin color="yellow" value={v + 0.1} {...y} />}
                  {r && <Pin color="red" value={v + 0.5} {...r} />}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {(settings.yellowDrawn > 0 || settings.redDrawn > 0) && (
        <div className="legend">
          {settings.yellowDrawn > 0 && (
            <span>
              <span className="pin yellow in" /> Yellow: {settings.yellowCount}
              {settings.yellowDrawn > settings.yellowCount && ` of ${settings.yellowDrawn}`} in play, {view.yellowCut} cut
            </span>
          )}
          {settings.redDrawn > 0 && (
            <span>
              <span className="pin red in" /> Red: {settings.redCount}
              {settings.redDrawn > settings.redCount && ` of ${settings.redDrawn}`} in play
            </span>
          )}
          <span className="muted">? = maybe in play · ✓ = cut · ✕ = ruled out</span>
        </div>
      )}
    </section>
  );
}

function Stand({
  view,
  player,
  sel,
  onClick,
  actor,
  mine,
  callable,
  ownSel,
}: {
  view: GameView;
  player: number;
  sel: { target: number; wires: number[] } | null;
  onClick: (p: number, w: number) => void;
  actor: number;
  mine?: boolean;
  callable?: boolean;
  ownSel?: number | null;
}) {
  const p = view.players[player];
  const hl = new Map<number, Highlight["tone"]>();
  for (const h of view.highlights) if (h.player === player) hl.set(h.wire, h.tone);
  const pendingWires: number[] = view.pending && view.pending.target === player ? view.pending.wires : [];
  const left = p.wires.filter((w) => !w.cut).length;
  return (
    <div className={`stand ${actor === player && view.phase !== "won" && view.phase !== "lost" ? "active" : ""} ${mine ? "is-mine" : ""}`}>
      <div className="stand-head">
        <span className="pname">
          {p.kind === "ai" ? "🤖" : "🧑"} {p.name}
          {mine && " (you)"}
        </span>
        {view.captain === player && <span className="tag">captain</span>}
        {p.probeUsed && <span className="tag dim">probe used</span>}
        <span className="muted">{left} left</span>
      </div>
      <div className="boards">
        {Array.from({ length: p.stands }, (_, st) => (
          <div key={st} className="board-row">
            {p.stands > 1 && <span className="board-label">{boardName(st)}</span>}
            <div className="wires">
              {p.wires.map((w, i) =>
                w.stand !== st ? null : (
                  <WireTile
                    key={w.id}
                    w={w}
                    tone={hl.get(i)}
                    selected={(!!sel && sel.target === player && sel.wires.includes(i)) || (!!mine && ownSel === i)}
                    pending={pendingWires.includes(i)}
                    callable={!!callable && !w.cut && w.color !== "red"}
                    onClick={() => onClick(player, i)}
                  />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WireTile({
  w,
  tone,
  selected,
  pending,
  callable,
  onClick,
}: {
  w: WireView;
  callable?: boolean;
  tone?: Highlight["tone"];
  selected: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  const known = w.color !== undefined;
  const cls = ["wire", known ? w.color : "hidden", w.cut ? "cut" : "", selected ? "selected" : "", pending ? "pending" : "", callable ? "callable" : "", tone ? `hl-${tone}` : ""].join(" ");
  const label = known ? (w.color === "blue" ? String(w.value) : w.value!.toFixed(1)) : "";
  return (
    <button className={cls} onClick={onClick}>
      {w.info !== null && !w.cut && <span className={`info ${w.info === "yellow" ? "yellow" : ""}`}>{w.info === "yellow" ? "Y" : w.info}</span>}
      <span className="val">{label}</span>
    </button>
  );
}

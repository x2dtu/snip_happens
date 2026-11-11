"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { emitAck, getSocket } from "../../../src/client/socket";
import { boardName, boardsNeedingToken } from "../../../src/game/engine";
import { equipmentInfo, ON_YOUR_TURN } from "../../../src/game/equipment";
import { canRevealReds, provableSoloCuts } from "../../../src/game/helpers";
import type { Action, GameView, Highlight, WireView } from "../../../src/game/types";
import type { RoomUpdate } from "../../../src/server/protocol";

/** "cut" and "twin" are your basic moves; numbers are equipment cards that need you to pick things. */
type Mode = "cut" | "twin" | 1 | 2 | 3 | 4 | 5 | 7 | 8 | 10 | 11 | 12;

interface ModeSpec {
  /** Teammate wires to pick: a count, or "board" for a whole board. */
  target: number | "board";
  /** Own wires to pick. */
  own: number;
  ownOk: (w: WireView) => boolean;
  prompt: string;
}

const callable = (w: WireView) => !w.cut && w.color !== "red";
const blueUncut = (w: WireView) => !w.cut && w.color === "blue";

const SPECS: Record<string, ModeSpec> = {
  cut: { target: 1, own: 1, ownOk: callable, prompt: "Pick a teammate's wire and one of your own wires, in any order." },
  twin: { target: 2, own: 1, ownOk: callable, prompt: "Twin probe: pick two wires on one teammate board and one of your own wires." },
  1: { target: 0, own: 2, ownOk: () => true, prompt: "Label ≠: pick two of your adjacent wires with different values." },
  12: { target: 0, own: 2, ownOk: () => true, prompt: "Label =: pick two of your adjacent wires with the same value." },
  2: { target: 1, own: 1, ownOk: (w) => !w.cut, prompt: "Walkie-Talkies: pick one of your uncut wires to give, and any wire of the teammate to swap with." },
  3: { target: 3, own: 1, ownOk: blueUncut, prompt: "Triple Detector: pick three wires on one teammate board and one of your blue wires." },
  4: { target: 0, own: 1, ownOk: (w) => blueUncut(w) && w.info === null, prompt: "Post-It: pick one of your blue wires to show." },
  5: { target: "board", own: 1, ownOk: blueUncut, prompt: "Super Detector: click any wire on a teammate's board, and one of your blue wires." },
  7: { target: 0, own: 0, ownOk: () => false, prompt: "Emergency Batteries: pick one or two used twin probes to recharge." },
  8: { target: 0, own: 0, ownOk: () => false, prompt: "General Radar: pick a value." },
  10: { target: 1, own: 2, ownOk: callable, prompt: "X or Y Ray: pick a teammate's wire and two of your wires with different values." },
  11: { target: 0, own: 0, ownOk: () => false, prompt: "Coffee Mug: pick who goes next." },
};

export default function Game({ update }: { update: RoomUpdate }) {
  const view = update.game!;
  const { lobby } = update;
  const me = view.you;
  const [mode, setMode] = useState<Mode>("cut");
  const [sel, setSel] = useState<{ target: number; wires: number[] } | null>(null);
  // Your own picked wires. Local-only: never sent until the action is submitted.
  const [mine, setMine] = useState<number[]>([]);
  const [batteries, setBatteries] = useState<number[]>([]);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const playing = view.phase === "opening" || view.phase === "playing";
  const actor = view.pending ? view.pending.target : view.turn;
  const myMove = playing && me >= 0 && actor === me;
  const myPending = myMove && !!view.pending;
  const myTurn = view.phase === "playing" && me >= 0 && view.turn === me && !view.pending;
  const canUseAnytime = view.phase === "playing" && me >= 0 && !view.pending;
  const solos = useMemo(() => (me >= 0 ? provableSoloCuts(view) : []), [view, me]);
  const reds = me >= 0 && canRevealReds(view);
  const spec = SPECS[String(mode)];
  // Turn-only modes need it to be your turn; out-of-turn equipment just needs the game to be idle.
  const modeActive = typeof mode === "number" && !ON_YOUR_TURN.has(mode) ? canUseAnytime : myTurn;

  function clearPicks() {
    setSel(null);
    setMine([]);
    setBatteries([]);
  }

  // Reset selection whenever the game state changes.
  useEffect(() => {
    clearPicks();
    setError("");
    if (!canUseAnytime || (mode === "twin" && view.players[me]?.probeUsed)) setMode("cut");
    else if (typeof mode === "number" && view.equipment.find((e) => e.card === mode)?.used) setMode("cut");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [view.log.length]);

  async function send(action: Action) {
    setError("");
    const res = await emitAck("game:action", action);
    if (res.error) setError(res.error);
    clearPicks();
    if (!res.error) setMode("cut");
  }

  function startMode(m: Mode) {
    clearPicks();
    setError("");
    setMode(m);
  }

  /** Sends once every required pick is made, whatever order they were clicked in. */
  function tryComplete(nextSel: typeof sel, nextMine: number[]) {
    const needTarget = spec.target === "board" ? 1 : spec.target;
    const haveTarget = nextSel ? nextSel.wires.length : 0;
    if (haveTarget < needTarget || nextMine.length < spec.own) return;
    const t = nextSel?.target ?? -1;
    const tw = nextSel?.wires ?? [];
    switch (mode) {
      case "cut":
        return void send({ type: "dualCut", target: t, wire: tw[0], myWire: nextMine[0] });
      case "twin":
        return void send({ type: "probe", device: "twin", target: t, wires: tw, myWire: nextMine[0] });
      case 3:
        return void send({ type: "probe", device: "triple", target: t, wires: tw, myWire: nextMine[0] });
      case 5:
        return void send({ type: "probe", device: "super", target: t, wires: tw, myWire: nextMine[0] });
      case 10:
        return void send({ type: "dualCut", target: t, wire: tw[0], myWire: nextMine[0], myWire2: nextMine[1] });
      case 2:
        return void send({ type: "equipment", card: 2, target: t, myWire: nextMine[0] });
      case 4:
        return void send({ type: "equipment", card: 4, wire: nextMine[0] });
      case 1:
      case 12:
        return void send({ type: "equipment", card: mode, wires: [nextMine[0], nextMine[1]] });
    }
  }

  function clickWire(player: number, wire: number) {
    const w = view.players[player].wires[wire];
    if (myPending) {
      if (player === me && view.pending!.wires.includes(wire)) void send({ type: "choosePending", wire });
      return;
    }
    if (myMove && view.phase === "opening") {
      if (player === me && w.color === "blue") void send({ type: "opening", wire });
      return;
    }
    if (!modeActive) return;
    if (player === me) {
      if (!spec.own || !spec.ownOk(w)) return;
      const next = mine.includes(wire) ? mine.filter((x) => x !== wire) : [...mine, wire].slice(-spec.own);
      setMine(next);
      tryComplete(sel, next);
      return;
    }
    if (!spec.target || w.cut) return;
    const tp = view.players[player];
    let next: { target: number; wires: number[] };
    if (spec.target === "board") {
      next = { target: player, wires: tp.wires.map((x, i) => (x.stand === w.stand && !x.cut ? i : -1)).filter((i) => i >= 0) };
    } else if (spec.target === 1) {
      next = { target: player, wires: [wire] };
    } else if (!sel || sel.target !== player || tp.wires[sel.wires[0]]?.stand !== w.stand) {
      next = { target: player, wires: [wire] };
    } else if (sel.wires.includes(wire)) {
      next = { target: player, wires: sel.wires.filter((x) => x !== wire) };
    } else {
      next = { target: player, wires: [...sel.wires, wire].slice(-spec.target) };
    }
    setSel(next);
    tryComplete(next, mine);
  }

  // Seat order: me at the bottom, others clockwise starting after me.
  const n = view.players.length;
  const base = me >= 0 ? me : 0;
  const others = Array.from({ length: n }, (_, i) => (base + i) % n).filter((i) => i !== me);

  let prompt = "";
  if (view.phase === "won") prompt = "🎉 Bomb defused! Every wire is cut.";
  else if (view.phase === "lost") prompt = `💥 Boom. ${view.lostReason ?? ""}`;
  else if (myPending) {
    const k = view.pending!.kind;
    prompt =
      k === "probeReveal"
        ? "Several probed wires match. Pick which one to reveal."
        : k === "probeInfo"
          ? "Pick which probed wire gets the info token."
          : `Walkie-Talkies: pick one of your uncut wires to give to ${view.players[view.pending!.actor].name}.`;
  } else if (myMove && view.phase === "opening")
    prompt =
      view.players[me].stands > 1
        ? `Pick a blue wire on board ${boardsNeedingToken(view.players[me]).map(boardName).join(" / ")} to show with an info token.`
        : "Pick one of your blue wires to show with an info token.";
  else if (modeActive && (mode !== "cut" || myTurn)) prompt = (mode === "cut" ? "Your turn: " : "") + spec.prompt;
  else if (me < 0) prompt = `Spectating. Waiting on ${view.players[actor].name}…`;
  else prompt = `Waiting on ${view.players[actor].name}…`;

  const equipReady = (card: number) => {
    const e = view.equipment.find((x) => x.card === card);
    return !!e && e.unlocked && !e.used && (ON_YOUR_TURN.has(card) ? myTurn : canUseAnytime);
  };

  function playCard(card: number) {
    if (card === 6 || card === 9) return void send({ type: "equipment", card });
    startMode(card as Mode);
  }

  const ownHighlight = modeActive && spec.own > 0 && mine.length < spec.own;

  return (
    <main className="game">
      <header className="topbar">
        <div className="logo small">
          Snip <span>Happens</span>
        </div>
        <div className="code">Room {lobby.code}</div>
        {view.stabilized && <span className="tag">🛡 stabilized</span>}
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
          <Stand
            view={view}
            player={me}
            sel={sel}
            onClick={clickWire}
            actor={actor}
            mine
            callable={ownHighlight ? spec.ownOk : undefined}
            ownSel={mine}
          />
          {view.phase === "playing" && !myPending && (
            <div className="controls">
              <div className="modes">
                {myTurn && (
                  <>
                    <button className={mode === "cut" ? "active" : ""} onClick={() => startMode("cut")}>
                      ✂️ Dual cut
                    </button>
                    <button
                      className={mode === "twin" ? "active" : ""}
                      disabled={view.players[me].probeUsed}
                      onClick={() => startMode("twin")}
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
                  </>
                )}
                {typeof mode === "number" && (
                  <button className="link" onClick={() => startMode("cut")}>
                    cancel {equipmentInfo(mode).title}
                  </button>
                )}
              </div>

              {mode === 7 && modeActive && (
                <div className="choices">
                  {view.players.map((p, i) =>
                    p.probeUsed ? (
                      <button
                        key={i}
                        className={batteries.includes(i) ? "active" : ""}
                        onClick={() =>
                          setBatteries(batteries.includes(i) ? batteries.filter((x) => x !== i) : [...batteries, i].slice(-2))
                        }
                      >
                        {p.name}
                      </button>
                    ) : null,
                  )}
                  {!view.players.some((p) => p.probeUsed) && <span className="muted">No twin probes have been used yet.</span>}
                  <button className="primary" disabled={!batteries.length} onClick={() => send({ type: "equipment", card: 7, players: batteries })}>
                    Recharge
                  </button>
                </div>
              )}
              {mode === 8 && modeActive && (
                <div className="choices">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((v) => (
                    <button key={v} className="call" onClick={() => send({ type: "equipment", card: 8, value: v })}>
                      {v}
                    </button>
                  ))}
                </div>
              )}
              {mode === 11 && modeActive && (
                <div className="choices">
                  {view.players.map((p, i) =>
                    i !== me && p.wires.some((w) => !w.cut) ? (
                      <button key={i} onClick={() => send({ type: "equipment", card: 11, next: i })}>
                        {p.name}
                      </button>
                    ) : null,
                  )}
                </div>
              )}

              {myTurn && (
                <p className="muted hint">
                  Only you see which of your wires you pick; it&apos;s only revealed if the cut succeeds. Click a selected wire again to
                  deselect it.
                </p>
              )}
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {view.equipment.length > 0 && <EquipmentPanel view={view} ready={equipReady} active={mode} onUse={playCard} />}

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

function EquipmentPanel({
  view,
  ready,
  active,
  onUse,
}: {
  view: GameView;
  ready: (card: number) => boolean;
  active: Mode;
  onUse: (card: number) => void;
}) {
  return (
    <section className="equipment">
      {view.equipment.map((e) => {
        const info = equipmentInfo(e.card);
        const status = e.used ? "used" : e.unlocked ? "ready" : `${Math.min(view.blueCut[e.card], 2)}/2 cut`;
        return (
          <div key={e.card} className={`equip ${e.used ? "used" : e.unlocked ? "unlocked" : "locked"} ${active === e.card ? "active" : ""}`}>
            <div className="equip-head">
              <span className="equip-num">{e.card}</span>
              <b>{info.title}</b>
              <span className="muted equip-status">{status}</span>
            </div>
            <p className="equip-desc">{info.description}</p>
            <div className="equip-foot">
              <span className="muted">{ON_YOUR_TURN.has(e.card) ? "your turn only" : "any time"}</span>
              <button disabled={!ready(e.card)} onClick={() => onUse(e.card)}>
                Use
              </button>
            </div>
          </div>
        );
      })}
    </section>
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
  callable?: (w: WireView) => boolean;
  ownSel?: number[];
}) {
  const p = view.players[player];
  const labelBetween = (a: WireView, b: WireView | undefined) =>
    b && view.labels.find((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
  // Latest radar answer per board.
  const radarFor = (st: number) => {
    for (let r = view.radar.length - 1; r >= 0; r--) {
      const b = view.radar[r].boards.find((x) => x.player === player && x.stand === st);
      if (b) return { value: view.radar[r].value, yes: b.yes };
    }
    return null;
  };
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
              {p.wires.map((w, i) => {
                if (w.stand !== st) return null;
                const next = p.wires[i + 1]?.stand === st ? p.wires[i + 1] : undefined;
                const label = labelBetween(w, next);
                return (
                  <Fragment key={w.id}>
                    <WireTile
                      w={w}
                      tone={hl.get(i)}
                      selected={(!!sel && sel.target === player && sel.wires.includes(i)) || (!!mine && !!ownSel?.includes(i))}
                      pending={pendingWires.includes(i)}
                      callable={!!callable && callable(w)}
                      onClick={() => onClick(player, i)}
                    />
                    {label && (
                      <span className={`label-token ${label.kind}`} title={label.kind === "eq" ? "Same value" : "Different values"}>
                        {label.kind === "eq" ? "=" : "≠"}
                      </span>
                    )}
                  </Fragment>
                );
              })}
            </div>
            {(() => {
              const r = radarFor(st);
              return r ? (
                <span className={`radar ${r.yes ? "yes" : "no"}`} title={`General Radar on ${r.value}`}>
                  📡 {r.value}: {r.yes ? "yes" : "no"}
                </span>
              ) : null;
            })()}
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

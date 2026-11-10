import type {
  Action,
  Call,
  GameSettings,
  GameState,
  GameView,
  Highlight,
  InfoToken,
  PlayerState,
  Wire,
} from "./types";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const BLUE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const COPIES_PER_BLUE = 4;
export const YELLOW_POOL = [1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1, 11.1];
export const RED_POOL = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];

const S = (yellowCount: number, yellowDrawn: number, redCount: number, redDrawn: number): GameSettings => ({
  yellowCount,
  yellowDrawn,
  redCount,
  redDrawn,
});

export const PRESETS: { name: string; description: string; settings: GameSettings }[] = [
  { name: "Training", description: "Blue wires only.", settings: S(0, 0, 0, 0) },
  { name: "Caution Tape", description: "Blue plus 2 yellow wires.", settings: S(2, 2, 0, 0) },
  { name: "Live Wire", description: "Blue plus 1 red wire.", settings: S(0, 0, 1, 1) },
  { name: "Full Rig", description: "Blue, 2 yellow and 2 red wires.", settings: S(2, 2, 2, 2) },
  { name: "Fog", description: "2 of 3 yellow, 1 of 2 red. You don't know which.", settings: S(2, 3, 1, 2) },
  { name: "Meltdown", description: "4 yellow and 2 of 3 red.", settings: S(4, 4, 2, 3) },
];

export const MAX_YELLOW = 4;
export const MAX_RED = 3;
export const MAX_DRAWN = 6;

export function clampSettings(s: Partial<GameSettings>): GameSettings {
  const clamp = (n: unknown, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Number.isInteger(n) ? (n as number) : lo));
  const yellowCount = clamp(s.yellowCount, 0, MAX_YELLOW);
  const redCount = clamp(s.redCount, 0, MAX_RED);
  return {
    yellowCount,
    yellowDrawn: clamp(s.yellowDrawn ?? yellowCount, yellowCount, Math.max(yellowCount, MAX_DRAWN)),
    redCount,
    redDrawn: clamp(s.redDrawn ?? redCount, redCount, Math.max(redCount, MAX_DRAWN)),
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createGame(
  seats: { name: string; kind: "human" | "ai" }[],
  settings: GameSettings,
  captain = 0,
  rand: () => number = Math.random,
): GameState {
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
    throw new Error(`Need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  }
  const s = clampSettings(settings);
  const values: { value: number; color: Wire["color"] }[] = [];
  for (const v of BLUE_VALUES) for (let i = 0; i < COPIES_PER_BLUE; i++) values.push({ value: v, color: "blue" });
  // Draw candidates publicly, then secretly keep only *Count of them ("X out of Y").
  const yellowCandidates = shuffle(YELLOW_POOL, rand).slice(0, s.yellowDrawn);
  const redCandidates = shuffle(RED_POOL, rand).slice(0, s.redDrawn);
  for (const v of shuffle(yellowCandidates, rand).slice(0, s.yellowCount)) values.push({ value: v, color: "yellow" });
  for (const v of shuffle(redCandidates, rand).slice(0, s.redCount)) values.push({ value: v, color: "red" });

  const deck = shuffle(values, rand);
  const n = seats.length;
  // Two players each run two boards, so the bomb is laid out like a four-player game.
  const standsPer = n === 2 ? 2 : 1;
  const players: PlayerState[] = seats.map((seat) => ({
    name: seat.name,
    kind: seat.kind,
    wires: [],
    stands: standsPer,
    probeUsed: false,
  }));
  // Deal board by board starting from the captain so any extra wires go round evenly.
  // Board k belongs to player k % n (its local board index is floor(k / n)).
  const boards: Wire[][] = Array.from({ length: n * standsPer }, () => []);
  deck.forEach((w, i) => {
    const k = (captain + i) % boards.length;
    boards[k].push({ id: 0, value: w.value, color: w.color, cut: false, info: null, stand: Math.floor(k / n) });
  });
  let id = 0;
  players.forEach((p, pi) => {
    for (let st = 0; st < standsPer; st++) {
      const board = boards[st * n + pi].sort((a, b) => a.value - b.value);
      p.wires.push(...board);
    }
    for (const w of p.wires) w.id = id++;
  });

  return {
    phase: "opening",
    players,
    captain,
    turn: captain,
    openingPlaced: 0,
    mistakes: 0,
    maxMistakes: players.length,
    settings: s,
    pending: null,
    log: [
      `Mission started. ${players[captain].name} is the captain.`,
      ...describeColor("yellow", yellowCandidates, s.yellowCount),
      ...describeColor("red", redCandidates, s.redCount),
      standsPer > 1
        ? `Each player runs two boards and places one info token on a blue wire on each board.`
        : `Each player places one info token on a blue wire.`,
    ],
    highlights: [],
    lostReason: null,
    yellowCandidates: yellowCandidates.sort((a, b) => a - b),
    redCandidates: redCandidates.sort((a, b) => a - b),
  };
}

function describeColor(color: string, cands: number[], inPlay: number): string[] {
  if (!cands.length) return [];
  const list = [...cands].sort((a, b) => a - b).join(", ");
  return inPlay === cands.length
    ? [`${color[0].toUpperCase() + color.slice(1)} wires in play: ${list}.`]
    : [`${inPlay} of these ${color} wires are in play (nobody knows which): ${list}.`];
}

// ---------- helpers ----------

export const boardName = (stand: number) => String.fromCharCode(65 + stand);

/** Boards that still need their opening info token (boards with no blue wire are skipped). */
export function boardsNeedingToken(p: { stands: number; wires: { stand: number; color?: string; info: InfoToken | null }[] }): number[] {
  const out: number[] = [];
  for (let st = 0; st < p.stands; st++) {
    const ws = p.wires.filter((w) => w.stand === st);
    if (ws.some((w) => w.color === "blue") && !ws.some((w) => w.info !== null)) out.push(st);
  }
  return out;
}

export function matches(w: Wire, call: Call): boolean {
  return call === "yellow" ? w.color === "yellow" : w.color === "blue" && w.value === call;
}

export function callLabel(call: Call): string {
  return call === "yellow" ? "yellow" : String(call);
}

export function wireLabel(w: { color?: string; value?: number }): string {
  if (w.color === "yellow") return `yellow ${w.value}`;
  if (w.color === "red") return `RED ${w.value}`;
  return String(w.value);
}

function tokenFor(w: Wire): InfoToken | null {
  if (w.color === "red") return null;
  return w.color === "yellow" ? "yellow" : w.value;
}

function findMatch(p: PlayerState, call: Call): number {
  return p.wires.findIndex((w) => !w.cut && matches(w, call));
}

export function canSoloCut(state: GameState, actor: number, call: Call): boolean {
  const mine = state.players[actor].wires.filter((w) => !w.cut && matches(w, call)).length;
  if (mine === 0) return false;
  let total = 0;
  for (const p of state.players) total += p.wires.filter((w) => !w.cut && matches(w, call)).length;
  return total === mine;
}

/** Validates the actor's chosen own wire and returns the value it calls. */
function callFromOwnWire(p: PlayerState, i: unknown): Call | string {
  if (!isWireIndex(p, i)) return "Pick one of your own wires to call its value.";
  const w = p.wires[i];
  if (w.cut) return "That wire of yours is already cut.";
  if (w.color === "red") return "You can't call a red wire.";
  return w.color === "yellow" ? "yellow" : w.value;
}

function isValidCall(call: unknown): call is Call {
  return call === "yellow" || (Number.isInteger(call) && (call as number) >= 1 && (call as number) <= 12);
}

function isWireIndex(p: PlayerState, i: unknown): i is number {
  return Number.isInteger(i) && (i as number) >= 0 && (i as number) < p.wires.length;
}

function log(state: GameState, msg: string) {
  state.log.push(msg);
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

function addMistake(state: GameState): boolean {
  state.mistakes++;
  if (state.mistakes >= state.maxMistakes) {
    state.phase = "lost";
    state.lostReason = "The detonator ran out of slack.";
    log(state, "💥 Too many mistakes. The bomb went off.");
    return true;
  }
  return false;
}

function checkWin(state: GameState): boolean {
  if (state.players.every((p) => p.wires.every((w) => w.cut))) {
    state.phase = "won";
    state.pending = null;
    log(state, "🎉 Every wire is cut. The bomb is defused!");
    return true;
  }
  return false;
}

function advanceTurn(state: GameState) {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const next = (state.turn + i) % n;
    if (state.players[next].wires.some((w) => !w.cut)) {
      state.turn = next;
      return;
    }
  }
}

/** Who the server is currently waiting on. */
export function actingPlayer(state: GameState): number {
  if (state.pending) return state.pending.target;
  return state.turn;
}

function cutActorWire(state: GameState, actor: number, i: number, hl: Highlight[]) {
  state.players[actor].wires[i].cut = true;
  hl.push({ player: actor, wire: i, tone: "hit" });
}

function finishTurn(state: GameState) {
  if (state.phase !== "playing") return;
  if (!checkWin(state)) advanceTurn(state);
}

// ---------- actions ----------

/** Applies an action in place. Returns an error message, or null on success. */
export function applyAction(state: GameState, actor: number, action: Action): string | null {
  if (state.phase === "won" || state.phase === "lost") return "The mission is over.";
  if (!action || typeof action !== "object") return "Bad action.";
  if (actor !== actingPlayer(state)) return "It's not your move.";
  const me = state.players[actor];
  const hl: Highlight[] = [];

  if (state.pending) {
    if (action.type !== "choosePending") return "Pick one of the two highlighted wires.";
    const pend = state.pending;
    if (!pend.wires.includes(action.wire)) return "Pick one of the two highlighted wires.";
    const w = me.wires[action.wire];
    const actorName = state.players[pend.actor].name;
    if (pend.kind === "probeReveal") {
      w.cut = true;
      hl.push({ player: actor, wire: action.wire, tone: "hit" });
      const own = state.players[pend.actor];
      const aw = pend.actorWire !== undefined && !own.wires[pend.actorWire].cut ? pend.actorWire : findMatch(own, pend.call);
      cutActorWire(state, pend.actor, aw, hl);
      log(state, `${me.name} reveals a ${wireLabel(w)}. ${actorName}'s twin probe hits.`);
    } else {
      w.info = tokenFor(w);
      hl.push({ player: actor, wire: action.wire, tone: "info" });
      log(state, `${me.name} puts an info token (${w.info}) on one of the probed wires.`);
    }
    state.pending = null;
    state.highlights = hl;
    finishTurn(state);
    return null;
  }

  if (state.phase === "opening") {
    if (action.type !== "opening") return "Place your opening info token first.";
    if (!isWireIndex(me, action.wire)) return "Bad wire.";
    const w = me.wires[action.wire];
    if (w.color !== "blue") return "Opening tokens go on a blue wire.";
    if (!boardsNeedingToken(me).includes(w.stand)) return "That board already has its info token.";
    w.info = w.value;
    hl.push({ player: actor, wire: action.wire, tone: "info" });
    log(state, `${me.name} shows a ${w.value}${me.stands > 1 ? ` on board ${boardName(w.stand)}` : ""}.`);
    state.openingPlaced++;
    state.highlights = hl;
    if (boardsNeedingToken(me).length > 0) return null; // same player places on their other board
    if (state.players.every((p) => boardsNeedingToken(p).length === 0)) {
      state.phase = "playing";
      state.turn = state.captain;
      log(state, `Opening info is down. ${state.players[state.captain].name} goes first.`);
    } else {
      state.turn = (state.turn + 1) % state.players.length;
    }
    return null;
  }

  switch (action.type) {
    case "dualCut": {
      const { target, wire, myWire } = action;
      if (!Number.isInteger(target) || target < 0 || target >= state.players.length || target === actor)
        return "Pick a teammate's wire.";
      const tp = state.players[target];
      if (!isWireIndex(tp, wire) || tp.wires[wire].cut) return "That wire is already cut.";
      const call = callFromOwnWire(me, myWire);
      if (typeof call === "string" && call !== "yellow") return call;
      const w = tp.wires[wire];
      if (matches(w, call)) {
        w.cut = true;
        hl.push({ player: target, wire, tone: "hit" });
        cutActorWire(state, actor, myWire, hl);
        log(state, `${me.name} calls ${callLabel(call)} on ${tp.name}'s wire. Correct! It's a ${wireLabel(w)}.`);
      } else if (w.color === "red") {
        w.cut = true;
        hl.push({ player: target, wire, tone: "boom" });
        state.phase = "lost";
        state.lostReason = `${me.name} cut a red wire.`;
        log(state, `${me.name} calls ${callLabel(call)} on ${tp.name}'s wire. It's RED. 💥`);
      } else {
        w.info = tokenFor(w);
        hl.push({ player: target, wire, tone: "miss" });
        log(state, `${me.name} calls ${callLabel(call)} on ${tp.name}'s wire. Wrong, it's a ${w.info}. The detonator ticks.`);
        addMistake(state);
      }
      state.highlights = hl;
      finishTurn(state);
      return null;
    }

    case "twinProbe": {
      const { target, wires, myWire } = action;
      if (me.probeUsed) return "You already used your twin probe.";
      if (!Number.isInteger(target) || target < 0 || target >= state.players.length || target === actor)
        return "Pick a teammate's wires.";
      const tp = state.players[target];
      if (!Array.isArray(wires) || wires.length !== 2) return "Pick two wires.";
      const [a, b] = wires;
      if (!isWireIndex(tp, a) || !isWireIndex(tp, b) || a === b) return "Pick two different wires.";
      if (tp.wires[a].cut || tp.wires[b].cut) return "Both wires must be uncut.";
      if (tp.wires[a].stand !== tp.wires[b].stand) return "Both probed wires must be on the same board.";
      const call = callFromOwnWire(me, myWire);
      if (typeof call === "string" && call !== "yellow") return call;
      me.probeUsed = true;
      const wa = tp.wires[a];
      const wb = tp.wires[b];
      const hits = [a, b].filter((i) => matches(tp.wires[i], call));
      const intro = `${me.name} uses the twin probe on two of ${tp.name}'s wires, calling ${callLabel(call)}.`;
      if (hits.length === 1) {
        tp.wires[hits[0]].cut = true;
        hl.push({ player: target, wire: hits[0], tone: "hit" });
        cutActorWire(state, actor, myWire, hl);
        log(state, `${intro} Hit! One is a ${wireLabel(tp.wires[hits[0]])}.`);
      } else if (hits.length === 2) {
        state.pending = { kind: "probeReveal", actor, target, wires: [a, b], call, actorWire: myWire };
        log(state, `${intro} Both match! ${tp.name} chooses which one to reveal.`);
      } else {
        log(state, `${intro} Miss. The detonator ticks.`);
        if (!addMistake(state)) {
          const ca = wa.color;
          const cb = wb.color;
          if (ca === "red" && cb === "red") {
            log(state, "Neither wire can take an info token.");
          } else if (ca === "red" || cb === "red" || ca !== cb) {
            // Exactly one candidate: the non-red one, or blue over yellow.
            const pick = ca === "red" ? b : cb === "red" ? a : ca === "blue" ? a : b;
            tp.wires[pick].info = tokenFor(tp.wires[pick]);
            hl.push({ player: target, wire: pick, tone: "info" });
            log(state, `An info token (${tp.wires[pick].info}) goes on one of the probed wires.`);
          } else {
            state.pending = { kind: "probeInfo", actor, target, wires: [a, b] };
            log(state, `${tp.name} chooses which probed wire gets an info token.`);
          }
        }
      }
      state.highlights = hl;
      if (!state.pending) finishTurn(state);
      return null;
    }

    case "soloCut": {
      const { call } = action;
      if (!isValidCall(call)) return "Bad value.";
      if (!canSoloCut(state, actor, call)) return `You don't hold every remaining ${callLabel(call)}.`;
      me.wires.forEach((w, i) => {
        if (!w.cut && matches(w, call)) {
          w.cut = true;
          hl.push({ player: actor, wire: i, tone: "hit" });
        }
      });
      log(state, `${me.name} solo cuts every remaining ${callLabel(call)} (${hl.length}).`);
      state.highlights = hl;
      finishTurn(state);
      return null;
    }

    case "revealReds": {
      const left = me.wires.filter((w) => !w.cut);
      if (left.length === 0 || left.some((w) => w.color !== "red")) return "You can only reveal when all your uncut wires are red.";
      me.wires.forEach((w, i) => {
        if (!w.cut) {
          w.cut = true;
          hl.push({ player: actor, wire: i, tone: "info" });
        }
      });
      log(state, `${me.name} reveals ${left.length} red wire${left.length > 1 ? "s" : ""}. Safely cleared.`);
      state.highlights = hl;
      finishTurn(state);
      return null;
    }

    default:
      return "Unknown action.";
  }
}

// ---------- views ----------

export function viewFor(state: GameState, viewer: number): GameView {
  const over = state.phase === "won" || state.phase === "lost";
  const blueCut = new Array(13).fill(0);
  let yellowCut = 0;
  for (const p of state.players)
    for (const w of p.wires)
      if (w.cut) {
        if (w.color === "blue") blueCut[w.value]++;
        if (w.color === "yellow") yellowCut++;
      }

  return {
    phase: state.phase,
    you: viewer,
    players: state.players.map((p, pi) => ({
      name: p.name,
      kind: p.kind,
      probeUsed: p.probeUsed,
      stands: p.stands,
      wires: p.wires.map((w) =>
        w.cut || pi === viewer || over
          ? { id: w.id, cut: w.cut, info: w.info, stand: w.stand, color: w.color, value: w.value }
          : { id: w.id, cut: false, info: w.info, stand: w.stand },
      ),
    })),
    captain: state.captain,
    turn: state.turn,
    mistakes: state.mistakes,
    maxMistakes: state.maxMistakes,
    settings: state.settings,
    // Never expose which own wire the actor used (it stays hidden unless the cut succeeds).
    pending: state.pending && state.pending.kind === "probeReveal" ? { ...state.pending, actorWire: undefined } : state.pending,
    log: state.log.slice(-60),
    highlights: state.highlights,
    lostReason: state.lostReason,
    blueCut,
    yellowCut,
    yellowCandidates: state.yellowCandidates,
    redCandidates: state.redCandidates,
  };
}

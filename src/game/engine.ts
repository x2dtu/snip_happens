import { EQUIPMENT, equipmentInfo, ON_YOUR_TURN } from "./equipment";
import type {
  Action,
  Call,
  GameSettings,
  GameState,
  GameView,
  Highlight,
  InfoToken,
  PlayerState,
  RadarResult,
  Wire,
} from "./types";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const BLUE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const COPIES_PER_BLUE = 4;
export const YELLOW_POOL = [1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1, 11.1];
export const RED_POOL = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];

const S = (yellowCount: number, yellowDrawn: number, redCount: number, redDrawn: number, equipmentCount = 0): GameSettings => ({
  yellowCount,
  yellowDrawn,
  redCount,
  redDrawn,
  equipmentCount,
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
export const MAX_EQUIPMENT = 6;

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
    equipmentCount: clamp(s.equipmentCount ?? 0, 0, MAX_EQUIPMENT),
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
    equipment: shuffle(EQUIPMENT.map((e) => e.wire), rand)
      .slice(0, s.equipmentCount)
      .sort((a, b) => a - b)
      .map((card) => ({ card, used: false })),
    labels: [],
    radar: [],
    stabilized: false,
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
  state.stabilized = false;
  if (state.phase !== "playing") return;
  if (!checkWin(state)) advanceTurn(state);
}

// ---------- equipment helpers ----------

/** Same-ness used by the = / ≠ labels: any two yellows (or two reds) count as identical. */
function sameKind(a: Wire, b: Wire): boolean {
  if (a.color !== b.color) return false;
  return a.color === "blue" ? a.value === b.value : true;
}

function equipmentCard(state: GameState, card: number) {
  return state.equipment.find((e) => e.card === card);
}

export function isUnlocked(blueCut: number[], card: number): boolean {
  return blueCut[card] >= 2;
}

function blueCutCounts(state: GameState): number[] {
  const c = new Array(13).fill(0);
  for (const p of state.players) for (const w of p.wires) if (w.cut && w.color === "blue") c[w.value]++;
  return c;
}

/** Validates that equipment `card` is in play, unlocked and unused. */
function checkEquipment(state: GameState, card: number): string | null {
  const e = equipmentCard(state, card);
  if (!e) return "That equipment isn't in this mission.";
  if (e.used) return "That equipment has already been used.";
  if (!isUnlocked(blueCutCounts(state), card)) return `Equipment ${card} unlocks once two blue ${card}s are cut.`;
  return null;
}

function useEquipment(state: GameState, card: number) {
  equipmentCard(state, card)!.used = true;
}

const isPlayer = (state: GameState, p: unknown): p is number =>
  Number.isInteger(p) && (p as number) >= 0 && (p as number) < state.players.length;

/** Index range [start, end) of a board within a player's wire list. */
function boardRange(p: PlayerState, stand: number): [number, number] {
  const start = p.wires.findIndex((w) => w.stand === stand);
  let end = start;
  while (end < p.wires.length && p.wires[end].stand === stand) end++;
  return [start, end];
}

/** Puts info on the best candidate after a missed probe (blue first, then yellow; never red). */
function probeMissToken(state: GameState, actor: number, target: number, wires: number[], hl: Highlight[]) {
  const tp = state.players[target];
  const blues = wires.filter((i) => tp.wires[i].color === "blue");
  const yellows = wires.filter((i) => tp.wires[i].color === "yellow");
  const cands = blues.length ? blues : yellows;
  if (cands.length === 0) {
    log(state, "None of the probed wires can take an info token.");
  } else if (cands.length === 1) {
    const w = tp.wires[cands[0]];
    w.info = tokenFor(w);
    hl.push({ player: target, wire: cands[0], tone: "info" });
    log(state, `An info token (${w.info}) goes on one of the probed wires.`);
  } else {
    state.pending = { kind: "probeInfo", actor, target, wires: cands };
    log(state, `${tp.name} chooses which probed wire gets an info token.`);
  }
}

/** A failed cut: ticks the detonator unless the Stabilizer is active. Returns true if the game ended. */
function failedCut(state: GameState): boolean {
  if (state.stabilized) {
    log(state, "The Stabilizer holds. The detonator doesn't move.");
    return false;
  }
  return addMistake(state);
}

// ---------- actions ----------

function validTarget(state: GameState, actor: number, target: unknown): target is number {
  return isPlayer(state, target) && target !== actor;
}

function applyPending(state: GameState, actor: number, action: Action, hl: Highlight[]): string | null {
  const pend = state.pending!;
  if (action.type !== "choosePending") return "Finish the pending choice first.";
  const me = state.players[actor];
  if (!pend.wires.includes(action.wire)) return "Pick one of the highlighted wires.";
  const w = me.wires[action.wire];
  const actorName = state.players[pend.actor].name;
  state.pending = null;

  if (pend.kind === "probeReveal") {
    w.cut = true;
    hl.push({ player: actor, wire: action.wire, tone: "hit" });
    const own = state.players[pend.actor];
    const aw = pend.actorWire !== undefined && !own.wires[pend.actorWire].cut ? pend.actorWire : findMatch(own, pend.call);
    cutActorWire(state, pend.actor, aw, hl);
    log(state, `${me.name} reveals a ${wireLabel(w)}. ${actorName}'s probe hits.`);
  } else if (pend.kind === "probeInfo") {
    w.info = tokenFor(w);
    hl.push({ player: actor, wire: action.wire, tone: "info" });
    log(state, `${me.name} puts an info token (${w.info}) on one of the probed wires.`);
  } else {
    swapWires(state, pend.actor, pend.actorWire, actor, action.wire, hl);
    // Walkie-Talkies can be used outside your turn, so the turn doesn't move.
    state.highlights = hl;
    return null;
  }
  state.highlights = hl;
  finishTurn(state);
  return null;
}

/** Walkie-Talkies: each wire goes onto the board the other one came from, then boards re-sort. */
function swapWires(state: GameState, pa: number, ia: number, pb: number, ib: number, hl: Highlight[]) {
  const A = state.players[pa];
  const B = state.players[pb];
  const wa = A.wires[ia];
  const wb = B.wires[ib];
  const [sa, sb] = [wa.stand, wb.stand];
  A.wires[ia] = { ...wb, stand: sa };
  B.wires[ib] = { ...wa, stand: sb };
  for (const p of [A, B]) p.wires.sort((x, y) => x.stand - y.stand || x.value - y.value);
  // Labels only make sense between wires that stayed together.
  state.labels = state.labels.filter((l) => ![wa.id, wb.id].includes(l.a) && ![wa.id, wb.id].includes(l.b));
  const na = A.wires.findIndex((w) => w.id === wb.id);
  const nb = B.wires.findIndex((w) => w.id === wa.id);
  hl.push({ player: pa, wire: na, tone: "info" }, { player: pb, wire: nb, tone: "info" });
  log(
    state,
    `${A.name} and ${B.name} swap wires with the Walkie-Talkies. ${A.name}'s new wire is at position ${na + 1}, ${B.name}'s at position ${nb + 1}.`,
  );
}

function applyEquipment(state: GameState, actor: number, action: Extract<Action, { type: "equipment" }>, hl: Highlight[]): string | null {
  const me = state.players[actor];
  const card = action.card;
  const err = checkEquipment(state, card);
  if (err) return err;
  const title = equipmentInfo(card).title;
  const myTurn = actor === state.turn;
  if (ON_YOUR_TURN.has(card) && !myTurn) return `${title} can only be used on your turn.`;

  switch (card) {
    case 1:
    case 12: {
      const { wires } = action as { wires: [number, number] };
      if (!Array.isArray(wires) || wires.length !== 2) return "Pick two of your adjacent wires.";
      const [a, b] = [...wires].sort((x, y) => x - y);
      if (!isWireIndex(me, a) || !isWireIndex(me, b) || b !== a + 1 || me.wires[a].stand !== me.wires[b].stand)
        return "Pick two adjacent wires on the same board.";
      const [wa, wb] = [me.wires[a], me.wires[b]];
      if (wa.cut && wb.cut) return "At most one of the two wires can already be cut.";
      const same = sameKind(wa, wb);
      if (card === 12 && !same) return "Label = needs two wires of the same value.";
      if (card === 1 && same) return "Label ≠ needs two wires of different values.";
      useEquipment(state, card);
      state.labels.push({ kind: card === 12 ? "eq" : "neq", a: wa.id, b: wb.id });
      hl.push({ player: actor, wire: a, tone: "info" }, { player: actor, wire: b, tone: "info" });
      log(state, `${me.name} uses ${title}: wires ${a + 1} and ${b + 1} are ${card === 12 ? "the same" : "different"}.`);
      break;
    }
    case 2: {
      const { target, myWire } = action as { target: number; myWire: number };
      if (!validTarget(state, actor, target)) return "Pick a teammate to swap with.";
      if (!isWireIndex(me, myWire) || me.wires[myWire].cut) return "Pick one of your uncut wires to give.";
      const tp = state.players[target];
      const theirs = tp.wires.map((w, i) => (w.cut ? -1 : i)).filter((i) => i >= 0);
      if (!theirs.length) return "That teammate has no uncut wires.";
      useEquipment(state, card);
      state.pending = { kind: "walkie", actor, target, actorWire: myWire, wires: theirs };
      hl.push({ player: actor, wire: myWire, tone: "info" });
      log(state, `${me.name} uses ${title} with ${tp.name}, offering their wire at position ${myWire + 1}. ${tp.name} picks a wire to give back.`);
      break;
    }
    case 4: {
      const { wire } = action as { wire: number };
      if (!isWireIndex(me, wire)) return "Pick one of your wires.";
      const w = me.wires[wire];
      if (w.cut || w.color !== "blue") return "Post-It goes on one of your uncut blue wires.";
      if (w.info !== null) return "That wire already has an info token.";
      useEquipment(state, card);
      w.info = w.value;
      hl.push({ player: actor, wire, tone: "info" });
      log(state, `${me.name} uses ${title}: shows a ${w.value}.`);
      break;
    }
    case 6: {
      if (state.mistakes === 0) return "The detonator is already at the start.";
      useEquipment(state, card);
      state.mistakes--;
      log(state, `${me.name} uses ${title}. The detonator moves back one step.`);
      break;
    }
    case 7: {
      const { players } = action as { players: number[] };
      const list = Array.isArray(players) ? [...new Set(players)] : [];
      if (list.length < 1 || list.length > 2) return "Pick one or two players.";
      if (!list.every((p) => isPlayer(state, p) && state.players[p].probeUsed)) return "Only used twin probes can be recharged.";
      useEquipment(state, card);
      for (const p of list) state.players[p].probeUsed = false;
      log(state, `${me.name} uses ${title}: ${list.map((p) => state.players[p].name).join(" and ")} get their twin probe back.`);
      break;
    }
    case 8: {
      const { value } = action as { value: number };
      if (!Number.isInteger(value) || value < 1 || value > 12) return "Pick a value from 1 to 12.";
      useEquipment(state, card);
      const result: RadarResult = { value, boards: [] };
      const parts: string[] = [];
      state.players.forEach((p, pi) => {
        for (let st = 0; st < p.stands; st++) {
          const ws = p.wires.filter((w) => w.stand === st && !w.cut);
          const yes = ws.some((w) => w.color === "blue" && w.value === value);
          result.boards.push({ player: pi, stand: st, yes, wireIds: ws.map((w) => w.id) });
          parts.push(`${p.name}${p.stands > 1 ? ` (${boardName(st)})` : ""}: ${yes ? "Yes!" : "no"}`);
        }
      });
      state.radar.push(result);
      log(state, `${me.name} uses ${title} on ${value}. ${parts.join(", ")}.`);
      break;
    }
    case 9: {
      if (state.stabilized) return "The Stabilizer is already active.";
      useEquipment(state, card);
      state.stabilized = true;
      log(state, `${me.name} uses the ${title}. A failed cut this turn won't move the detonator or explode.`);
      break;
    }
    case 11: {
      const { next } = action as { next: number };
      if (!validTarget(state, actor, next)) return "Pick another player to go next.";
      if (!state.players[next].wires.some((w) => !w.cut)) return "That player has no wires left.";
      useEquipment(state, card);
      state.stabilized = false;
      state.turn = next;
      log(state, `${me.name} uses the ${title}, skipping their turn. ${state.players[next].name} goes next.`);
      break;
    }
    default:
      return "That equipment is used as part of a cut.";
  }
  state.highlights = hl;
  return null;
}

/** Applies an action in place. Returns an error message, or null on success. */
export function applyAction(state: GameState, actor: number, action: Action): string | null {
  if (state.phase === "won" || state.phase === "lost") return "The mission is over.";
  if (!action || typeof action !== "object") return "Bad action.";
  if (!isPlayer(state, actor)) return "Bad player.";
  const me = state.players[actor];
  const hl: Highlight[] = [];

  // Most equipment can be used by anyone at any time (outside setup and pending choices).
  if (action.type === "equipment") {
    if (state.phase !== "playing") return "Equipment can't be used during setup.";
    if (state.pending) return "Wait for the pending choice to finish.";
    return applyEquipment(state, actor, action, hl);
  }

  if (actor !== actingPlayer(state)) return "It's not your move.";
  if (state.pending) return applyPending(state, actor, action, hl);

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
      const { target, wire, myWire, myWire2 } = action;
      if (!validTarget(state, actor, target)) return "Pick a teammate's wire.";
      const tp = state.players[target];
      if (!isWireIndex(tp, wire) || tp.wires[wire].cut) return "That wire is already cut.";
      const call = callFromOwnWire(me, myWire);
      if (typeof call === "string" && call !== "yellow") return call;
      const calls: Call[] = [call];
      const xray = myWire2 !== undefined;
      if (xray) {
        const err = checkEquipment(state, 10);
        if (err) return err;
        const call2 = callFromOwnWire(me, myWire2);
        if (typeof call2 === "string" && call2 !== "yellow") return call2;
        if (call2 === call) return "X or Y Ray needs two different values.";
        calls.push(call2);
        useEquipment(state, 10);
      }
      const w = tp.wires[wire];
      const said = calls.map(callLabel).join(" or ");
      const hitIdx = calls.findIndex((c) => matches(w, c));
      if (hitIdx >= 0) {
        w.cut = true;
        hl.push({ player: target, wire, tone: "hit" });
        cutActorWire(state, actor, hitIdx === 0 ? myWire : myWire2!, hl);
        log(state, `${me.name} calls ${said}${xray ? " (X or Y Ray)" : ""} on ${tp.name}'s wire. Correct! It's a ${wireLabel(w)}.`);
      } else if (w.color === "red") {
        w.cut = true;
        if (state.stabilized) {
          hl.push({ player: target, wire, tone: "info" });
          log(state, `${me.name} calls ${said} on ${tp.name}'s wire. It's RED, but the Stabilizer holds and it's safely revealed.`);
        } else {
          hl.push({ player: target, wire, tone: "boom" });
          state.phase = "lost";
          state.lostReason = `${me.name} cut a red wire.`;
          log(state, `${me.name} calls ${said} on ${tp.name}'s wire. It's RED. 💥`);
        }
      } else {
        w.info = tokenFor(w);
        hl.push({ player: target, wire, tone: "miss" });
        log(state, `${me.name} calls ${said} on ${tp.name}'s wire. Wrong, it's a ${w.info}.${state.stabilized ? "" : " The detonator ticks."}`);
        failedCut(state);
      }
      state.highlights = hl;
      finishTurn(state);
      return null;
    }

    case "probe": {
      const { device, target, myWire } = action;
      if (!validTarget(state, actor, target)) return "Pick a teammate's wires.";
      const tp = state.players[target];
      const call = callFromOwnWire(me, myWire);
      if (typeof call === "string" && call !== "yellow") return call;
      let wires = Array.isArray(action.wires) ? [...new Set(action.wires)] : [];
      if (!wires.every((i) => isWireIndex(tp, i) && !tp.wires[i].cut)) return "Probed wires must be uncut.";
      if (wires.length && !wires.every((i) => tp.wires[i].stand === tp.wires[wires[0]].stand))
        return "All probed wires must be on the same board.";
      let name: string;
      if (device === "twin") {
        if (me.probeUsed) return "You already used your twin probe.";
        if (wires.length !== 2) return "Pick two wires.";
        me.probeUsed = true;
        name = "the twin probe";
      } else if (device === "triple" || device === "super") {
        const card = device === "triple" ? 3 : 5;
        const err = checkEquipment(state, card);
        if (err) return err;
        if (call === "yellow") return `${equipmentInfo(card).title} can't call yellow.`;
        if (device === "triple" && wires.length !== 3) return "Pick three wires on one board.";
        if (device === "super") {
          if (wires.length < 1) return "Pick a teammate's board.";
          const [s0, e0] = boardRange(tp, tp.wires[wires[0]].stand);
          wires = [];
          for (let i = s0; i < e0; i++) if (!tp.wires[i].cut) wires.push(i);
        }
        useEquipment(state, card);
        name = `the ${equipmentInfo(card).title}`;
      } else {
        return "Unknown probe.";
      }

      const hits = wires.filter((i) => matches(tp.wires[i], call));
      const intro = `${me.name} uses ${name} on ${wires.length} of ${tp.name}'s wires, calling ${callLabel(call)}.`;
      if (hits.length === 1) {
        tp.wires[hits[0]].cut = true;
        hl.push({ player: target, wire: hits[0], tone: "hit" });
        cutActorWire(state, actor, myWire, hl);
        log(state, `${intro} Hit! One is a ${wireLabel(tp.wires[hits[0]])}.`);
      } else if (hits.length > 1) {
        state.pending = { kind: "probeReveal", actor, target, wires: hits, call, actorWire: myWire };
        log(state, `${intro} ${hits.length} match! ${tp.name} chooses which one to reveal.`);
      } else {
        log(state, `${intro} Miss.${state.stabilized ? "" : " The detonator ticks."}`);
        if (!failedCut(state)) probeMissToken(state, actor, target, wires, hl);
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
    equipment: state.equipment.map((e) => ({ ...e, unlocked: isUnlocked(blueCut, e.card) })),
    labels: state.labels,
    radar: state.radar,
    stabilized: state.stabilized,
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

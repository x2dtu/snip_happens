// Rules tests for equipment cards. Usage: npx tsx scripts/equipment-test.ts
import { applyAction, createGame, viewFor } from "../src/game/engine";
import type { Action, GameState, Wire } from "../src/game/types";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

/** A 3-player game with every card drawn, in the playing phase, with hand-crafted boards. */
function setup(hands: [number, Wire["color"]][][], cards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]): GameState {
  const g = createGame(
    hands.map((_, i) => ({ name: `P${i}`, kind: "human" as const })),
    { yellowCount: 0, yellowDrawn: 0, redCount: 0, redDrawn: 0, equipmentCount: 0 },
  );
  let id = 0;
  g.players.forEach((p, pi) => {
    p.stands = 1;
    p.wires = hands[pi].map(([value, color]) => ({ id: id++, value, color, cut: false, info: null, stand: 0 }));
  });
  g.phase = "playing";
  g.turn = 0;
  g.equipment = cards.map((card) => ({ card, used: false }));
  return g;
}
const B = (v: number): [number, Wire["color"]] => [v, "blue"];
const Y = (v: number): [number, Wire["color"]] => [v, "yellow"];
const R = (v: number): [number, Wire["color"]] => [v, "red"];
/** Marks two blue wires of every value as already cut on a dummy 4th player, unlocking all cards. */
function unlockAll(g: GameState) {
  const dummy = g.players[g.players.length - 1];
  for (let v = 1; v <= 12; v++) for (let k = 0; k < 2; k++) dummy.wires.push({ id: 1000 + v * 10 + k, value: v, color: "blue", cut: true, info: null, stand: 0 });
  dummy.wires.sort((a, b) => a.value - b.value);
}
const act = (g: GameState, p: number, a: Action) => applyAction(g, p, a);

// Locked / unlock
{
  const g = setup([[B(3), B(4)], [B(3), B(5)], [B(9)]], [6]);
  g.mistakes = 1;
  check("locked equipment is rejected", act(g, 0, { type: "equipment", card: 6 }) !== null);
  g.players[2].wires.push({ id: 99, value: 6, color: "blue", cut: true, info: null, stand: 0 }, { id: 98, value: 6, color: "blue", cut: true, info: null, stand: 0 });
  check("unlocks after two blue 6s cut", act(g, 1, { type: "equipment", card: 6 }) === null && g.mistakes === 0);
  check("one-time use", act(g, 1, { type: "equipment", card: 6 }) !== null);
}

// 1 / 12 labels
{
  const g = setup([[B(2), B(3), B(3)], [B(5)], []]);
  unlockAll(g);
  check("Label rejects the same wire twice", act(g, 1, { type: "equipment", card: 1, wires: [0, 0] }) !== null);
  check("Label ≠ by an off-turn player", act(g, 0, { type: "equipment", card: 1, wires: [0, 1] }) === null && g.labels[0]?.kind === "neq");
  check("Label = rejects different values", act(g, 0, { type: "equipment", card: 12, wires: [0, 1] }) !== null);
  check("Label = on same adjacent", act(g, 0, { type: "equipment", card: 12, wires: [1, 2] }) === null && g.labels[1]?.kind === "eq");
}

// 2 walkie-talkies
{
  const g = setup([[B(2), B(8)], [B(1), B(10)], []]);
  unlockAll(g);
  check("walkie starts (off turn)", act(g, 1, { type: "equipment", card: 2, target: 0, myWire: 1 }) === null && g.pending?.kind === "walkie");
  check("other actions blocked during walkie", act(g, 0, { type: "dualCut", target: 1, wire: 0, myWire: 0 }) !== null);
  check("walkie target picks", act(g, 0, { type: "choosePending", wire: 0 }) === null);
  const v0 = g.players[0].wires.map((w) => w.value).join(",");
  const v1 = g.players[1].wires.map((w) => w.value).join(",");
  check("walkie swapped and re-sorted", v0 === "8,10" && v1 === "1,2", `${v0} | ${v1}`);
  check("turn unchanged after walkie", g.turn === 0);
}

// 3 triple detector, 5 super detector
{
  const g = setup([[B(4), B(7)], [B(1), B(4), B(9), B(11)], []]);
  unlockAll(g);
  check("triple needs exactly 3 wires", act(g, 0, { type: "probe", device: "triple", target: 1, wires: [0, 1], myWire: 0 }) !== null);
  check("triple hit", act(g, 0, { type: "probe", device: "triple", target: 1, wires: [0, 1, 2], myWire: 0 }) === null && g.players[1].wires[1].cut && g.players[0].wires[0].cut);
}
{
  const g = setup([[B(7)], [B(1), B(7), B(9)], []]);
  unlockAll(g);
  check("super detector", act(g, 0, { type: "probe", device: "super", target: 1, wires: [0], myWire: 0 }) === null && g.players[1].wires[1].cut);
}
{
  const g = setup([[B(6)], [B(1), R(4.5), B(9)], []]);
  unlockAll(g);
  check("triple miss with red: no boom, token on a blue (target picks)", act(g, 0, { type: "probe", device: "triple", target: 1, wires: [0, 1, 2], myWire: 0 }) === null && g.phase === "playing" && g.mistakes === 1 && g.pending?.kind === "probeInfo" && g.pending.wires.join() === "0,2");
}

// 4 post-it
{
  const g = setup([[B(4), Y(5.1)], [B(1)], []]);
  unlockAll(g);
  check("post-it rejects yellow", act(g, 0, { type: "equipment", card: 4, wire: 1 }) !== null);
  check("post-it shows blue", act(g, 0, { type: "equipment", card: 4, wire: 0 }) === null && g.players[0].wires[0].info === 4);
}

// 7 batteries
{
  const g = setup([[B(4)], [B(1)], []]);
  unlockAll(g);
  check("batteries need used probes", act(g, 0, { type: "equipment", card: 7, players: [1] }) !== null);
  g.players[1].probeUsed = true;
  check("batteries recharge", act(g, 2, { type: "equipment", card: 7, players: [1] }) === null && !g.players[1].probeUsed);
}

// 8 radar
{
  const g = setup([[B(4), B(7)], [B(7)], [B(2)]]);
  unlockAll(g);
  act(g, 1, { type: "equipment", card: 8, value: 7 });
  const r = g.radar[0];
  check("radar answers per board", r.boards[0].yes && r.boards[1].yes && !r.boards[2].yes);
}

// 9 stabilizer
{
  const g = setup([[B(4), B(7)], [B(1), R(5.5)], []]);
  unlockAll(g);
  check("stabilizer only on your turn", act(g, 1, { type: "equipment", card: 9 }) !== null);
  act(g, 0, { type: "equipment", card: 9 });
  check("stabilized miss: no detonator", act(g, 0, { type: "dualCut", target: 1, wire: 0, myWire: 0 }) === null && g.mistakes === 0 && g.players[1].wires[0].info === 1);
  check("stabilizer wears off after the turn", !g.stabilized);
}
{
  const g = setup([[B(4), B(7)], [B(1), R(5.5)], []]);
  unlockAll(g);
  act(g, 0, { type: "equipment", card: 9 });
  act(g, 0, { type: "dualCut", target: 1, wire: 1, myWire: 0 });
  check("stabilized red: no explosion, red revealed", g.phase === "playing" && g.players[1].wires[1].cut);
}

// 10 X or Y ray
{
  const g = setup([[B(4), B(7)], [B(7), B(12)], []]);
  unlockAll(g);
  check("x/y ray hit on second value cuts that own wire", act(g, 0, { type: "dualCut", target: 1, wire: 0, myWire: 0, myWire2: 1 }) === null && g.players[0].wires[1].cut && !g.players[0].wires[0].cut);
  g.turn = 0;
  check("x/y ray is single use", act(g, 0, { type: "dualCut", target: 1, wire: 1, myWire: 0, myWire2: 0 }) !== null);
}

// 11 coffee mug
{
  const g = setup([[B(4)], [B(1)], [B(9)]]);
  unlockAll(g);
  check("coffee mug picks next player", act(g, 0, { type: "equipment", card: 11, next: 2 }) === null && g.turn === 2);
}

// Views: equipment state visible, walkie index public, probe actorWire hidden
{
  const g = setup([[B(7), B(7)], [B(7), B(7)], []]);
  unlockAll(g);
  act(g, 0, { type: "probe", device: "twin", target: 1, wires: [0, 1], myWire: 1 });
  const v = viewFor(g, 1);
  check("probeReveal pending hides the actor's wire", v.pending?.kind === "probeReveal" && (v.pending as { actorWire?: number }).actorWire === undefined);
  check("view lists equipment with unlock state", v.equipment.length === 12 && v.equipment.every((e) => e.unlocked));
}

console.log(failures ? `\n${failures} FAILED` : "\nall equipment tests passed");
process.exit(failures ? 1 : 0);

import type { Call, GameView, WireView } from "./types";

/** Calls the viewer can legally make in a dual cut (values they hold uncut). */
export function heldCalls(view: GameView): Call[] {
  const me = view.players[view.you];
  if (!me) return [];
  const out = new Set<Call>();
  for (const w of me.wires) {
    if (w.cut) continue;
    if (w.color === "blue") out.add(w.value!);
    if (w.color === "yellow") out.add("yellow");
  }
  return [...out].sort((a, b) => (a === "yellow" ? 99 : a) - (b === "yellow" ? 99 : b));
}

/** Solo cuts the viewer can prove from public info + their own hand. */
export function provableSoloCuts(view: GameView): Call[] {
  const me = view.players[view.you];
  if (!me) return [];
  const out: Call[] = [];
  for (const call of heldCalls(view)) {
    const mine = me.wires.filter((w) => !w.cut && matchesView(w, call)).length;
    if (call === "yellow") {
      if (mine + view.yellowCut === view.settings.yellowCount) out.push(call);
    } else if (mine + view.blueCut[call] === 4) {
      out.push(call);
    }
  }
  return out;
}

export function canRevealReds(view: GameView): boolean {
  const me = view.players[view.you];
  if (!me) return false;
  const left = me.wires.filter((w) => !w.cut);
  return left.length > 0 && left.every((w) => w.color === "red");
}

export function matchesView(w: WireView, call: Call): boolean {
  return call === "yellow" ? w.color === "yellow" : w.color === "blue" && w.value === call;
}

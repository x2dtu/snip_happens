import { BLUE_VALUES, boardsNeedingToken } from "./engine";
import { canRevealReds, heldCalls, matchesView, provableSoloCuts } from "./helpers";
import type { Action, Call, GameView, WireColor } from "./types";

/**
 * AI teammate. It only ever sees its own redacted GameView, so it plays by the
 * same information rules as humans: its own hand plus public info.
 *
 * It estimates what each hidden wire could be by sampling random deals that are
 * consistent with everything public (sorted stands, revealed wires, info tokens,
 * copy counts), then picks the call most likely to succeed.
 */

const SAMPLES = 400;
const SWAPS_PER_SAMPLE = 40;

interface Item {
  value: number;
  color: WireColor;
}

/** A run of hidden wires on one stand between two known anchors. */
interface Segment {
  player: number;
  wires: number[]; // wire indexes, in order
  lo: number;
  hi: number;
  yellowOnly: boolean; // a single wire with a yellow info token
}

interface Model {
  /** key "p:w" -> sample counts by outcome */
  counts: Map<string, Map<string, number>>;
  /** key "p:a:b" -> per call, samples where at least one of a/b matched */
  samples: Map<string, Item>[];
}

const rand = () => Math.random();
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

const outcomeKey = (it: Item) => (it.color === "blue" ? String(it.value) : it.color);

function fits(it: Item, s: Segment): boolean {
  if (s.yellowOnly) return it.color === "yellow" && it.value > s.lo && it.value < s.hi;
  return it.value >= s.lo && it.value <= s.hi;
}

function buildSegments(view: GameView): Segment[] {
  const segs: Segment[] = [];
  view.players.forEach((p, pi) => {
    if (pi === view.you) return;
    let lo = 0;
    let cur: number[] = [];
    const flush = (hi: number) => {
      if (cur.length) segs.push({ player: pi, wires: cur, lo, hi, yellowOnly: false });
      cur = [];
    };
    p.wires.forEach((w, wi) => {
      // Each board is sorted independently: a new board resets the bounds.
      if (wi > 0 && p.wires[wi - 1].stand !== w.stand) {
        flush(13);
        lo = 0;
      }
      const known = w.cut ? w.value! : typeof w.info === "number" ? w.info : null;
      if (known !== null) {
        flush(known);
        lo = known;
      } else if (w.info === "yellow") {
        // Find the next numeric anchor for its upper bound later; mark it as its own segment.
        flush(13);
        segs.push({ player: pi, wires: [wi], lo, hi: 13, yellowOnly: true });
      } else {
        cur.push(wi);
      }
    });
    flush(13);
  });
  // Tighten upper bounds: each segment's hi is the next numeric anchor on the same stand.
  for (const s of segs) {
    const p = view.players[s.player];
    const last = s.wires[s.wires.length - 1];
    let hi = 13;
    for (let j = last + 1; j < p.wires.length && p.wires[j].stand === p.wires[last].stand; j++) {
      const w = p.wires[j];
      const k = w.cut ? w.value! : typeof w.info === "number" ? w.info : null;
      if (k !== null) {
        hi = k;
        break;
      }
    }
    s.hi = hi;
  }
  return segs;
}

function buildPool(view: GameView) {
  const remainingBlue = new Array(13).fill(4);
  let knownYellow = 0;
  let knownRed = 0;
  const seenYellow = new Set<number>();
  const seenRed = new Set<number>();
  view.players.forEach((p, pi) => {
    for (const w of p.wires) {
      if (w.color === "blue") remainingBlue[w.value!]--;
      else if (w.color === "yellow") {
        knownYellow++;
        seenYellow.add(w.value!);
      } else if (w.color === "red") {
        knownRed++;
        seenRed.add(w.value!);
      } else if (pi !== view.you && typeof w.info === "number") {
        remainingBlue[w.info]--;
      }
    }
  });
  const blues: Item[] = [];
  for (const v of BLUE_VALUES) for (let i = 0; i < remainingBlue[v]; i++) blues.push({ value: v, color: "blue" });
  return {
    blues,
    // Yellow-token wires are still hidden yellows, so they stay in the yellow count.
    yellowLeft: Math.max(0, view.settings.yellowCount - knownYellow),
    redLeft: Math.max(0, view.settings.redCount - knownRed),
    yellowCands: view.yellowCandidates.filter((v) => !seenYellow.has(v)).map((v): Item => ({ value: v, color: "yellow" })),
    redCands: view.redCandidates.filter((v) => !seenRed.has(v)).map((v): Item => ({ value: v, color: "red" })),
  };
}

/** Greedy feasible assignment of items to slots (earliest-deadline-first on interval slots). */
function assign(items: Item[], slots: Segment[]): number[] | null {
  const order = items.map((_, i) => i).sort((a, b) => items[a].value - items[b].value || rand() - 0.5);
  const used = new Array(slots.length).fill(false);
  const out = new Array(items.length).fill(-1);
  for (const i of order) {
    let best = -1;
    for (let s = 0; s < slots.length; s++) {
      if (used[s] || !fits(items[i], slots[s])) continue;
      if (best < 0 || slots[s].hi < slots[best].hi || (slots[s].yellowOnly && !slots[best].yellowOnly)) best = s;
    }
    if (best < 0) return null;
    used[best] = true;
    out[i] = best;
  }
  return out;
}

/** Public facts from equipment (= / ≠ labels, radar answers), checked against sampled deals. */
type Fact =
  | { kind: "eq" | "neq"; a: number; b: number }
  | { kind: "radar"; value: number; yes: boolean; ids: number[] };

function buildFacts(view: GameView): Fact[] {
  const facts: Fact[] = view.labels.map((l) => ({ kind: l.kind, a: l.a, b: l.b }));
  for (const r of view.radar) for (const b of r.boards) facts.push({ kind: "radar", value: r.value, yes: b.yes, ids: b.wireIds });
  return facts;
}

function sample(view: GameView): Model | null {
  const segs = buildSegments(view);
  // One slot per hidden wire; each slot carries its segment's bounds.
  const slots: Segment[] = [];
  for (const s of segs) for (const _ of s.wires) slots.push(s);
  const pool = buildPool(view);
  if (pool.blues.length + pool.yellowLeft + pool.redLeft !== slots.length) return null;

  let yellowIn = [...pool.yellowCands].sort(() => rand() - 0.5).slice(0, pool.yellowLeft);
  let redIn = [...pool.redCands].sort(() => rand() - 0.5).slice(0, pool.redLeft);
  let items: Item[] = [...pool.blues, ...yellowIn, ...redIn];
  let at = assign(items, slots);
  // If the random yellow/red picks don't fit, retry a few times.
  for (let t = 0; !at && t < 50; t++) {
    yellowIn = [...pool.yellowCands].sort(() => rand() - 0.5).slice(0, pool.yellowLeft);
    redIn = [...pool.redCands].sort(() => rand() - 0.5).slice(0, pool.redLeft);
    items = [...pool.blues, ...yellowIn, ...redIn];
    at = assign(items, slots);
  }
  if (!at) return null;

  const outside = [
    ...pool.yellowCands.filter((c) => !yellowIn.includes(c)),
    ...pool.redCands.filter((c) => !redIn.includes(c)),
  ];
  const model: Model = { counts: new Map(), samples: [] };

  // Wires whose value is public or ours, by id; hidden ones resolve through the sampled deal.
  const known = new Map<number, Item>();
  const keyOf = new Map<number, string>();
  view.players.forEach((p, pi) =>
    p.wires.forEach((w, wi) => {
      if (w.color) known.set(w.id, { value: w.value!, color: w.color });
      else if (typeof w.info === "number") known.set(w.id, { value: w.info, color: "blue" });
      else keyOf.set(w.id, `${pi}:${wi}`);
    }),
  );
  const facts = buildFacts(view);

  const materialize = () => {
    const bySeg = new Map<Segment, Item[]>();
    items.forEach((it, i) => {
      const s = slots[at![i]];
      if (!bySeg.has(s)) bySeg.set(s, []);
      bySeg.get(s)!.push(it);
    });
    const deal = new Map<string, Item>();
    for (const [s, its] of bySeg) {
      its.sort((a, b) => a.value - b.value);
      s.wires.forEach((w, idx) => deal.set(`${s.player}:${w}`, its[idx]));
    }
    // Wires with a numeric info token are known exactly.
    view.players.forEach((p, pi) => {
      if (pi === view.you) return;
      p.wires.forEach((w, wi) => {
        if (!w.cut && typeof w.info === "number") deal.set(`${pi}:${wi}`, { value: w.info, color: "blue" });
      });
    });
    return deal;
  };

  const violations = (deal: Map<string, Item>) => {
    const val = (id: number) => known.get(id) ?? deal.get(keyOf.get(id) ?? "");
    let v = 0;
    for (const f of facts) {
      if (f.kind === "radar") {
        const has = f.ids.some((id) => {
          const it = val(id);
          return it?.color === "blue" && it.value === f.value;
        });
        if (has !== f.yes) v++;
      } else {
        const a = val(f.a);
        const b = val(f.b);
        if (!a || !b) continue;
        const same = a.color === b.color && (a.color !== "blue" || a.value === b.value);
        if (same !== (f.kind === "eq")) v++;
      }
    }
    return v;
  };

  let curV = facts.length ? violations(materialize()) : 0;
  const consistent: Map<string, Item>[] = [];
  const loose: Map<string, Item>[] = [];

  for (let n = 0; n < SAMPLES; n++) {
    for (let k = 0; items.length > 0 && k < SWAPS_PER_SAMPLE; k++) {
      const i = Math.floor(rand() * items.length);
      let undo: (() => void) | null = null;
      if (outside.length && rand() < 0.15 && items[i].color !== "blue") {
        // Swap which yellow/red values are in the bomb.
        const o = Math.floor(rand() * outside.length);
        if (outside[o].color === items[i].color && fits(outside[o], slots[at[i]])) {
          [items[i], outside[o]] = [outside[o], items[i]];
          undo = () => ([items[i], outside[o]] = [outside[o], items[i]]);
        }
      } else {
        const j = Math.floor(rand() * items.length);
        if (i !== j && fits(items[i], slots[at[j]]) && fits(items[j], slots[at[i]])) {
          [at[i], at[j]] = [at[j], at[i]];
          undo = () => ([at![i], at![j]] = [at![j], at![i]]);
        }
      }
      // With equipment facts in play, never accept a move that breaks more of them.
      if (undo && facts.length) {
        const v = violations(materialize());
        if (v > curV) undo();
        else curV = v;
      }
    }
    const deal = materialize();
    (curV === 0 ? consistent : loose).push(deal);
  }

  const kept = consistent.length >= 30 ? consistent : [...consistent, ...loose];
  for (const deal of kept) {
    for (const [key, it] of deal) {
      if (!model.counts.has(key)) model.counts.set(key, new Map());
      const c = model.counts.get(key)!;
      const ok = outcomeKey(it);
      c.set(ok, (c.get(ok) ?? 0) + 1);
    }
    model.samples.push(deal);
  }
  return model;
}

const callKey = (c: Call) => (c === "yellow" ? "yellow" : String(c));

export function chooseAction(view: GameView): Action | null {
  const me = view.players[view.you];
  if (!me) return null;

  // Resolve a choice someone forced on us (twin probe).
  if (view.pending && view.pending.target === view.you) {
    return { type: "choosePending", wire: pick(view.pending.wires) };
  }

  if (view.phase === "opening") {
    const board = boardsNeedingToken(me)[0];
    const onBoard = me.wires.map((w, i) => ({ w, i })).filter(({ w }) => w.stand === board);
    const blues = onBoard.filter(({ w }) => w.color === "blue");
    const mid = onBoard.length ? (onBoard[0].i + onBoard[onBoard.length - 1].i) / 2 : 0;
    const middling = blues.filter(({ w }) => w.value! >= 4 && w.value! <= 9);
    const choices = middling.length ? middling : blues;
    choices.sort((a, b) => Math.abs(a.i - mid) - Math.abs(b.i - mid));
    return { type: "opening", wire: choices[0].i };
  }

  if (view.phase !== "playing" || view.turn !== view.you) return null;

  const solo = provableSoloCuts(view);
  if (solo.length) return { type: "soloCut", call: solo[0] };
  if (canRevealReds(view)) return { type: "revealReds" };

  const calls = heldCalls(view);
  const model = sample(view);
  const lastLife = view.maxMistakes - view.mistakes <= 1;
  const total = model?.samples.length ?? 0;

  const prob = (key: string, outcome: string) => {
    if (!model || !total) return 0;
    return (model.counts.get(key)?.get(outcome) ?? 0) / total;
  };

  type Cand = { target: number; wire: number; call: Call; p: number; red: number; score: number };
  let best: Cand | null = null;
  view.players.forEach((p, pi) => {
    if (pi === view.you) return;
    p.wires.forEach((w, wi) => {
      if (w.cut) return;
      const key = `${pi}:${wi}`;
      const red = prob(key, "red");
      for (const call of calls) {
        let pHit = prob(key, callKey(call));
        // Fallback when sampling failed: trust info tokens only.
        if (!model) pHit = w.info === call ? 1 : 0.05;
        const score = (lastLife ? pHit : pHit - 6 * red) + rand() * 1e-6;
        if (!best || score > best.score) best = { target: pi, wire: wi, call, p: pHit, red, score };
      }
    });
  });

  const b = best as Cand | null;
  const own = (call: Call) => me.wires.findIndex((w) => !w.cut && matchesView(w, call));
  if (b && b.p > 0.999) return { type: "dualCut", target: b.target, wire: b.wire, myWire: own(b.call) };

  const ready = (card: number) => view.equipment.some((e) => e.card === card && e.unlocked && !e.used);

  // Rescue equipment first: wind the detonator back when one more mistake would end it.
  if (lastLife && ready(6) && view.mistakes > 0) return { type: "equipment", card: 6 };

  type Option = { p: number; action: Action };
  const options: Option[] = [];
  const dualP = b ? b.p : 0;
  const dualRed = b ? b.red : 0;
  if (b) options.push({ p: dualP - (view.stabilized ? 0 : 6 * dualRed), action: { type: "dualCut", target: b.target, wire: b.wire, myWire: own(b.call) } });

  const pAny = (pi: number, wires: number[], ck: string) => {
    if (!model || !total) return 0;
    let hits = 0;
    for (const d of model.samples) if (wires.some((w) => outcomeKey(d.get(`${pi}:${w}`)!) === ck)) hits++;
    return hits / total;
  };

  if (model) {
    const blueCalls = calls.filter((c) => c !== "yellow");
    view.players.forEach((p, pi) => {
      if (pi === view.you) return;
      const uncut = p.wires.map((w, i) => ({ w, i })).filter(({ w }) => !w.cut);
      const sameBoard = (a: number, c: number) => p.wires[a].stand === p.wires[c].stand;
      // Twin probe: any two wires on one board.
      if (!me.probeUsed) {
        for (const { i: a } of uncut)
          for (const { i: c } of uncut) {
            if (c <= a || !sameBoard(a, c)) continue;
            for (const call of calls) {
              const pr = pAny(pi, [a, c], callKey(call));
              options.push({ p: pr - 0.1, action: { type: "probe", device: "twin", target: pi, wires: [a, c], myWire: own(call) } });
            }
          }
      }
      // Triple Detector (3): three nearby wires on one board.
      if (ready(3)) {
        for (let x = 0; x + 2 < uncut.length; x++) {
          const trio = [uncut[x].i, uncut[x + 1].i, uncut[x + 2].i];
          if (!sameBoard(trio[0], trio[2])) continue;
          for (const call of blueCalls) {
            const pr = pAny(pi, trio, callKey(call));
            options.push({ p: pr - 0.15, action: { type: "probe", device: "triple", target: pi, wires: trio, myWire: own(call) } });
          }
        }
      }
      // Super Detector (5): a whole board.
      if (ready(5)) {
        for (let st = 0; st < p.stands; st++) {
          const board = uncut.filter(({ w }) => w.stand === st).map(({ i }) => i);
          if (!board.length) continue;
          for (const call of blueCalls) {
            const pr = pAny(pi, board, callKey(call));
            options.push({ p: pr - 0.25, action: { type: "probe", device: "super", target: pi, wires: board, myWire: own(call) } });
          }
        }
      }
      // X or Y Ray (10): two values on one wire.
      if (ready(10) && calls.length >= 2) {
        for (const { i } of uncut) {
          const key = `${pi}:${i}`;
          const red = prob(key, "red");
          for (let x = 0; x < calls.length; x++)
            for (let y = x + 1; y < calls.length; y++) {
              const pr = prob(key, callKey(calls[x])) + prob(key, callKey(calls[y]));
              const score = pr - 0.15 - (view.stabilized ? 0 : 6 * red);
              options.push({ p: score, action: { type: "dualCut", target: pi, wire: i, myWire: own(calls[x]), myWire2: own(calls[y]) } });
            }
        }
      }
    });
  }

  options.sort((x, y) => y.p - x.p);
  const top = options[0];
  // Shaky odds: steady the bomb first (the AI gets another action this turn).
  if (top && !view.stabilized && ready(9) && (top.p < 0.6 || (lastLife && top.p < 0.9) || dualRed > 0.05)) {
    return { type: "equipment", card: 9 };
  }
  // A plain dual cut that's already good doesn't need a gadget (the margins above also favor it).
  if (b && dualP >= 0.75 && dualRed <= 0.02) return { type: "dualCut", target: b.target, wire: b.wire, myWire: own(b.call) };
  if (top) return top.action;
  return null;
}

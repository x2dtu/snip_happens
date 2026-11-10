export type WireColor = "blue" | "yellow" | "red";

/** A value called during a cut: a blue number (1-12) or "yellow" (matches any yellow). */
export type Call = number | "yellow";

/** What an info token shows: a blue value, or "yellow". Red wires never get tokens. */
export type InfoToken = number | "yellow";

export interface Wire {
  id: number;
  /** Sort key. Blue: 1..12, yellow: n.1, red: n.5 */
  value: number;
  color: WireColor;
  cut: boolean;
  info: InfoToken | null;
}

export interface PlayerState {
  name: string;
  kind: "human" | "ai";
  wires: Wire[];
  probeUsed: boolean;
}

export interface GameSettings {
  /** Yellow wires actually in the bomb (0..4). */
  yellowCount: number;
  /** Yellow values drawn and shown publicly; yellowCount of them go in ("X out of Y"). */
  yellowDrawn: number;
  /** Red wires actually in the bomb (0..3). */
  redCount: number;
  redDrawn: number;
}

export type Pending =
  | {
      kind: "probeReveal";
      actor: number;
      target: number;
      wires: [number, number];
      call: Call;
      /** Which of the actor's own wires was used. Server-only: stripped from views. */
      actorWire?: number;
    }
  | { kind: "probeInfo"; actor: number; target: number; wires: [number, number] };

export interface Highlight {
  player: number;
  wire: number;
  tone: "hit" | "miss" | "boom" | "info";
}

export interface GameState {
  phase: "opening" | "playing" | "won" | "lost";
  players: PlayerState[];
  captain: number;
  turn: number;
  openingPlaced: number;
  mistakes: number;
  /** Team loses when mistakes reaches this (= number of players). */
  maxMistakes: number;
  settings: GameSettings;
  pending: Pending | null;
  log: string[];
  highlights: Highlight[];
  lostReason: string | null;
  /** Publicly known drawn values. Only settings.*Count of each are really in the bomb. */
  yellowCandidates: number[];
  redCandidates: number[];
}

export type Action =
  | { type: "opening"; wire: number }
  /** myWire: the actor's own wire whose value is being called; it's the one cut on success. */
  | { type: "dualCut"; target: number; wire: number; myWire: number }
  | { type: "twinProbe"; target: number; wires: [number, number]; myWire: number }
  | { type: "soloCut"; call: Call }
  | { type: "revealReds" }
  | { type: "choosePending"; wire: number };

/** A wire as seen by a particular viewer. Hidden wires omit color/value. */
export interface WireView {
  id: number;
  cut: boolean;
  info: InfoToken | null;
  color?: WireColor;
  value?: number;
}

export interface PlayerView {
  name: string;
  kind: "human" | "ai";
  probeUsed: boolean;
  wires: WireView[];
}

export interface GameView {
  phase: GameState["phase"];
  you: number; // -1 for spectators
  players: PlayerView[];
  captain: number;
  turn: number;
  mistakes: number;
  maxMistakes: number;
  settings: GameSettings;
  pending: Pending | null;
  log: string[];
  highlights: Highlight[];
  lostReason: string | null;
  /** Number of cut blue wires for each value 1..12 (index 0 unused). */
  blueCut: number[];
  yellowCut: number;
  yellowCandidates: number[];
  redCandidates: number[];
}

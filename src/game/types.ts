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
  /** Which of the owner's boards (stands) this wire sits on. Each board is sorted on its own. */
  stand: number;
}

export interface PlayerState {
  name: string;
  kind: "human" | "ai";
  /** All of a player's wires, board 0 first then board 1; each board sorted ascending. */
  wires: Wire[];
  /** Number of boards this player has (2 in a two-player game, otherwise 1). */
  stands: number;
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
  /** Equipment cards drawn at random for the mission (0..6). */
  equipmentCount: number;
}

export type ProbeDevice = "twin" | "triple" | "super";

export interface EquipmentState {
  /** Card number 1..12; unlocks once 2 blue wires of this value are cut. */
  card: number;
  used: boolean;
}

/** Public token between two adjacent wires saying they're equal / different (by wire id). */
export interface LabelToken {
  kind: "eq" | "neq";
  a: number;
  b: number;
}

/** Result of a General Radar: for each board, whether it had an uncut blue of `value` (wire ids it covered). */
export interface RadarResult {
  value: number;
  boards: { player: number; stand: number; yes: boolean; wireIds: number[] }[];
}

export type Pending =
  | {
      /** Several probed wires matched; the target picks which one is cut. */
      kind: "probeReveal";
      actor: number;
      target: number;
      wires: number[];
      call: Call;
      /** Which of the actor's own wires was used. Server-only: stripped from views. */
      actorWire?: number;
    }
  /** A probe missed; the target picks which candidate wire gets the info token. */
  | { kind: "probeInfo"; actor: number; target: number; wires: number[] }
  /** Walkie-Talkies: the target picks one of their uncut wires to give back. actorWire is public. */
  | { kind: "walkie"; actor: number; target: number; actorWire: number; wires: number[] };

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
  equipment: EquipmentState[];
  labels: LabelToken[];
  radar: RadarResult[];
  /** Stabilizer is active for the current turn's cut. */
  stabilized: boolean;
}

export type EquipmentAction =
  | { type: "equipment"; card: 1 | 12; wires: [number, number] } // Label ≠ / Label =, on your own adjacent wires
  | { type: "equipment"; card: 2; target: number; myWire: number } // Walkie-Talkies
  | { type: "equipment"; card: 4; wire: number } // Post-It on your own blue wire
  | { type: "equipment"; card: 6 } // Rewinder
  | { type: "equipment"; card: 7; players: number[] } // Emergency Batteries
  | { type: "equipment"; card: 8; value: number } // General Radar
  | { type: "equipment"; card: 9 } // Stabilizer
  | { type: "equipment"; card: 11; next: number }; // Coffee Mug

export type Action =
  | { type: "opening"; wire: number }
  /**
   * myWire: the actor's own wire whose value is being called; it's the one cut on success.
   * myWire2: a second own wire with a different value (X or Y Ray, equipment 10).
   */
  | { type: "dualCut"; target: number; wire: number; myWire: number; myWire2?: number }
  /** twin: your character probe (2 wires). triple: equipment 3. super: equipment 5 (a whole board). */
  | { type: "probe"; device: ProbeDevice; target: number; wires: number[]; myWire: number }
  | EquipmentAction
  | { type: "soloCut"; call: Call }
  | { type: "revealReds" }
  | { type: "choosePending"; wire: number };

/** A wire as seen by a particular viewer. Hidden wires omit color/value. */
export interface WireView {
  id: number;
  cut: boolean;
  info: InfoToken | null;
  stand: number;
  color?: WireColor;
  value?: number;
}

export interface PlayerView {
  name: string;
  kind: "human" | "ai";
  probeUsed: boolean;
  stands: number;
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
  equipment: (EquipmentState & { unlocked: boolean })[];
  labels: LabelToken[];
  radar: RadarResult[];
  stabilized: boolean;
}

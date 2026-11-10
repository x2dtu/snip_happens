import type { GameSettings, GameView } from "../game/types";

export interface LobbySeat {
  kind: "human" | "ai";
  name: string;
  connected: boolean;
  isHost: boolean;
}

export interface LobbyView {
  code: string;
  seats: LobbySeat[];
  settings: GameSettings;
  you: number;
  isHost: boolean;
}

export interface RoomUpdate {
  lobby: LobbyView;
  game: GameView | null;
}

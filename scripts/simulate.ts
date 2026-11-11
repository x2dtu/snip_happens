// Runs AI-only games to sanity check the engine and AI. Usage: npm run simulate [games]
import { chooseAction } from "../src/game/ai";
import { actingPlayer, applyAction, createGame, PRESETS, viewFor } from "../src/game/engine";

const args = process.argv.slice(2);
const games = Number(args.find((a) => !a.startsWith("--")) ?? 200);
// --equipment: draw the maximum 6 equipment cards each game.
const equipmentCount = args.includes("--equipment") ? 6 : 0;

for (const preset of PRESETS) {
  for (let n = 2; n <= 5; n++) {
    let won = 0;
    let boom = 0;
    let turnsTotal = 0;
    for (let g = 0; g < games; g++) {
      const seats = Array.from({ length: n }, (_, i) => ({ name: `AI${i + 1}`, kind: "ai" as const }));
      const state = createGame(seats, { ...preset.settings, equipmentCount }, g % n);
      let turns = 0;
      while (state.phase === "opening" || state.phase === "playing") {
        const who = actingPlayer(state);
        const action = chooseAction(viewFor(state, who));
        if (!action) throw new Error(`AI returned no action\n${state.log.slice(-5).join("\n")}`);
        const err = applyAction(state, who, action);
        if (err) throw new Error(`Illegal AI action ${JSON.stringify(action)}: ${err}`);
        if (++turns > 2000) throw new Error("Game did not terminate");
      }
      turnsTotal += turns;
      if (state.phase === "won") won++;
      if (state.lostReason?.includes("red")) boom++;
    }
    console.log(
      `${preset.name.padEnd(13)} ${n}p  win ${((100 * won) / games).toFixed(0).padStart(3)}%  red-boom ${boom}  avg actions ${(turnsTotal / games).toFixed(0)}`,
    );
  }
}

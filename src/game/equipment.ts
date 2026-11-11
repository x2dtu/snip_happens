export type Equipment = {
  wire: number;
  title: string;
  description: string;
};

export const EQUIPMENT: Equipment[] = [
  {
    wire: 1,
    title: "Label ≠",
    description: `Put the NOT EQUALS token in front of 2 adjacent wires of different values.
- 1 of the 2 can already be cut.
- Reminder: Any 2 yellow wires or any 2 red wires are always considered identical.
  Therefore, they cannot be "different"`,
  },
  {
    wire: 2,
    title: "Walkie-Talkies",
    description: `Swap 2 wires
1. Take 1 of your uncut wires and put it facedown in front of a teammate.
2. That teammate does the same to you.
3. Each player takes their new wire and places it on their wire array.
- If a player has 2 wire arrays, they put the new wire in the array they took the wire from.
- Any uncut wire can be swapped (even red/yellow).
- Everyone sees where swapped wires come from and end up.`,
  },
  {
    wire: 3,
    title: "Triple Detector",
    description: `During a Dual Cut action, you can state a value (but not a yellow one) and select 3 wires on a teammate's wire array.
- This equipment works like the "Twin Probe", but with 3 wires.`,
  },
  {
    wire: 4,
    title: "Post-It",
    description: `Put 1 Info token in front of 1 of your blue wires.`,
  },
  {
    wire: 5,
    title: "Super Detector",
    description: `During a Dual Cut action, you can state a value (but not yellow) and select your teammate's whole wire array.
- This equipment works like the "Twin Probe", but with ALL wires in a wire array.`,
  },
  {
    wire: 6,
    title: "Rewinder",
    description: `Move the detonator fuse back 1 unit`,
  },
  {
    wire: 7,
    title: "Emergency Batteries",
    description: `Choose 1 or 2 Twin Probes which have already been used and enable them.`,
  },
  {
    wire: 8,
    title: "General Radar",
    description: `State a number between 1 and 12. All players (including you) say "Yes!" if they have 1 or more uncut blue wires of that value in their wire array.
- If a player has 2 wire arrays, they answer separately for each array.`,
  },
  {
    wire: 9,
    title: "Stabilizer",
    description: `Use this equipment BEFORE a Dual Cut action.
During your turn:
- If the action fails, the detonator fuse does not move.
- If a red wire is cut, the bomb does not explode.`,
  },
  {
    wire: 10,
    title: "X or Y ray",
    description: `During a Dual Cut action, you can state 2 values when selecting 1 wire (including yellow wires).
- You must have both values in your hand.`,
  },
  {
    wire: 11,
    title: "Coffee Mug",
    description: `Skip your turn and choose who the next player will be.
- The game then continues in turn order from the chosen player.`,
  },
  {
    wire: 12,
    title: "Label =",
    description: `Put the EQUALS token in front of 2 of your adjacent wires of the same value.
- 1 of the 2 wires can already be cut.
- Any 2 yellow wires or any 2 red wires are considered identical.`,
  },
];

/** Cards whose text limits them to your own turn (during a Dual Cut, or skipping your turn). */
export const ON_YOUR_TURN = new Set([3, 5, 9, 10, 11]);

export const equipmentInfo = (card: number) => EQUIPMENT.find((e) => e.wire === card)!;

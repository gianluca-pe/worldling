import { Simulation } from "../src/sim/simulation";
import type { MatchStatus } from "../src/sim/simulation";
import { isSuitableBuildingSite } from "../src/sim/settlement";

const SEEDS = [1, 2, 3, 6, 42, 0x47_4f_44] as const;
const MAX_TICKS = 18_000;
const POLICIES = ["passive", "settlement", "aggressive"] as const;
type Policy = (typeof POLICIES)[number];

function settlementDestination(simulation: Simulation) {
  const snapshot = simulation.snapshot();
  const terrain = {
    ...snapshot.terrain,
    heights: Uint8Array.from(snapshot.terrain.heights),
    flooded: snapshot.terrain.flooded
      ? Uint8Array.from(snapshot.terrain.flooded)
      : undefined,
  };
  const origin = snapshot.settlement.banner;
  let best: { x: number; y: number; score: number } | undefined;
  for (let y = 1; y < terrain.size - 1; y += 1) {
    for (let x = 1; x < terrain.size - 1; x += 1) {
      if (!isSuitableBuildingSite(terrain, x, y)) continue;
      let nearbySites = 0;
      for (let offsetY = -4; offsetY <= 4; offsetY += 1) {
        for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
          if (isSuitableBuildingSite(terrain, x + offsetX, y + offsetY)) {
            nearbySites += 1;
          }
        }
      }
      const distance = Math.abs(x - origin.x) + Math.abs(y - origin.y);
      const score = nearbySites * 10 - distance;
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  return best;
}

function run(seed: number, policy: Policy) {
  const simulation = new Simulation(seed, "skirmish");
  let sequence = 0;
  for (let tick = 0; tick < MAX_TICKS; tick += 300) {
    const snapshot = simulation.snapshot();
    if (snapshot.matchStatus !== "playing") break;
    if (policy === "aggressive") {
      const target = snapshot.opponent?.houses
        .slice()
        .sort(
          (first, second) => second.level - first.level || first.id - second.id,
        )[0];
      if (target && snapshot.settlement.mana >= 30) {
        simulation.queue({
          tick,
          sequence: sequence++,
          type: "earthquake",
          faction: "player",
          x: target.x,
          y: target.y,
        });
      }
    } else if (policy === "settlement" && tick % 600 === 0) {
      const target = settlementDestination(simulation);
      if (target) {
        simulation.queue({
          tick,
          sequence: sequence++,
          type: "rally",
          faction: "player",
          x: target.x,
          y: target.y,
        });
      }
    }
    simulation.advanceTo(Math.min(tick + 300, MAX_TICKS));
  }
  const snapshot = simulation.snapshot();
  return {
    seed,
    policy,
    status: snapshot.matchStatus as MatchStatus,
    minutes: Number((snapshot.tick / 1200).toFixed(2)),
    playerPeople: snapshot.settlement.followers.length,
    playerHouses: snapshot.settlement.houses.length,
    rivalPeople: snapshot.opponent?.followers.length ?? 0,
    rivalHouses: snapshot.opponent?.houses.length ?? 0,
    mana: Number(snapshot.settlement.mana.toFixed(1)),
    edits: snapshot.editCount,
    spells: snapshot.spellCount,
  };
}

const results = SEEDS.flatMap((seed) =>
  POLICIES.map((policy) => run(seed, policy)),
);
console.log(JSON.stringify(results, null, 2));

import { describe, expect, it } from "vitest";
import { Simulation } from "../../src/sim/simulation";
import type { MatchStatus } from "../../src/sim/simulation";

function playAggressiveMatch(
  seed: number,
  expected: MatchStatus,
  attackOwn = false,
) {
  const simulation = new Simulation(seed, "skirmish");
  let sequence = 0;
  for (let tick = 0; tick <= 30000; tick += 100) {
    const snapshot = simulation.snapshot();
    if (snapshot.matchStatus !== "playing") break;
    const target = (
      attackOwn ? snapshot.settlement.followers : snapshot.opponent?.followers
    )
      ?.slice()
      .sort(
        (first, second) =>
          (snapshot.terrain.heights[
            first.y * snapshot.terrain.size + first.x
          ] ?? 0) -
            (snapshot.terrain.heights[
              second.y * snapshot.terrain.size + second.x
            ] ?? 0) || first.id - second.id,
      )[0];
    const type = snapshot.settlement.mana >= 50 ? "flood" : "earthquake";
    const cost = type === "flood" ? 50 : 30;
    if (snapshot.settlement.mana >= cost && target) {
      simulation.queue({
        tick,
        sequence: sequence++,
        type,
        faction: "player",
        x: target.x,
        y: target.y,
      });
    }
    simulation.advanceTo(tick + 100);
  }
  const snapshot = simulation.snapshot();
  expect(snapshot.matchStatus).toBe(expected);
  expect(snapshot.tick).toBeLessThanOrEqual(30300);
  expect(snapshot.settlement.mana).toBeGreaterThanOrEqual(0);
  expect(snapshot.opponent?.mana).toBeGreaterThanOrEqual(0);

  const hazards = snapshot.hazards.length;
  simulation.queue({
    tick: snapshot.tick,
    sequence,
    type: "flood",
    x: 32,
    y: 32,
  });
  simulation.advanceTo(snapshot.tick + 1);
  expect(simulation.snapshot().hazards).toHaveLength(hazards);
  return snapshot;
}

describe("complete skirmishes", () => {
  it("finishes a player victory and rejects post-outcome hazards", () => {
    const snapshot = playAggressiveMatch(1, "victory");
    expect(snapshot.opponent?.followers).toHaveLength(0);
    expect(snapshot.opponent?.houses).toHaveLength(0);
  }, 15_000);

  it("finishes a player defeat without a zero-house stalemate", () => {
    const snapshot = playAggressiveMatch(0x47_4f_44, "defeat", true);
    expect(snapshot.settlement.followers).toHaveLength(0);
  });
});

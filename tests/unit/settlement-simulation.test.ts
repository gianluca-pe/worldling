import { describe, expect, it } from "vitest";
import { Simulation, runScenario } from "../../src/sim/simulation";
import type { Replay, SimulationCommand } from "../../src/sim/replay";
import { parseReplay, serializeReplay } from "../../src/sim/replay";
import { TERRAIN_EDIT_MANA_COST } from "../../src/sim/settlement";

const center = 32;

describe("settlement simulation integration", () => {
  it("starts with six followers and earns mana each tick", () => {
    const simulation = new Simulation(42);
    const initial = simulation.snapshot();
    simulation.advanceTo(1);
    const next = simulation.snapshot();

    expect(initial.settlement.followers).toHaveLength(6);
    expect(initial.settlement.mana).toBe(30);
    expect(next.settlement.mana).toBeCloseTo(30.0012);
  });

  it("expands the default island beyond its first house", () => {
    const simulation = new Simulation(0x47_4f_44);
    simulation.advanceTo(1200);
    const snapshot = simulation.snapshot();

    expect(snapshot.settlement.houses.length).toBeGreaterThan(1);
    expect(snapshot.settlement.followers.length).toBeGreaterThan(6);
    expect(
      snapshot.settlement.houses.some(
        (building) => building.x !== center || building.y !== center,
      ),
    ).toBe(true);
  });

  it("charges exactly the terrain cost when a command executes", () => {
    const result = runScenario({
      version: 1,
      seed: 42,
      ticks: 1,
      commands: [
        { tick: 0, sequence: 0, type: "raise-land", x: center, y: center },
      ],
    });
    expect(result.settlement.mana).toBeCloseTo(
      30 - TERRAIN_EDIT_MANA_COST + 0.0012,
    );
    expect(result.editCount).toBe(1);
  });

  it("charges five mana when raising land from the sea", () => {
    const result = runScenario({
      version: 1,
      seed: 42,
      ticks: 1,
      commands: [{ tick: 0, sequence: 0, type: "raise-land", x: 0, y: 0 }],
    });
    expect(result.settlement.mana).toBeCloseTo(25.0012);
    expect(result.editCount).toBe(1);
  });

  it("rejects terrain edits when mana is unavailable", () => {
    const commands = Array.from({ length: 11 }, (_, sequence) => ({
      tick: 0,
      sequence,
      type:
        sequence % 2 === 0 ? ("raise-land" as const) : ("lower-land" as const),
      x: center,
      y: center,
    }));
    const result = runScenario({ version: 1, seed: 42, ticks: 1, commands });
    expect(result.editCount).toBe(10);
    expect(result.rejectedEditCount).toBe(1);
    expect(result.lastRejectedEdit?.reason).toBe("mana");
    expect(result.settlement.mana).toBeCloseTo(0.0012);
  });

  it("accepts valid rally commands and rejects submerged targets", () => {
    const valid = runScenario({
      version: 1,
      seed: 42,
      ticks: 1,
      commands: [{ tick: 0, sequence: 0, type: "rally", x: center, y: center }],
    });
    expect(valid.settlement.banner).toEqual({ x: center, y: center });

    const invalid = runScenario({
      version: 1,
      seed: 42,
      ticks: 1,
      commands: [{ tick: 0, sequence: 0, type: "rally", x: 0, y: 0 }],
    });
    expect(invalid.settlement.banner).not.toEqual({ x: 0, y: 0 });
    expect(invalid.lastRejectedEdit?.reason).toBe("terrain");
  });

  it("replays long settlement runs identically after serialization", () => {
    const replay: Replay = {
      version: 1,
      seed: 42,
      ticks: 1000,
      commands: [
        { tick: 0, sequence: 0, type: "rally", x: center, y: center },
        { tick: 20, sequence: 1, type: "lower-land", x: center, y: center },
      ],
    };
    const restored = parseReplay(serializeReplay(replay));
    expect(runScenario(restored)).toEqual(runScenario(replay));
  });

  it("reports invalid targets before checking mana", () => {
    const commands: SimulationCommand[] = Array.from(
      { length: 11 },
      (_, sequence) => ({
        tick: 0,
        sequence,
        type: sequence % 2 === 0 ? "raise-land" : "lower-land",
        x: center,
        y: center,
      }),
    );
    commands.push({
      tick: 0,
      sequence: 11,
      type: "raise-land",
      x: 64,
      y: center,
    });
    const result = runScenario({ version: 1, seed: 42, ticks: 1, commands });
    expect(result.lastRejectedEdit?.reason).toBe("terrain");
    expect(result.settlement.mana).toBeCloseTo(0.0012);
  });
});

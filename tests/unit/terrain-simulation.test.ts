import { describe, expect, it } from "vitest";
import { runScenario } from "../../src/sim/simulation";
import type { Replay } from "../../src/sim/replay";
import { parseReplay, serializeReplay } from "../../src/sim/replay";
import { MAP_SIZE, MAX_HEIGHT, WATER_LEVEL } from "../../src/sim/terrain";

const center = Math.floor(MAP_SIZE / 2);

function terrainReplay(commands: Replay["commands"]): Replay {
  return { version: 1, seed: 42, ticks: 1, commands };
}

describe("terrain simulation commands", () => {
  it("raises and lowers terrain deterministically", () => {
    const replay = terrainReplay([
      { tick: 0, sequence: 0, type: "raise-land", x: center, y: center },
      { tick: 0, sequence: 1, type: "lower-land", x: center, y: center },
    ]);
    const initial = runScenario({
      version: 1,
      seed: 42,
      ticks: 1,
      commands: [],
    });
    const result = runScenario(replay);

    expect(result.terrain.heights).toEqual(initial.terrain.heights);
    expect(result.editCount).toBe(2);
    expect(result.lastTerrainEdit).toMatchObject({
      x: center,
      y: center,
      sequence: 1,
    });
  });

  it("rejects out-of-bounds edits without changing land", () => {
    const initial = runScenario({
      version: 1,
      seed: 42,
      ticks: 1,
      commands: [],
    });
    const result = runScenario(
      terrainReplay([
        { tick: 0, sequence: 0, type: "raise-land", x: MAP_SIZE, y: center },
      ]),
    );
    expect(result.terrain.heights).toEqual(initial.terrain.heights);
    expect(result.editCount).toBe(0);
    expect(result.rejectedEditCount).toBe(1);
  });

  it("rejects edits beyond the height limit", () => {
    const commands = Array.from({ length: MAX_HEIGHT + 2 }, (_, sequence) => ({
      tick: 0,
      sequence,
      type: "raise-land" as const,
      x: center,
      y: center,
    }));
    const result = runScenario(terrainReplay(commands));
    expect(result.lastTerrainEdit?.height).toBeLessThanOrEqual(MAX_HEIGHT);
    expect(result.rejectedEditCount).toBeGreaterThan(0);
  });

  it("keeps the water level fixed during sandbox edits", () => {
    const result = runScenario(
      terrainReplay([
        { tick: 0, sequence: 0, type: "lower-land", x: center, y: center },
      ]),
    );
    expect(result.terrain.waterLevel).toBe(WATER_LEVEL);
  });

  it("round-trips terrain commands and preserves a golden terrain hash", () => {
    const replay = terrainReplay([
      { tick: 0, sequence: 0, type: "raise-land", x: center, y: center },
    ]);
    const restored = parseReplay(serializeReplay(replay));
    const result = runScenario(restored);
    const hash = result.terrain.heights.reduce(
      (value, height) => Math.imul(value ^ height, 0x01000193) >>> 0,
      0x811c9dc5,
    );

    expect(result.terrain.heights).toEqual(runScenario(replay).terrain.heights);
    expect(hash).toBe(2475325700);
    expect(result.lastTerrainEdit).toMatchObject({
      x: center,
      y: center,
      height: 6,
    });
  });

  it("records the rejected edit for user feedback", () => {
    const result = runScenario(
      terrainReplay([
        { tick: 0, sequence: 0, type: "raise-land", x: MAP_SIZE, y: center },
      ]),
    );
    expect(result.lastRejectedEdit).toMatchObject({
      sequence: 0,
      x: MAP_SIZE,
      y: center,
    });
  });
});

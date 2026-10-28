import { describe, expect, it } from "vitest";
import {
  MAP_SIZE,
  MAX_HEIGHT,
  MIN_HEIGHT,
  WATER_LEVEL,
  editTerrain,
  generateIsland,
  terrainIndex,
  validateTerrain,
} from "../../src/sim/terrain";
import type { TerrainState } from "../../src/sim/terrain";

function landRatio(terrain: TerrainState): number {
  return (
    terrain.heights.reduce(
      (count, height) => count + Number(height > WATER_LEVEL),
      0,
    ) / terrain.heights.length
  );
}

describe("island generation", () => {
  it("is deterministic for the same seed", () => {
    expect(generateIsland(42)).toEqual(generateIsland(42));
  });

  it("generates different terrain for different seeds", () => {
    expect(generateIsland(42).heights).not.toEqual(generateIsland(43).heights);
  });

  it("generates useful integer terrain for 100 seeds", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const terrain = generateIsland(seed);
      expect(terrain.size).toBe(MAP_SIZE);
      expect(terrain.waterLevel).toBe(WATER_LEVEL);
      expect(terrain.heights).toHaveLength(MAP_SIZE * MAP_SIZE);
      expect(landRatio(terrain)).toBeGreaterThanOrEqual(0.2);
      expect(landRatio(terrain)).toBeLessThanOrEqual(0.75);
      expect(
        terrain.heights[terrainIndex(MAP_SIZE / 2, MAP_SIZE / 2)]!,
      ).toBeGreaterThan(WATER_LEVEL);
      expect(
        terrain.heights.every(
          (height) =>
            Number.isInteger(height) &&
            height >= MIN_HEIGHT &&
            height <= MAX_HEIGHT,
        ),
      ).toBe(true);
      expect(() => validateTerrain(terrain)).not.toThrow();
    }
  });
});

describe("terrain indexing", () => {
  it("uses row-major indexing and supports an explicit size", () => {
    expect(terrainIndex(3, 2)).toBe(2 * MAP_SIZE + 3);
    expect(terrainIndex(3, 2, 8)).toBe(19);
  });

  it.each([
    [-1, 0],
    [0, -1],
    [MAP_SIZE, 0],
    [0, MAP_SIZE],
    [1.5, 0],
    [0, Number.NaN],
  ])("rejects invalid coordinates (%s, %s)", (x, y) => {
    expect(() => terrainIndex(x, y)).toThrow(RangeError);
  });
});

describe("terrain editing", () => {
  it("raises and lowers exactly one level", () => {
    const terrain = generateIsland(7);
    const index = terrainIndex(10, 10);
    terrain.heights[index] = 3;

    expect(editTerrain(terrain, 10, 10, "raise")).toBe(true);
    expect(terrain.heights[index]).toBe(4);
    expect(editTerrain(terrain, 10, 10, "lower")).toBe(true);
    expect(terrain.heights[index]).toBe(3);
  });

  it("does not edit beyond the height bounds", () => {
    const terrain = generateIsland(7);
    const index = terrainIndex(10, 10);

    terrain.heights[index] = MAX_HEIGHT;
    expect(editTerrain(terrain, 10, 10, "raise")).toBe(false);
    expect(terrain.heights[index]).toBe(MAX_HEIGHT);

    terrain.heights[index] = MIN_HEIGHT;
    expect(editTerrain(terrain, 10, 10, "lower")).toBe(false);
    expect(terrain.heights[index]).toBe(MIN_HEIGHT);
  });

  it.each([
    [-1, 0],
    [0, -1],
    [MAP_SIZE, 0],
    [0, MAP_SIZE],
    [1.5, 0],
    [0, Number.NaN],
  ])("treats an edit at (%s, %s) as a no-op", (x, y) => {
    const terrain = generateIsland(7);
    const before = terrain.heights.slice();

    expect(editTerrain(terrain, x, y, "raise")).toBe(false);
    expect(terrain.heights).toEqual(before);
  });
});

describe("terrain validation", () => {
  it("rejects incorrect dimensions, water level, and height-data length", () => {
    const terrain = generateIsland(9);
    expect(() => validateTerrain({ ...terrain, size: 32 })).toThrow(RangeError);
    expect(() => validateTerrain({ ...terrain, waterLevel: 1 })).toThrow(
      RangeError,
    );
    expect(() =>
      validateTerrain({ ...terrain, heights: terrain.heights.slice(1) }),
    ).toThrow(RangeError);
  });

  it.each([MIN_HEIGHT - 1, MAX_HEIGHT + 1, 2.5])(
    "rejects a height value of %s",
    (invalidHeight) => {
      const terrain = generateIsland(9);
      const heights = new Proxy(terrain.heights.slice(), {
        get(target, property) {
          if (property === "0") return invalidHeight;
          return Reflect.get(target, property);
        },
      });
      expect(() => validateTerrain({ ...terrain, heights })).toThrow(
        RangeError,
      );
    },
  );

  it("rejects too little or too much land", () => {
    const terrain = generateIsland(9);
    const ocean = new Uint8Array(terrain.heights.length);
    const land = new Uint8Array(terrain.heights.length).fill(MAX_HEIGHT);

    expect(() => validateTerrain({ ...terrain, heights: ocean })).toThrow(
      /20% and 75%/,
    );
    expect(() => validateTerrain({ ...terrain, heights: land })).toThrow(
      /20% and 75%/,
    );
  });

  it("rejects a submerged central tile", () => {
    const terrain = generateIsland(9);
    const heights = terrain.heights.slice();
    heights[terrainIndex(MAP_SIZE / 2, MAP_SIZE / 2)] = WATER_LEVEL;

    expect(() => validateTerrain({ ...terrain, heights })).toThrow(/central/);
  });
});

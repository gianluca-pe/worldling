import { describe, expect, it } from "vitest";
import { tileNoise } from "../../src/render/terrain-renderer";
import { createSkirmishSettlements } from "../../src/sim/skirmish";
import {
  ISLAND_GEOGRAPHIES,
  generateIsland,
  islandGeography,
} from "../../src/sim/terrain";

describe("seeded geography", () => {
  it("provides every geography family and distinct islands within families", () => {
    const seen = new Set<string>();
    const byFamily = new Map<string, number>();
    for (let seed = 0; seed < 64; seed += 1) {
      const family = islandGeography(seed);
      seen.add(family);
      if (!byFamily.has(family)) {
        byFamily.set(family, seed);
        expect(generateIsland(seed).heights).not.toEqual(
          generateIsland(seed + 64).heights,
        );
      }
    }
    expect([...seen].sort()).toEqual([...ISLAND_GEOGRAPHIES].sort());
  });

  it("produces substantially more rocky ground in highlands than lowlands", () => {
    const rockyTiles = { highlands: 0, lowlands: 0 };
    for (let seed = 0; seed < 64; seed += 1) {
      const family = islandGeography(seed);
      if (family !== "highlands" && family !== "lowlands") continue;
      rockyTiles[family] += generateIsland(seed).heights.reduce(
        (count, height) => count + Number(height >= 6),
        0,
      );
    }
    expect(rockyTiles.highlands).toBeGreaterThan(0);
    expect(rockyTiles.highlands).toBeGreaterThan(rockyTiles.lowlands * 4);
  });

  it("keeps terrain and fair skirmish starts valid over 500 seeds", () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const terrain = generateIsland(seed);
      const starts = createSkirmishSettlements(terrain);
      expect(starts.player.followers).toHaveLength(6);
      expect(starts.opponent.followers).toHaveLength(6);
      expect(starts.player.mana).toBe(starts.opponent.mana);
      expect(
        Math.abs(
          starts.areas.player.landTiles - starts.areas.opponent.landTiles,
        ),
      ).toBeLessThanOrEqual(12);
      expect(
        Math.abs(
          starts.areas.player.buildingSites -
            starts.areas.opponent.buildingSites,
        ),
      ).toBeLessThanOrEqual(6);
    }
  }, 15_000);
});

describe("seeded terrain decoration", () => {
  it("is deterministic per seed and varies across seeds", () => {
    expect(tileNoise(12, 20, 29, 42)).toBe(tileNoise(12, 20, 29, 42));
    expect(tileNoise(12, 20, 29, 42)).not.toBe(tileNoise(12, 20, 29, 43));
    expect(tileNoise(12, 20, 29, 42)).not.toBe(tileNoise(12, 20, 47, 42));
  });

  it("provides different cluster fields without touching terrain", () => {
    const before = generateIsland(42);
    const original = before.heights.slice();
    const first = tileNoise(4, 4, 47, 42);
    const second = tileNoise(4, 4, 47, 43);
    expect(first).not.toBe(second);
    expect(before.heights).toEqual(original);
  });
});

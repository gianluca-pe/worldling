import { describe, expect, it } from "vitest";
import {
  createSkirmishSettlements,
  hasTerrainPath,
  measureStartArea,
} from "../../src/sim/skirmish";
import {
  generateIsland,
  isTerrainAboveWater,
  terrainIndex,
} from "../../src/sim/terrain";

describe("fair skirmish starts", () => {
  it("creates equal, connected starts across 100 seeds", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const terrain = generateIsland(seed);
      const starts = createSkirmishSettlements(terrain);
      const actualAreas = {
        player: measureStartArea(terrain, starts.player.banner),
        opponent: measureStartArea(terrain, starts.opponent.banner),
      };
      expect(starts.areas).toEqual(actualAreas);
      for (const faction of ["player", "opponent"] as const) {
        const settlement = starts[faction];
        expect(settlement.followers).toHaveLength(6);
        expect(settlement.mana).toBe(30);
        expect(
          isTerrainAboveWater(
            terrain,
            settlement.banner.x,
            settlement.banner.y,
          ),
        ).toBe(true);
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            expect(
              terrain.heights[
                terrainIndex(
                  settlement.banner.x + offsetX,
                  settlement.banner.y + offsetY,
                  terrain.size,
                )
              ],
            ).toBe(5);
          }
        }
      }
      expect(starts.opponent.banner).not.toEqual(starts.player.banner);
      expect(
        hasTerrainPath(terrain, starts.player.banner, starts.opponent.banner),
      ).toBe(true);
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
  });
});

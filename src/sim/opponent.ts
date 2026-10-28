import { HAZARD_RULES } from "./hazards";
import { SeededRandom } from "./random";
import type { Faction, SimulationCommand } from "./replay";
import {
  isSuitableBuildingSite,
  TERRAIN_EDIT_MANA_COST,
  terrainEditManaCost,
} from "./settlement";
import type { Point, SettlementState } from "./settlement";
import { reachableTerrainTiles } from "./skirmish";
import { canEditTerrain, terrainIndex } from "./terrain";
import type { TerrainState } from "./terrain";

type Action = Exclude<SimulationCommand, { type: "probe" }>;

export interface OpponentSnapshot {
  readonly nextDecisionTick: number;
  readonly nextSpellTick: number;
  readonly randomState: number;
}

export class OpponentController {
  private nextDecisionTick = 0;
  private nextSpellTick = 0;

  constructor(private readonly random: SeededRandom) {}

  snapshot(): OpponentSnapshot {
    return {
      nextDecisionTick: this.nextDecisionTick,
      nextSpellTick: this.nextSpellTick,
      randomState: this.random.snapshot(),
    };
  }

  decide(
    tick: number,
    terrain: TerrainState,
    faction: Faction,
    own: SettlementState,
    rival: SettlementState,
  ): Action | null {
    if (tick < this.nextDecisionTick) return null;
    this.nextDecisionTick = tick + 20;

    if (own.followers.length === 0) {
      return this.repairFoundation(terrain, faction, own);
    }

    if (!isSuitableBuildingSite(terrain, own.banner.x, own.banner.y)) {
      const destination = this.nearestBuildingSite(terrain, own.banner);
      if (destination) {
        return { type: "rally", faction, tick: 0, sequence: 0, ...destination };
      }
    }

    if (tick >= this.nextSpellTick && rival.houses.length > 0) {
      const reachable = reachableTerrainTiles(terrain, own.banner);
      const targets = rival.houses
        .filter((house) =>
          reachable.has(terrainIndex(house.x, house.y, terrain.size)),
        )
        .sort(
          (first, second) => second.level - first.level || first.id - second.id,
        );
      const target = targets[0];
      if (target) {
        const type =
          this.random.nextUint32() % 2 === 0 ? "earthquake" : "flood";
        if (own.mana >= HAZARD_RULES[type].cost) {
          this.nextSpellTick = tick + 300;
          return {
            type,
            faction,
            tick: 0,
            sequence: 0,
            x: target.x,
            y: target.y,
          };
        }
      }
    }

    if (own.mana >= 25) {
      return this.repairFoundation(terrain, faction, own);
    }
    return null;
  }

  private repairFoundation(
    terrain: TerrainState,
    faction: Faction,
    own: SettlementState,
  ): Action | null {
    if (own.mana < TERRAIN_EDIT_MANA_COST) return null;
    for (const house of own.houses) {
      const height = terrain.heights[house.y * terrain.size + house.x]!;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const x = house.x + offsetX;
          const y = house.y + offsetY;
          if (x < 0 || y < 0 || x >= terrain.size || y >= terrain.size) {
            continue;
          }
          const sample = terrain.heights[y * terrain.size + x]!;
          if (sample === height) continue;
          const direction = sample < height ? "raise-land" : "lower-land";
          if (
            canEditTerrain(
              terrain,
              x,
              y,
              direction === "raise-land" ? "raise" : "lower",
            )
          ) {
            const cost = terrainEditManaCost(
              terrain,
              x,
              y,
              direction === "raise-land" ? "raise" : "lower",
            );
            if (own.mana < cost) continue;
            return { type: direction, faction, tick: 0, sequence: 0, x, y };
          }
        }
      }
    }
    return null;
  }

  private nearestBuildingSite(
    terrain: TerrainState,
    origin: Point,
  ): Point | undefined {
    const candidates: Point[] = [];
    const reachable = reachableTerrainTiles(terrain, origin);
    for (let y = 0; y < terrain.size; y += 1) {
      for (let x = 0; x < terrain.size; x += 1) {
        if (
          isSuitableBuildingSite(terrain, x, y) &&
          reachable.has(terrainIndex(x, y, terrain.size))
        ) {
          candidates.push({ x, y });
        }
      }
    }
    candidates.sort(
      (first, second) =>
        Math.abs(first.x - origin.x) +
          Math.abs(first.y - origin.y) -
          Math.abs(second.x - origin.x) -
          Math.abs(second.y - origin.y) ||
        first.y - second.y ||
        first.x - second.x,
    );
    return candidates[0];
  }
}

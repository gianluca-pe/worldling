import type { Faction } from "./replay";
import type { Point } from "./settlement";
import { editTerrain } from "./terrain";
import type { TerrainState } from "./terrain";

export type HazardType = "earthquake" | "flood";

export interface Hazard {
  readonly id: number;
  readonly type: HazardType;
  readonly faction: Faction;
  readonly target: Point;
  readonly cells: readonly Point[];
  readonly executeTick: number;
  readonly endTick: number;
}

export const HAZARD_RULES = {
  earthquake: { cost: 30, radius: 2, warningTicks: 100, activeTicks: 0 },
  flood: { cost: 50, radius: 3, warningTicks: 100, activeTicks: 200 },
} as const;

export function hazardCells(
  size: number,
  target: Point,
  radius: number,
): Point[] {
  const cells: Point[] = [];
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const x = target.x + offsetX;
      const y = target.y + offsetY;
      if (x >= 0 && y >= 0 && x < size && y < size) cells.push({ x, y });
    }
  }
  return cells;
}

export function createHazard(
  id: number,
  type: HazardType,
  faction: Faction,
  target: Point,
  size: number,
  tick: number,
): Hazard {
  const rules = HAZARD_RULES[type];
  const executeTick = tick + rules.warningTicks;
  return {
    id,
    type,
    faction,
    target: { ...target },
    cells: hazardCells(size, target, rules.radius),
    executeTick,
    endTick: executeTick + rules.activeTicks,
  };
}

export function advanceHazards(
  hazards: readonly Hazard[],
  terrain: TerrainState,
  tick: number,
): Hazard[] {
  if (!terrain.flooded)
    throw new Error("Skirmish terrain requires a flood mask");
  terrain.flooded.fill(0);
  const remaining: Hazard[] = [];
  for (const hazard of hazards) {
    if (hazard.type === "earthquake") {
      if (tick === hazard.executeTick) {
        for (const cell of hazard.cells)
          editTerrain(terrain, cell.x, cell.y, "lower");
      }
      if (tick < hazard.executeTick) remaining.push(hazard);
      continue;
    }
    if (tick >= hazard.endTick) continue;
    remaining.push(hazard);
    if (tick >= hazard.executeTick) {
      for (const cell of hazard.cells) {
        const index = cell.y * terrain.size + cell.x;
        if (terrain.heights[index]! <= 4) terrain.flooded[index] = 1;
      }
    }
  }
  return remaining;
}

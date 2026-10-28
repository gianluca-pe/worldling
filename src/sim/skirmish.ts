import type { Faction } from "./replay";
import { createSettlement, isSuitableBuildingSite } from "./settlement";
import type { Point, SettlementState } from "./settlement";
import { isTerrainAboveWater, terrainIndex } from "./terrain";
import type { TerrainState } from "./terrain";

export interface StartArea {
  readonly landTiles: number;
  readonly buildingSites: number;
}

interface Candidate extends StartArea {
  readonly point: Point;
}

export interface SkirmishSettlements {
  readonly player: SettlementState;
  readonly opponent: SettlementState;
  readonly areas: Record<Faction, StartArea>;
}

export function measureStartArea(
  terrain: TerrainState,
  point: Point,
): StartArea {
  let landTiles = 0;
  let buildingSites = 0;
  for (let offsetY = -4; offsetY <= 4; offsetY += 1) {
    for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
      const x = point.x + offsetX;
      const y = point.y + offsetY;
      if (isTerrainAboveWater(terrain, x, y)) landTiles += 1;
      if (isSuitableBuildingSite(terrain, x, y)) buildingSites += 1;
    }
  }
  return { landTiles, buildingSites };
}

function reachableTiles(terrain: TerrainState, start: Point): Set<number> {
  const reached = new Set<number>();
  if (!isTerrainAboveWater(terrain, start.x, start.y)) return reached;
  const queue = [start];
  reached.add(terrainIndex(start.x, start.y, terrain.size));
  for (let read = 0; read < queue.length; read += 1) {
    const current = queue[read]!;
    for (const [offsetX, offsetY] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const x = current.x + offsetX;
      const y = current.y + offsetY;
      if (!isTerrainAboveWater(terrain, x, y)) continue;
      const index = terrainIndex(x, y, terrain.size);
      if (reached.has(index)) continue;
      reached.add(index);
      queue.push({ x, y });
    }
  }
  return reached;
}

interface PathCacheEntry {
  readonly heights: readonly number[];
  readonly flooded?: readonly number[];
  readonly reached: Set<number>;
}

const pathCache = new WeakMap<TerrainState, Map<number, PathCacheEntry>>();

function unchanged(
  current: readonly number[] | Uint8Array | undefined,
  cached: readonly number[] | undefined,
): boolean {
  if (current === undefined || cached === undefined) {
    return current === cached;
  }
  return (
    current.length === cached.length &&
    current.every((value, index) => value === cached[index])
  );
}

export function reachableTerrainTiles(
  terrain: TerrainState,
  start: Point,
): ReadonlySet<number> {
  const startIndex = terrainIndex(start.x, start.y, terrain.size);
  const entries = pathCache.get(terrain) ?? new Map<number, PathCacheEntry>();
  pathCache.set(terrain, entries);
  const cached = entries.get(startIndex);
  const reached =
    cached &&
    unchanged(terrain.heights, cached.heights) &&
    unchanged(terrain.flooded, cached.flooded)
      ? cached.reached
      : reachableTiles(terrain, start);
  if (!cached || reached !== cached.reached) {
    entries.set(startIndex, {
      heights: Array.from(terrain.heights),
      flooded: terrain.flooded ? Array.from(terrain.flooded) : undefined,
      reached,
    });
  }
  return reached;
}

export function hasTerrainPath(
  terrain: TerrainState,
  start: Point,
  goal: Point,
): boolean {
  if (!isTerrainAboveWater(terrain, goal.x, goal.y)) return false;
  return reachableTerrainTiles(terrain, start).has(
    terrainIndex(goal.x, goal.y, terrain.size),
  );
}

function normalizedArea(terrain: TerrainState, point: Point): StartArea {
  const original: { index: number; height: number }[] = [];
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const index = terrainIndex(
        point.x + offsetX,
        point.y + offsetY,
        terrain.size,
      );
      original.push({ index, height: terrain.heights[index]! });
      terrain.heights[index] = 5;
    }
  }
  const area = measureStartArea(terrain, point);
  for (const cell of original) terrain.heights[cell.index] = cell.height;
  return area;
}

function candidates(terrain: TerrainState): Candidate[] {
  const center = Math.floor(terrain.size / 2);
  const reachable = reachableTiles(terrain, { x: center, y: center });
  const result: Candidate[] = [];
  for (let y = 4; y < terrain.size - 4; y += 4) {
    for (let x = 4; x < terrain.size - 4; x += 4) {
      const point = { x, y };
      if (!reachable.has(terrainIndex(x, y, terrain.size))) continue;
      const area = normalizedArea(terrain, point);
      if (area.landTiles >= 24 && area.buildingSites >= 2) {
        result.push({ point, ...area });
      }
    }
  }
  return result;
}

function normalizePlateau(terrain: TerrainState, point: Point): void {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const index = terrainIndex(
        point.x + offsetX,
        point.y + offsetY,
        terrain.size,
      );
      terrain.heights[index] = 5;
      if (terrain.flooded) terrain.flooded[index] = 0;
    }
  }
}

export function createSkirmishSettlements(
  terrain: TerrainState,
): SkirmishSettlements {
  const choices = candidates(terrain);
  let first: Candidate | undefined;
  let second: Candidate | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestDistance = -1;
  for (const player of choices) {
    for (const opponent of choices) {
      const distance =
        Math.abs(player.point.x - opponent.point.x) +
        Math.abs(player.point.y - opponent.point.y);
      if (distance < 24) continue;
      const score =
        Math.abs(player.landTiles - opponent.landTiles) +
        Math.abs(player.buildingSites - opponent.buildingSites) * 4;
      if (
        score < bestScore ||
        (score === bestScore && distance > bestDistance) ||
        (score === bestScore &&
          distance === bestDistance &&
          (player.point.y - opponent.point.y ||
            player.point.x - opponent.point.x) < 0)
      ) {
        first = player;
        second = opponent;
        bestScore = score;
        bestDistance = distance;
      }
    }
  }
  if (!first || !second) {
    throw new RangeError("The island lacks two fair reachable starting areas");
  }

  normalizePlateau(terrain, first.point);
  normalizePlateau(terrain, second.point);
  return {
    player: createSettlement(terrain, first.point),
    opponent: createSettlement(terrain, second.point),
    areas: {
      player: measureStartArea(terrain, first.point),
      opponent: measureStartArea(terrain, second.point),
    },
  };
}

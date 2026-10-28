import { SeededRandom } from "./random";

export const MAP_SIZE = 64;
export const WATER_LEVEL = 2;
export const MIN_HEIGHT = 0;
export const MAX_HEIGHT = 7;

const MIN_LAND_RATIO = 0.2;
const MAX_LAND_RATIO = 0.75;

export interface TerrainState {
  readonly size: number;
  readonly waterLevel: number;
  readonly heights: Uint8Array;
  readonly flooded?: Uint8Array;
}

export function terrainIndex(
  x: number,
  y: number,
  size: number = MAP_SIZE,
): number {
  if (
    !Number.isInteger(size) ||
    size <= 0 ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= size ||
    y >= size
  ) {
    throw new RangeError("Terrain coordinates must be integers in bounds");
  }
  return y * size + x;
}

export function isTerrainFlooded(
  terrain: TerrainState,
  x: number,
  y: number,
): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < 0 || y < 0 || x >= terrain.size || y >= terrain.size) return false;
  return terrain.flooded?.[y * terrain.size + x] === 1;
}

export function isTerrainAboveWater(
  terrain: TerrainState,
  x: number,
  y: number,
): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < 0 || y < 0 || x >= terrain.size || y >= terrain.size) return false;
  return (
    terrain.heights[y * terrain.size + x]! > terrain.waterLevel &&
    !isTerrainFlooded(terrain, x, y)
  );
}

function smoothNoise(noise: Float64Array): Float64Array {
  let source: Float64Array = noise;
  let target: Float64Array = new Float64Array(noise.length);

  for (let pass = 0; pass < 1; pass += 1) {
    for (let y = 0; y < MAP_SIZE; y += 1) {
      for (let x = 0; x < MAP_SIZE; x += 1) {
        let total = 0;
        let samples = 0;
        for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
          for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
            const sampleX = x + offsetX;
            const sampleY = y + offsetY;
            if (
              sampleX >= 0 &&
              sampleY >= 0 &&
              sampleX < MAP_SIZE &&
              sampleY < MAP_SIZE
            ) {
              total += source[terrainIndex(sampleX, sampleY)]!;
              samples += 1;
            }
          }
        }
        target[terrainIndex(x, y)] = total / samples;
      }
    }
    [source, target] = [target, source];
  }

  return source;
}

export function validateTerrain(terrain: TerrainState): void {
  if (terrain.size !== MAP_SIZE || terrain.waterLevel !== WATER_LEVEL) {
    throw new RangeError("Terrain dimensions or water level are invalid");
  }
  if (
    !(terrain.heights instanceof Uint8Array) ||
    terrain.heights.length !== MAP_SIZE * MAP_SIZE
  ) {
    throw new RangeError("Terrain height data has an invalid length or type");
  }
  if (
    terrain.flooded !== undefined &&
    (!(terrain.flooded instanceof Uint8Array) ||
      terrain.flooded.length !== terrain.heights.length)
  ) {
    throw new RangeError("Terrain flood data has an invalid length or type");
  }

  let landTiles = 0;
  for (let index = 0; index < terrain.heights.length; index += 1) {
    const height = terrain.heights[index]!;
    if (
      !Number.isInteger(height) ||
      height < MIN_HEIGHT ||
      height > MAX_HEIGHT
    ) {
      throw new RangeError("Terrain heights must be integers in bounds");
    }
    if (height > terrain.waterLevel) {
      landTiles += 1;
    }
  }

  const landRatio = landTiles / terrain.heights.length;
  if (landRatio < MIN_LAND_RATIO || landRatio > MAX_LAND_RATIO) {
    throw new RangeError("Terrain must have between 20% and 75% land");
  }
  const center = MAP_SIZE / 2;
  if (terrain.heights[terrainIndex(center, center)]! <= terrain.waterLevel) {
    throw new RangeError("The central terrain tile must be above water");
  }
}

export const ISLAND_GEOGRAPHIES = [
  "ridges",
  "highlands",
  "lowlands",
  "archipelago",
] as const;
export type IslandGeography = (typeof ISLAND_GEOGRAPHIES)[number];

export function islandGeography(seed: number): IslandGeography {
  const random = new SeededRandom((seed ^ 0xa5_a5_a5_a5) >>> 0);
  return ISLAND_GEOGRAPHIES[random.nextUint32() % ISLAND_GEOGRAPHIES.length]!;
}

export function generateIsland(seed: number): TerrainState {
  const random = new SeededRandom(seed);
  const noise = new Float64Array(MAP_SIZE * MAP_SIZE);
  for (let index = 0; index < noise.length; index += 1) {
    noise[index] = random.nextUint32() / 0x1_00_00_00_00;
  }
  const smoothed = smoothNoise(noise);
  const parameters = new SeededRandom((seed ^ 0x51_5e_d5_ed) >>> 0);
  const nextPhase = () =>
    (parameters.nextUint32() / 0x1_00_00_00_00) * Math.PI * 2;
  const geography = islandGeography(seed);
  const phase = nextPhase();
  const orientation = nextPhase();
  const aspect = 0.78 + (parameters.nextUint32() / 0x1_00_00_00_00) * 0.48;
  const peakAngle = nextPhase();
  const peakDistance = 8 + (parameters.nextUint32() / 0x1_00_00_00_00) * 9;
  const peakX = (MAP_SIZE - 1) / 2 + Math.cos(peakAngle) * peakDistance;
  const peakY = (MAP_SIZE - 1) / 2 + Math.sin(peakAngle) * peakDistance;
  const heights = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const center = (MAP_SIZE - 1) / 2;
  const cosine = Math.cos(orientation);
  const sine = Math.sin(orientation);

  for (let y = 0; y < MAP_SIZE; y += 1) {
    for (let x = 0; x < MAP_SIZE; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const rotatedX = (dx * cosine + dy * sine) / aspect;
      const rotatedY = (-dx * sine + dy * cosine) * aspect;
      const angle = Math.atan2(rotatedY, rotatedX);
      const coast =
        (geography === "lowlands"
          ? 1.2
          : geography === "archipelago"
            ? 1.04
            : 1.1) +
        Math.sin(angle * 2 + phase) * 0.19 +
        Math.sin(angle * 5 - phase) * 0.13 +
        Math.sin(angle * 9 + orientation) * 0.06;
      const distance = Math.hypot(rotatedX, rotatedY) / (MAP_SIZE / 2);
      const radial = Math.max(0, 1 - distance / coast);
      const localNoise = (smoothed[terrainIndex(x, y)]! - 0.5) * 5.5;
      const ridgeLine = rotatedY - rotatedX * 0.35;
      const ridges =
        Math.exp(-(ridgeLine * ridgeLine) / 65) *
        radial *
        (2.7 + Math.sin(rotatedX * 0.3 + phase) * 0.8);
      const highlands =
        Math.max(0, 1 - Math.hypot(x - peakX, y - peakY) / 19) * 4.4;
      const channels =
        geography === "archipelago"
          ? Math.max(0, Math.sin(angle * 5 + phase)) *
            Math.max(0, distance - 0.3) *
            4.2
          : 0;
      const base =
        geography === "ridges"
          ? radial * 4.2 + ridges
          : geography === "highlands"
            ? radial * 3.8 + highlands
            : geography === "lowlands"
              ? radial * 4.5
              : radial * 5.2;
      const elevation = base + localNoise - channels;
      heights[terrainIndex(x, y)] = Math.max(
        MIN_HEIGHT,
        Math.min(MAX_HEIGHT, Math.floor(elevation)),
      );
    }
  }

  for (let pass = 0; pass < MAX_HEIGHT; pass += 1) {
    const landRatio =
      heights.reduce(
        (count, height) => count + Number(height > WATER_LEVEL),
        0,
      ) / heights.length;
    if (landRatio >= MIN_LAND_RATIO && landRatio <= MAX_LAND_RATIO) break;
    const adjustment = landRatio < MIN_LAND_RATIO ? 1 : -1;
    for (let index = 0; index < heights.length; index += 1) {
      heights[index] = Math.max(
        MIN_HEIGHT,
        Math.min(MAX_HEIGHT, heights[index]! + adjustment),
      );
    }
  }

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      heights[terrainIndex(MAP_SIZE / 2 + offsetX, MAP_SIZE / 2 + offsetY)] = 5;
    }
  }

  const terrain = {
    size: MAP_SIZE,
    waterLevel: WATER_LEVEL,
    heights,
    flooded: new Uint8Array(MAP_SIZE * MAP_SIZE),
  };
  validateTerrain(terrain);
  return terrain;
}

export function canEditTerrain(
  terrain: TerrainState,
  x: number,
  y: number,
  direction: "raise" | "lower",
): boolean {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= terrain.size ||
    y >= terrain.size
  ) {
    return false;
  }
  const height = terrain.heights[terrainIndex(x, y, terrain.size)]!;
  return !(
    (direction === "raise" && height === MAX_HEIGHT) ||
    (direction === "lower" && height === MIN_HEIGHT)
  );
}

export function editTerrain(
  terrain: TerrainState,
  x: number,
  y: number,
  direction: "raise" | "lower",
): boolean {
  if (!canEditTerrain(terrain, x, y, direction)) return false;
  const index = terrainIndex(x, y, terrain.size);
  const height = terrain.heights[index]!;
  terrain.heights[index] = height + (direction === "raise" ? 1 : -1);
  return true;
}

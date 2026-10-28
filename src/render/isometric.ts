import type { Point } from "./camera";

export const TILE_WIDTH = 48;
export const TILE_HEIGHT = 24;
export const HEIGHT_STEP = 7;

export function projectTile(x: number, y: number, height: number): Point {
  return {
    x: ((x - y) * TILE_WIDTH) / 2,
    y: ((x + y) * TILE_HEIGHT) / 2 - height * HEIGHT_STEP,
  };
}

export function unprojectTile(point: Point): Point {
  return {
    x: point.y / TILE_HEIGHT + point.x / TILE_WIDTH,
    y: point.y / TILE_HEIGHT - point.x / TILE_WIDTH,
  };
}

export function tileDiamond(x: number, y: number, height: number): Point[] {
  const top = projectTile(x, y, height);
  return [
    top,
    { x: top.x + TILE_WIDTH / 2, y: top.y + TILE_HEIGHT / 2 },
    { x: top.x, y: top.y + TILE_HEIGHT },
    { x: top.x - TILE_WIDTH / 2, y: top.y + TILE_HEIGHT / 2 },
  ];
}

export interface SurfaceTerrain {
  readonly size: number;
  readonly waterLevel: number;
  readonly heights: Uint8Array | readonly number[];
  readonly flooded?: Uint8Array | readonly number[];
}

export function createCornerHeights(terrain: SurfaceTerrain): Float64Array {
  const corners = new Float64Array((terrain.size + 1) ** 2);
  for (let cornerY = 0; cornerY <= terrain.size; cornerY += 1) {
    for (let cornerX = 0; cornerX <= terrain.size; cornerX += 1) {
      let total = 0;
      for (const [offsetX, offsetY] of [
        [-1, -1],
        [0, -1],
        [-1, 0],
        [0, 0],
      ] as const) {
        const x = cornerX + offsetX;
        const y = cornerY + offsetY;
        const inBounds =
          x >= 0 && y >= 0 && x < terrain.size && y < terrain.size;
        const index = inBounds ? y * terrain.size + x : -1;
        const flooded = index >= 0 && terrain.flooded?.[index] === 1;
        const height = inBounds
          ? (terrain.heights[index] ?? terrain.waterLevel)
          : terrain.waterLevel;
        total += flooded
          ? terrain.waterLevel
          : Math.max(height, terrain.waterLevel);
      }
      corners[cornerY * (terrain.size + 1) + cornerX] = total / 4;
    }
  }
  return corners;
}

export function surfaceQuad(
  x: number,
  y: number,
  size: number,
  corners: Float64Array,
): Point[] {
  const height = (cornerX: number, cornerY: number) =>
    corners[cornerY * (size + 1) + cornerX] ?? 0;
  return [
    projectTile(x, y, height(x, y)),
    projectTile(x + 1, y, height(x + 1, y)),
    projectTile(x + 1, y + 1, height(x + 1, y + 1)),
    projectTile(x, y + 1, height(x, y + 1)),
  ];
}

export function surfacePoint(
  polygon: readonly Point[],
  u: number,
  v: number,
): Point {
  const top = polygon[0]!;
  const right = polygon[1]!;
  const bottom = polygon[2]!;
  const left = polygon[3]!;
  return {
    x:
      top.x * (1 - u) * (1 - v) +
      right.x * u * (1 - v) +
      bottom.x * u * v +
      left.x * (1 - u) * v,
    y:
      top.y * (1 - u) * (1 - v) +
      right.y * u * (1 - v) +
      bottom.y * u * v +
      left.y * (1 - u) * v,
  };
}

export function surfaceCenter(polygon: readonly Point[]): Point {
  return surfacePoint(polygon, 0.5, 0.5);
}

export function pointInPolygon(
  point: Point,
  polygon: readonly Point[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (!currentPoint || !previousPoint) continue;

    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

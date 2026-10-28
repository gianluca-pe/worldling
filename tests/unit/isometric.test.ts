import { describe, expect, it } from "vitest";
import {
  createCornerHeights,
  surfaceCenter,
  surfacePoint,
  surfaceQuad,
  tileDiamond,
} from "../../src/render/isometric";

function terrain(size: number, heights: readonly number[], waterLevel = 2) {
  return { size, heights, waterLevel };
}

describe("continuous terrain geometry", () => {
  it("keeps flat equal-height regions identical to the original diamond", () => {
    const corners = createCornerHeights(terrain(4, Array(16).fill(4)));

    expect(corners[1 * 5 + 1]).toBe(4);
    expect(surfaceQuad(1, 1, 4, corners)).toEqual(tileDiamond(1, 1, 4));
  });

  it("slopes neighboring cells around an isolated raised cell", () => {
    const heights = Array(25).fill(2);
    heights[2 * 5 + 2] = 3;
    const corners = createCornerHeights(terrain(5, heights));
    const raised = surfaceQuad(2, 2, 5, corners);
    const neighbor = surfaceQuad(3, 2, 5, corners);

    expect(raised[0]?.y).toBeLessThan(tileDiamond(2, 2, 2)[0]!.y);
    expect(new Set(neighbor.map((point) => point.y)).size).toBeGreaterThan(2);
    expect(raised[1]).toEqual(neighbor[0]);
    expect(raised[2]).toEqual(neighbor[3]);
  });

  it("keeps a plateau interior flat while sloping its outer edges", () => {
    const heights = Array(36).fill(2);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) heights[y * 6 + x] = 4;
    }
    const corners = createCornerHeights(terrain(6, heights));
    const interior = surfaceQuad(2, 2, 6, corners);
    const boundary = surfaceQuad(1, 1, 6, corners);

    expect(interior).toEqual(tileDiamond(2, 2, 4));
    expect(new Set(boundary.map((point) => point.y)).size).toBeGreaterThan(2);
  });

  it("clamps deep water and out-of-bounds samples to the water level", () => {
    const corners = createCornerHeights(terrain(3, Array(9).fill(0)));

    expect([...corners]).toEqual(Array(16).fill(2));
    expect(
      surfaceQuad(0, 0, 3, corners).every((point) =>
        Number.isFinite(point.x + point.y),
      ),
    ).toBe(true);
  });

  it("is deterministic and interpolates the actual surface center", () => {
    const heights = Array.from({ length: 16 }, (_, index) => 2 + (index % 4));
    const first = createCornerHeights(terrain(4, heights));
    const second = createCornerHeights(terrain(4, heights));
    const polygon = surfaceQuad(1, 2, 4, first);

    expect(first).toEqual(second);
    expect(surfaceCenter(polygon)).toEqual(surfacePoint(polygon, 0.5, 0.5));
  });
});

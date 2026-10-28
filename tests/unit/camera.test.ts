import { describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera";
import { projectTile, unprojectTile } from "../../src/render/isometric";

const viewport = { width: 800, height: 600 };

describe("Camera", () => {
  it("pans in screen space regardless of zoom", () => {
    const camera = new Camera();
    camera.zoom = 2;
    camera.panBy({ x: 40, y: -20 });
    expect(camera.x).toBe(-20);
    expect(camera.y).toBe(10);
  });

  it("keeps the world point under the cursor stationary while zooming", () => {
    const camera = new Camera();
    const before = camera.toScreen({ x: 100, y: 50 }, viewport);
    camera.zoomAt(1.5, before, viewport);
    const after = camera.toScreen({ x: 100, y: 50 }, viewport);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps zoom to its configured limits", () => {
    const camera = new Camera();
    camera.minZoom = 0.5;
    camera.maxZoom = 2;
    camera.zoomAt(100, { x: 400, y: 300 }, viewport);
    expect(camera.zoom).toBe(2);
    camera.zoomAt(0.001, { x: 400, y: 300 }, viewport);
    expect(camera.zoom).toBe(0.5);
  });
});

describe("isometric coordinates", () => {
  it("round-trips grid coordinates at a common height", () => {
    for (const [x, y] of [
      [0, 0],
      [4, 9],
      [63, 17],
    ] as const) {
      const result = unprojectTile(projectTile(x, y, 0));
      expect(result.x).toBeCloseTo(x);
      expect(result.y).toBeCloseTo(y);
    }
  });
});

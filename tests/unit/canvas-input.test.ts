import { describe, expect, it, vi } from "vitest";
import { CanvasInput } from "../../src/input/canvas-input";
import type { TerrainRenderer } from "../../src/render/terrain-renderer";

type Handler = (event: {
  pointerId: number;
  pointerType: string;
  button: number;
  clientX: number;
  clientY: number;
  type: string;
  preventDefault: () => void;
}) => void;

function installInput(
  tileAt: (point: { x: number; y: number }) => {
    x: number;
    y: number;
  },
) {
  const handlers = new Map<string, Handler>();
  const canvas = {
    addEventListener: (name: string, handler: Handler) =>
      handlers.set(name, handler),
    focus: vi.fn(),
    setPointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const renderer = {
    tileAt,
    panBy: vi.fn(),
    zoomAt: vi.fn(),
    ensureTileVisible: vi.fn(),
    mapSize: 64,
  };
  const onAction = vi.fn();
  new CanvasInput(
    canvas as unknown as HTMLCanvasElement,
    renderer as unknown as TerrainRenderer,
    {
      getTool: () => "raise",
      onAction,
      onTool: vi.fn(),
      onCursor: vi.fn(),
    },
  );
  const event = (type: string, x: number) => ({
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: x,
    clientY: 0,
    type,
    preventDefault: vi.fn(),
  });
  return { handlers, event, onAction };
}

describe("CanvasInput painting", () => {
  it("paints a repeated tile only once per stroke", () => {
    const { handlers, event, onAction } = installInput(() => ({ x: 5, y: 5 }));
    handlers.get("pointerdown")?.(event("pointerdown", 0));
    handlers.get("pointermove")?.(event("pointermove", 10));
    handlers.get("pointermove")?.(event("pointermove", 0));
    handlers.get("pointerup")?.(event("pointerup", 0));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ x: 5, y: 5 }, "raise");
  });

  it("paints newly entered tiles but skips duplicates on the return path", () => {
    const { handlers, event, onAction } = installInput(({ x }) => ({
      x: Math.floor(x / 10),
      y: 0,
    }));
    handlers.get("pointerdown")?.(event("pointerdown", 0));
    for (const x of [10, 20, 10, 0]) {
      handlers.get("pointermove")?.(event("pointermove", x));
    }
    handlers.get("pointerup")?.(event("pointerup", 0));

    expect(onAction).toHaveBeenCalledTimes(3);
    expect(onAction.mock.calls.map(([tile]) => tile.x)).toEqual([0, 1, 2]);
  });
});

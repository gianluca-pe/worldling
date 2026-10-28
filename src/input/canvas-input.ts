import type { Point } from "../render/camera";
import type { TerrainRenderer } from "../render/terrain-renderer";

export type Tool =
  "inspect" | "raise" | "lower" | "rally" | "earthquake" | "flood";

interface InputCallbacks {
  readonly getTool: () => Tool;
  readonly onAction: (tile: Point, tool: Tool) => void;
  readonly onTool: (tool: Tool) => void;
  readonly onCursor: (tile: Point) => void;
}

export class CanvasInput {
  private readonly pointers = new Map<number, Point>();
  private readonly paintedTiles = new Set<string>();
  private cursor: Point = { x: 32, y: 32 };
  private gestureOrigin: Point = { x: 0, y: 0 };
  private dragged = false;
  private painting = false;
  private pinchActive = false;
  private pinchDistance = 0;
  private pinchMidpoint: Point = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: TerrainRenderer,
    private readonly callbacks: InputCallbacks,
  ) {
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerUp);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    canvas.addEventListener("keydown", this.keyDown);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  reset(): void {
    this.pointers.clear();
    this.paintedTiles.clear();
    this.dragged = false;
    this.painting = false;
    this.pinchActive = false;
    this.pinchDistance = 0;
  }

  resetCursor(): void {
    this.cursor = { x: 32, y: 32 };
    this.callbacks.onCursor(this.cursor);
    this.renderer.ensureTileVisible(this.cursor);
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size === 1) {
      this.gestureOrigin = point;
      this.dragged = false;
      this.painting =
        event.pointerType === "mouse" &&
        ["raise", "lower"].includes(this.callbacks.getTool());
      if (this.painting) this.paint(point);
    } else if (this.pointers.size === 2) {
      this.pinchActive = true;
      this.dragged = true;
      this.startPinch();
    }
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, current);

    if (this.pointers.size === 2) {
      const midpoint = this.updatePinch();
      this.renderer.panBy({
        x: midpoint.x - this.pinchMidpoint.x,
        y: midpoint.y - this.pinchMidpoint.y,
      });
      if (this.pinchDistance > 0) {
        this.renderer.zoomAt(midpoint.distance / this.pinchDistance, midpoint);
      }
      this.pinchDistance = midpoint.distance;
      this.pinchMidpoint = midpoint;
      return;
    }

    if (this.painting) {
      this.paint(current);
      return;
    }

    const travelled = Math.hypot(
      current.x - this.gestureOrigin.x,
      current.y - this.gestureOrigin.y,
    );
    if (travelled > 6) this.dragged = true;
    if (this.dragged && !this.pinchActive) {
      this.renderer.panBy({
        x: current.x - previous.x,
        y: current.y - previous.y,
      });
    }
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    const wasTap =
      event.type === "pointerup" &&
      this.pointers.size === 1 &&
      !this.dragged &&
      !this.painting &&
      !this.pinchActive;
    this.pointers.delete(event.pointerId);
    if (wasTap) {
      const tile = this.renderer.tileAt({ x: event.clientX, y: event.clientY });
      if (tile) this.activate(tile);
    }
    if (this.pointers.size === 0) {
      this.dragged = false;
      this.painting = false;
      this.paintedTiles.clear();
      this.pinchActive = false;
    } else if (this.pointers.size === 1) {
      const remaining = this.pointers.values().next().value;
      if (remaining) this.gestureOrigin = remaining;
      this.dragged = true;
      this.pinchActive = false;
      this.pinchDistance = 0;
    }
  };

  private paint(point: Point): void {
    const tile = this.renderer.tileAt(point);
    if (!tile) return;
    const key = `${tile.x},${tile.y}`;
    if (this.paintedTiles.has(key)) return;
    this.paintedTiles.add(key);
    this.activate(tile);
  }

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.renderer.zoomAt(event.deltaY > 0 ? 1 / 1.15 : 1.15, {
      x: event.clientX,
      y: event.clientY,
    });
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    const pans: Record<string, Point> = {
      ArrowLeft: { x: 80, y: 0 },
      ArrowRight: { x: -80, y: 0 },
      ArrowUp: { x: 0, y: 80 },
      ArrowDown: { x: 0, y: -80 },
    };
    const cursorMoves: Record<string, Point> = {
      w: { x: 0, y: -1 },
      a: { x: -1, y: 0 },
      s: { x: 0, y: 1 },
      d: { x: 1, y: 0 },
    };
    const pan = pans[event.key];
    const cursorMove = cursorMoves[event.key.toLowerCase()];
    if (pan) {
      event.preventDefault();
      this.renderer.panBy(pan);
    } else if (cursorMove) {
      event.preventDefault();
      this.moveCursor(cursorMove);
    } else if (["+", "=", "-"].includes(event.key)) {
      event.preventDefault();
      const bounds = this.canvas.getBoundingClientRect();
      this.renderer.zoomAt(event.key === "-" ? 0.85 : 1.15, {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });
    } else if (["1", "2", "3", "4", "5", "6"].includes(event.key)) {
      event.preventDefault();
      const tools: Tool[] = [
        "inspect",
        "raise",
        "lower",
        "rally",
        "earthquake",
        "flood",
      ];
      this.callbacks.onTool(tools[Number(event.key) - 1]!);
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.activate(this.cursor);
    }
  };

  private activate(tile: Point): void {
    this.cursor = tile;
    this.callbacks.onAction(tile, this.callbacks.getTool());
  }

  private moveCursor(delta: Point): void {
    const limit = this.renderer.mapSize - 1;
    this.cursor = {
      x: Math.max(0, Math.min(limit, this.cursor.x + delta.x)),
      y: Math.max(0, Math.min(limit, this.cursor.y + delta.y)),
    };
    this.callbacks.onCursor(this.cursor);
    this.renderer.ensureTileVisible(this.cursor);
  }

  private startPinch(): void {
    const midpoint = this.updatePinch();
    this.pinchDistance = midpoint.distance;
    this.pinchMidpoint = midpoint;
  }

  private updatePinch(): Point & { distance: number } {
    const [first, second] = [...this.pointers.values()];
    if (!first || !second) return { x: 0, y: 0, distance: 0 };
    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      distance: Math.hypot(second.x - first.x, second.y - first.y),
    };
  }
}

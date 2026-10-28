export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  minZoom = 0.1;
  maxZoom = 2.5;

  panBy(screenDelta: Point): void {
    this.x -= screenDelta.x / this.zoom;
    this.y -= screenDelta.y / this.zoom;
  }

  zoomAt(factor: number, screenPoint: Point, viewport: Viewport): void {
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    const worldPoint = {
      x: this.x + (screenPoint.x - center.x) / this.zoom,
      y: this.y + (screenPoint.y - center.y) / this.zoom,
    };
    const nextZoom = Math.min(
      this.maxZoom,
      Math.max(this.minZoom, this.zoom * factor),
    );

    this.x = worldPoint.x - (screenPoint.x - center.x) / nextZoom;
    this.y = worldPoint.y - (screenPoint.y - center.y) / nextZoom;
    this.zoom = nextZoom;
  }

  toScreen(point: Point, viewport: Viewport): Point {
    return {
      x: (point.x - this.x) * this.zoom + viewport.width / 2,
      y: (point.y - this.y) * this.zoom + viewport.height / 2,
    };
  }
}

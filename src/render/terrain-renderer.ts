import { MAP_SIZE, MAX_HEIGHT, WATER_LEVEL } from "../sim/terrain";
import { Camera } from "./camera";
import type { Point, Viewport } from "./camera";
import {
  HEIGHT_STEP,
  TILE_HEIGHT,
  TILE_WIDTH,
  createCornerHeights,
  pointInPolygon,
  projectTile,
  surfaceCenter,
  surfacePoint,
  surfaceQuad,
} from "./isometric";
import { constructionStage, createSpriteSet } from "./sprites";
import type { Facing } from "./sprites";

export interface RenderTerrain {
  readonly size: number;
  readonly waterLevel: number;
  readonly heights: Uint8Array | readonly number[];
  readonly flooded?: Uint8Array | readonly number[];
}

export interface RenderSettlement {
  readonly faction?: "player" | "opponent";
  readonly banner: Point;
  readonly followers: readonly (Point & {
    readonly id: number;
    readonly dwell: number;
    readonly path: readonly Point[];
  })[];
  readonly houses: readonly (Point & {
    readonly id: number;
    readonly level: number;
  })[];
}

export interface RenderHazard {
  readonly type: "earthquake" | "flood";
  readonly faction: "player" | "opponent";
  readonly cells: readonly Point[];
  readonly executeTick: number;
  readonly endTick: number;
}

function settlementOccupies(
  settlement: RenderSettlement | undefined,
  x: number,
  y: number,
): boolean {
  return Boolean(
    settlement &&
    ((settlement.banner.x === x && settlement.banner.y === y) ||
      settlement.houses.some((house) => house.x === x && house.y === y) ||
      settlement.followers.some(
        (follower) =>
          follower.dwell > 0 && follower.x === x && follower.y === y,
      )),
  );
}

const LAND_COLORS = [
  "#c7ad68",
  "#b7a061",
  "#aaa05c",
  "#c0a563",
  "#9da05a",
  "#789052",
  "#687f4b",
  "#786e4e",
];
const WATER_COLOR = "#2d6f80";

export function tileNoise(
  x: number,
  y: number,
  salt: number,
  seed = 0,
): number {
  let value =
    Math.imul(x + 1, 0x27d4eb2d) ^
    Math.imul(y + 1, 0x165667b1) ^
    Math.imul(salt + 1, 0x9e3779b1) ^
    Math.imul(seed + 1, 0x27d4eb2d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  return value >>> 0;
}

interface TerrainEffect {
  readonly x: number;
  readonly y: number;
  readonly started: number;
  readonly direction: "raise-land" | "lower-land";
}

export class TerrainRenderer {
  readonly camera = new Camera();
  private viewport: Viewport = { width: 1, height: 1 };
  private pixelRatio = 1;
  private dirty = true;
  private initialized = false;
  private viewCenter: Point = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
  private selected: Point | null = null;
  private terrain: RenderTerrain | null = null;
  private worldSeed = 0;
  private geometryTerrain: RenderTerrain | null = null;
  private cornerHeights: Float64Array<ArrayBufferLike> = new Float64Array(0);
  private readonly resizeObserver: ResizeObserver;
  private readonly sprites = createSpriteSet();
  private readonly effects: TerrainEffect[] = [];
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onCameraChange: () => void,
  ) {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    motionQuery.addEventListener("change", () => {
      this.reducedMotion = motionQuery.matches;
      this.invalidate();
    });
    this.resize();
  }

  notifyTerrainEdit(
    tile: Point,
    direction: "raise-land" | "lower-land",
    started: number,
  ): void {
    if (this.reducedMotion) return;
    this.effects.push({ ...tile, direction, started });
    if (this.effects.length > 20) this.effects.shift();
    this.invalidate();
  }

  get needsRender(): boolean {
    return this.dirty;
  }

  get mapSize(): number {
    return this.terrain?.size ?? MAP_SIZE;
  }

  ensureTileVisible(tile: Point): void {
    if (!this.terrain) return;
    const center = this.entityCenter(this.terrain, tile.x, tile.y);
    const margin = 48;
    const dx =
      center.x < margin
        ? center.x - margin
        : center.x > this.viewport.width - margin
          ? center.x - this.viewport.width + margin
          : 0;
    const dy =
      center.y < margin
        ? center.y - margin
        : center.y > this.viewport.height - margin
          ? center.y - this.viewport.height + margin
          : 0;
    if (dx === 0 && dy === 0) return;
    this.camera.x += dx / this.camera.zoom;
    this.camera.y += dy / this.camera.zoom;
    this.changed();
  }

  invalidate(): void {
    this.dirty = true;
  }

  resetView(center: Point = this.viewCenter): void {
    this.viewCenter = { ...center };
    this.selected = null;
    this.terrain = null;
    this.geometryTerrain = null;
    this.cornerHeights = new Float64Array(0);
    this.effects.length = 0;
    this.initialized = false;
    this.resize();
  }

  setSelected(tile: Point | null): void {
    this.selected = tile;
    this.invalidate();
  }

  panBy(delta: Point): void {
    this.camera.panBy(delta);
    this.changed();
  }

  zoomAt(factor: number, clientPoint: Point): void {
    this.camera.zoomAt(factor, this.toLocal(clientPoint), this.viewport);
    this.changed();
  }

  private updateGeometry(terrain: RenderTerrain): void {
    const previous = this.geometryTerrain;
    let changed =
      !previous ||
      previous.size !== terrain.size ||
      previous.waterLevel !== terrain.waterLevel ||
      previous.heights.length !== terrain.heights.length ||
      previous.flooded?.length !== terrain.flooded?.length;
    if (!changed && previous) {
      for (let index = 0; index < terrain.heights.length; index += 1) {
        if (
          previous.heights[index] !== terrain.heights[index] ||
          previous.flooded?.[index] !== terrain.flooded?.[index]
        ) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    this.cornerHeights = createCornerHeights(terrain);
    this.geometryTerrain = {
      ...terrain,
      heights: Array.from(terrain.heights),
      flooded: terrain.flooded ? Array.from(terrain.flooded) : undefined,
    };
  }

  tileAt(clientPoint: Point): Point | null {
    if (!this.terrain) return null;
    const local = this.toLocal(clientPoint);
    for (let sum = (this.terrain.size - 1) * 2; sum >= 0; sum -= 1) {
      for (
        let x = Math.max(0, sum - this.terrain.size + 1);
        x <= Math.min(this.terrain.size - 1, sum);
        x += 1
      ) {
        const y = sum - x;
        if (pointInPolygon(local, this.screenSurface(x, y))) return { x, y };
      }
    }
    return null;
  }

  draw(
    terrain: RenderTerrain,
    settlement?: RenderSettlement,
    visualTime = 0,
    opponent?: RenderSettlement,
    hazards: readonly RenderHazard[] = [],
    worldSeed = 0,
  ): void {
    this.worldSeed = worldSeed;
    this.terrain = terrain;
    this.updateGeometry(terrain);
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.viewport.width, this.viewport.height);
    context.lineJoin = "round";
    context.imageSmoothingEnabled = false;
    const animationTime = this.reducedMotion ? 0 : visualTime;

    for (let sum = 0; sum <= (terrain.size - 1) * 2; sum += 1) {
      for (
        let x = Math.max(0, sum - terrain.size + 1);
        x <= Math.min(terrain.size - 1, sum);
        x += 1
      ) {
        const y = sum - x;
        const height = terrain.heights[y * terrain.size + x] ?? 0;
        this.drawTile(context, terrain, x, y, height, animationTime);
        this.drawTerrainFeature(
          context,
          terrain,
          x,
          y,
          height,
          settlement,
          opponent,
        );
      }
      if (settlement) {
        this.drawSettlement(context, terrain, settlement, sum, animationTime);
      }
      if (opponent) {
        this.drawSettlement(context, terrain, opponent, sum, animationTime);
      }
    }
    this.drawHazards(context, hazards, animationTime);
    this.drawEffects(context, terrain, animationTime);
    this.dirty = false;
  }

  private drawTerrainFeature(
    context: CanvasRenderingContext2D,
    terrain: RenderTerrain,
    x: number,
    y: number,
    height: number,
    settlement?: RenderSettlement,
    opponent?: RenderSettlement,
  ): void {
    if (
      height <= terrain.waterLevel ||
      terrain.flooded?.[y * terrain.size + x] === 1
    )
      return;
    const center = terrain.size / 2;
    if (Math.abs(x - center) <= 3 && Math.abs(y - center) <= 3) return;
    if (
      settlementOccupies(settlement, x, y) ||
      settlementOccupies(opponent, x, y)
    )
      return;
    const noise = tileNoise(x, y, 29, this.worldSeed);
    const cluster = tileNoise(
      Math.floor(x / 3),
      Math.floor(y / 3),
      47,
      this.worldSeed,
    );
    const slope = this.surfaceSlope(x, y, terrain.size);
    const sprite =
      height >= 6
        ? cluster % 5 !== 0 && noise % 3 === 0
          ? this.sprites.rocks[0]
          : undefined
        : height >= 4 && slope <= 0.5 && cluster % 4 !== 0 && noise % 9 === 0
          ? this.sprites.trees[(noise >>> 4) % this.sprites.trees.length]
          : undefined;
    if (!sprite) return;
    const ground = this.entityCenter(terrain, x, y);
    const scale = Math.max(1, this.camera.zoom * 2);
    const width = sprite.width * scale;
    const spriteHeight = sprite.height * scale;
    context.beginPath();
    context.ellipse(
      ground.x + width * 0.08,
      ground.y + 3,
      width * 0.38,
      Math.max(2, width * 0.1),
      0,
      0,
      Math.PI * 2,
    );
    context.fillStyle = "#1d29255c";
    context.fill();
    context.save();
    if ((noise & 1) === 1) {
      context.translate(Math.round(ground.x), 0);
      context.scale(-1, 1);
      context.drawImage(
        sprite,
        -width / 2,
        ground.y - spriteHeight + 4,
        width,
        spriteHeight,
      );
    } else {
      context.drawImage(
        sprite,
        ground.x - width / 2,
        ground.y - spriteHeight + 4,
        width,
        spriteHeight,
      );
    }
    context.restore();
  }

  private drawSettlement(
    context: CanvasRenderingContext2D,
    terrain: RenderTerrain,
    settlement: RenderSettlement,
    depth: number,
    animationTime: number,
  ): void {
    if (settlement.banner.x + settlement.banner.y === depth) {
      this.drawBanner(
        context,
        terrain,
        settlement.banner,
        settlement.faction ?? "player",
      );
    }
    const entities = [
      ...settlement.houses.map((entity) => ({
        kind: "house" as const,
        entity,
      })),
      ...settlement.followers
        .filter((entity) => entity.dwell > 0)
        .map((entity) => ({
          kind: "construction" as const,
          entity,
        })),
      ...settlement.followers
        .filter(
          (entity) =>
            !settlement.houses.some(
              (house) => house.x === entity.x && house.y === entity.y,
            ),
        )
        .map((entity) => ({
          kind: "follower" as const,
          entity,
        })),
    ]
      .filter(({ entity }) => entity.x + entity.y === depth)
      .sort(
        (first, second) =>
          this.entityCenter(terrain, first.entity.x, first.entity.y).y -
            this.entityCenter(terrain, second.entity.x, second.entity.y).y ||
          first.entity.id - second.entity.id,
      );
    for (const { kind, entity } of entities) {
      if (kind === "house") {
        this.drawHouse(
          context,
          terrain,
          entity,
          animationTime,
          settlement.faction ?? "player",
        );
      } else if (kind === "construction") {
        this.drawConstruction(context, terrain, entity);
      } else {
        this.drawFollower(
          context,
          terrain,
          entity,
          animationTime,
          settlement.faction ?? "player",
        );
      }
    }
  }

  private drawConstruction(
    context: CanvasRenderingContext2D,
    terrain: RenderTerrain,
    follower: RenderSettlement["followers"][number],
  ): void {
    const stage = constructionStage(follower.dwell);
    const sprite = this.sprites.construction[stage];
    if (!sprite) return;
    const center = this.entityCenter(terrain, follower.x, follower.y);
    const scale = Math.max(1, this.camera.zoom * 2);
    const width = sprite.width * scale;
    const height = sprite.height * scale;
    context.drawImage(
      sprite,
      center.x - width / 2,
      center.y - height + 5,
      width,
      height,
    );
  }

  private drawHouse(
    context: CanvasRenderingContext2D,
    terrain: RenderTerrain,
    house: RenderSettlement["houses"][number],
    animationTime: number,
    faction: "player" | "opponent",
  ): void {
    const center = this.entityCenter(terrain, house.x, house.y);
    const sprite =
      this.sprites.houses[house.level - 1] ?? this.sprites.houses[0];
    if (!sprite) return;
    const scale = Math.max(1, this.camera.zoom * 2);
    const width = sprite.width * scale;
    const height = sprite.height * scale;
    const top = center.y - height + 5;
    const sideBaseY = [0, 17, 21, 25][house.level] ?? 17;
    const left = {
      x: center.x - width / 2 + scale,
      y: top + sideBaseY * scale,
    };
    const right = {
      x: center.x + width / 2 - scale * 2,
      y: left.y,
    };
    const bottom = { x: center.x, y: top + (height - 2) * scale };
    const footing = Math.max(2, this.camera.zoom * 4);
    context.beginPath();
    context.ellipse(
      center.x,
      bottom.y + footing * 0.6,
      width * 0.36,
      Math.max(1.5, width * 0.06),
      0,
      0,
      Math.PI * 2,
    );
    context.fillStyle = "#1d29255c";
    context.fill();
    context.beginPath();
    this.path(context, [
      left,
      bottom,
      { x: bottom.x, y: bottom.y + footing },
      { x: left.x, y: left.y + footing },
    ]);
    context.closePath();
    context.fillStyle = "#56564a";
    context.fill();
    context.beginPath();
    this.path(context, [
      bottom,
      right,
      { x: right.x, y: right.y + footing },
      { x: bottom.x, y: bottom.y + footing },
    ]);
    context.closePath();
    context.fillStyle = "#777665";
    context.fill();
    context.drawImage(sprite, center.x - width / 2, top, width, height);
    context.fillStyle = faction === "opponent" ? "#a94f3d" : "#527ba0";
    context.fillRect(
      center.x - width * 0.34,
      top + height * 0.55,
      Math.max(2, scale * 2),
      Math.max(3, scale * 4),
    );
    if (house.level >= 2 && animationTime > 0) {
      const drift = (animationTime / 450 + house.id) % 4;
      context.fillStyle = "#d6d2bd80";
      context.fillRect(
        center.x + width * 0.2 + drift,
        center.y - height - drift * 2,
        2,
        2,
      );
    }
  }

  private drawFollower(
    context: CanvasRenderingContext2D,
    terrain: RenderTerrain,
    follower: RenderSettlement["followers"][number],
    animationTime: number,
    faction: "player" | "opponent",
  ): void {
    const center = this.entityCenter(terrain, follower.x, follower.y);
    const offsetX = ((follower.id % 3) - 1) * 3;
    const offsetY = ((Math.floor(follower.id / 3) % 3) - 1) * 2;
    const facing = this.followerFacing(follower.x, follower.y, follower.path);
    const variants =
      faction === "opponent"
        ? this.sprites.opponentFollowers[facing]
        : this.sprites.followers[facing];
    const frames = variants[follower.id % variants.length] ?? variants[0]!;
    const frameCount = frames.length;
    const frame = Math.floor(animationTime / 240 + follower.id) % frameCount;
    const sprite = frames[frame] ?? frames[0];
    if (!sprite) return;
    const scale = Math.max(1, this.camera.zoom * 1.8);
    context.drawImage(
      sprite,
      center.x + offsetX - (sprite.width * scale) / 2,
      center.y + offsetY + 4 - sprite.height * scale,
      sprite.width * scale,
      sprite.height * scale,
    );
  }

  private followerFacing(x: number, y: number, path: readonly Point[]): Facing {
    const next = path[0];
    if (!next) return "down";
    const dx = next.x - x;
    const dy = next.y - y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
    if (dy !== 0) return dy > 0 ? "down" : "up";
    return dx > 0 ? "right" : "left";
  }

  private drawHazards(
    context: CanvasRenderingContext2D,
    hazards: readonly RenderHazard[],
    animationTime: number,
  ): void {
    for (const hazard of hazards) {
      const pulse =
        animationTime > 0
          ? 0.55 + Math.sin(animationTime / 180 + hazard.executeTick) * 0.2
          : 0.55;
      context.save();
      context.globalAlpha = pulse;
      context.strokeStyle =
        hazard.faction === "opponent"
          ? "#d56a54"
          : hazard.type === "flood"
            ? "#75a7ad"
            : "#f2c14e";
      context.fillStyle = hazard.type === "flood" ? "#3d8ca022" : "#d0803022";
      context.lineWidth = Math.max(1, this.camera.zoom * 2);
      for (const cell of hazard.cells) {
        const polygon = this.screenSurface(cell.x, cell.y);
        context.beginPath();
        this.path(context, polygon);
        context.closePath();
        context.fill();
        context.stroke();
      }
      context.restore();
    }
  }

  private drawEffects(
    context: CanvasRenderingContext2D,
    terrain: RenderTerrain,
    animationTime: number,
  ): void {
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      if (!effect) continue;
      const age = animationTime - effect.started;
      if (age > 450) {
        this.effects.splice(index, 1);
        continue;
      }
      if (age < 0) continue;
      const center = this.entityCenter(terrain, effect.x, effect.y);
      const progress = age / 450;
      context.fillStyle =
        effect.direction === "raise-land" ? "#e2d9b8a0" : "#b8cba7a0";
      for (let particle = 0; particle < 6; particle += 1) {
        const angle = (particle / 6) * Math.PI * 2;
        const distance = 3 + progress * 12;
        const lift =
          effect.direction === "raise-land" ? progress * 8 : progress * 2;
        context.fillRect(
          center.x + Math.cos(angle) * distance,
          center.y + Math.sin(angle) * distance - lift,
          2,
          2,
        );
      }
    }
  }

  private drawBanner(
    context: CanvasRenderingContext2D,
    terrain: RenderTerrain,
    banner: Point,
    faction: "player" | "opponent",
  ): void {
    const center = this.entityCenter(terrain, banner.x, banner.y);
    const poleHeight = Math.max(14, this.camera.zoom * 28);
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(center.x, center.y - poleHeight);
    context.strokeStyle = "#fff4b0";
    context.lineWidth = 2;
    context.stroke();
    context.beginPath();
    context.moveTo(center.x, center.y - poleHeight);
    context.lineTo(center.x + poleHeight * 0.55, center.y - poleHeight * 0.75);
    context.lineTo(center.x, center.y - poleHeight * 0.5);
    context.closePath();
    context.fillStyle = faction === "opponent" ? "#d56a54" : "#f2c14e";
    context.fill();
  }

  private entityCenter(terrain: RenderTerrain, x: number, y: number): Point {
    const center = surfaceCenter(
      surfaceQuad(x, y, terrain.size, this.cornerHeights),
    );
    return this.camera.toScreen(center, this.viewport);
  }

  private drawTile(
    context: CanvasRenderingContext2D,
    terrain: RenderTerrain,
    x: number,
    y: number,
    height: number,
    animationTime: number,
  ): void {
    const submerged =
      height <= terrain.waterLevel ||
      terrain.flooded?.[y * terrain.size + x] === 1;
    const polygon = this.screenSurface(x, y);
    const bottom = polygon[2];
    const right = polygon[1];
    const left = polygon[3];
    if (!bottom || !right || !left) return;

    context.beginPath();
    this.path(context, polygon);
    context.closePath();
    context.fillStyle = submerged
      ? WATER_COLOR
      : (LAND_COLORS[Math.min(height, LAND_COLORS.length - 1)] ?? "#657746");
    context.fill();

    if (submerged) {
      this.drawWaterDetail(context, polygon, x, y, animationTime);
    } else {
      if (this.surfaceSlope(x, y, terrain.size) > 0) {
        context.fillStyle = "#4c433324";
        context.fill();
      }
      const rightNeighbor =
        x + 1 < terrain.size
          ? (terrain.heights[y * terrain.size + x + 1] ?? 0)
          : WATER_LEVEL;
      const leftNeighbor =
        y + 1 < terrain.size
          ? (terrain.heights[(y + 1) * terrain.size + x] ?? 0)
          : WATER_LEVEL;
      this.drawLandDetail(context, polygon, x, y, height);
      this.drawShoreline(
        context,
        right,
        bottom,
        rightNeighbor,
        x + 1 < terrain.size &&
          terrain.flooded?.[y * terrain.size + x + 1] === 1,
      );
      this.drawShoreline(
        context,
        bottom,
        left,
        leftNeighbor,
        y + 1 < terrain.size &&
          terrain.flooded?.[(y + 1) * terrain.size + x] === 1,
      );
    }

    if (this.selected?.x === x && this.selected.y === y) {
      context.beginPath();
      this.path(context, polygon);
      context.closePath();
      context.strokeStyle = "#fff4b0";
      context.lineWidth = Math.max(2, this.camera.zoom * 2);
      context.stroke();
    }
  }

  private drawLandDetail(
    context: CanvasRenderingContext2D,
    polygon: readonly Point[],
    x: number,
    y: number,
    height: number,
  ): void {
    const count = this.camera.zoom < 0.3 ? 3 : 7;
    for (let detail = 0; detail < count; detail += 1) {
      const noise = tileNoise(x, y, detail, this.worldSeed);
      const u = 0.5 + ((noise & 255) / 255 - 0.5) * 0.72;
      const v = 0.5 + (((noise >>> 8) & 255) / 255 - 0.5) * 0.72;
      const { x: px, y: py } = surfacePoint(polygon, u, v);
      context.fillStyle = (noise & 0x10000) === 0 ? "#4b513b70" : "#eee0a15c";
      const size = Math.max(1, Math.round(this.camera.zoom * 2));
      context.fillRect(Math.round(px), Math.round(py), size, 1);
      if (detail !== 0) continue;
      const relief = Math.max(1, Math.round(this.camera.zoom * 4));
      if (height >= 6) {
        context.fillStyle = "#454536a8";
        context.fillRect(
          Math.round(px),
          Math.round(py - relief),
          relief * 2,
          relief,
        );
        context.fillStyle = "#c0b88b9e";
        context.fillRect(
          Math.round(px),
          Math.round(py - relief * 2),
          relief,
          relief,
        );
      } else if (height >= 4) {
        context.fillStyle = "#426b3f9e";
        context.fillRect(
          Math.round(px),
          Math.round(py - relief * 2),
          1,
          relief * 2,
        );
        context.fillRect(
          Math.round(px + relief),
          Math.round(py - relief),
          1,
          relief,
        );
      }
    }
  }

  private drawWaterDetail(
    context: CanvasRenderingContext2D,
    polygon: readonly Point[],
    x: number,
    y: number,
    animationTime: number,
  ): void {
    const noise = tileNoise(x, y, 11, this.worldSeed);
    if ((noise & 3) !== 0) return;
    const phase = animationTime > 0 ? Math.sin(animationTime / 900 + x) : 0;
    const u = 0.5 + ((noise & 63) / 63 - 0.5) * 0.55;
    const point = surfacePoint(polygon, u, 0.5);
    context.fillStyle = "#77b6b55c";
    context.fillRect(
      Math.round(point.x),
      Math.round(point.y + phase * this.camera.zoom),
      Math.max(2, Math.round(this.camera.zoom * 7)),
      1,
    );
  }

  private drawShoreline(
    context: CanvasRenderingContext2D,
    first: Point,
    second: Point,
    neighborHeight: number,
    flooded: boolean,
  ): void {
    if (neighborHeight > WATER_LEVEL && !flooded) return;
    context.beginPath();
    context.moveTo(first.x, first.y);
    context.lineTo(second.x, second.y);
    context.strokeStyle = "#a9d0bd9c";
    context.lineWidth = Math.max(1, this.camera.zoom * 1.5);
    context.stroke();
  }

  private surfaceSlope(x: number, y: number, size: number): number {
    const height = (cornerX: number, cornerY: number) =>
      this.cornerHeights[cornerY * (size + 1) + cornerX] ?? 0;
    const top = height(x, y);
    const right = height(x + 1, y);
    const bottom = height(x + 1, y + 1);
    const left = height(x, y + 1);
    return (
      Math.max(top, right, bottom, left) - Math.min(top, right, bottom, left)
    );
  }

  private screenSurface(x: number, y: number): Point[] {
    const size = this.terrain?.size ?? MAP_SIZE;
    return surfaceQuad(x, y, size, this.cornerHeights).map((point) =>
      this.camera.toScreen(point, this.viewport),
    );
  }

  private path(
    context: CanvasRenderingContext2D,
    points: readonly Point[],
  ): void {
    const first = points[0];
    if (!first) return;
    context.moveTo(first.x, first.y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  }

  private resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    this.viewport = { width: bounds.width, height: bounds.height };
    this.pixelRatio = 0.5;
    this.canvas.width = Math.round(bounds.width * this.pixelRatio);
    this.canvas.height = Math.round(bounds.height * this.pixelRatio);

    const fitZoom = Math.min(
      bounds.width / (MAP_SIZE * TILE_WIDTH),
      bounds.height / (MAP_SIZE * TILE_HEIGHT + MAX_HEIGHT * HEIGHT_STEP),
    );
    this.camera.minZoom = Math.max(0.08, fitZoom * 0.75);
    this.camera.zoom = Math.max(
      this.camera.minZoom,
      Math.min(this.camera.maxZoom, this.camera.zoom),
    );
    if (!this.initialized) {
      this.camera.zoom = Math.max(0.42, fitZoom);
      const center = projectTile(
        this.viewCenter.x,
        this.viewCenter.y,
        WATER_LEVEL,
      );
      this.camera.x = center.x;
      this.camera.y = center.y;
      this.initialized = true;
    }
    this.changed();
  }

  private toLocal(point: Point): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: point.x - bounds.left, y: point.y - bounds.top };
  }

  private changed(): void {
    this.invalidate();
    this.onCameraChange();
  }
}

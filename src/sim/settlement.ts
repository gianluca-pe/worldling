import type { SeededRandom } from "./random";
import { isTerrainAboveWater, MAX_HEIGHT } from "./terrain";
import type { TerrainState } from "./terrain";

export const TERRAIN_EDIT_MANA_COST = 3;
export const SEA_RAISE_MANA_COST = 5;
export const MAX_FOLLOWERS = 200;

export function terrainEditManaCost(
  terrain: TerrainState,
  x: number,
  y: number,
  direction: "raise" | "lower",
): number {
  const height = terrain.heights[y * terrain.size + x] ?? terrain.waterLevel;
  return direction === "raise" && height <= terrain.waterLevel
    ? SEA_RAISE_MANA_COST
    : TERRAIN_EDIT_MANA_COST;
}

const INITIAL_MANA = 30;
const INITIAL_FOLLOWERS = 6;
const FOLLOWER_MOVE_INTERVAL = 10;
const HOUSE_INTERVAL = 100;
const DWELL_REQUIRED = 60;
const MAX_ACTIVE_SETTLERS = 1;
const RALLY_HOLD_TICKS = 100;
const SUPPORTED_MANA_PER_TICK = 0.001;
const HOMELESS_MANA_PER_TICK = 0.0002;
const HOUSE_EXCLUSION_DISTANCE = 4;
const SPAWN_DISTANCE = 2;
const LEVEL_2_SITE_COUNT = 4;
const LEVEL_3_SITE_COUNT = 12;

const NEIGHBORS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export interface Point {
  x: number;
  y: number;
}

export interface Follower {
  id: number;
  x: number;
  y: number;
  dwell: number;
  path: Point[];
  pathGoal: string;
}

export interface House {
  id: number;
  x: number;
  y: number;
  level: 1 | 2 | 3;
}

export interface SettlementState {
  followers: Follower[];
  houses: House[];
  banner: Point;
  mana: number;
  ticks: number;
  rallyUntil: number;
  nextSiteSearchTick: number;
  nextFollowerId: number;
  nextHouseId: number;
}

function isInBounds(terrain: TerrainState, x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < terrain.size &&
    y < terrain.size
  );
}

function isAboveWater(terrain: TerrainState, x: number, y: number): boolean {
  return isInBounds(terrain, x, y) && isTerrainAboveWater(terrain, x, y);
}

function bannerGoal(point: Point): string {
  return `banner:${point.x},${point.y}`;
}

function nearestLandTiles(terrain: TerrainState, target: Point): Point[] {
  const tiles: Point[] = [];
  for (let y = 0; y < terrain.size; y += 1) {
    for (let x = 0; x < terrain.size; x += 1) {
      if (isAboveWater(terrain, x, y)) tiles.push({ x, y });
    }
  }
  tiles.sort(
    (a, b) =>
      Math.abs(a.x - target.x) +
        Math.abs(a.y - target.y) -
        Math.abs(b.x - target.x) -
        Math.abs(b.y - target.y) ||
      Math.hypot(a.x - target.x, a.y - target.y) -
        Math.hypot(b.x - target.x, b.y - target.y) ||
      a.y - b.y ||
      a.x - b.x,
  );
  return tiles;
}

export function createSettlement(
  terrain: TerrainState,
  start?: Point,
): SettlementState {
  const center = Math.floor(terrain.size / 2);
  const target = start ?? { x: center, y: center };
  const tiles = nearestLandTiles(terrain, target);
  const banner = tiles[0];
  if (!banner) {
    throw new RangeError("A settlement requires an above-water tile");
  }

  const followers: Follower[] = [];
  for (let id = 0; id < INITIAL_FOLLOWERS; id += 1) {
    const tile = tiles[id % tiles.length]!;
    followers.push({
      id,
      x: tile.x,
      y: tile.y,
      dwell: 0,
      path: [],
      pathGoal: bannerGoal(banner),
    });
  }

  return {
    followers,
    houses: [],
    banner: { ...banner },
    mana: INITIAL_MANA,
    ticks: 0,
    rallyUntil: 0,
    nextSiteSearchTick: 0,
    nextFollowerId: INITIAL_FOLLOWERS,
    nextHouseId: 0,
  };
}

export function setRallyBanner(
  state: SettlementState,
  terrain: TerrainState,
  x: number,
  y: number,
): boolean {
  if (!isAboveWater(terrain, x, y)) return false;
  state.banner = { x, y };
  state.rallyUntil = state.ticks + RALLY_HOLD_TICKS;
  for (const follower of state.followers) {
    follower.path = [];
    follower.pathGoal = bannerGoal(state.banner);
    follower.dwell = 0;
  }
  return true;
}

export function isSuitableBuildingSite(
  terrain: TerrainState,
  x: number,
  y: number,
): boolean {
  if (!isInBounds(terrain, x, y)) return false;
  const height = terrain.heights[y * terrain.size + x]!;
  if (height <= terrain.waterLevel) return false;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const sampleX = x + offsetX;
      const sampleY = y + offsetY;
      if (
        !isInBounds(terrain, sampleX, sampleY) ||
        terrain.heights[sampleY * terrain.size + sampleX] !== height
      ) {
        return false;
      }
    }
  }
  return true;
}

export function houseCapacity(house: House): number {
  return house.level * 4;
}

export interface FoundationRepair {
  readonly cost: number;
  readonly nextEdit: (Point & { type: "raise-land" | "lower-land" }) | null;
}

// Consider every habitable elevation: lowering the house can be cheaper
// than raising all eight neighboring tiles to its current height.
export function foundationRepair(
  terrain: TerrainState,
  house: Point,
): FoundationRepair | null {
  if (
    !isAboveWater(terrain, house.x, house.y) ||
    !isInBounds(terrain, house.x - 1, house.y - 1) ||
    !isInBounds(terrain, house.x + 1, house.y + 1)
  ) {
    return null;
  }
  let best: FoundationRepair | null = null;
  for (let target = terrain.waterLevel + 1; target <= MAX_HEIGHT; target++) {
    let cost = 0;
    let nextEdit: FoundationRepair["nextEdit"] = null;
    for (let y = house.y - 1; y <= house.y + 1; y++) {
      for (let x = house.x - 1; x <= house.x + 1; x++) {
        const height = terrain.heights[y * terrain.size + x]!;
        if (height === target) continue;
        nextEdit ??= {
          x,
          y,
          type: height < target ? "raise-land" : "lower-land",
        };
        if (height > target) {
          cost += (height - target) * TERRAIN_EDIT_MANA_COST;
        } else {
          for (let level = height; level < target; level++) {
            cost +=
              level <= terrain.waterLevel
                ? SEA_RAISE_MANA_COST
                : TERRAIN_EDIT_MANA_COST;
          }
        }
      }
    }
    if (!best || cost < best.cost) best = { cost, nextEdit };
  }
  return best;
}

function findPath(terrain: TerrainState, start: Point, goal: Point): Point[] {
  if (!isAboveWater(terrain, goal.x, goal.y)) return [];
  const startIndex = start.y * terrain.size + start.x;
  const goalIndex = goal.y * terrain.size + goal.x;
  if (startIndex === goalIndex) return [];

  const tileCount = terrain.size * terrain.size;
  const previous = new Int32Array(tileCount);
  previous.fill(-2);
  previous[startIndex] = -1;
  const queue = new Int32Array(tileCount);
  let read = 0;
  let write = 0;
  queue[write++] = startIndex;

  while (read < write && previous[goalIndex] === -2) {
    const current = queue[read++]!;
    const x = current % terrain.size;
    const y = Math.floor(current / terrain.size);
    for (const offset of NEIGHBORS) {
      const nextX = x + offset.x;
      const nextY = y + offset.y;
      if (!isAboveWater(terrain, nextX, nextY)) continue;
      const next = nextY * terrain.size + nextX;
      if (previous[next] !== -2) continue;
      previous[next] = current;
      queue[write++] = next;
    }
  }

  if (previous[goalIndex] === -2) return [];
  const path: Point[] = [];
  let current = goalIndex;
  while (current !== startIndex) {
    path.push({
      x: current % terrain.size,
      y: Math.floor(current / terrain.size),
    });
    current = previous[current]!;
  }
  path.reverse();
  return path;
}

function hasNearbyHouse(state: SettlementState, point: Point): boolean {
  return state.houses.some(
    (house) =>
      Math.abs(house.x - point.x) + Math.abs(house.y - point.y) <=
      HOUSE_EXCLUSION_DISTANCE,
  );
}

function siteGoal(point: Point): string {
  return `site:${point.x},${point.y}`;
}

function findSettlementSite(
  state: SettlementState,
  terrain: TerrainState,
  follower: Follower,
  random: SeededRandom,
): Point | undefined {
  const capacity = state.houses.reduce(
    (total, house) => total + houseCapacity(house),
    0,
  );
  if (state.followers.length < capacity) return undefined;
  state.nextSiteSearchTick = state.ticks + 100;
  const activeSettlers = state.followers.filter(
    (other) => other.id !== follower.id && other.pathGoal.startsWith("site:"),
  ).length;
  if (
    !follower.pathGoal.startsWith("site:") &&
    activeSettlers >= MAX_ACTIVE_SETTLERS
  ) {
    return undefined;
  }
  const candidates: { point: Point; distance: number }[] = [];
  for (let y = 0; y < terrain.size; y += 1) {
    for (let x = 0; x < terrain.size; x += 1) {
      const point = { x, y };
      const goal = siteGoal(point);
      if (
        !isSuitableBuildingSite(terrain, x, y) ||
        hasNearbyHouse(state, point) ||
        state.followers.some(
          (other) => other.id !== follower.id && other.pathGoal === goal,
        )
      ) {
        continue;
      }
      candidates.push({
        point,
        distance: Math.abs(x - follower.x) + Math.abs(y - follower.y),
      });
    }
  }
  candidates.sort(
    (first, second) =>
      first.distance - second.distance ||
      first.point.y - second.point.y ||
      first.point.x - second.point.x,
  );
  let start = 0;
  while (start < candidates.length) {
    let end = start + 1;
    while (
      end < candidates.length &&
      candidates[end]!.distance === candidates[start]!.distance
    ) {
      end += 1;
    }
    const reachable = candidates
      .slice(start, end)
      .map(({ point }) => point)
      .filter(
        (point) =>
          (follower.x === point.x && follower.y === point.y) ||
          findPath(terrain, follower, point).length > 0,
      );
    if (reachable.length > 0) {
      return reachable[random.nextUint32() % reachable.length];
    }
    start = end;
  }
  return undefined;
}

function moveFollower(
  follower: Follower,
  state: SettlementState,
  terrain: TerrainState,
  random: SeededRandom,
): void {
  const capacity = state.houses.reduce(
    (total, house) => total + houseCapacity(house),
    0,
  );
  if (
    (state.houses.length === 0 || state.followers.length < capacity) &&
    follower.pathGoal.startsWith("site:")
  ) {
    follower.path = [];
    follower.pathGoal = bannerGoal(state.banner);
    follower.dwell = 0;
  }
  const atBanner =
    follower.x === state.banner.x && follower.y === state.banner.y;
  if (atBanner && state.ticks < state.rallyUntil) {
    follower.path = [];
    follower.pathGoal = bannerGoal(state.banner);
    return;
  }
  const canSettleHere =
    isSuitableBuildingSite(terrain, follower.x, follower.y) &&
    !hasNearbyHouse(state, follower);
  if (
    canSettleHere &&
    (follower.pathGoal === siteGoal(follower) ||
      (state.houses.length === 0 &&
        atBanner &&
        follower.pathGoal === bannerGoal(state.banner)))
  ) {
    follower.path = [];
    return;
  }

  if (follower.pathGoal.startsWith("site:")) {
    const next = follower.path[0];
    if (next && isAboveWater(terrain, next.x, next.y)) {
      follower.dwell = 0;
      follower.x = next.x;
      follower.y = next.y;
      follower.path.shift();
      return;
    }
  }

  let goal = state.banner;
  let goalKey = bannerGoal(goal);
  if (
    state.houses.length > 0 &&
    (follower.pathGoal.startsWith("site:") ||
      (atBanner && state.ticks >= state.nextSiteSearchTick))
  ) {
    const site = findSettlementSite(state, terrain, follower, random);
    if (site) {
      goal = site;
      goalKey = siteGoal(site);
    }
  }
  if (follower.x === goal.x && follower.y === goal.y) {
    follower.path = [];
    follower.pathGoal = goalKey;
    return;
  }

  const next = follower.path[0];
  if (
    follower.pathGoal !== goalKey ||
    !next ||
    !isAboveWater(terrain, next.x, next.y)
  ) {
    follower.path = findPath(terrain, follower, goal);
    follower.pathGoal = goalKey;
  }
  const destination = follower.path.shift();
  if (destination) {
    follower.dwell = 0;
    follower.x = destination.x;
    follower.y = destination.y;
  }
}

function surroundingSuitableSiteCount(
  terrain: TerrainState,
  house: House,
): number {
  let count = 0;
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      if (
        isSuitableBuildingSite(terrain, house.x + offsetX, house.y + offsetY)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function findSpawnTile(terrain: TerrainState, house: House): Point | undefined {
  for (let distance = 0; distance <= SPAWN_DISTANCE; distance += 1) {
    for (let offsetY = -distance; offsetY <= distance; offsetY += 1) {
      const offsetX = distance - Math.abs(offsetY);
      const candidates = offsetX === 0 ? [0] : [-offsetX, offsetX];
      for (const candidateX of candidates) {
        const x = house.x + candidateX;
        const y = house.y + offsetY;
        if (isAboveWater(terrain, x, y)) return { x, y };
      }
    }
  }
  return undefined;
}

function updateHouses(state: SettlementState, terrain: TerrainState): void {
  const spawnEligible = new Set<House>();
  for (const house of state.houses) {
    if (!isSuitableBuildingSite(terrain, house.x, house.y)) {
      house.level = 1;
      continue;
    }
    const sites = surroundingSuitableSiteCount(terrain, house);
    house.level =
      sites >= LEVEL_3_SITE_COUNT ? 3 : sites >= LEVEL_2_SITE_COUNT ? 2 : 1;
    spawnEligible.add(house);
  }

  const capacity = state.houses.reduce(
    (total, house) => total + houseCapacity(house),
    0,
  );
  for (const house of state.houses) {
    if (
      state.followers.length >= capacity ||
      state.followers.length >= MAX_FOLLOWERS
    ) {
      break;
    }
    if (!spawnEligible.has(house)) continue;
    const tile = findSpawnTile(terrain, house);
    if (!tile) continue;
    state.followers.push({
      id: state.nextFollowerId++,
      x: tile.x,
      y: tile.y,
      dwell: 0,
      path: [],
      pathGoal: bannerGoal(state.banner),
    });
  }
}

export function updateSettlement(
  state: SettlementState,
  terrain: TerrainState,
  random: SeededRandom,
): void {
  state.ticks += 1;
  state.followers = state.followers.filter((follower) =>
    isAboveWater(terrain, follower.x, follower.y),
  );
  state.houses = state.houses.filter((house) =>
    isAboveWater(terrain, house.x, house.y),
  );
  if (!isAboveWater(terrain, state.banner.x, state.banner.y)) {
    const nearest = nearestLandTiles(terrain, state.banner)[0];
    if (nearest) state.banner = { ...nearest };
  }

  const capacity = state.houses.reduce(
    (total, house) => total + houseCapacity(house),
    0,
  );
  const supported = Math.min(state.followers.length, capacity);
  state.mana +=
    supported * SUPPORTED_MANA_PER_TICK +
    (state.followers.length - supported) * HOMELESS_MANA_PER_TICK;

  if (state.ticks % FOLLOWER_MOVE_INTERVAL === 0) {
    for (const follower of state.followers) {
      moveFollower(follower, state, terrain, random);
    }
  }

  for (const follower of state.followers) {
    const buildingFirstHouse =
      state.houses.length === 0 &&
      state.ticks >= state.rallyUntil &&
      follower.x === state.banner.x &&
      follower.y === state.banner.y &&
      follower.pathGoal === bannerGoal(state.banner);
    const buildingAssignedSite =
      state.houses.length > 0 &&
      state.followers.length >= capacity &&
      follower.pathGoal === siteGoal(follower);
    if (
      (buildingFirstHouse || buildingAssignedSite) &&
      isSuitableBuildingSite(terrain, follower.x, follower.y) &&
      !hasNearbyHouse(state, follower)
    ) {
      follower.dwell += 1;
      if (follower.dwell >= DWELL_REQUIRED) {
        state.houses.push({
          id: state.nextHouseId++,
          x: follower.x,
          y: follower.y,
          level: 1,
        });
        follower.dwell = 0;
      }
    } else {
      follower.dwell = 0;
    }
  }

  if (state.ticks % HOUSE_INTERVAL === 0) {
    updateHouses(state, terrain);
  }
}

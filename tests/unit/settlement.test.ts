import { describe, expect, it } from "vitest";
import { SeededRandom } from "../../src/sim/random";
import {
  MAX_FOLLOWERS,
  TERRAIN_EDIT_MANA_COST,
  createSettlement,
  houseCapacity,
  isSuitableBuildingSite,
  setRallyBanner,
  updateSettlement,
} from "../../src/sim/settlement";
import type {
  Follower,
  House,
  SettlementState,
} from "../../src/sim/settlement";
import { generateIsland } from "../../src/sim/terrain";
import type { TerrainState } from "../../src/sim/terrain";

function flatTerrain(size = 9, height = 4): TerrainState {
  return {
    size,
    waterLevel: 2,
    heights: new Uint8Array(size * size).fill(height),
  };
}

function buildingIsland(): TerrainState {
  const terrain = flatTerrain(9, 2);
  for (let y = 3; y <= 5; y += 1) {
    for (let x = 3; x <= 5; x += 1) {
      terrain.heights[y * terrain.size + x] = 4;
    }
  }
  return terrain;
}

function follower(id: number, x: number, y: number): Follower {
  return { id, x, y, dwell: 0, path: [], pathGoal: "banner:4,4" };
}

function house(id: number, x: number, y: number, level: 1 | 2 | 3 = 1): House {
  return { id, x, y, level };
}

function isolatedState(terrain: TerrainState): SettlementState {
  const state = createSettlement(terrain);
  state.followers = [follower(0, 4, 4)];
  state.banner = { x: 4, y: 4 };
  state.mana = 0;
  state.nextFollowerId = 1;
  return state;
}

function advance(
  state: SettlementState,
  terrain: TerrainState,
  ticks: number,
  seed = 123,
): SeededRandom {
  const random = new SeededRandom(seed);
  for (let tick = 0; tick < ticks; tick += 1) {
    updateSettlement(state, terrain, random);
  }
  return random;
}

function isLand(terrain: TerrainState, x: number, y: number): boolean {
  return terrain.heights[y * terrain.size + x]! > terrain.waterLevel;
}

describe("settlement creation", () => {
  it("starts with valid mana, IDs, banner, and six followers on land", () => {
    const terrain = generateIsland(42);
    const state = createSettlement(terrain);
    const center = Math.floor(terrain.size / 2);

    expect(state).toMatchObject({
      mana: 30,
      ticks: 0,
      houses: [],
      nextFollowerId: 6,
      nextHouseId: 0,
      banner: { x: center, y: center },
    });
    expect(state.followers).toHaveLength(6);
    expect(new Set(state.followers.map(({ id }) => id)).size).toBe(6);
    expect(isLand(terrain, state.banner.x, state.banner.y)).toBe(true);
    for (const resident of state.followers) {
      expect(isLand(terrain, resident.x, resident.y)).toBe(true);
      expect(resident.dwell).toBe(0);
    }
    expect(TERRAIN_EDIT_MANA_COST).toBe(3);
  });

  it("finds the nearest central land when the exact center is submerged", () => {
    const terrain = flatTerrain();
    terrain.heights[4 * terrain.size + 4] = 2;
    const state = createSettlement(terrain);

    expect(isLand(terrain, state.banner.x, state.banner.y)).toBe(true);
    expect(Math.abs(state.banner.x - 4) + Math.abs(state.banner.y - 4)).toBe(1);
  });
});

describe("rally banner", () => {
  it("accepts only integer, in-bounds, above-water destinations", () => {
    const terrain = flatTerrain();
    terrain.heights[2 * terrain.size + 2] = 2;
    const state = createSettlement(terrain);
    const original = { ...state.banner };

    expect(setRallyBanner(state, terrain, 6, 5)).toBe(true);
    expect(state.banner).toEqual({ x: 6, y: 5 });

    const invalidDestinations: [number, number][] = [
      [-1, 4],
      [4, -1],
      [9, 4],
      [4, 9],
      [1.5, 4],
      [4, Number.NaN],
      [2, 2],
    ];
    for (const [x, y] of invalidDestinations) {
      expect(setRallyBanner(state, terrain, x, y)).toBe(false);
      expect(state.banner).toEqual({ x: 6, y: 5 });
    }
    expect(original).not.toEqual(state.banner);
  });

  it("relocates a submerged banner and repaths off-banner followers", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    const resident = follower(0, 1, 4);
    resident.path = [
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ];
    state.followers = [resident];
    state.houses = [house(0, 7, 7)];
    state.nextHouseId = 1;
    terrain.heights[4 * terrain.size + 4] = 2;

    advance(state, terrain, 10);
    expect(state.banner).toEqual({ x: 4, y: 3 });
    expect(state.followers[0]).not.toMatchObject({ x: 1, y: 4 });
    expect(state.followers[0]?.pathGoal).toBe("banner:4,3");
    expect(isLand(terrain, state.followers[0]!.x, state.followers[0]!.y)).toBe(
      true,
    );
  });
});

describe("building sites and dwellings", () => {
  it("requires a complete, flat, above-water 3x3 neighborhood", () => {
    const terrain = flatTerrain();

    expect(isSuitableBuildingSite(terrain, 4, 4)).toBe(true);
    expect(isSuitableBuildingSite(terrain, 0, 4)).toBe(false);
    expect(isSuitableBuildingSite(terrain, 4, 8)).toBe(false);
    expect(isSuitableBuildingSite(terrain, 4.5, 4)).toBe(false);

    terrain.heights[3 * terrain.size + 3] = 5;
    expect(isSuitableBuildingSite(terrain, 4, 4)).toBe(false);
    terrain.heights[3 * terrain.size + 3] = 2;
    expect(isSuitableBuildingSite(terrain, 4, 4)).toBe(false);
  });

  it("autonomously builds one level-1 house after 60 dwell ticks", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);

    advance(state, terrain, 59);
    expect(state.houses).toEqual([]);
    expect(state.followers[0]?.dwell).toBe(59);

    advance(state, terrain, 1);
    expect(state.houses).toEqual([house(0, 4, 4)]);
    expect(state.nextHouseId).toBe(1);
    expect(state.followers[0]?.dwell).toBe(0);

    advance(state, terrain, 60);
    expect(state.houses).toHaveLength(1);
  });

  it("does not build within four grid steps of an existing house", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: 4 }, (_, id) => follower(id, 4, 4));
    state.nextFollowerId = 4;
    state.houses = [house(0, 7, 4)];
    state.nextHouseId = 1;

    advance(state, terrain, 80);
    expect(state.houses).toHaveLength(2);
    for (const added of state.houses.filter((building) => building.id !== 0)) {
      expect(Math.abs(added.x - 7) + Math.abs(added.y - 4)).toBeGreaterThan(4);
    }
    expect(state.followers[0]?.dwell).toBe(0);
  });

  it("resets dwell when terrain stops being flat and can recover", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    advance(state, terrain, 20);

    terrain.heights[3 * terrain.size + 3] = 5;
    advance(state, terrain, 1);
    expect(state.followers[0]?.dwell).toBe(0);
    expect(state.houses).toEqual([]);

    terrain.heights[3 * terrain.size + 3] = 4;
    advance(state, terrain, 60);
    expect(state.houses).toEqual([house(0, 4, 4)]);
  });

  it("uses 4 and 12 surrounding suitable sites as level thresholds", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = [];
    state.houses = [house(0, 4, 4)];
    state.ticks = 99;

    advance(state, terrain, 1);
    expect(state.houses[0]?.level).toBe(3);
    expect(houseCapacity(state.houses[0]!)).toBe(12);

    for (let y = 2; y <= 6; y += 1) {
      for (let x = 2; x <= 6; x += 1) {
        if (x < 3 || x > 5 || y < 3 || y > 5) {
          terrain.heights[y * terrain.size + x] = 2;
        }
      }
    }
    state.ticks = 99;
    advance(state, terrain, 1);
    expect(state.houses[0]?.level).toBe(1);
    expect(houseCapacity(state.houses[0]!)).toBe(4);
    expect(houseCapacity(house(1, 4, 4, 2))).toBe(8);
  });

  it("downgrades an unsuitable house foundation and skips its spawn", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.houses = [house(0, 4, 4, 3)];
    state.nextHouseId = 1;
    state.ticks = 99;
    terrain.heights[4 * terrain.size + 4] = 5;

    advance(state, terrain, 1);
    expect(state.houses).toEqual([house(0, 4, 4, 1)]);
    expect(state.followers).toHaveLength(1);
    expect(state.nextFollowerId).toBe(1);
    expect(isLand(terrain, 4, 4)).toBe(true);
  });
});

describe("settlement simulation", () => {
  it("moves at most one tile on each tenth tick", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = [follower(0, 1, 4)];
    state.houses = [house(0, 4, 4)];
    state.banner = { x: 6, y: 4 };

    advance(state, terrain, 9);
    expect(state.followers[0]).toMatchObject({ x: 1, y: 4 });
    advance(state, terrain, 1);
    expect(state.followers[0]).toMatchObject({ x: 2, y: 4 });
    advance(state, terrain, 10);
    expect(state.followers[0]).toMatchObject({ x: 3, y: 4 });
  });

  it("uses one settlement party at a time beyond the first house", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: 12 }, (_, id) => follower(id, 4, 4));
    state.nextFollowerId = 12;
    state.houses = [house(0, 4, 4)];
    state.nextHouseId = 1;

    advance(state, terrain, 10);
    const goals = state.followers.map((resident) => resident.pathGoal);
    expect(goals[0]).toMatch(/^site:/);
    for (const goal of goals.slice(1)) expect(goal).toBe("banner:4,4");

    advance(state, terrain, 110);
    expect(state.houses).toHaveLength(2);
    expect(
      state.houses.some((building) => building.x !== 4 || building.y !== 4),
    ).toBe(true);
  });

  it("waits for full housing and cancels unnecessary settlement trips", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: 3 }, (_, id) => follower(id, 4, 4));
    state.nextFollowerId = 3;
    state.houses = [house(0, 4, 4)];
    state.nextHouseId = 1;

    advance(state, terrain, 10);
    expect(state.followers[0]?.pathGoal).toBe("banner:4,4");
    state.followers.push(follower(3, 4, 4));
    state.nextFollowerId = 4;
    advance(state, terrain, 10);
    expect(state.followers[0]?.pathGoal).toMatch(/^site:/);

    state.houses[0]!.level = 2;
    advance(state, terrain, 10);
    expect(state.followers[0]?.pathGoal).toBe("banner:4,4");
  });

  it("rally overrides expansion goals and gathers followers", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: 4 }, (_, id) => follower(id, 4, 4));
    state.nextFollowerId = 4;
    state.houses = [house(0, 4, 4)];
    state.nextHouseId = 1;
    advance(state, terrain, 10);
    expect(state.followers[0]?.pathGoal).toMatch(/^site:/);

    expect(setRallyBanner(state, terrain, 6, 6)).toBe(true);
    expect(state.followers[0]?.pathGoal).toBe("banner:6,6");
    expect(state.followers[0]?.path).toEqual([]);
    advance(state, terrain, 10);
    expect(state.followers[0]).not.toMatchObject({ x: 4, y: 4 });
  });

  it("does not build at Rally while spare housing remains", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: 3 }, (_, id) => follower(id, 4, 4));
    state.nextFollowerId = 3;
    state.houses = [house(0, 7, 7, 2)];
    state.nextHouseId = 1;

    expect(setRallyBanner(state, terrain, 4, 4)).toBe(true);
    advance(state, terrain, 150);
    expect(state.houses).toHaveLength(1);
    expect(state.followers.every((resident) => resident.dwell === 0)).toBe(
      true,
    );
  });

  it("holds a full-housing Rally before expansion resumes", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: 12 }, (_, id) => follower(id, 4, 4));
    state.nextFollowerId = 12;
    state.houses = [house(0, 4, 4)];
    state.nextHouseId = 1;

    expect(setRallyBanner(state, terrain, 4, 4)).toBe(true);
    advance(state, terrain, 90);
    expect(state.followers[0]?.pathGoal).toBe("banner:4,4");
    advance(state, terrain, 20);
    expect(state.followers[0]?.pathGoal).toMatch(/^site:/);
  });

  it("accumulates dwelling only after reaching an assigned site", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: 12 }, (_, id) => follower(id, 4, 4));
    state.nextFollowerId = 12;
    state.houses = [house(0, 4, 4)];
    state.nextHouseId = 1;

    advance(state, terrain, 60);
    expect(state.houses).toHaveLength(1);
    expect(
      state.followers
        .filter((resident) => resident.path.length > 0)
        .every((resident) => resident.dwell === 0),
    ).toBe(true);
    advance(state, terrain, 60);
    expect(state.houses.length).toBeGreaterThan(1);
  });

  it("skips an unreachable nearest site for a reachable one", () => {
    const terrain = flatTerrain(12, 2);
    for (let y = 0; y <= 2; y += 1) {
      for (let x = 0; x <= 2; x += 1) terrain.heights[y * 12 + x] = 4;
    }
    for (let y = 3; y <= 5; y += 1) {
      for (let x = 3; x <= 5; x += 1) terrain.heights[y * 12 + x] = 4;
      for (let x = 9; x <= 11; x += 1) terrain.heights[y * 12 + x] = 4;
    }
    for (let x = 6; x <= 8; x += 1) terrain.heights[4 * 12 + x] = 4;
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: 4 }, (_, id) => follower(id, 4, 4));
    state.nextFollowerId = 4;
    state.houses = [house(0, 4, 4)];
    state.nextHouseId = 1;

    advance(state, terrain, 10);
    expect(state.followers[0]?.pathGoal).toBe("site:10,4");
  });

  it("accepts the current tile as a reachable settlement destination", () => {
    const terrain = flatTerrain(9, 2);
    for (const center of [1, 7]) {
      for (let y = center - 1; y <= center + 1; y += 1) {
        for (let x = center - 1; x <= center + 1; x += 1) {
          terrain.heights[y * terrain.size + x] = 4;
        }
      }
    }
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: 4 }, (_, id) => follower(id, 1, 1));
    state.nextFollowerId = 4;
    state.houses = [house(0, 7, 7)];
    state.nextHouseId = 1;
    state.banner = { x: 1, y: 1 };

    expect(setRallyBanner(state, terrain, 1, 1)).toBe(true);
    advance(state, terrain, 110);
    expect(state.followers[0]?.pathGoal).toBe("site:1,1");
    advance(state, terrain, 60);
    expect(state.houses).toHaveLength(2);
  });

  it("waits at unsuitable pre-first-house Rally ground and can recover", () => {
    const terrain = flatTerrain();
    const state = createSettlement(terrain);
    terrain.heights[3 * terrain.size + 3] = 5;

    expect(setRallyBanner(state, terrain, 4, 4)).toBe(true);
    advance(state, terrain, 150);
    expect(state.houses).toEqual([]);
    expect(
      state.followers.every((resident) => resident.pathGoal === "banner:4,4"),
    ).toBe(true);

    terrain.heights[3 * terrain.size + 3] = 4;
    expect(setRallyBanner(state, terrain, 4, 4)).toBe(true);
    advance(state, terrain, 170);
    expect(state.houses).toHaveLength(1);
  });

  it("reuses a cached path with the current goal and dry next tile", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    const resident = follower(0, 1, 4);
    resident.path = [
      { x: 1, y: 3 },
      { x: 2, y: 3 },
    ];
    resident.pathGoal = "banner:6,4";
    state.followers = [resident];
    state.houses = [house(0, 4, 4)];
    state.banner = { x: 6, y: 4 };

    advance(state, terrain, 10);
    expect(state.followers[0]).toMatchObject({ x: 1, y: 3 });
    expect(state.followers[0]?.path).toEqual([{ x: 2, y: 3 }]);
  });

  it("repaths when the cached next tile becomes submerged", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    const resident = follower(0, 1, 4);
    resident.path = [{ x: 2, y: 4 }];
    resident.pathGoal = "banner:6,4";
    state.followers = [resident];
    state.houses = [house(0, 4, 4)];
    state.banner = { x: 6, y: 4 };
    terrain.heights[4 * terrain.size + 2] = 2;

    advance(state, terrain, 10);
    expect(state.followers[0]).not.toMatchObject({ x: 2, y: 4 });
    expect(state.followers[0]?.pathGoal).toBe("banner:6,4");
    expect(isLand(terrain, state.followers[0]!.x, state.followers[0]!.y)).toBe(
      true,
    );
  });

  it("grows population and mana, then respects total house capacity", () => {
    const terrain = buildingIsland();
    const state = isolatedState(terrain);
    state.houses = [house(0, 4, 4)];
    state.nextHouseId = 1;

    advance(state, terrain, 100);
    expect(state.followers).toHaveLength(2);
    expect(state.mana).toBeCloseTo(0.1, 10);

    advance(state, terrain, 300);
    expect(state.houses[0]?.level).toBe(1);
    expect(state.followers).toHaveLength(4);
    expect(state.mana).toBeCloseTo(1, 10);
    expect(new Set(state.followers.map(({ id }) => id)).size).toBe(4);
    expect(state.nextFollowerId).toBe(4);
    for (const resident of state.followers) {
      expect(isLand(terrain, resident.x, resident.y)).toBe(true);
    }

    advance(state, terrain, 200);
    expect(state.followers).toHaveLength(houseCapacity(state.houses[0]!));
    expect(state.mana).toBeCloseTo(1.8, 10);
  });

  it("pays the homeless rate to the initial six followers without houses", () => {
    const terrain = flatTerrain();
    const state = createSettlement(terrain);

    advance(state, terrain, 1);
    expect(state.houses).toEqual([]);
    expect(state.followers).toHaveLength(6);
    expect(state.mana).toBeCloseTo(30.0012, 10);
  });

  it("reduces supported income after a house downgrade", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: 8 }, (_, id) => follower(id, 4, 4));
    state.nextFollowerId = 8;
    state.houses = [house(0, 4, 4, 3)];
    state.nextHouseId = 1;
    state.ticks = 99;
    terrain.heights[4 * terrain.size + 4] = 5;

    advance(state, terrain, 1);
    expect(state.houses[0]?.level).toBe(1);
    state.mana = 0;
    advance(state, terrain, 1);
    expect(state.mana).toBeCloseTo(4 * 0.001 + 4 * 0.0002, 10);
  });

  it("caps house spawning at the global follower limit", () => {
    const terrain = flatTerrain();
    const state = isolatedState(terrain);
    state.followers = Array.from({ length: MAX_FOLLOWERS - 1 }, (_, id) =>
      follower(id, 4, 4),
    );
    state.nextFollowerId = MAX_FOLLOWERS - 1;
    state.houses = Array.from({ length: 18 }, (_, id) => house(id, 4, 4, 3));
    state.nextHouseId = 18;
    state.ticks = 99;

    advance(state, terrain, 1);
    expect(state.followers).toHaveLength(MAX_FOLLOWERS);
    expect(state.nextFollowerId).toBe(MAX_FOLLOWERS);
    expect(new Set(state.followers.map(({ id }) => id)).size).toBe(
      MAX_FOLLOWERS,
    );

    advance(state, terrain, 100);
    expect(state.followers).toHaveLength(MAX_FOLLOWERS);
    expect(state.nextFollowerId).toBe(MAX_FOLLOWERS);
  });

  it("removes submerged followers and houses without reusing IDs", () => {
    const terrain = flatTerrain();
    const state = createSettlement(terrain);
    state.followers = [follower(4, 2, 2), follower(7, 6, 6)];
    state.houses = [house(3, 2, 2), house(8, 6, 6)];
    state.nextFollowerId = 8;
    state.nextHouseId = 9;
    terrain.heights[2 * terrain.size + 2] = 2;

    advance(state, terrain, 1);
    expect(state.followers).toEqual([follower(7, 6, 6)]);
    expect(state.houses).toEqual([house(8, 6, 6)]);
    expect(state.nextFollowerId).toBe(8);
    expect(state.nextHouseId).toBe(9);
    expect(Number.isFinite(state.mana)).toBe(true);
    expect(state.mana).toBeGreaterThanOrEqual(30);
  });

  it("produces identical repeated seeded-island runs", () => {
    function run(): { state: SettlementState; randomState: number } {
      const terrain = generateIsland(8675309);
      const state = createSettlement(terrain);
      const random = new SeededRandom(8675309);
      for (let tick = 0; tick < 400; tick += 1) {
        if (tick === 120) setRallyBanner(state, terrain, 30, 30);
        updateSettlement(state, terrain, random);
      }
      return { state, randomState: random.snapshot() };
    }

    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.state.ticks).toBe(400);
    expect(first.state.mana).toBeGreaterThan(30);
    expect(first.state.followers.length).toBeGreaterThan(0);
    for (const resident of first.state.followers) {
      expect(isLand(generateIsland(8675309), resident.x, resident.y)).toBe(
        true,
      );
    }
  });
});

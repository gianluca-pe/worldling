import { describe, expect, it } from "vitest";
import {
  advanceHazards,
  createHazard,
  HAZARD_RULES,
} from "../../src/sim/hazards";
import { OpponentController } from "../../src/sim/opponent";
import { SeededRandom } from "../../src/sim/random";
import { createSettlement } from "../../src/sim/settlement";
import {
  matchStatusFor,
  Simulation,
  runScenario,
} from "../../src/sim/simulation";
import { editTerrain, generateIsland } from "../../src/sim/terrain";

describe("deterministic hazards", () => {
  it("telegraphs then applies an earthquake exactly once", () => {
    const terrain = generateIsland(42);
    const target = { x: 32, y: 32 };
    const before = terrain.heights[target.y * terrain.size + target.x]!;
    const hazards = [
      createHazard(0, "earthquake", "player", target, terrain.size, 10),
    ];

    advanceHazards(hazards, terrain, 109);
    expect(terrain.heights[target.y * terrain.size + target.x]).toBe(before);
    const remaining = advanceHazards(hazards, terrain, 110);
    expect(terrain.heights[target.y * terrain.size + target.x]).toBe(
      before - 1,
    );
    advanceHazards(remaining, terrain, 110);
    expect(terrain.heights[target.y * terrain.size + target.x]).toBe(
      before - 1,
    );
  });

  it("telegraphs, rechecks, and recedes a localized flood", () => {
    const terrain = generateIsland(42);
    const target = { x: 32, y: 32 };
    const index = target.y * terrain.size + target.x;
    terrain.heights[index] = 4;
    const hazards = [
      createHazard(0, "flood", "player", target, terrain.size, 0),
    ];

    let remaining = advanceHazards(hazards, terrain, 99);
    expect(terrain.flooded?.[index]).toBe(0);
    remaining = advanceHazards(remaining, terrain, 100);
    expect(terrain.flooded?.[index]).toBe(1);

    editTerrain(terrain, target.x, target.y, "raise");
    remaining = advanceHazards(remaining, terrain, 101);
    expect(terrain.flooded?.[index]).toBe(0);
    editTerrain(terrain, target.x, target.y, "lower");
    remaining = advanceHazards(remaining, terrain, 102);
    expect(terrain.flooded?.[index]).toBe(1);

    remaining = advanceHazards(remaining, terrain, 300);
    expect(terrain.flooded?.[index]).toBe(0);
    expect(remaining).toEqual([]);
  });

  it("charges the player once for an accepted spell", () => {
    const simulation = new Simulation(0x47_4f_44, "skirmish");
    simulation.advanceTo(2000);
    const before = simulation.snapshot();
    const target = before.settlement.banner;
    simulation.queue({
      tick: 2000,
      sequence: 0,
      type: "earthquake",
      faction: "player",
      ...target,
    });
    simulation.advanceTo(2001);
    const accepted = simulation.snapshot();

    const capacity = before.settlement.houses.reduce(
      (total, house) => total + house.level * 4,
      0,
    );
    const supported = Math.min(before.settlement.followers.length, capacity);
    const income =
      supported * 0.001 +
      (before.settlement.followers.length - supported) * 0.0002;
    expect(accepted.settlement.mana).toBeCloseTo(
      before.settlement.mana - HAZARD_RULES.earthquake.cost + income,
      8,
    );
    expect(accepted.spellCount).toBe(1);
    expect(accepted.hazards).toHaveLength(1);
    expect(accepted.hazards[0]?.executeTick).toBe(2100);
  });

  it("rejects an unaffordable spell without creating a hazard", () => {
    const result = runScenario({
      version: 1,
      seed: 42,
      ticks: 1,
      mode: "skirmish",
      commands: [{ tick: 0, sequence: 0, type: "flood", x: 32, y: 32 }],
    });

    expect(result.spellCount).toBe(0);
    expect(result.hazards).toEqual([]);
    expect(result.lastRejectedEdit?.reason).toBe("mana");
  });

  it("uses the same costs and a deterministic cooldown for the opponent", () => {
    const terrain = generateIsland(42);
    const own = createSettlement(terrain);
    const rival = createSettlement(terrain);
    rival.houses.push({ id: 0, x: 32, y: 32, level: 1 });
    const controller = new OpponentController(new SeededRandom(42));

    own.mana = 0;
    expect(controller.decide(0, terrain, "opponent", own, rival)).toBeNull();
    own.mana = 80;
    const action = controller.decide(20, terrain, "opponent", own, rival);
    expect(action?.type).toMatch(/earthquake|flood/);
    expect(action?.faction).toBe("opponent");
    expect(controller.snapshot().nextSpellTick).toBe(320);
  });

  it("prioritizes followerless foundation recovery at the real edit cost", () => {
    const terrain = generateIsland(42);
    const own = createSettlement(terrain);
    const rival = createSettlement(terrain);
    const controller = new OpponentController(new SeededRandom(42));
    own.followers = [];
    own.houses = [{ id: 0, x: 32, y: 32, level: 1 }];
    own.mana = 10;
    terrain.heights[31 * terrain.size + 31] = 6;

    const action = controller.decide(0, terrain, "opponent", own, rival);
    expect(action?.type).toBe("lower-land");
    terrain.heights[31 * terrain.size + 31] = 2;
    own.mana = 30;
    expect(controller.decide(20, terrain, "opponent", own, rival)?.type).toBe(
      "raise-land",
    );
    own.mana = 4;
    expect(controller.decide(40, terrain, "opponent", own, rival)).toBeNull();
  });

  it("evaluates victory, defeat, and draw from both factions", () => {
    const terrain = generateIsland(42);
    const player = createSettlement(terrain);
    const opponent = createSettlement(terrain);
    expect(matchStatusFor(player, opponent, terrain)).toBe("playing");

    const survivor = opponent.followers[0]!;
    opponent.followers = [];
    opponent.houses = [];
    expect(matchStatusFor(player, opponent, terrain)).toBe("victory");
    player.followers = [];
    player.houses = [];
    expect(matchStatusFor(player, opponent, terrain)).toBe("draw");
    opponent.followers = [survivor];
    expect(matchStatusFor(player, opponent, terrain)).toBe("defeat");
  });

  it("distinguishes a recoverable empty house from an unsustainable one", () => {
    const terrain = generateIsland(42);
    const player = createSettlement(terrain);
    const opponent = createSettlement(terrain);
    player.followers = [];
    player.houses = [{ id: 0, x: 32, y: 32, level: 1 }];
    player.mana = 0;

    expect(matchStatusFor(player, opponent, terrain)).toBe("playing");
    terrain.heights[31 * terrain.size + 31] = 6;
    expect(matchStatusFor(player, opponent, terrain)).toBe("defeat");
  });

  it("replays skirmish mode identically after serialization", () => {
    const replay = {
      version: 1 as const,
      seed: 42,
      ticks: 1200,
      mode: "skirmish" as const,
      commands: [
        { tick: 0, sequence: 0, type: "rally" as const, x: 32, y: 32 },
        {
          tick: 20,
          sequence: 1,
          type: "lower-land" as const,
          x: 32,
          y: 32,
        },
      ],
    };
    const first = runScenario(replay);
    const second = runScenario(replay);
    expect(first).toEqual(second);
    expect(first.mode).toBe("skirmish");
    expect(first.opponent).not.toBeNull();
  });
});

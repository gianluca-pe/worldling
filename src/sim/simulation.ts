import { advanceHazards, createHazard, HAZARD_RULES } from "./hazards";
import type { Hazard, HazardType } from "./hazards";
import { OpponentController } from "./opponent";
import type { OpponentSnapshot } from "./opponent";
import { SeededRandom } from "./random";
import type { Faction, GameMode, Replay, SimulationCommand } from "./replay";
import { validateReplay } from "./replay";
import {
  TERRAIN_EDIT_MANA_COST,
  createSettlement,
  isSuitableBuildingSite,
  setRallyBanner,
  terrainEditManaCost,
  updateSettlement,
} from "./settlement";
import type { SettlementState } from "./settlement";
import { createSkirmishSettlements } from "./skirmish";
import type { StartArea } from "./skirmish";
import { canEditTerrain, editTerrain, generateIsland } from "./terrain";
import type { TerrainState } from "./terrain";

type Action = Exclude<SimulationCommand, { type: "probe" }>;
export type MatchStatus = "playing" | "victory" | "defeat" | "draw";

export interface TerrainEdit {
  readonly sequence: number;
  readonly type: Action["type"];
  readonly faction: Faction;
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly reason?: "mana" | "terrain" | "height" | "finished";
}

export interface SimulationSnapshot {
  readonly seed: number;
  readonly mode: GameMode;
  readonly tick: number;
  readonly randomState: number;
  readonly probeCount: number;
  readonly lastProbeValue: number | null;
  readonly lastSequence: number | null;
  readonly terrain: {
    readonly size: number;
    readonly waterLevel: number;
    readonly heights: number[];
    readonly flooded?: number[];
  };
  readonly settlement: SettlementState;
  readonly opponent: SettlementState | null;
  readonly opponentAI: OpponentSnapshot | null;
  readonly startAreas: Record<Faction, StartArea> | null;
  readonly hazards: readonly Hazard[];
  readonly matchStatus: MatchStatus;
  readonly editCount: number;
  readonly rejectedEditCount: number;
  readonly spellCount: number;
  readonly lastTerrainEdit: TerrainEdit | null;
  readonly lastRejectedEdit: TerrainEdit | null;
  readonly lastOpponentAction: TerrainEdit | null;
}

function copySettlement(settlement: SettlementState): SettlementState {
  return {
    ...settlement,
    banner: { ...settlement.banner },
    followers: settlement.followers.map((follower) => ({
      ...follower,
      path: follower.path.map((point) => ({ ...point })),
    })),
    houses: settlement.houses.map((house) => ({ ...house })),
  };
}

function canRecoverSettlement(
  settlement: SettlementState,
  terrain: TerrainState,
): boolean {
  if (settlement.followers.length > 0) return true;
  if (settlement.houses.length === 0) return false;
  if (settlement.mana >= TERRAIN_EDIT_MANA_COST) return true;
  return settlement.houses.some((house) =>
    isSuitableBuildingSite(terrain, house.x, house.y),
  );
}

export function matchStatusFor(
  player: SettlementState,
  opponent: SettlementState,
  terrain: TerrainState,
): MatchStatus {
  const playerEliminated = !canRecoverSettlement(player, terrain);
  const opponentEliminated = !canRecoverSettlement(opponent, terrain);
  if (playerEliminated && opponentEliminated) return "draw";
  if (opponentEliminated) return "victory";
  if (playerEliminated) return "defeat";
  return "playing";
}

export class Simulation {
  readonly seed: number;
  private readonly mode: GameMode;
  private tick = 0;
  private readonly random: SeededRandom;
  private readonly settlementRandom: SeededRandom;
  private readonly opponentSettlementRandom: SeededRandom | null = null;
  private readonly terrain: TerrainState;
  private readonly settlement: SettlementState;
  private readonly opponent: SettlementState | null = null;
  private readonly opponentController: OpponentController | null = null;
  private readonly startAreas: Record<Faction, StartArea> | null = null;
  private readonly commands: SimulationCommand[] = [];
  private readonly hazards: Hazard[] = [];
  private pendingIndex = 0;
  private probeCount = 0;
  private lastProbeValue: number | null = null;
  private lastSequence: number | null = null;
  private editCount = 0;
  private rejectedEditCount = 0;
  private spellCount = 0;
  private nextHazardId = 0;
  private nextOpponentSequence = 1_000_000;
  private matchStatus: MatchStatus = "playing";
  private lastTerrainEdit: TerrainEdit | null = null;
  private lastRejectedEdit: TerrainEdit | null = null;
  private lastOpponentAction: TerrainEdit | null = null;

  constructor(seed: number, mode: GameMode = "sandbox") {
    this.seed = seed;
    this.mode = mode;
    this.random = new SeededRandom(seed);
    this.settlementRandom = new SeededRandom((seed ^ 0x9e_37_79_b9) >>> 0);
    this.terrain = generateIsland(seed);
    if (mode === "skirmish") {
      const starts = createSkirmishSettlements(this.terrain);
      this.settlement = starts.player;
      this.opponent = starts.opponent;
      this.startAreas = starts.areas;
      this.opponentSettlementRandom = new SeededRandom(
        (seed ^ 0x51_5e_77_31) >>> 0,
      );
      this.opponentController = new OpponentController(
        new SeededRandom((seed ^ 0xa5_5a_5a_5a) >>> 0),
      );
    } else {
      this.settlement = createSettlement(this.terrain);
    }
  }

  get currentTick(): number {
    return this.tick;
  }

  get status(): MatchStatus {
    return this.matchStatus;
  }

  queue(command: SimulationCommand): void {
    const previous = this.commands.at(-1);
    if (
      !Number.isInteger(command.tick) ||
      !Number.isInteger(command.sequence) ||
      command.tick < this.tick ||
      command.sequence < 0 ||
      (previous &&
        (command.tick < previous.tick || command.sequence <= previous.sequence))
    ) {
      throw new Error("Commands must have future ticks and canonical ordering");
    }
    this.commands.push({ ...command });
  }

  advanceTo(targetTick: number): void {
    if (!Number.isInteger(targetTick) || targetTick < this.tick) {
      throw new RangeError("Target tick must be a current or future integer");
    }
    while (this.tick < targetTick) {
      this.step();
    }
  }

  toReplay(): Replay {
    return {
      version: 1,
      seed: this.seed,
      ticks: this.tick,
      mode: this.mode,
      commands: this.commands
        .filter((command) => command.tick < this.tick)
        .map((command) => ({ ...command })),
    };
  }

  static fromReplay(replay: Replay): Simulation {
    const validated = validateReplay(replay);
    const simulation = new Simulation(
      validated.seed,
      validated.mode ?? "sandbox",
    );
    for (const command of validated.commands) simulation.queue(command);
    simulation.advanceTo(validated.ticks);
    return simulation;
  }

  snapshot(): SimulationSnapshot {
    return {
      seed: this.seed,
      mode: this.mode,
      tick: this.tick,
      randomState: this.random.snapshot(),
      probeCount: this.probeCount,
      lastProbeValue: this.lastProbeValue,
      lastSequence: this.lastSequence,
      terrain: {
        size: this.terrain.size,
        waterLevel: this.terrain.waterLevel,
        heights: Array.from(this.terrain.heights),
        flooded: this.terrain.flooded
          ? Array.from(this.terrain.flooded)
          : undefined,
      },
      settlement: copySettlement(this.settlement),
      opponent: this.opponent ? copySettlement(this.opponent) : null,
      opponentAI: this.opponentController?.snapshot() ?? null,
      startAreas: this.startAreas
        ? {
            player: { ...this.startAreas.player },
            opponent: { ...this.startAreas.opponent },
          }
        : null,
      hazards: this.hazards.map((hazard) => ({
        ...hazard,
        target: { ...hazard.target },
        cells: hazard.cells.map((cell) => ({ ...cell })),
      })),
      matchStatus: this.matchStatus,
      editCount: this.editCount,
      rejectedEditCount: this.rejectedEditCount,
      spellCount: this.spellCount,
      lastTerrainEdit: this.lastTerrainEdit,
      lastRejectedEdit: this.lastRejectedEdit,
      lastOpponentAction: this.lastOpponentAction,
    };
  }

  private step(): void {
    if (this.matchStatus !== "playing") {
      this.tick += 1;
      return;
    }
    while (this.commands[this.pendingIndex]?.tick === this.tick) {
      const command = this.commands[this.pendingIndex];
      if (command) this.applyCommand(command);
      this.pendingIndex += 1;
    }
    if (this.opponentController && this.opponent) {
      const action = this.opponentController.decide(
        this.tick,
        this.terrain,
        "opponent",
        this.opponent,
        this.settlement,
      );
      if (action) {
        this.applyCommand({
          ...action,
          tick: this.tick,
          sequence: this.nextOpponentSequence++,
        });
      }
    }

    this.tick += 1;
    if (this.mode === "skirmish") {
      const remaining = advanceHazards(this.hazards, this.terrain, this.tick);
      this.hazards.splice(0, this.hazards.length, ...remaining);
    }
    updateSettlement(this.settlement, this.terrain, this.settlementRandom);
    if (this.opponent && this.opponentSettlementRandom) {
      updateSettlement(
        this.opponent,
        this.terrain,
        this.opponentSettlementRandom,
      );
    }
    if (this.mode === "skirmish") this.updateMatchStatus();
  }

  private applyCommand(command: SimulationCommand): void {
    const faction = command.faction ?? "player";
    if (command.type === "probe") {
      this.lastSequence = command.sequence;
      this.lastProbeValue = this.random.nextUint32();
      this.probeCount += 1;
      return;
    }

    if (faction === "player") this.lastSequence = command.sequence;
    const settlement = faction === "player" ? this.settlement : this.opponent;
    if (!settlement || this.matchStatus !== "playing") {
      this.recordResult(command, faction, false, "finished");
      return;
    }

    if (command.type === "rally") {
      const accepted = setRallyBanner(
        settlement,
        this.terrain,
        command.x,
        command.y,
      );
      this.recordResult(
        command,
        faction,
        accepted,
        accepted ? undefined : "terrain",
      );
      return;
    }

    if (command.type === "earthquake" || command.type === "flood") {
      this.applyHazardCommand(command, faction, settlement);
      return;
    }

    const direction = command.type === "raise-land" ? "raise" : "lower";
    if (!canEditTerrain(this.terrain, command.x, command.y, direction)) {
      const inBounds =
        command.x >= 0 &&
        command.y >= 0 &&
        command.x < this.terrain.size &&
        command.y < this.terrain.size;
      this.recordResult(
        command,
        faction,
        false,
        inBounds ? "height" : "terrain",
      );
      return;
    }
    const cost = terrainEditManaCost(
      this.terrain,
      command.x,
      command.y,
      direction,
    );
    if (settlement.mana < cost) {
      this.recordResult(command, faction, false, "mana");
      return;
    }
    editTerrain(this.terrain, command.x, command.y, direction);
    settlement.mana -= cost;
    if (faction === "player") this.editCount += 1;
    this.recordResult(command, faction, true);
  }

  private applyHazardCommand(
    command: Action & { type: HazardType },
    faction: Faction,
    settlement: SettlementState,
  ): void {
    const inBounds =
      command.x >= 0 &&
      command.y >= 0 &&
      command.x < this.terrain.size &&
      command.y < this.terrain.size;
    if (!inBounds) {
      this.recordResult(command, faction, false, "terrain");
      return;
    }
    const cost = HAZARD_RULES[command.type].cost;
    if (settlement.mana < cost) {
      this.recordResult(command, faction, false, "mana");
      return;
    }
    settlement.mana -= cost;
    this.hazards.push(
      createHazard(
        this.nextHazardId++,
        command.type,
        faction,
        command,
        this.terrain.size,
        this.tick,
      ),
    );
    if (faction === "player") this.spellCount += 1;
    this.recordResult(command, faction, true);
  }

  private recordResult(
    command: Action,
    faction: Faction,
    accepted: boolean,
    reason?: "mana" | "terrain" | "height" | "finished",
  ): void {
    const result: TerrainEdit = {
      sequence: command.sequence,
      type: command.type,
      faction,
      x: command.x,
      y: command.y,
      height:
        this.terrain.heights[command.y * this.terrain.size + command.x] ?? 0,
      reason,
    };
    if (faction === "opponent") {
      this.lastOpponentAction = result;
      return;
    }
    if (accepted) {
      this.lastTerrainEdit = result;
    } else {
      this.rejectedEditCount += 1;
      this.lastRejectedEdit = result;
    }
  }

  private updateMatchStatus(): void {
    if (!this.opponent) return;
    this.matchStatus = matchStatusFor(
      this.settlement,
      this.opponent,
      this.terrain,
    );
  }
}

export function runScenario(input: Replay): SimulationSnapshot {
  const replay = validateReplay(input);
  const simulation = new Simulation(replay.seed, replay.mode ?? "sandbox");
  for (const command of replay.commands) {
    simulation.queue(command);
  }
  simulation.advanceTo(replay.ticks);
  return simulation.snapshot();
}

import type { SimulationCommand } from "./replay";
import { validateReplay } from "./replay";
import type { SimulationSnapshot } from "./simulation";
import { MAP_SIZE, MAX_HEIGHT, WATER_LEVEL } from "./terrain";

export interface SimulationCheckpoint {
  readonly version: 1;
  readonly snapshot: SimulationSnapshot;
  readonly settlementRandomState: number;
  readonly opponentSettlementRandomState: number | null;
  readonly nextHazardId: number;
  readonly nextOpponentSequence: number;
  readonly commands: readonly SimulationCommand[];
}

type Validator = (value: unknown) => boolean;
const integer: Validator = (value) =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const uint32: Validator = (value) =>
  integer(value) && (value as number) <= 0xffffffff;
const nonnegative: Validator = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const oneOf =
  (...values: unknown[]): Validator =>
  (value) =>
    values.includes(value);
const nullable =
  (validate: Validator): Validator =>
  (value) =>
    value === null || validate(value);
const arrayOf =
  (validate: Validator): Validator =>
  (value) =>
    Array.isArray(value) && value.every(validate);
const object =
  (fields: Record<string, Validator>): Validator =>
  (value) =>
    typeof value === "object" &&
    value !== null &&
    Object.entries(fields).every(([key, validate]) =>
      validate((value as Record<string, unknown>)[key]),
    );
const coordinate: Validator = (value) =>
  integer(value) && (value as number) < MAP_SIZE;
const point = object({ x: coordinate, y: coordinate });
const faction = oneOf("player", "opponent");
const settlement = object({
  followers: arrayOf(
    object({
      id: integer,
      x: coordinate,
      y: coordinate,
      dwell: integer,
      path: arrayOf(point),
      pathGoal: (value) => typeof value === "string",
    }),
  ),
  houses: arrayOf(
    object({
      id: integer,
      x: coordinate,
      y: coordinate,
      level: oneOf(1, 2, 3),
    }),
  ),
  banner: point,
  mana: nonnegative,
  ticks: integer,
  rallyUntil: integer,
  nextSiteSearchTick: integer,
  nextFollowerId: integer,
  nextHouseId: integer,
});
const opponentAI = object({
  nextDecisionTick: integer,
  nextSpellTick: integer,
  randomState: uint32,
});
const area = object({ landTiles: integer, buildingSites: integer });
const edit = nullable(
  object({
    sequence: integer,
    type: oneOf("raise-land", "lower-land", "rally", "earthquake", "flood"),
    faction,
    x: integer,
    y: integer,
    height: (value) => integer(value) && (value as number) <= MAX_HEIGHT,
    reason: oneOf(undefined, "mana", "terrain", "height", "finished"),
  }),
);
const grid =
  (validate: Validator): Validator =>
  (value) =>
    Array.isArray(value) &&
    value.length === MAP_SIZE * MAP_SIZE &&
    value.every(validate);
const snapshot = object({
  seed: uint32,
  mode: oneOf("sandbox", "skirmish"),
  tick: integer,
  randomState: uint32,
  probeCount: integer,
  lastProbeValue: nullable(uint32),
  lastSequence: nullable(integer),
  terrain: object({
    size: oneOf(MAP_SIZE),
    waterLevel: oneOf(WATER_LEVEL),
    heights: grid((value) => integer(value) && (value as number) <= MAX_HEIGHT),
    flooded: grid(oneOf(0, 1)),
  }),
  settlement,
  opponent: nullable(settlement),
  opponentAI: nullable(opponentAI),
  startAreas: nullable(object({ player: area, opponent: area })),
  hazards: arrayOf(
    object({
      id: integer,
      type: oneOf("earthquake", "flood"),
      faction,
      target: point,
      cells: arrayOf(point),
      executeTick: integer,
      endTick: integer,
    }),
  ),
  matchStatus: oneOf("playing", "victory", "defeat", "draw"),
  editCount: integer,
  rejectedEditCount: integer,
  spellCount: integer,
  lastTerrainEdit: edit,
  lastRejectedEdit: edit,
  lastOpponentAction: edit,
});

export function validateCheckpoint(value: unknown): SimulationCheckpoint {
  if (
    !object({
      version: oneOf(1),
      snapshot,
      settlementRandomState: uint32,
      opponentSettlementRandomState: nullable(uint32),
      nextHazardId: integer,
      nextOpponentSequence: integer,
      commands: Array.isArray,
    })(value)
  ) {
    throw new Error("Invalid simulation checkpoint");
  }
  const checkpoint = value as SimulationCheckpoint;
  const state = checkpoint.snapshot;
  const skirmish = state.mode === "skirmish";
  if (
    (state.opponent !== null) !== skirmish ||
    (state.opponentAI !== null) !== skirmish ||
    (state.startAreas !== null) !== skirmish ||
    (checkpoint.opponentSettlementRandomState !== null) !== skirmish ||
    state.settlement.ticks > state.tick ||
    (state.opponent && state.opponent.ticks > state.tick)
  ) {
    throw new Error("Inconsistent simulation checkpoint");
  }
  // Include queued, unexecuted commands, so saving while paused is lossless.
  validateReplay({
    version: 1,
    seed: state.seed,
    mode: state.mode,
    ticks: Math.max(state.tick, (checkpoint.commands.at(-1)?.tick ?? -1) + 1),
    commands: checkpoint.commands,
  });
  // The restored simulation must not share mutable state with its caller.
  return JSON.parse(JSON.stringify(checkpoint)) as SimulationCheckpoint;
}

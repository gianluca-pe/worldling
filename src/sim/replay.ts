export type Faction = "player" | "opponent";
export type GameMode = "sandbox" | "skirmish";

interface CommandMetadata {
  readonly tick: number;
  readonly sequence: number;
  readonly faction?: Faction;
}

export interface ProbeCommand extends CommandMetadata {
  readonly type: "probe";
}

export interface TerrainCommand extends CommandMetadata {
  readonly type: "raise-land" | "lower-land";
  readonly x: number;
  readonly y: number;
}

export interface RallyCommand extends CommandMetadata {
  readonly type: "rally";
  readonly x: number;
  readonly y: number;
}

export interface HazardCommand extends CommandMetadata {
  readonly type: "earthquake" | "flood";
  readonly x: number;
  readonly y: number;
}

export type SimulationCommand =
  ProbeCommand | TerrainCommand | RallyCommand | HazardCommand;

export interface Replay {
  readonly version: 1;
  readonly seed: number;
  readonly ticks: number;
  readonly mode?: GameMode;
  readonly commands: readonly SimulationCommand[];
}

function isUnsignedInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isValidAction(command: SimulationCommand): boolean {
  if (
    command.faction !== undefined &&
    command.faction !== "player" &&
    command.faction !== "opponent"
  ) {
    return false;
  }
  if (command.type === "probe") return true;
  if (
    !["raise-land", "lower-land", "rally", "earthquake", "flood"].includes(
      command.type,
    )
  )
    return false;
  return isUnsignedInteger(command.x) && isUnsignedInteger(command.y);
}

export function validateReplay(replay: Replay): Replay {
  if (replay.version !== 1) {
    throw new Error("Unsupported replay version");
  }
  if (
    !isUnsignedInteger(replay.seed) ||
    replay.seed > 0xff_ff_ff_ff ||
    !isUnsignedInteger(replay.ticks) ||
    (replay.mode !== undefined &&
      replay.mode !== "sandbox" &&
      replay.mode !== "skirmish")
  ) {
    throw new Error("Replay seed and tick count must be unsigned integers");
  }

  let previousTick = -1;
  let previousSequence = -1;
  for (const command of replay.commands) {
    if (
      !isUnsignedInteger(command.tick) ||
      !isUnsignedInteger(command.sequence) ||
      command.tick < previousTick ||
      command.sequence <= previousSequence ||
      command.tick >= replay.ticks ||
      !isValidAction(command)
    ) {
      throw new Error("Replay commands are invalid or not canonically ordered");
    }
    previousTick = command.tick;
    previousSequence = command.sequence;
  }

  return {
    version: 1,
    seed: replay.seed,
    ticks: replay.ticks,
    mode: replay.mode,
    commands: replay.commands.map((command) => ({ ...command })),
  };
}

export function parseReplay(serialized: string): Replay {
  return validateReplay(JSON.parse(serialized) as Replay);
}

export function serializeReplay(replay: Replay): string {
  return JSON.stringify(validateReplay(replay));
}

import { parseReplay } from "../sim/replay";
import { Simulation } from "../sim/simulation";

export const SESSION_STORAGE_KEY = "worldling.session.v1";

export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadSession(
  storage: SessionStorage | undefined,
): Simulation | null {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(SESSION_STORAGE_KEY);
    if (!serialized) return null;
    const payload: unknown = JSON.parse(serialized);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("version" in payload) ||
      (payload.version !== 1 && payload.version !== 2)
    ) {
      throw new Error("Unsupported saved session");
    }
    if (payload.version === 2) {
      if (!("checkpoint" in payload))
        throw new Error("Saved checkpoint is missing");
      return Simulation.fromCheckpoint(payload.checkpoint);
    }
    // Migrate existing replay-only saves, including matches over one hour.
    if (!("replay" in payload)) throw new Error("Saved replay is missing");
    const replay = JSON.stringify(payload.replay);
    if (!replay) throw new Error("Saved replay is missing");
    return Simulation.fromReplay(parseReplay(replay));
  } catch {
    clearSession(storage);
    return null;
  }
}

export function saveSession(
  storage: SessionStorage | undefined,
  simulation: Simulation,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ version: 2, checkpoint: simulation.toCheckpoint() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearSession(storage: SessionStorage | undefined): void {
  try {
    storage?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage is optional; gameplay must continue when it is unavailable.
  }
}

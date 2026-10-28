import { parseReplay } from "../sim/replay";
import type { Replay } from "../sim/replay";

export const SESSION_STORAGE_KEY = "worldling.session.v1";
export const MAX_SAVED_TICKS = 72_000;

export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadSession(
  storage: SessionStorage | undefined,
): Replay | null {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(SESSION_STORAGE_KEY);
    if (!serialized) return null;
    const payload: unknown = JSON.parse(serialized);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("version" in payload) ||
      payload.version !== 1 ||
      !("replay" in payload)
    ) {
      throw new Error("Unsupported saved session");
    }
    const replay = JSON.stringify(payload.replay);
    if (!replay) throw new Error("Saved replay is missing");
    const validated = parseReplay(replay);
    if (validated.ticks > MAX_SAVED_TICKS) {
      throw new Error("Saved session exceeds the one-hour recovery limit");
    }
    return validated;
  } catch {
    clearSession(storage);
    return null;
  }
}

export function saveSession(
  storage: SessionStorage | undefined,
  replay: Replay,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, replay }),
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

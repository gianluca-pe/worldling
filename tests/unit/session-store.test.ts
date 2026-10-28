import { describe, expect, it } from "vitest";
import {
  MAX_SAVED_TICKS,
  SESSION_STORAGE_KEY,
  clearSession,
  loadSession,
  saveSession,
} from "../../src/app/session-store";
import type { SessionStorage } from "../../src/app/session-store";
import type { Replay } from "../../src/sim/replay";

const replay: Replay = {
  version: 1,
  seed: 42,
  ticks: 2,
  mode: "skirmish",
  commands: [{ tick: 0, sequence: 0, type: "raise-land", x: 20, y: 20 }],
};

function memoryStorage(initial: string | null = null): SessionStorage {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
}

describe("session storage", () => {
  it("round-trips a replay", () => {
    const storage = memoryStorage();
    expect(saveSession(storage, replay)).toBe(true);
    expect(loadSession(storage)).toEqual(replay);
  });

  it.each(["not json", "null", '{"version":2}', '{"version":1}'])(
    "discards invalid data: %s",
    (serialized) => {
      const storage = memoryStorage(serialized);
      expect(loadSession(storage)).toBeNull();
      expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    },
  );

  it("discards a malformed replay", () => {
    const storage = memoryStorage(
      JSON.stringify({ version: 1, replay: { version: 1 } }),
    );
    expect(loadSession(storage)).toBeNull();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("rejects an unreasonably large recovery timeline", () => {
    const storage = memoryStorage(
      JSON.stringify({
        version: 1,
        replay: { ...replay, ticks: MAX_SAVED_TICKS + 1, commands: [] },
      }),
    );
    expect(loadSession(storage)).toBeNull();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("keeps gameplay available when storage fails", () => {
    const storage: SessionStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadSession(storage)).toBeNull();
    expect(saveSession(storage, replay)).toBe(false);
    expect(() => clearSession(storage)).not.toThrow();
    expect(loadSession(undefined)).toBeNull();
    expect(saveSession(undefined, replay)).toBe(false);
  });
});

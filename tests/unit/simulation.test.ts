import { describe, expect, it } from "vitest";
import { Simulation, runScenario } from "../../src/sim/simulation";
import type { Replay } from "../../src/sim/replay";
import { parseReplay, serializeReplay } from "../../src/sim/replay";

const scenario: Replay = {
  version: 1,
  seed: 123456,
  ticks: 200,
  commands: [
    { tick: 0, sequence: 0, type: "probe" },
    { tick: 20, sequence: 1, type: "probe" },
    { tick: 20, sequence: 2, type: "probe" },
    { tick: 199, sequence: 3, type: "probe" },
  ],
};

describe("deterministic scenarios", () => {
  it("produces identical snapshots for repeated runs", () => {
    expect(runScenario(scenario)).toEqual(runScenario(scenario));
  });

  it("survives replay serialization without changing the result", () => {
    const restored = parseReplay(serializeReplay(scenario));
    expect(runScenario(restored)).toEqual(runScenario(scenario));
  });

  it("uses different random streams for different seeds", () => {
    expect(runScenario(scenario)).not.toEqual(
      runScenario({ ...scenario, seed: scenario.seed + 1 }),
    );
  });

  it("does not consume randomness on empty ticks", () => {
    const simulation = new Simulation(42);
    const initialState = simulation.snapshot().randomState;
    simulation.advanceTo(1000);

    expect(simulation.snapshot()).toMatchObject({
      tick: 1000,
      randomState: initialState,
      probeCount: 0,
    });
  });

  it("applies same-tick commands in ascending sequence order", () => {
    const snapshot = runScenario({
      ...scenario,
      ticks: 21,
      commands: scenario.commands.slice(0, 3),
    });
    expect(snapshot).toMatchObject({ probeCount: 3, lastSequence: 2 });
  });

  it("preserves the version-1 golden scenario vector", () => {
    expect(
      runScenario({
        version: 1,
        seed: 0x47_4f_44,
        ticks: 120,
        commands: [
          { tick: 0, sequence: 0, type: "probe" },
          { tick: 30, sequence: 1, type: "probe" },
          { tick: 90, sequence: 2, type: "probe" },
        ],
      }),
    ).toMatchObject({
      seed: 4673348,
      tick: 120,
      randomState: 1204403491,
      probeCount: 3,
      lastProbeValue: 3221086688,
      lastSequence: 2,
    });
  });
});

describe("simulation restoration", () => {
  it("restores an exact skirmish and its future decisions", () => {
    const simulation = new Simulation(6, "skirmish");
    simulation.queue({
      tick: 0,
      sequence: 0,
      type: "earthquake",
      faction: "player",
      x: 32,
      y: 32,
    });
    simulation.queue({
      tick: 20,
      sequence: 1,
      type: "raise-land",
      faction: "player",
      x: 30,
      y: 30,
    });
    simulation.advanceTo(450);

    const restored = Simulation.fromReplay(simulation.toReplay());
    expect(restored.snapshot()).toEqual(simulation.snapshot());
    expect(restored.toReplay()).toEqual(simulation.toReplay());
    simulation.advanceTo(900);
    restored.advanceTo(900);
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  it("exports only commands that have already executed", () => {
    const simulation = new Simulation(1);
    simulation.queue({ tick: 4, sequence: 0, type: "probe" });
    simulation.advanceTo(2);
    expect(simulation.toReplay().commands).toEqual([]);
    simulation.advanceTo(5);
    expect(Simulation.fromReplay(simulation.toReplay()).snapshot()).toEqual(
      simulation.snapshot(),
    );
  });
});

describe("command and replay validation", () => {
  it("rejects commands sent into the past", () => {
    const simulation = new Simulation(1);
    simulation.advanceTo(2);
    expect(() =>
      simulation.queue({ tick: 1, sequence: 0, type: "probe" }),
    ).toThrow(/future ticks/);
  });

  it.each<[string, Replay["commands"]]>([
    [
      "decreasing ticks",
      [
        { tick: 2, sequence: 0, type: "probe" },
        { tick: 1, sequence: 1, type: "probe" },
      ],
    ],
    [
      "duplicate sequences",
      [
        { tick: 1, sequence: 0, type: "probe" },
        { tick: 1, sequence: 0, type: "probe" },
      ],
    ],
    [
      "decreasing sequences",
      [
        { tick: 1, sequence: 1, type: "probe" },
        { tick: 1, sequence: 0, type: "probe" },
      ],
    ],
    ["commands beyond the scenario", [{ tick: 3, sequence: 0, type: "probe" }]],
  ])("rejects %s", (_name, commands) => {
    expect(() =>
      runScenario({ version: 1, seed: 1, ticks: 3, commands }),
    ).toThrow();
  });

  it("rejects malformed serialized replay data", () => {
    expect(() => parseReplay("not json")).toThrow();
    expect(() => parseReplay('{"version":2}')).toThrow(
      "Unsupported replay version",
    );
    expect(() =>
      parseReplay(
        JSON.stringify({
          version: 1,
          seed: 42,
          ticks: 1,
          commands: [
            { tick: 0, sequence: 0, type: "not-a-command", x: 32, y: 32 },
          ],
        }),
      ),
    ).toThrow("invalid or not canonically ordered");
  });
});

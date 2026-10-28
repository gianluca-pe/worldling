import { runScenario } from "../src/sim/simulation";
import type { Replay } from "../src/sim/replay";

const scenario: Replay = {
  version: 1,
  seed: 0x47_4f_44,
  ticks: 120,
  commands: [
    { tick: 0, sequence: 0, type: "probe" },
    { tick: 30, sequence: 1, type: "probe" },
    { tick: 90, sequence: 2, type: "probe" },
  ],
};

console.log(JSON.stringify(runScenario(scenario), null, 2));

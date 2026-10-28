import "./style.css";
import { FixedStepClock } from "./app/fixed-step-clock";
import { clearSession, loadSession, saveSession } from "./app/session-store";
import type { SessionStorage } from "./app/session-store";
import { CanvasInput } from "./input/canvas-input";
import type { Tool } from "./input/canvas-input";
import { TerrainRenderer } from "./render/terrain-renderer";
import { HAZARD_RULES } from "./sim/hazards";
import { Simulation } from "./sim/simulation";
import type { SimulationSnapshot } from "./sim/simulation";

const TICK_MS = 50;
function parseSeed(value: string | null): number | null {
  if (!value || !/^[0-9a-fA-F]{1,8}$/.test(value.trim())) return null;
  return Number.parseInt(value.trim(), 16) >>> 0;
}
function randomSeed(): number {
  return window.crypto.getRandomValues(new Uint32Array(1))[0]!;
}
function formatSeed(seed: number): string {
  return seed.toString(16).toUpperCase();
}
let sessionStorage: SessionStorage | undefined;
try {
  sessionStorage = window.localStorage;
} catch {
  sessionStorage = undefined;
}
const requestedSeed = parseSeed(
  new URLSearchParams(window.location.search).get("seed"),
);
const restoredReplay =
  requestedSeed === null ? loadSession(sessionStorage) : null;
let simulation = restoredReplay
  ? Simulation.fromReplay(restoredReplay)
  : new Simulation(requestedSeed ?? randomSeed(), "skirmish");
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application root is missing");

app.innerHTML = `
  <main class="game-shell">
    <header class="topbar">
      <h1>Worldling</h1>
      <span class="faction-key"><span class="player">You: blue</span> · <span class="rival">Rival: red</span></span>
      <details class="seed" id="seed-menu">
        <summary>Island <span id="current-seed" data-testid="current-seed">${formatSeed(simulation.seed)}</span></summary>
        <form id="seed-form">
          <label for="seed-entry">Seed (hex)</label>
          <input id="seed-entry" name="seed" value="${formatSeed(simulation.seed)}" pattern="[0-9a-fA-F]{1,8}" maxlength="8" autocomplete="off" spellcheck="false" required />
          <div class="seed-actions">
            <button type="submit" data-testid="load-seed">Load seed</button>
            <button type="button" id="random-island" data-testid="random-island">New island</button>
          </div>
        </form>
      </details>
    </header>
    <section class="world" aria-label="Island skirmish">
      <canvas id="world" data-testid="world-canvas" tabindex="0" aria-label="Island terrain. Drag to pan, pinch to zoom, tap to use the selected tool. WASD moves the tile cursor and Enter applies it.">
        Your browser needs Canvas 2D to display the island.
      </canvas>
      <p class="selection-status" id="selection-status" role="status">Shape the land, grow your settlement, and defeat the rival.</p>
      <output class="zoom-level" id="zoom-level" data-testid="zoom-level" aria-label="Zoom level"></output>
      <div class="outcome" id="outcome-panel" role="status" hidden>
        <strong id="outcome-text"></strong>
        <button type="button" id="restart" data-testid="restart">Restart island</button>
      </div>
      <aside class="field-guide" id="field-guide" data-testid="field-guide" aria-labelledby="guide-title" hidden>
        <strong id="guide-title">Grow your blue settlement</strong>
        <p>Flatten land for homes. Full homes trigger expansion and house more settlers, who generate mana.</p>
        <p><b>Raise/Lower</b> shape land · <b>Rally</b> gathers settlers · <b>Quake/Flood</b> attack after a 5-second warning.</p>
        <p>Touch: drag to pan, pinch to zoom, tap to apply. Desktop: WASD moves the cursor; Enter applies.</p>
        <button type="button" id="dismiss-guide" data-testid="dismiss-guide">Got it</button>
      </aside>
    </section>
    <section class="toolbar" aria-label="Terrain tools">
      <div class="tool-group" role="group" aria-label="Selected tool">
        <button type="button" data-tool="inspect" aria-pressed="true">Inspect</button>
        <button type="button" data-tool="raise" aria-pressed="false">Raise</button>
        <button type="button" data-tool="lower" aria-pressed="false">Lower</button>
        <button type="button" data-tool="rally" aria-pressed="false">Rally</button>
        <button type="button" data-tool="earthquake" aria-label="Earthquake" aria-pressed="false">Quake</button>
        <button type="button" data-tool="flood" aria-pressed="false">Flood</button>
      </div>
      <div class="tool-group" role="group" aria-label="Camera and match controls">
        <button type="button" id="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" id="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" id="home" data-testid="home">Home</button>
        <button type="button" id="help" data-testid="help" aria-expanded="false" aria-controls="field-guide">Help</button>
        <button type="button" id="pause" data-testid="pause" aria-pressed="false">Pause</button>
        <button type="button" id="restart-match" data-testid="restart-match">Restart</button>
      </div>
      <div class="status-line">
        <span><strong id="mana-count" data-testid="mana-count">30</strong> mana</span>
        <span><strong id="population-count" data-testid="population-count">6</strong> people</span>
        <span><strong id="house-count" data-testid="house-count">0</strong> houses</span>
        <span>Rival <strong id="opponent-population" data-testid="opponent-population">6</strong> people · <strong id="opponent-houses" data-testid="opponent-houses">0</strong> houses</span>
        <span id="edit-count" data-testid="edit-count">0 edits</span>
        <span id="settlement-hint" data-testid="settlement-hint">Settlers gathering to build</span>
      </div>
    </section>
  </main>
`;

function required<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>("#world");
const status = required<HTMLParagraphElement>("#selection-status");
const zoomLevel = required<HTMLOutputElement>("#zoom-level");
const editCount = required<HTMLSpanElement>("#edit-count");
const manaCount = required<HTMLElement>("#mana-count");
const populationCount = required<HTMLElement>("#population-count");
const houseCount = required<HTMLElement>("#house-count");
const opponentPopulation = required<HTMLElement>("#opponent-population");
const opponentHouses = required<HTMLElement>("#opponent-houses");
const settlementHint = required<HTMLElement>("#settlement-hint");
const outcomePanel = required<HTMLDivElement>("#outcome-panel");
const outcomeText = required<HTMLElement>("#outcome-text");
const pauseButton = required<HTMLButtonElement>("#pause");
const toolButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-tool]"),
];
let selectedTool: Tool = "inspect";
let sequence = (restoredReplay?.commands.at(-1)?.sequence ?? -1) + 1;
let renderedSequence: number | null = null;
let savedSequence: number | null = null;
let lastSavedTick = simulation.snapshot().tick;
let paused = false;

function persistSession(): void {
  lastSavedTick = simulation.snapshot().tick;
  saveSession(sessionStorage, simulation.toReplay());
}

const renderer = new TerrainRenderer(canvas, () => {
  queueMicrotask(() => {
    zoomLevel.value = `${Math.round(renderer.camera.zoom * 100)}%`;
  });
});

const toolMessages: Record<Tool, string> = {
  inspect: "Inspect selected · tap a tile to read its height.",
  raise:
    "Raise selected · 3 mana; 5 from sea · tap or mouse-drag to reshape land.",
  lower: "Lower selected · 3 mana · tap or mouse-drag to reshape land.",
  rally: "Rally selected · tap suitable land to gather your followers.",
  earthquake: `Earthquake selected · ${HAZARD_RULES.earthquake.cost} mana · tap a target; strikes after 5s.`,
  flood: `Flood selected · ${HAZARD_RULES.flood.cost} mana · tap low ground; floods after 5s for 10s.`,
};

function selectTool(tool: Tool): void {
  selectedTool = tool;
  for (const button of toolButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
  }
  status.textContent = toolMessages[tool];
}

for (const button of toolButtons) {
  button.addEventListener("click", () =>
    selectTool(button.dataset.tool as Tool),
  );
}

const guide = required<HTMLElement>("#field-guide");
const helpButton = required<HTMLButtonElement>("#help");
const GUIDE_DISMISSED_KEY = "worldling.guide-dismissed.v1";
function setGuideVisible(visible: boolean): void {
  guide.hidden = !visible;
  helpButton.setAttribute("aria-expanded", String(visible));
}
function dismissGuide(): void {
  setGuideVisible(false);
  helpButton.focus();
  try {
    sessionStorage?.setItem(GUIDE_DISMISSED_KEY, "1");
  } catch {
    // The guide still closes when preferences cannot be stored.
  }
}
try {
  setGuideVisible(sessionStorage?.getItem(GUIDE_DISMISSED_KEY) !== "1");
} catch {
  setGuideVisible(true);
}
required<HTMLButtonElement>("#dismiss-guide").addEventListener(
  "click",
  dismissGuide,
);
helpButton.addEventListener("click", () =>
  setGuideVisible(Boolean(guide.hidden)),
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !guide.hidden) dismissGuide();
});

function zoomFromControls(factor: number): void {
  const bounds = canvas.getBoundingClientRect();
  renderer.zoomAt(factor, {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  });
}
required<HTMLButtonElement>("#zoom-in").addEventListener("click", () =>
  zoomFromControls(1.2),
);
required<HTMLButtonElement>("#zoom-out").addEventListener("click", () =>
  zoomFromControls(1 / 1.2),
);

function drawWorld(snapshot: SimulationSnapshot, time = 0): void {
  renderer.draw(
    snapshot.terrain,
    { ...snapshot.settlement, faction: "player" },
    time,
    snapshot.opponent
      ? { ...snapshot.opponent, faction: "opponent" }
      : undefined,
    snapshot.hazards,
    snapshot.seed,
  );
}

function updateInterface(snapshot: SimulationSnapshot, time = 0): void {
  manaCount.textContent = String(Math.floor(snapshot.settlement.mana));
  populationCount.textContent = String(snapshot.settlement.followers.length);
  houseCount.textContent = String(snapshot.settlement.houses.length);
  opponentPopulation.textContent = String(
    snapshot.opponent?.followers.length ?? 0,
  );
  opponentHouses.textContent = String(snapshot.opponent?.houses.length ?? 0);
  const capacity = snapshot.settlement.houses.reduce(
    (total, house) => total + house.level * 4,
    0,
  );
  const pending = snapshot.hazards.find(
    (hazard) => hazard.executeTick > snapshot.tick,
  );
  const activeFlood = snapshot.hazards.find(
    (hazard) => hazard.type === "flood" && hazard.executeTick <= snapshot.tick,
  );
  settlementHint.textContent = pending
    ? `${pending.faction === "player" ? "Your" : "Rival"} ${pending.type} at ${pending.target.x},${pending.target.y} · ${Math.ceil((pending.executeTick - snapshot.tick) / 20)}s`
    : activeFlood
      ? `Flood recedes at ${activeFlood.target.x},${activeFlood.target.y} · ${Math.ceil((activeFlood.endTick - snapshot.tick) / 20)}s`
      : snapshot.settlement.houses.length === 0
        ? "Settlers gathering to build · Rally chooses where"
        : snapshot.settlement.followers.length >= capacity
          ? "Houses full · settlers seeking new flat sites"
          : "Growing population · new building starts when houses fill";

  outcomePanel.hidden = snapshot.matchStatus === "playing";
  outcomeText.textContent =
    snapshot.matchStatus === "victory"
      ? "Victory — the rival settlement has fallen."
      : snapshot.matchStatus === "defeat"
        ? "Defeat — your settlement has fallen."
        : snapshot.matchStatus === "draw"
          ? "Draw — both settlements have fallen."
          : "";
  pauseButton.disabled = snapshot.matchStatus !== "playing";
  for (const button of toolButtons) {
    button.disabled = paused || snapshot.matchStatus !== "playing";
  }

  editCount.textContent = `${snapshot.editCount} ${snapshot.editCount === 1 ? "edit" : "edits"}`;
  if (snapshot.lastSequence !== renderedSequence) {
    renderedSequence = snapshot.lastSequence;
    if (snapshot.lastTerrainEdit?.sequence === renderedSequence) {
      const edit = snapshot.lastTerrainEdit;
      if (edit.type === "raise-land" || edit.type === "lower-land") {
        renderer.notifyTerrainEdit(edit, edit.type, time);
      }
      status.textContent =
        edit.type === "rally"
          ? `Followers rallying to ${edit.x}, ${edit.y}`
          : edit.type === "earthquake"
            ? `Earthquake gathering at ${edit.x}, ${edit.y}`
            : edit.type === "flood"
              ? `Flood gathering at ${edit.x}, ${edit.y}`
              : `Tile ${edit.x}, ${edit.y} · height ${edit.height}`;
    } else if (snapshot.lastRejectedEdit?.sequence === renderedSequence) {
      const edit = snapshot.lastRejectedEdit;
      status.textContent =
        edit.type === "rally"
          ? `Cannot rally to ${edit.x}, ${edit.y} · choose land above water`
          : edit.reason === "mana"
            ? `Not enough mana · ${Math.floor(snapshot.settlement.mana)} available`
            : edit.reason === "finished"
              ? "The match is not accepting commands."
              : `Tile ${edit.x}, ${edit.y} cannot be changed · height ${edit.height}`;
    }
  }
}

const input = new CanvasInput(canvas, renderer, {
  getTool: () => selectedTool,
  onTool: selectTool,
  onCursor: (tile) => {
    renderer.setSelected(tile);
    const snapshot = simulation.snapshot();
    const height =
      snapshot.terrain.heights[tile.y * snapshot.terrain.size + tile.x];
    status.textContent = `Cursor ${tile.x}, ${tile.y} · height ${height ?? "unknown"} · Enter to apply`;
  },
  onAction: (tile, tool) => {
    const snapshot = simulation.snapshot();
    if (paused || snapshot.matchStatus !== "playing") {
      status.textContent = paused
        ? "Resume the match to issue commands."
        : "The match has finished · restart to play again.";
      return;
    }
    renderer.setSelected(tile);
    if (tool === "inspect") {
      const height =
        snapshot.terrain.heights[tile.y * snapshot.terrain.size + tile.x];
      status.textContent = `Tile ${tile.x}, ${tile.y} · height ${height ?? "unknown"}`;
      return;
    }

    simulation.queue({
      tick: snapshot.tick,
      sequence: sequence++,
      type:
        tool === "raise"
          ? "raise-land"
          : tool === "lower"
            ? "lower-land"
            : tool,
      faction: "player",
      x: tile.x,
      y: tile.y,
    });
    renderer.invalidate();
  },
});

const clock = new FixedStepClock(TICK_MS);
function frame(time: number): void {
  let advanced = false;
  const steps = clock.advance(time, () => {
    if (!paused && simulation.status === "playing") {
      simulation.advanceTo(simulation.currentTick + 1);
      advanced = true;
    }
  });

  let snapshot: SimulationSnapshot | null = null;
  if (steps > 0) {
    snapshot = simulation.snapshot();
    updateInterface(snapshot, time);
    if (
      snapshot.lastSequence !== savedSequence ||
      (advanced &&
        (Math.floor(snapshot.tick / 100) > Math.floor(lastSavedTick / 100) ||
          snapshot.matchStatus !== "playing"))
    ) {
      persistSession();
      savedSequence = snapshot.lastSequence;
    }
    if (advanced && snapshot.tick % 2 === 0) renderer.invalidate();
  }
  if (renderer.needsRender) drawWorld(snapshot ?? simulation.snapshot(), time);
  requestAnimationFrame(frame);
}

pauseButton.addEventListener("click", () => {
  paused = !paused;
  pauseButton.textContent = paused ? "Resume" : "Pause";
  pauseButton.setAttribute("aria-pressed", String(paused));
  clock.reset();
  input.reset();
  updateInterface(simulation.snapshot());
});

function startIsland(seed: number): void {
  clearSession(sessionStorage);
  simulation = new Simulation(seed, "skirmish");
  sequence = 0;
  renderedSequence = null;
  savedSequence = null;
  lastSavedTick = 0;
  paused = false;
  pauseButton.textContent = "Pause";
  pauseButton.setAttribute("aria-pressed", "false");
  clock.reset();
  input.reset();
  renderer.resetView(simulation.snapshot().settlement.banner);
  input.resetCursor();
  selectTool("inspect");
  updateInterface(simulation.snapshot());
  required<HTMLElement>("#current-seed").textContent = formatSeed(seed);
  required<HTMLInputElement>("#seed-entry").value = formatSeed(seed);
  required<HTMLDetailsElement>("#seed-menu").open = false;
  window.history.replaceState(null, "", window.location.pathname);
  drawWorld(simulation.snapshot());
}

function restartMatch(): void {
  startIsland(simulation.seed);
}

required<HTMLButtonElement>("#restart").addEventListener("click", restartMatch);
required<HTMLButtonElement>("#restart-match").addEventListener(
  "click",
  restartMatch,
);
required<HTMLFormElement>("#seed-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const seed = parseSeed(required<HTMLInputElement>("#seed-entry").value);
  if (seed === null) return;
  startIsland(seed);
  status.textContent = `Island ${formatSeed(seed)} loaded`;
});
required<HTMLButtonElement>("#random-island").addEventListener("click", () => {
  const seed = randomSeed();
  startIsland(seed);
  status.textContent = `New island ${formatSeed(seed)}`;
});
required<HTMLButtonElement>("#home").addEventListener("click", () => {
  renderer.resetView(simulation.snapshot().settlement.banner);
});

function resetTransientState(): void {
  clock.reset();
  input.reset();
  renderer.invalidate();
}

document.addEventListener("visibilitychange", resetTransientState);
window.addEventListener("pagehide", () => {
  const snapshot = simulation.snapshot();
  if (!paused && snapshot.matchStatus === "playing") {
    simulation.advanceTo(snapshot.tick + 1);
  }
  persistSession();
  resetTransientState();
});
window.addEventListener("pageshow", resetTransientState);

const initialSnapshot = simulation.snapshot();
renderer.resetView(initialSnapshot.settlement.banner);
updateInterface(initialSnapshot);
if (restoredReplay) {
  status.textContent = `Island restored · ${initialSnapshot.tick / 20}s elapsed`;
}
drawWorld(initialSnapshot);
requestAnimationFrame(frame);

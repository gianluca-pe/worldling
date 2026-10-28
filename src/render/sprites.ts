export type Facing = "up" | "down" | "left" | "right";

export interface SpriteSet {
  followers: Record<Facing, HTMLCanvasElement[][]>;
  houses: HTMLCanvasElement[];
  construction: HTMLCanvasElement[];
  rocks: HTMLCanvasElement[];
  trees: HTMLCanvasElement[];
  opponentFollowers: Record<Facing, HTMLCanvasElement[][]>;
}

type PixelMap = readonly string[];

export function constructionStage(dwell: number): 0 | 1 | 2 {
  return dwell < 20 ? 0 : dwell < 45 ? 1 : 2;
}

const facings: readonly Facing[] = ["up", "down", "left", "right"];

const palette: Readonly<Record<string, string>> = {
  H: "#38251f",
  S: "#e7ad72",
  N: "#bd784e",
  E: "#20232b",
  T: "#a58b62",
  L: "#4f4133",
  A: "#527ba0",
  R: "#8f493b",
  U: "#c06a46",
  B: "#39333a",
  W: "#c2bda3",
  G: "#75a7ad",
  D: "#694637",
  C: "#70636a",
  M: "#a6a58e",
  V: "#555c52",
  F: "#426b3f",
  P: "#78964a",
};

const followerBodies: Record<Facing, readonly string[]> = {
  up: [
    "....H....",
    "...HHH...",
    "..HHHHH..",
    "..HHHHH..",
    "..HHHHH..",
    "...SSS...",
  ],
  down: [
    "....H....",
    "...HHH...",
    "..HHHHH..",
    "..HSSSH..",
    "..SESES..",
    "...SSS...",
  ],
  left: [
    "....H....",
    "...HHH...",
    "..HHHHH..",
    "..HHSSS..",
    "..HESN...",
    "...SSS...",
  ],
  right: [
    "....H....",
    "...HHH...",
    "..HHHHH..",
    "..SSSHH..",
    "...NSEH..",
    "...SSS...",
  ],
};

const sharedTorso = [
  "..TTTTT..",
  ".STTTTTS.",
  "..TTATT..",
  "..TTTTT..",
] as const;
const walkLegs = [
  ["..LL.LL..", "..LL.LL..", ".LLL.LLL."],
  ["...LLL...", "..LL.LL..", "..LL.LL.."],
] as const;

const followerPalettes: readonly Readonly<Record<string, string>>[] = [
  { T: "#a58b62", H: "#38251f", S: "#e7ad72", L: "#4f4133" },
  { T: "#8b8b68", H: "#6b4a32", S: "#c88f62", L: "#514536" },
  { T: "#b2a78a", H: "#d0b078", S: "#8f5f46", L: "#454139" },
  { T: "#7f8166", H: "#312a27", S: "#e0b087", L: "#5b4b3b" },
];

function makeFollowerFrames(facing: Facing): readonly [PixelMap, PixelMap] {
  return [
    [...followerBodies[facing], ...sharedTorso, ...walkLegs[0]],
    [...followerBodies[facing], ...sharedTorso, ...walkLegs[1]],
  ];
}

const followerDefinitions: Record<Facing, readonly [PixelMap, PixelMap]> = {
  up: makeFollowerFrames("up"),
  down: makeFollowerFrames("down"),
  left: makeFollowerFrames("left"),
  right: makeFollowerFrames("right"),
};

type MutablePixelMap = string[][];
type PixelPoint = readonly [number, number];

function blankMap(width: number, height: number): MutablePixelMap {
  return Array.from({ length: height }, () => Array<string>(width).fill("."));
}

function paintRect(
  map: MutablePixelMap,
  x: number,
  y: number,
  width: number,
  height: number,
  symbol: string,
): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      if (map[py]?.[px] !== undefined) map[py]![px] = symbol;
    }
  }
}

function paintLine(
  map: MutablePixelMap,
  from: PixelPoint,
  to: PixelPoint,
  symbol: string,
): void {
  let [x, y] = from;
  const [targetX, targetY] = to;
  const dx = Math.abs(targetX - x);
  const dy = -Math.abs(targetY - y);
  const stepX = x < targetX ? 1 : -1;
  const stepY = y < targetY ? 1 : -1;
  let error = dx + dy;
  while (true) {
    if (map[y]?.[x] !== undefined) map[y]![x] = symbol;
    if (x === targetX && y === targetY) break;
    const twice = error * 2;
    if (twice >= dy) {
      error += dy;
      x += stepX;
    }
    if (twice <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

function paintPolygon(
  map: MutablePixelMap,
  points: readonly PixelPoint[],
  symbol: string,
): void {
  for (let y = 0; y < map.length; y += 1) {
    for (let x = 0; x < (map[y]?.length ?? 0); x += 1) {
      let inside = false;
      for (
        let index = 0, previous = points.length - 1;
        index < points.length;
        previous = index++
      ) {
        const current = points[index]!;
        const other = points[previous]!;
        if (
          current[1] > y !== other[1] > y &&
          x <
            ((other[0] - current[0]) * (y - current[1])) /
              (other[1] - current[1]) +
              current[0]
        ) {
          inside = !inside;
        }
      }
      if (inside) map[y]![x] = symbol;
    }
  }
}

function paintWindow(map: MutablePixelMap, x: number, y: number): void {
  paintRect(map, x, y, 4, 5, "B");
  paintRect(map, x + 1, y + 1, 2, 3, "G");
  paintLine(map, [x + 2, y + 1], [x + 2, y + 3], "D");
}

function addMasonry(map: MutablePixelMap): void {
  for (let y = 0; y < map.length; y += 1) {
    for (let x = 0; x < (map[y]?.length ?? 0); x += 1) {
      const symbol = map[y]![x];
      if (symbol !== "W" && symbol !== "C") continue;
      if (y % 3 === 0 && x % 3 !== 0) map[y]![x] = "V";
      if (y % 3 !== 0 && (x + Math.floor(y / 3) * 2) % 5 === 0) {
        map[y]![x] = "M";
      }
    }
  }
}

function makeHouseDefinition(level: 1 | 2 | 3, complete = true): PixelMap {
  const width = [0, 26, 34, 44][level]!;
  const height = [0, 27, 33, 41][level]!;
  const equator = [0, 9, 11, 13][level]!;
  const roofBottom = [0, 17, 21, 27][level]!;
  const map = blankMap(width, height);
  const center = Math.floor(width / 2);
  const left = 1;
  const right = width - 2;
  const base = height - 2;
  const top: PixelPoint = [center, 1];
  const leftPoint: PixelPoint = [left, equator];
  const rightPoint: PixelPoint = [right, equator];
  const bottom: PixelPoint = [center, roofBottom];
  const leftBase: PixelPoint = [left, base - (roofBottom - equator)];
  const rightBase: PixelPoint = [right, base - (roofBottom - equator)];
  const bottomBase: PixelPoint = [center, base];

  paintPolygon(map, [leftPoint, bottom, bottomBase, leftBase], "C");
  paintPolygon(map, [bottom, rightPoint, rightBase, bottomBase], "W");
  addMasonry(map);
  paintLine(map, leftPoint, leftBase, "D");
  paintLine(map, rightPoint, rightBase, "D");
  paintLine(map, bottom, bottomBase, "D");
  paintLine(map, [left + 2, equator + 3], [center - 2, roofBottom + 3], "D");
  if (level >= 2) {
    paintLine(map, [right - 2, equator + 3], [center + 2, roofBottom + 3], "D");
  }

  const windowRows = level === 1 ? [0] : level === 2 ? [0, 5] : [0, 5, 10];
  for (const offset of windowRows) {
    const y = equator + 3 + offset;
    if (y + 5 < base - 4) {
      paintWindow(map, left + 2, y);
      paintWindow(map, right - 5, y);
    }
  }
  paintRect(map, center - 1, base - 6, 4, 7, "B");
  paintRect(map, center, base - 5, 2, 6, "D");
  paintRect(map, center - 1, base, 4, 1, "M");
  paintLine(map, leftBase, bottomBase, "B");
  paintLine(map, bottomBase, rightBase, "B");

  if (complete) {
    const apex: PixelPoint = [center, 6];
    paintPolygon(map, [leftPoint, top, apex], "R");
    paintPolygon(map, [top, rightPoint, apex], "R");
    paintPolygon(map, [rightPoint, bottom, apex], "U");
    paintPolygon(map, [bottom, leftPoint, apex], "R");
    for (let y = 1; y < roofBottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (
          (map[y]?.[x] === "R" || map[y]?.[x] === "U") &&
          (x + y * 2) % 7 === 0
        ) {
          map[y]![x] = "R";
        }
      }
    }
    paintLine(map, top, rightPoint, "B");
    paintLine(map, rightPoint, bottom, "B");
    paintLine(map, bottom, leftPoint, "B");
    paintLine(map, leftPoint, top, "B");
    paintLine(map, apex, bottom, "R");
    paintRect(map, right - 7, 2, 3, 7, "C");
    paintRect(map, right - 8, 1, 5, 2, "B");
    if (level === 3) {
      for (const x of [center - 10, center + 6]) {
        paintRect(map, x, equator - 1, 5, 5, "W");
        paintWindow(map, x, equator - 1);
        paintLine(map, [x - 1, equator - 1], [x + 2, equator - 4], "R");
        paintLine(map, [x + 2, equator - 4], [x + 5, equator - 1], "R");
      }
    }
  } else {
    paintLine(map, [0, equator], [0, base], "D");
    paintLine(map, [width - 1, equator], [width - 1, base], "D");
    paintLine(map, [0, equator + 4], [width - 1, equator + 4], "D");
    paintLine(map, [0, base - 3], [width - 1, base - 3], "D");
  }
  return map.map((row) => row.join(""));
}

const houseDefinitions: readonly PixelMap[] = [
  makeHouseDefinition(1),
  makeHouseDefinition(2),
  makeHouseDefinition(3),
];

function makeFoundationDefinition(): PixelMap {
  const map = blankMap(26, 12);
  const corners: PixelPoint[] = [
    [13, 1],
    [24, 5],
    [13, 10],
    [2, 5],
  ];
  paintPolygon(map, corners, "V");
  for (let index = 0; index < corners.length; index += 1) {
    paintLine(map, corners[index]!, corners[(index + 1) % 4]!, "M");
    const [x, y] = corners[index]!;
    paintRect(map, x - 1, y - 1, 2, 3, "D");
  }
  paintLine(map, [6, 5], [18, 5], "W");
  paintLine(map, [13, 3], [13, 8], "W");
  return map.map((row) => row.join(""));
}

function makeFrameDefinition(): PixelMap {
  const map = blankMap(26, 27);
  const top: PixelPoint = [13, 1];
  const left: PixelPoint = [1, 9];
  const right: PixelPoint = [24, 9];
  const bottom: PixelPoint = [13, 17];
  const leftBase: PixelPoint = [1, 17];
  const rightBase: PixelPoint = [24, 17];
  const bottomBase: PixelPoint = [13, 25];
  paintLine(map, leftBase, bottomBase, "M");
  paintLine(map, bottomBase, rightBase, "M");
  for (const [roof, ground] of [
    [left, leftBase],
    [right, rightBase],
    [bottom, bottomBase],
  ] as const) {
    paintLine(map, roof, ground, "D");
  }
  paintLine(map, left, top, "D");
  paintLine(map, top, right, "D");
  paintLine(map, left, bottom, "D");
  paintLine(map, right, bottom, "D");
  paintLine(map, left, bottomBase, "D");
  paintLine(map, right, bottomBase, "D");
  paintLine(map, [5, 12], [17, 22], "D");
  paintLine(map, [20, 12], [9, 22], "D");
  return map.map((row) => row.join(""));
}

const constructionDefinitions: readonly PixelMap[] = [
  makeFoundationDefinition(),
  makeFrameDefinition(),
  makeHouseDefinition(1, false),
];

const rockDefinitions: readonly PixelMap[] = [
  [
    "........MM..........",
    ".......MCCC.........",
    "......MMCCCV........",
    ".....MMMCCVV........",
    "....MMMMCCCVV.......",
    "...MMMMMCCCVVV......",
    "..MMMMMMCCCVVVV.....",
    ".MMMMMMMMCCCVVVVV...",
    "MMMMMMMMMMCCCVVVVVV.",
    "MMMMMMMMMMCCCVVVVVVV",
    "MMMMMMMMMMCCCVVVVVVV",
    "MMMMMMMMMMMCCVVVVVVV",
    "MMMMMMMMMMMCCVVVVVVV",
    "MMMMMMMMMMMMCVVVVVVV",
    "MMMMMMMMMMMMCVVVVVVV",
    "MMMMMMMMMMMMMCVVVVVV",
    ".MMMMMMMMMMMMCVVVVV.",
    "..VVVVVVVVVVVVVVVV..",
  ],
];

function paintDisc(
  map: MutablePixelMap,
  centerX: number,
  centerY: number,
  radius: number,
  symbol: string,
): void {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (
        (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2 &&
        map[y]?.[x] !== undefined
      ) {
        map[y]![x] = symbol;
      }
    }
  }
}

function makeConiferDefinition(): PixelMap {
  const map = blankMap(18, 28);
  paintRect(map, 8, 7, 2, 20, "D");
  paintLine(map, [8, 26], [5, 27], "D");
  paintLine(map, [9, 26], [12, 27], "D");
  for (const points of [
    [
      [9, 1],
      [5, 8],
      [7, 7],
      [3, 12],
      [15, 12],
      [11, 7],
      [13, 8],
    ],
    [
      [9, 6],
      [3, 15],
      [6, 14],
      [1, 20],
      [17, 20],
      [12, 14],
      [15, 15],
    ],
    [
      [9, 11],
      [4, 18],
      [6, 18],
      [2, 24],
      [16, 24],
      [12, 18],
      [14, 18],
    ],
  ] as const) {
    paintPolygon(map, points, "F");
  }
  paintPolygon(
    map,
    [
      [8, 4],
      [6, 9],
      [8, 8],
      [5, 13],
      [9, 11],
      [10, 7],
    ],
    "P",
  );
  paintPolygon(
    map,
    [
      [7, 12],
      [5, 17],
      [7, 16],
      [5, 21],
      [9, 18],
      [10, 14],
    ],
    "P",
  );
  return map.map((row) => row.join(""));
}

function makeBroadleafDefinition(): PixelMap {
  const map = blankMap(24, 28);
  paintRect(map, 11, 12, 3, 14, "D");
  paintLine(map, [12, 16], [6, 8], "D");
  paintLine(map, [13, 15], [19, 7], "D");
  paintLine(map, [12, 25], [8, 27], "D");
  paintLine(map, [13, 25], [17, 27], "D");
  for (const [x, y, radius] of [
    [12, 7, 6],
    [7, 10, 5],
    [17, 10, 5],
    [12, 13, 5],
  ] as const) {
    paintDisc(map, x, y, radius, "F");
  }
  paintDisc(map, 10, 5, 4, "P");
  paintDisc(map, 6, 8, 3, "P");
  paintDisc(map, 15, 8, 3, "P");
  paintDisc(map, 9, 12, 3, "P");
  for (const [x, y] of [
    [4, 12],
    [8, 15],
    [15, 14],
    [19, 11],
    [12, 8],
    [10, 17],
  ] as const) {
    map[y]![x] = ".";
  }
  paintLine(map, [12, 16], [12, 24], "D");
  paintLine(map, [12, 17], [8, 13], "D");
  return map.map((row) => row.join(""));
}

const treeDefinitions: readonly PixelMap[] = [
  makeConiferDefinition(),
  makeBroadleafDefinition(),
];

function validateMap(
  label: string,
  map: PixelMap,
  minWidth: number,
  maxWidth: number,
  minHeight: number,
  maxHeight: number,
): void {
  if (map.length < minHeight || map.length > maxHeight) {
    throw new Error(`${label} must be ${minHeight}–${maxHeight} pixels high`);
  }

  const width = map[0]?.length ?? 0;
  if (width < minWidth || width > maxWidth) {
    throw new Error(`${label} must be ${minWidth}–${maxWidth} pixels wide`);
  }

  for (const [rowIndex, row] of map.entries()) {
    if (row.length !== width) {
      throw new Error(`${label} row ${rowIndex} is not rectangular`);
    }
    for (const symbol of row) {
      if (symbol !== "." && !(symbol in palette)) {
        throw new Error(`${label} uses unknown palette symbol ${symbol}`);
      }
    }
  }
}

export function validateSpriteDefinitions(): void {
  for (const facing of facings) {
    const frames = followerDefinitions[facing];
    if (frames.length !== 2) {
      throw new Error(`${facing} follower must have exactly two walk frames`);
    }
    for (const [index, frame] of frames.entries()) {
      validateMap(`${facing} follower frame ${index}`, frame, 8, 10, 11, 13);
    }
    if (frames[0].join("\n") === frames[1].join("\n")) {
      throw new Error(`${facing} follower walk frames must differ`);
    }
  }

  if (houseDefinitions.length !== 3) {
    throw new Error("Exactly three house tiers are required");
  }
  for (const [index, house] of houseDefinitions.entries()) {
    validateMap(`house tier ${index + 1}`, house, 26, 44, 27, 41);
  }
  for (const [index, stage] of constructionDefinitions.entries()) {
    validateMap(`construction stage ${index + 1}`, stage, 26, 26, 12, 27);
  }
  for (const [index, rock] of rockDefinitions.entries()) {
    validateMap(`rock ${index + 1}`, rock, 20, 24, 18, 24);
  }
  for (const [index, tree] of treeDefinitions.entries()) {
    validateMap(`tree ${index + 1}`, tree, 16, 24, 24, 30);
  }
}

function renderMap(
  map: PixelMap,
  overrides: Readonly<Record<string, string>> = {},
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = map[0]!.length;
  canvas.height = map.length;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("A 2D canvas context is required to create sprites");
  }
  context.imageSmoothingEnabled = false;

  for (const [y, row] of map.entries()) {
    for (const [x, symbol] of [...row].entries()) {
      if (symbol === ".") continue;
      context.fillStyle = overrides[symbol] ?? palette[symbol]!;
      context.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

export function createSpriteSet(): SpriteSet {
  validateSpriteDefinitions();
  return {
    followers: Object.fromEntries(
      facings.map((facing) => [
        facing,
        followerPalettes.map((colors) =>
          followerDefinitions[facing].map((frame) => renderMap(frame, colors)),
        ),
      ]),
    ) as Record<Facing, HTMLCanvasElement[][]>,
    houses: houseDefinitions.map((house) => renderMap(house)),
    construction: constructionDefinitions.map((stage) => renderMap(stage)),
    rocks: rockDefinitions.map((rock) => renderMap(rock)),
    trees: treeDefinitions.map((tree) => renderMap(tree)),
    opponentFollowers: Object.fromEntries(
      facings.map((facing) => [
        facing,
        followerPalettes.map((colors) =>
          followerDefinitions[facing].map((frame) =>
            renderMap(frame, { ...colors, A: "#a94f3d" }),
          ),
        ),
      ]),
    ) as Record<Facing, HTMLCanvasElement[][]>,
  };
}

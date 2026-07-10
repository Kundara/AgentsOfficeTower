export type ScenePaletteInput = {
  floor?: unknown;
  wall?: unknown;
  board?: unknown;
};

export type ScenePaletteBase = {
  floor: string;
  wall: string;
  board: string;
};

export const DEFAULT_WORKSPACE_SCENE_COLORS: ScenePaletteBase = {
  floor: "#2f8fdf",
  wall: "#dceefe",
  board: "#16352c"
};

export const DEFAULT_CAFE_SCENE_COLORS: ScenePaletteBase = {
  floor: "#c78355",
  wall: "#b95e45",
  board: "#16352c"
};

const RELATIVE_SHADE_LIMIT = 0.28;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeSceneHex(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return HEX_COLOR.test(normalized) ? normalized : fallback;
}

export function relativeSceneHex(value: string, amount: number): string {
  const color = normalizeSceneHex(value, "#000000");
  const bounded = Math.max(-RELATIVE_SHADE_LIMIT, Math.min(RELATIVE_SHADE_LIMIT, Number(amount) || 0));
  const ratio = Math.abs(bounded);
  const target = bounded >= 0 ? 255 : 0;
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  return "#" + channels
    .map((channel) => Math.round(channel + (target - channel) * ratio).toString(16).padStart(2, "0"))
    .join("");
}

export function sceneHexToNumber(value: string): number {
  return Number.parseInt(normalizeSceneHex(value, "#000000").slice(1), 16);
}

export function normalizeScenePaletteInput(
  input: ScenePaletteInput | null | undefined,
  defaults: ScenePaletteBase = DEFAULT_WORKSPACE_SCENE_COLORS
): ScenePaletteBase {
  return {
    floor: normalizeSceneHex(input?.floor, defaults.floor),
    wall: normalizeSceneHex(input?.wall, defaults.wall),
    board: normalizeSceneHex(input?.board, defaults.board)
  };
}

export function deriveScenePalette(
  input: ScenePaletteInput | null | undefined,
  defaults: ScenePaletteBase = DEFAULT_WORKSPACE_SCENE_COLORS
) {
  const base = normalizeScenePaletteInput(input, defaults);
  const hex = {
    floorBase: base.floor,
    floorLight: relativeSceneHex(base.floor, 0.1),
    floorDark: relativeSceneHex(base.floor, -0.08),
    floorSeam: relativeSceneHex(base.floor, -0.16),
    floorBorder: relativeSceneHex(base.floor, -0.26),
    wallBase: base.wall,
    wallMural: relativeSceneHex(base.wall, 0.12),
    wallBorder: relativeSceneHex(base.wall, -0.24),
    boardBase: base.board,
    boardDark: relativeSceneHex(base.board, -0.24),
    boardLight: relativeSceneHex(base.board, 0.22)
  };
  return {
    base,
    hex,
    pixi: Object.fromEntries(
      Object.entries(hex).map(([key, value]) => [key, sceneHexToNumber(value)])
    ) as Record<keyof typeof hex, number>
  };
}

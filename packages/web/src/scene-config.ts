export interface GlobalSceneSettings {
  textScale: number;
  debugTiles: boolean;
}

export interface InternalSceneSettings {
  tileSizePx: number;
  compactTileSizePx: number;
  deskAreaStartRatio: number;
  wallDepthTiles: number;
  deskColumnGapTiles: number;
  deskGroupGapTiles: number;
  deskRowsPerColumn: number;
  deskPodWidthTiles: number;
  deskPodHeightTiles: number;
  deskPodCapacity: number;
  bossLaneStartTiles: number;
  bossLaneWidthTiles: number;
  bossGapToDeskTiles: number;
  bossBoothWidthTiles: number;
  bossBoothHeightTiles: number;
  bossBoothGapTiles: number;
  recAreaFurnitureRow: number;
  recAreaWalkwayRow: number;
  recAreaMaxDepthTiles: number;
  minTextScale: number;
  maxTextScale: number;
}

export const DEFAULT_GLOBAL_SCENE_SETTINGS: GlobalSceneSettings = {
  textScale: 1,
  debugTiles: false
};

export const INTERNAL_SCENE_SETTINGS: InternalSceneSettings = {
  tileSizePx: 16,
  compactTileSizePx: 16,
  deskAreaStartRatio: 0.2,
  wallDepthTiles: 3,
  deskColumnGapTiles: 4,
  deskGroupGapTiles: 1,
  deskRowsPerColumn: 3,
  deskPodWidthTiles: 6,
  deskPodHeightTiles: 3,
  deskPodCapacity: 2,
  bossLaneStartTiles: 1,
  bossLaneWidthTiles: 3,
  bossGapToDeskTiles: 1,
  bossBoothWidthTiles: 3,
  bossBoothHeightTiles: 2,
  bossBoothGapTiles: 1,
  recAreaFurnitureRow: 1,
  recAreaWalkwayRow: 2,
  recAreaMaxDepthTiles: 2,
  minTextScale: 0.75,
  maxTextScale: 2
};

export function clampSceneTextScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_GLOBAL_SCENE_SETTINGS.textScale;
  }
  const rounded = Math.round(value * 100) / 100;
  return Math.min(INTERNAL_SCENE_SETTINGS.maxTextScale, Math.max(INTERNAL_SCENE_SETTINGS.minTextScale, rounded));
}

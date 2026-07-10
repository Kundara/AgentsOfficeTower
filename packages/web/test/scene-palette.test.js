const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_WORKSPACE_SCENE_COLORS,
  deriveScenePalette,
  normalizeScenePaletteInput,
  relativeSceneHex
} = require("../dist/client/runtime/scene-palette.js");

test("scene palette normalizes editable base colors and falls back safely", () => {
  assert.deepEqual(normalizeScenePaletteInput({
    floor: "#123ABC",
    wall: "not-a-color",
    board: " #abcdef "
  }), {
    floor: "#123abc",
    wall: DEFAULT_WORKSPACE_SCENE_COLORS.wall,
    board: "#abcdef"
  });
});

test("scene palette derives bounded relative shades", () => {
  assert.equal(relativeSceneHex("#4080c0", 0.9), relativeSceneHex("#4080c0", 0.28));
  assert.equal(relativeSceneHex("#4080c0", -0.9), relativeSceneHex("#4080c0", -0.28));

  const palette = deriveScenePalette({ floor: "#4080c0", wall: "#d0e0f0", board: "#204030" });
  assert.equal(palette.base.floor, "#4080c0");
  assert.notEqual(palette.hex.floorLight, palette.base.floor);
  assert.notEqual(palette.hex.floorDark, palette.base.floor);
  assert.equal(palette.pixi.floorBase, 0x4080c0);
});

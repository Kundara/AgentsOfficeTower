const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const EasyStar = require("easystarjs");

function runtimeSource() {
  const source = readFileSync(join(__dirname, "../src/client/runtime/navigation-pathing-source.ts"), "utf8").trim();
  const prefix = "export const CLIENT_RUNTIME_NAVIGATION_PATHING_SOURCE = ";
  assert.ok(source.startsWith(prefix));
  return Function(`"use strict"; return (${source.slice(prefix.length, -1).trim()});`)();
}

function harness(easyStar = null) {
  const officeAvatarFootTile = (room, tileSize, x, y, width, height) => {
    return {
      column: Math.max(0, Math.floor((x + width / 2 - room.x) / tileSize)),
      row: Math.max(0, Math.floor((y + height - 1 - room.floorTop) / tileSize))
    };
  };
  return Function(
    "window",
    "HTMLElement",
    "officeMapHoverTarget",
    "officeAvatarFootTile",
    "scheduleOfficeMapHoverPosition",
    `${runtimeSource()}
return { solveEasyStarPath, buildAgentPixelRoute };`
  )(
    { EasyStar: easyStar },
    class {},
    null,
    officeAvatarFootTile,
    () => {}
  );
}

test("EasyStar resolves synchronously and uses a direct diagonal across open floor", () => {
  const { solveEasyStarPath } = harness(EasyStar);
  const nav = navigation(Array.from({ length: 5 }, () => Array(5).fill(0)));
  const path = solveEasyStarPath(nav, { column: 0, row: 0 }, { column: 4, row: 4 });

  assert.equal(JSON.stringify(path), JSON.stringify([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
    { x: 4, y: 4 }
  ]));
});

function navigation(grid) {
  return {
    grid,
    rows: grid.length,
    columns: grid[0].length
  };
}

test("EasyStar does not squeeze diagonally between blocked tiles", () => {
  const { solveEasyStarPath } = harness(EasyStar);
  const nav = navigation([
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 0]
  ]);

  assert.equal(solveEasyStarPath(nav, { column: 0, row: 0 }, { column: 2, row: 2 }), null);
});

test("unreachable grounded routes hold the exact current pose instead of cutting through obstacles", () => {
  const { buildAgentPixelRoute } = harness();
  const nav = navigation([
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0]
  ]);
  const room = { x: 0, floorTop: 0 };
  const exactStart = { x: 3, y: 5 };
  const route = buildAgentPixelRoute(
    nav,
    { column: 0, row: 1 },
    { column: 2, row: 1 },
    room,
    16,
    8,
    12,
    { x: 35, y: 21 },
    exactStart
  );

  assert.equal(JSON.stringify(route), JSON.stringify([exactStart]));
});

test("a docked pose keeps its walkable egress tile before following the grid route", () => {
  const { buildAgentPixelRoute } = harness(EasyStar);
  const nav = navigation([
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ]);
  const room = { x: 0, floorTop: 0 };
  const exactStart = { x: 19, y: 5 };
  const route = buildAgentPixelRoute(
    nav,
    { column: 0, row: 1 },
    { column: 3, row: 1 },
    room,
    16,
    8,
    12,
    { x: 51, y: 21 },
    exactStart
  );

  assert.equal(JSON.stringify(route[0]), JSON.stringify(exactStart));
  assert.equal(JSON.stringify(route[1]), JSON.stringify({ x: 4, y: 20 }));
  assert.ok(route.length > 3);
});

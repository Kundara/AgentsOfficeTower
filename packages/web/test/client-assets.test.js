const test = require("node:test");
const assert = require("node:assert/strict");

const { renderHtml } = require("../dist/render-html.js");

test("renderHtml loads external client assets and bootstrap config", () => {
  const html = renderHtml({
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/tmp/project", label: "project" }]
  });

  assert.match(html, /<link rel="stylesheet" href="\/client\/app\.css\?v=/);
  assert.match(html, /<script src="\/client\/app\.js\?v=.*"><\/script>/);
  assert.match(html, /window\.__AGENTS_OFFICE_CLIENT_CONFIG__/);
});

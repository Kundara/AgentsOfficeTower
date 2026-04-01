const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { handleRequest } = require("../dist/server/router.js");

function createStubOptions() {
  return {
    host: "127.0.0.1",
    port: 0,
    projects: [],
    explicitProjects: false
  };
}

function createStubService() {
  return {
    getCurrentProjects() {
      return [];
    }
  };
}

test("asset route serves public files whose names include spaces", async (t) => {
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, createStubOptions(), createStubService());
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code === "EPERM") {
      t.skip("sandbox disallows loopback listeners");
      return;
    }
    throw error;
  }
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/assets/pixel-office/sprites/hats/Alien%20cap.png`, {
      method: "HEAD"
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

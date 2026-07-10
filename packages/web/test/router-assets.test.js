const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { mkdtemp, mkdir, rm, symlink, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

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

async function startTestServer(t, service = createStubService()) {
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, createStubOptions(), service);
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
      return null;
    }
    throw error;
  }

  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function rawRequest(baseUrl, path, options = {}) {
  const target = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method ?? "GET",
      headers: options.headers ?? {}
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.once("error", reject);
    request.end(options.body);
  });
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

test("wide office audit route serves the fake-avatar scroll harness", async (t) => {
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
    const response = await fetch(`http://127.0.0.1:${address.port}/wide-office-audit`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Wide Office Scroll Audit/);
    assert.match(html, /audit-wide-avatar-32/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("layout audit route serves GET and HEAD without consulting the live fleet", async (t) => {
  const testServer = await startTestServer(t);
  if (!testServer) return;

  try {
    const getResponse = await rawRequest(testServer.baseUrl, "/layout-audit");
    assert.equal(getResponse.status, 200);
    assert.match(getResponse.body, /Workstation Layout Audit/);
    assert.match(getResponse.body, /window\.EventSource = MockEventSource/);

    const headResponse = await rawRequest(testServer.baseUrl, "/layout-audit", { method: "HEAD" });
    assert.equal(headResponse.status, 200);
    assert.equal(headResponse.body, "");
  } finally {
    await testServer.close();
  }
});

test("project file route only serves images from a current configured project", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "agents-office-router-project-"));
  const projectRoot = join(temporaryRoot, "project");
  const outsideRoot = join(temporaryRoot, "outside");
  await mkdir(projectRoot);
  await mkdir(outsideRoot);
  await writeFile(join(projectRoot, "inside.png"), "inside");
  await writeFile(join(projectRoot, "active.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>top.fetch('/api/refresh',{method:'POST'})</script></svg>");
  await writeFile(join(outsideRoot, "secret.png"), "secret");

  const harness = await startTestServer(t, {
    getCurrentProjects() {
      return [{ root: projectRoot, label: "project" }];
    }
  });
  if (!harness) {
    await rm(temporaryRoot, { recursive: true, force: true });
    return;
  }

  try {
    const allowed = await fetch(
      `${harness.baseUrl}/api/project-file?projectRoot=${encodeURIComponent(`${projectRoot}/.`)}&path=inside.png`
    );
    assert.equal(allowed.status, 200);
    assert.equal(await allowed.text(), "inside");

    const activeSvg = await fetch(
      `${harness.baseUrl}/api/project-file?projectRoot=${encodeURIComponent(projectRoot)}&path=active.svg`
    );
    assert.equal(activeSvg.status, 404);

    const arbitraryRoot = await fetch(
      `${harness.baseUrl}/api/project-file?projectRoot=${encodeURIComponent(outsideRoot)}&path=secret.png`
    );
    assert.equal(arbitraryRoot.status, 404);

    const traversal = await fetch(
      `${harness.baseUrl}/api/project-file?projectRoot=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent("../outside/secret.png")}`
    );
    assert.equal(traversal.status, 404);

    const boundarySibling = await fetch(
      `${harness.baseUrl}/api/project-file?projectRoot=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent(`${projectRoot}-sibling/secret.png`)}`
    );
    assert.equal(boundarySibling.status, 404);
  } finally {
    await harness.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("project file route rejects symlinks that escape the configured project", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "agents-office-router-symlink-"));
  const projectRoot = join(temporaryRoot, "project");
  const outsideImage = join(temporaryRoot, "secret.png");
  await mkdir(projectRoot);
  await writeFile(outsideImage, "secret");

  try {
    await symlink(outsideImage, join(projectRoot, "linked.png"));
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code === "EPERM" || code === "EACCES") {
      await rm(temporaryRoot, { recursive: true, force: true });
      t.skip("environment disallows symlink creation");
      return;
    }
    throw error;
  }

  const harness = await startTestServer(t, {
    getCurrentProjects() {
      return [{ root: projectRoot, label: "project" }];
    }
  });
  if (!harness) {
    await rm(temporaryRoot, { recursive: true, force: true });
    return;
  }

  try {
    const response = await fetch(
      `${harness.baseUrl}/api/project-file?projectRoot=${encodeURIComponent(projectRoot)}&path=linked.png`
    );
    assert.equal(response.status, 404);
  } finally {
    await harness.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("mutation guard accepts loopback same-origin requests and rejects unsafe origins and hosts", async (t) => {
  let refreshCount = 0;
  const harness = await startTestServer(t, {
    getCurrentProjects() {
      return [];
    },
    async refreshAll() {
      refreshCount += 1;
      return { projects: [] };
    }
  });
  if (!harness) {
    return;
  }

  try {
    const noOrigin = await fetch(`${harness.baseUrl}/api/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(noOrigin.status, 200);

    const sameOrigin = await fetch(`${harness.baseUrl}/api/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: harness.baseUrl },
      body: "{}"
    });
    assert.equal(sameOrigin.status, 200);

    const crossOrigin = await fetch(`${harness.baseUrl}/api/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: "{}"
    });
    assert.equal(crossOrigin.status, 403);
    assert.deepEqual(await crossOrigin.json(), { error: "origin does not match this Agents Office server" });

    const nonLoopbackHost = await rawRequest(harness.baseUrl, "/api/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", host: "office.example" },
      body: "{}"
    });
    assert.equal(nonLoopbackHost.status, 403);
    assert.equal(refreshCount, 2);
  } finally {
    await harness.close();
  }
});

test("mutation guard leaves the internal web CLI cache contract intact", async (t) => {
  let cachedFleet = null;
  const harness = await startTestServer(t, {
    getCurrentProjects() {
      return [];
    },
    setCoordinatedTeamFleet(fleet) {
      cachedFleet = fleet;
    }
  });
  if (!harness) {
    return;
  }

  try {
    const response = await fetch(`${harness.baseUrl}/api/web-cli/team-fleet`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agents-office-web-cli-cache": "1"
      },
      body: JSON.stringify({ fleet: { projects: [] } })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(cachedFleet, { projects: [] });
  } finally {
    await harness.close();
  }
});

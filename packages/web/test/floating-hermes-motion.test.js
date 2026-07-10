const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

function readRuntimeLiteral(fileName, exportName) {
  const source = readFileSync(join(__dirname, "../src/client/runtime", fileName), "utf8").trim();
  const prefix = `export const ${exportName} = `;
  assert.ok(source.startsWith(prefix), `${fileName} should export ${exportName}`);
  const literal = source.endsWith(";")
    ? source.slice(prefix.length, -1).trim()
    : source.slice(prefix.length).trim();
  return Function(`"use strict"; return (${literal});`)();
}

function parsePixels(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTransform(value) {
  const text = String(value || "");
  let match = text.match(/translate3d\(([-0-9.]+)px,\s*([-0-9.]+)px,\s*[-0-9.]+(?:px)?\)/);
  if (match) {
    return { x: Number(match[1]), y: Number(match[2]) };
  }
  match = text.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([-0-9.]+),\s*([-0-9.]+)\)/);
  if (match) {
    return { x: Number(match[1]), y: Number(match[2]) };
  }
  return { x: 0, y: 0 };
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  add(...classNames) {
    const next = new Set(String(this.element.className || "").split(/\s+/).filter(Boolean));
    classNames.forEach((className) => next.add(className));
    this.element.className = [...next].join(" ");
  }

  contains(className) {
    return String(this.element.className || "").split(/\s+/).includes(className);
  }
}

class FakeElement {
  constructor(tagName, document, rect = null) {
    this.tagName = tagName;
    this.ownerDocument = document;
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.innerHTML = "";
    this._rect = rect;
    this.classList = new FakeClassList(this);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    if (child.dataset && child.dataset.hermesFloatLayer === "true") {
      this.ownerDocument.layer = child;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    }
    if (this.ownerDocument.layer === this) {
      this.ownerDocument.layer = null;
    }
    this.parentNode = null;
  }

  getBoundingClientRect() {
    if (this._rect) {
      return {
        left: this._rect.left,
        top: this._rect.top,
        width: this._rect.width,
        height: this._rect.height,
        right: this._rect.left + this._rect.width,
        bottom: this._rect.top + this._rect.height
      };
    }
    const position = parseTransform(this.style.transform);
    const width = parsePixels(this.style.width, 0);
    const height = parsePixels(this.style.height, 0);
    return {
      left: position.x,
      top: position.y,
      width,
      height,
      right: position.x + width,
      bottom: position.y + height
    };
  }
}

class FakeDocument {
  constructor() {
    this.hosts = [];
    this.agentHits = [];
    this.layer = null;
    this.body = new FakeElement("body", this);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  querySelector(selector) {
    if (selector === "[data-hermes-float-layer]") {
      return this.layer;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-office-map-host]") {
      return this.hosts;
    }
    if (selector === ".office-map-agent-hit") {
      return this.agentHits;
    }
    if (selector === ".hermes-float-agent") {
      return this.layer ? this.layer.children.filter((child) => String(child.className).includes("hermes-float-agent")) : [];
    }
    return [];
  }
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRuntimeHarness({ width = 1280, height = 900, hosts = [] } = {}) {
  const document = new FakeDocument();
  document.hosts = hosts.map((rect) => new FakeElement("div", document, rect));
  const animationFrames = [];
  const timers = [];
  const context = {
    console,
    document,
    HTMLElement: FakeElement,
    state: { view: "map" },
    stableHash,
    avatarVisualSizeForAgent: () => ({ avatar: { url: "/avatar.png" }, width: 24, height: 30 }),
    displayAgentLabel: (_snapshot, agent) => agent.label || agent.id || "Hermes",
    threadViewProjectRoot: (snapshot) => snapshot.projectRoot || "",
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    renderAgentHover: () => '<div class="agent-hover"></div>',
    focusAgentKey: (snapshot, agent) => `${snapshot.projectRoot}::${agent.id}`,
    collectFocusedSessionKeys: (snapshot, agent) => [`${snapshot.projectRoot}::${agent.id}`],
    window: {
      innerWidth: width,
      innerHeight: height,
      requestAnimationFrame: (callback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      setTimeout: (callback, delay) => {
        timers.push({ callback, delay });
        return timers.length;
      },
      clearTimeout: () => {}
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  const navigationSource = readRuntimeLiteral(
    "floating-orchestrator-source.ts",
    "CLIENT_RUNTIME_FLOATING_ORCHESTRATOR_SOURCE"
  );
  vm.runInContext(`${navigationSource}
this.__floatingHermesTestHooks = {
  hermesFloatingSlotLayout,
  hermesFloatingTravelDuration,
  syncFloatingHermesAgents,
  spawnHermesAssignedTransferGhosts,
  snapshotHermesAssignedScreenRects
};`, context);
  return {
    context,
    document,
    animationFrames,
    timers,
    flushAnimationFrame() {
      if (animationFrames.length > 0) {
        animationFrames.shift()();
      }
    },
    runNextTimer() {
      const timer = timers.shift();
      if (timer) {
        timer.callback();
      }
      return timer;
    },
    flushAnimationFrames() {
      while (animationFrames.length > 0) {
        animationFrames.shift()();
      }
    }
  };
}

function roamingProject(agentOverrides = {}) {
  return {
    projectRoot: "/repo/a",
    agents: [{
      id: "hermes:orchestrator",
      threadId: "orchestrator",
      label: "Orchestrator",
      source: "hermes",
      sourceKind: "hermes:roaming",
      isOngoing: true,
      updatedAt: "2026-05-17T22:00:00.000Z",
      ...agentOverrides
    }]
  };
}

function assignedProject(projectRoot = "/repo/a", agentOverrides = {}) {
  return {
    projectRoot,
    agents: [{
      id: "hermes:orchestrator",
      threadId: "orchestrator",
      label: "Orchestrator",
      source: "hermes",
      sourceKind: "hermes:cli",
      isOngoing: true,
      updatedAt: "2026-05-17T22:00:00.000Z",
      ...agentOverrides
    }]
  };
}

function roamingOpenClawProject(agentOverrides = {}) {
  return {
    projectRoot: "/repo/a",
    agents: [{
      id: "openclaw:agent:main:orchestrator",
      threadId: "agent:main:orchestrator",
      label: "OpenClaw Orchestrator",
      source: "openclaw",
      sourceKind: "openclaw:roaming",
      isOngoing: true,
      updatedAt: "2026-05-17T22:00:00.000Z",
      ...agentOverrides
    }]
  };
}

function assignedOpenClawProject(projectRoot = "/repo/a", agentOverrides = {}) {
  return {
    projectRoot,
    agents: [{
      id: "openclaw:agent:main:orchestrator",
      threadId: "agent:main:orchestrator",
      label: "OpenClaw Orchestrator",
      source: "openclaw",
      sourceKind: "openclaw",
      isOngoing: true,
      updatedAt: "2026-05-17T22:00:00.000Z",
      ...agentOverrides
    }]
  };
}

function agentHit(document, { projectRoot = "/repo/a", id = "hermes:orchestrator", threadId = "orchestrator", rect }) {
  const node = new FakeElement("div", document, rect);
  node.className = "office-map-agent-hit";
  node.dataset.agentKey = `${projectRoot}::${id}`;
  node.dataset.threadId = threadId;
  return node;
}

test("floating Hermes tower slots stay left of visible office space and spread apart", () => {
  const harness = createRuntimeHarness({
    hosts: [{ left: 220, top: 300, width: 760, height: 520 }]
  });
  const entries = Array.from({ length: 8 }, (_, index) => ({
    key: `hermes:${index}`,
    agent: { id: `hermes:${index}` },
    snapshot: { projectRoot: "/repo/a" }
  }));

  const layout = harness.context.__floatingHermesTestHooks.hermesFloatingSlotLayout(entries);
  const points = [...layout.values()];

  assert.equal(points.length, 8);
  for (const point of points) {
    assert.equal(point.size, 68);
    assert.ok(point.x >= 22, `x ${point.x} should stay in the left tower gutter`);
    assert.ok(point.x + point.size <= 220, `right edge ${point.x + point.size} should stay left of the first tower scene`);
    assert.ok(point.y >= 220, `y ${point.y} should align inside the fixed viewport hover band`);
    assert.ok(point.y <= 769, `y ${point.y} should remain inside the fixed viewport hover band`);
  }

  let nearest = Infinity;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      nearest = Math.min(nearest, Math.hypot(points[left].x - points[right].x, points[left].y - points[right].y));
    }
  }
  assert.ok(nearest >= 45, `nearest floating Hermes spacing ${nearest} should avoid visible collisions`);
});

test("floating Hermes does not snap to floor levels while the building scrolls", () => {
  const harness = createRuntimeHarness({
    hosts: [{ left: 48, top: 321, width: 778, height: 520 }]
  });

  harness.context.__floatingHermesTestHooks.syncFloatingHermesAgents([roamingProject()]);
  harness.flushAnimationFrames();
  const node = harness.document.layer.children[0];
  const before = node.getBoundingClientRect();

  assert.ok(before.right <= 48, `floating Hermes right edge ${before.right} should stay left of the tower`);

  harness.document.hosts[0]._rect = { left: 48, top: -279, width: 778, height: 520 };
  harness.context.__floatingHermesTestHooks.syncFloatingHermesAgents([roamingProject()]);
  harness.flushAnimationFrames();
  const after = node.getBoundingClientRect();

  assert.equal(harness.document.layer.children.length, 1);
  assert.ok(after.right <= 48, `floating Hermes right edge ${after.right} should stay left of the tower after scroll`);
  assert.equal(after.top, before.top);
});

test("finished roaming Hermes does not keep hovering after the cooldown", () => {
  const harness = createRuntimeHarness({
    hosts: [{ left: 48, top: 321, width: 778, height: 520 }]
  });

  harness.context.__floatingHermesTestHooks.syncFloatingHermesAgents([
    roamingProject({
      isCurrent: false,
      isOngoing: false,
      state: "done",
      statusText: "done",
      stoppedAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z"
    })
  ]);

  assert.equal(harness.document.layer, null);
});

test("Hermes flies from a desk rect into the projectless sky and back to a desk", () => {
  const harness = createRuntimeHarness({
    hosts: [{ left: 48, top: 321, width: 778, height: 520 }]
  });
  const oldDeskRect = { left: 420, top: 450, width: 44, height: 58 };
  const newDeskRect = { left: 520, top: 390, width: 44, height: 58 };
  const previousRects = new Map([
    ["hermes:orchestrator", oldDeskRect],
    ["orchestrator", oldDeskRect]
  ]);

  harness.context.__floatingHermesTestHooks.syncFloatingHermesAgents([roamingProject()], { assignedRects: previousRects });
  const node = harness.document.layer.children[0];

  assert.equal(node.style.transform, "translate3d(408px, 445px, 0)");
  harness.flushAnimationFrames();
  assert.match(node.style.transform, /^translate3d\(-?[0-9]+px, [0-9]+px, 0\)$/);
  const floatingRect = node.getBoundingClientRect();
  assert.ok(floatingRect.right <= 48, `floating Hermes right ${floatingRect.right} should land left of the tower`);

  harness.document.agentHits = [
    agentHit(harness.document, { rect: newDeskRect })
  ];
  harness.context.__floatingHermesTestHooks.syncFloatingHermesAgents([]);

  assert.ok(node.classList.contains("is-departing"));
  assert.equal(node.style.opacity, "1");
  assert.equal(node.style.transform, "translate3d(508px, 385px, 0)");
});

test("reduced-motion preference collapses screen-space flight duration", () => {
  const harness = createRuntimeHarness();
  harness.context.window.matchMedia = () => ({ matches: true });

  assert.equal(
    harness.context.__floatingHermesTestHooks.hermesFloatingTravelDuration(0, 0, 900, 700),
    1
  );
});

test("assigned Hermes transfer ghosts are skipped for viewport-only scroll sync", () => {
  const harness = createRuntimeHarness({
    hosts: [
      { left: 48, top: 321, width: 778, height: 520 },
      { left: 48, top: 928, width: 778, height: 520 }
    ]
  });
  const oldDeskRect = { left: 420, top: 450, width: 44, height: 58 };
  const newDeskRect = { left: 520, top: 990, width: 44, height: 58 };
  const previousRects = new Map([
    ["hermes:orchestrator", oldDeskRect],
    ["orchestrator", oldDeskRect]
  ]);
  harness.document.agentHits = [
    agentHit(harness.document, { projectRoot: "/repo/b", rect: newDeskRect })
  ];

  harness.context.__floatingHermesTestHooks.spawnHermesAssignedTransferGhosts(
    previousRects,
    [assignedProject("/repo/b")],
    new Set(),
    { viewportOnly: true }
  );

  assert.equal(harness.document.layer, null);
  assert.equal(harness.timers.length, 0);
});

test("Hermes moving between known project floors gets a screen-space transfer ghost", () => {
  const harness = createRuntimeHarness({
    hosts: [
      { left: 48, top: 321, width: 778, height: 520 },
      { left: 48, top: 928, width: 778, height: 520 }
    ]
  });
  const oldDeskRect = { left: 420, top: 450, width: 44, height: 58 };
  const newDeskRect = { left: 520, top: 990, width: 44, height: 58 };
  const previousRects = new Map([
    ["hermes:orchestrator", oldDeskRect],
    ["orchestrator", oldDeskRect]
  ]);
  harness.document.agentHits = [
    agentHit(harness.document, { projectRoot: "/repo/b", rect: newDeskRect })
  ];

  harness.context.__floatingHermesTestHooks.spawnHermesAssignedTransferGhosts(
    previousRects,
    [assignedProject("/repo/b")],
    new Set()
  );
  const settleTimer = harness.runNextTimer();

  assert.ok(settleTimer.delay >= 1);
  const ghost = harness.document.layer.children[0];

  assert.ok(ghost.classList.contains("is-transfer"));
  assert.equal(ghost.style.transform, "translate3d(415px, 452px, 0)");
  harness.flushAnimationFrame();
  assert.equal(ghost.style.transform, "translate3d(515px, 992px, 0)");
  assert.equal(harness.timers.length, 2);
});

test("OpenClaw roaming orchestrators use left-of-tower handoffs like Hermes", () => {
  const harness = createRuntimeHarness({
    hosts: [{ left: 48, top: 321, width: 778, height: 520 }]
  });
  const oldDeskRect = { left: 420, top: 450, width: 44, height: 58 };
  const newDeskRect = { left: 520, top: 390, width: 44, height: 58 };
  const previousRects = new Map([
    ["openclaw:agent:main:orchestrator", oldDeskRect],
    ["agent:main:orchestrator", oldDeskRect]
  ]);

  harness.context.__floatingHermesTestHooks.syncFloatingHermesAgents([roamingOpenClawProject()], { assignedRects: previousRects });
  const node = harness.document.layer.children[0];

  assert.equal(node.dataset.hermesFloatKey, "openclaw:agent:main:orchestrator");
  assert.equal(node.style.transform, "translate3d(408px, 445px, 0)");
  harness.flushAnimationFrames();
  assert.match(node.style.transform, /^translate3d\(-?[0-9]+px, [0-9]+px, 0\)$/);

  harness.document.hosts[0]._rect = { left: 48, top: -279, width: 778, height: 520 };
  const before = node.getBoundingClientRect();
  harness.context.__floatingHermesTestHooks.syncFloatingHermesAgents([roamingOpenClawProject()]);
  harness.flushAnimationFrames();
  assert.deepEqual(node.getBoundingClientRect(), before);

  harness.document.agentHits = [
    agentHit(harness.document, {
      id: "openclaw:agent:main:orchestrator",
      threadId: "agent:main:orchestrator",
      rect: newDeskRect
    })
  ];
  harness.context.__floatingHermesTestHooks.syncFloatingHermesAgents([]);

  assert.ok(node.classList.contains("is-departing"));
  assert.equal(node.style.transform, "translate3d(508px, 385px, 0)");
});

test("OpenClaw moving between known project floors gets a screen-space transfer ghost", () => {
  const harness = createRuntimeHarness({
    hosts: [
      { left: 48, top: 321, width: 778, height: 520 },
      { left: 48, top: 928, width: 778, height: 520 }
    ]
  });
  const oldDeskRect = { left: 420, top: 450, width: 44, height: 58 };
  const newDeskRect = { left: 520, top: 990, width: 44, height: 58 };
  const previousRects = new Map([
    ["openclaw:agent:main:orchestrator", oldDeskRect],
    ["agent:main:orchestrator", oldDeskRect]
  ]);
  harness.document.agentHits = [
    agentHit(harness.document, {
      projectRoot: "/repo/b",
      id: "openclaw:agent:main:orchestrator",
      threadId: "agent:main:orchestrator",
      rect: newDeskRect
    })
  ];

  harness.context.__floatingHermesTestHooks.spawnHermesAssignedTransferGhosts(
    previousRects,
    [assignedOpenClawProject("/repo/b")],
    new Set()
  );
  harness.runNextTimer();
  const ghost = harness.document.layer.children[0];

  assert.ok(ghost.classList.contains("is-transfer"));
  assert.equal(ghost.dataset.hermesFloatTransfer, "openclaw:agent:main:orchestrator");
  assert.equal(ghost.style.transform, "translate3d(415px, 452px, 0)");
  harness.flushAnimationFrame();
  assert.equal(ghost.style.transform, "translate3d(515px, 992px, 0)");
});

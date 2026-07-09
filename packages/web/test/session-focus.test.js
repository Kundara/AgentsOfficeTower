const test = require("node:test");
const assert = require("node:assert/strict");

const {
  captureSessionFocus,
  restoreSessionFocus
} = require("../dist/client/runtime/session-focus.js");

class FakeElement {
  constructor(tagName, dataset = {}) {
    this.tagName = tagName.toUpperCase();
    this.dataset = { ...dataset };
    this.children = [];
    this.parentElement = null;
    this.focused = false;
    this.focusOptions = null;
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  contains(candidate) {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  closest(selector) {
    if (selector === "[data-session-key]" && this.dataset.sessionKey) {
      return this;
    }
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }

  querySelectorAll(selector) {
    const wantsSession = selector === "[data-session-key]";
    const results = [];
    const visit = (element) => {
      const focusable = ["BUTTON", "TEXTAREA", "INPUT", "SELECT"].includes(element.tagName)
        || Object.prototype.hasOwnProperty.call(element.dataset, "tabindex");
      if ((wantsSession && element.dataset.sessionKey) || (!wantsSession && focusable)) {
        results.push(element);
      }
      element.children.forEach(visit);
    };
    this.children.forEach(visit);
    return results;
  }

  focus(options) {
    this.focused = true;
    this.focusOptions = options;
  }
}

class FakeTextarea extends FakeElement {
  constructor(dataset, value, selectionStart, selectionEnd) {
    super("textarea", dataset);
    this.value = value;
    this.selectionStart = selectionStart;
    this.selectionEnd = selectionEnd;
    this.selectionDirection = "forward";
  }

  setSelectionRange(start, end, direction) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
}

test("session focus survives a card rebuild and restores composer selection by stable identity", () => {
  const oldContainer = new FakeElement("div");
  const oldCard = new FakeElement("article", { sessionKey: '["/repo","thread-1"]' });
  const oldComposer = new FakeTextarea(
    { replyProjectRoot: "/repo", replyThreadId: "thread-1" },
    "continue this task",
    3,
    11
  );
  oldCard.append(oldComposer);
  oldContainer.append(oldCard);

  const snapshot = captureSessionFocus(oldContainer, oldComposer);
  assert.deepEqual(snapshot, {
    sessionKey: '["/repo","thread-1"]',
    controlIndex: 0,
    controlSignature: '["textarea",[["replyProjectRoot","/repo"],["replyThreadId","thread-1"]]]',
    selectionStart: 3,
    selectionEnd: 11,
    selectionDirection: "forward"
  });
});

test("session focus restoration follows control signatures after action order changes", () => {
  const oldContainer = new FakeElement("div");
  const oldCard = new FakeElement("article", { sessionKey: '["/repo","thread-1"]' });
  const oldComposer = new FakeTextarea(
    { replyProjectRoot: "/repo", replyThreadId: "thread-1" },
    "continue this task",
    3,
    11
  );
  oldCard.append(oldComposer);
  oldContainer.append(oldCard);
  const snapshot = captureSessionFocus(oldContainer, oldComposer);

  const nextContainer = new FakeElement("div");
  const nextCard = new FakeElement("article", { sessionKey: '["/repo","thread-1"]' });
  const insertedAction = new FakeElement("button", { action: "cycle-look", agentId: "agent-1" });
  const nextComposer = new FakeTextarea(
    { replyProjectRoot: "/repo", replyThreadId: "thread-1" },
    "continue this task safely",
    0,
    0
  );
  nextCard.append(insertedAction, nextComposer);
  nextContainer.append(nextCard);

  assert.equal(restoreSessionFocus(nextContainer, snapshot), true);
  assert.equal(nextComposer.focused, true);
  assert.deepEqual(nextComposer.focusOptions, { preventScroll: true });
  assert.equal(nextComposer.selectionStart, 3);
  assert.equal(nextComposer.selectionEnd, 11);
  assert.equal(nextComposer.selectionDirection, "forward");
  assert.equal(restoreSessionFocus(new FakeElement("div"), snapshot), false);
});

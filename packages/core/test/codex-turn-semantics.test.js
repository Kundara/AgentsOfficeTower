const test = require("node:test");
const assert = require("node:assert/strict");

const {
  turnHasFinalAnswer,
  turnHasNonFinalWorkSignal,
  turnHasOpenWorkSignal
} = require("../dist/domain/codex-turn-semantics.js");

function turn(status, items) {
  return { id: "turn", status, error: null, items };
}

const cases = [
  {
    name: "final answer closes the turn",
    value: turn("completed", [{ type: "agentMessage", phase: "final_answer" }]),
    final: true,
    nonFinal: false,
    open: false
  },
  {
    name: "commentary remains non-final work",
    value: turn("completed", [{ type: "agentMessage", phase: "commentary" }]),
    final: false,
    nonFinal: true,
    open: false
  },
  {
    name: "an in-progress turn is open without items",
    value: turn("inProgress", []),
    final: false,
    nonFinal: false,
    open: true
  },
  {
    name: "a running tool is open work",
    value: turn("interrupted", [{ type: "commandExecution", status: "inProgress" }]),
    final: false,
    nonFinal: true,
    open: true
  },
  {
    name: "a completed tool is settled non-final work",
    value: turn("completed", [{ type: "commandExecution", status: "completed" }]),
    final: false,
    nonFinal: true,
    open: false
  },
  {
    name: "unknown items do not change lifecycle state",
    value: turn("completed", [{ type: "futureItem", status: "inProgress" }]),
    final: false,
    nonFinal: false,
    open: false
  }
];

for (const entry of cases) {
  test(entry.name, () => {
    assert.equal(turnHasFinalAnswer(entry.value), entry.final);
    assert.equal(turnHasNonFinalWorkSignal(entry.value), entry.nonFinal);
    assert.equal(turnHasOpenWorkSignal(entry.value), entry.open);
  });
}

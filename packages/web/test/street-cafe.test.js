const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isCodexChatProjectRootForStreetCafe
} = require("../dist/client/runtime/street-cafe.js");

test("street cafe recognizes canonical projectless Codex roots across platforms", () => {
  assert.equal(isCodexChatProjectRootForStreetCafe("/Users/me/Documents/Codex"), true);
  assert.equal(isCodexChatProjectRootForStreetCafe("C:\\Users\\me\\Documents\\Codex\\"), true);
  assert.equal(isCodexChatProjectRootForStreetCafe("/mnt/c/Users/me/Documents/Codex"), true);
});

test("street cafe does not classify an ordinary project merely named Chat", () => {
  assert.equal(isCodexChatProjectRootForStreetCafe("/work/Chat"), false);
  assert.equal(isCodexChatProjectRootForStreetCafe("/repos/chat"), false);
  assert.equal(isCodexChatProjectRootForStreetCafe("/Users/me/Documents/Codex/2026-07-09/chat"), false);
});

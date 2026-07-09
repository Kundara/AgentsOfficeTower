const test = require("node:test");
const assert = require("node:assert/strict");

const {
  officeMapHorizontalMaxScrollLeft,
  officeMapHorizontalWheelTarget,
  wheelDeltaPixels
} = require("../dist/client/runtime/horizontal-wheel.js");

test("horizontal wheel helpers normalize deltas, find hosts, and measure canvas overflow", () => {
  const originals = {
    Element: global.Element,
    HTMLElement: global.HTMLElement,
    WheelEvent: global.WheelEvent,
    window: global.window
  };
  class FakeElement {
    closest() { return null; }
  }
  class FakeHTMLElement extends FakeElement {}
  global.Element = FakeElement;
  global.HTMLElement = FakeHTMLElement;
  global.WheelEvent = { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 };
  global.window = { innerHeight: 900 };

  try {
    assert.equal(wheelDeltaPixels({ deltaMode: 0, deltaX: 4, deltaY: 12 }), 4);
    assert.equal(wheelDeltaPixels({ deltaMode: 1, deltaX: -3, deltaY: 1 }), -48);
    assert.equal(wheelDeltaPixels({ deltaMode: 2, deltaX: 0, deltaY: 2 }), 1800);

    const host = new FakeHTMLElement();
    host.clientWidth = 500;
    const canvas = new FakeHTMLElement();
    canvas.style = { width: "930px" };
    canvas.scrollWidth = 900;
    canvas.getBoundingClientRect = () => ({ width: 920 });
    host.querySelector = () => canvas;
    const child = new FakeElement();
    child.closest = () => host;

    assert.equal(officeMapHorizontalWheelTarget(child), host);
    assert.equal(officeMapHorizontalWheelTarget(null), null);
    assert.equal(officeMapHorizontalMaxScrollLeft(host), 430);
  } finally {
    global.Element = originals.Element;
    global.HTMLElement = originals.HTMLElement;
    global.WheelEvent = originals.WheelEvent;
    global.window = originals.window;
  }
});

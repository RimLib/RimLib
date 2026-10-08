import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { positionContextMenu } from "../src/renderer/src/utils/modSelection";
import { tagChipStyle } from "../src/renderer/src/utils/tagColors";
import { positionTooltip, tooltipPlacements } from "../src/renderer/src/utils/tooltips";
import { viewportPadding } from "../src/renderer/src/utils/uiConstants";
import { propertyOptions, textArbitrary } from "./helpers/properties";

void test("property: every RGB tag color gets black or white text with at least 4.5 to 1 contrast", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 0xffffff }), (rgb) => {
      const background = `#${rgb.toString(16).padStart(6, "0")}`;
      const style = tagChipStyle(background);
      assert.equal(style.backgroundColor, background);
      assert.ok(style.color === "#000000" || style.color === "#ffffff");
      const channels = [rgb >>> 16, (rgb >>> 8) & 255, rgb & 255].map((byte) => {
        const channel = byte / 255;
        return channel > 0.04045 ? Math.pow((channel + 0.055) / 1.055, 2.4) : channel / 12.92;
      });
      const luminance =
        (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
      const contrast =
        style.color === "#000000" ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
      assert.ok(contrast >= 4.5, `Insufficient contrast for ${background}`);
    }),
    propertyOptions,
  );
});

void test("property: arbitrary saved tag colors always resolve to safe concrete hexadecimal styles", () => {
  fc.assert(
    fc.property(textArbitrary, (color) => {
      const style = tagChipStyle(color);
      assert.match(style.backgroundColor, /^#[\da-f]{6}$/);
      assert.ok(style.color === "#000000" || style.color === "#ffffff");
    }),
    propertyOptions,
  );
});

const positionArbitrary = fc.record({
  viewport: fc.record({
    width: fc.integer({ min: 200, max: 3000 }),
    height: fc.integer({ min: 200, max: 2000 }),
  }),
  size: fc.record({
    width: fc.integer({ min: 1, max: 180 }),
    height: fc.integer({ min: 1, max: 180 }),
  }),
  x: fc.integer({ min: -1000, max: 4000 }),
  y: fc.integer({ min: -1000, max: 3000 }),
});

void test("property: context menus remain inside the viewport even for offscreen click coordinates", () => {
  fc.assert(
    fc.property(positionArbitrary, ({ viewport, size, x, y }) => {
      const { left, top } = positionContextMenu({ x, y }, size, viewport);
      assert.ok(left >= viewportPadding && top >= viewportPadding);
      assert.ok(left + size.width <= viewport.width - viewportPadding);
      assert.ok(top + size.height <= viewport.height - viewportPadding);
    }),
    propertyOptions,
  );
});

void test("property: tooltip placement remains bounded on every side and at arbitrary viewport edges", () => {
  fc.assert(
    fc.property(
      positionArbitrary,
      fc.constantFrom(...Object.values(tooltipPlacements)),
      ({ viewport, size, x, y }, placement) => {
        const anchor = { left: x, top: y, right: x + 34, bottom: y + 34, width: 34, height: 34 };
        const { left, top } = positionTooltip(anchor, size, viewport, placement);
        assert.ok(Number.isFinite(left) && Number.isFinite(top));
        assert.ok(left >= viewportPadding && top >= viewportPadding);
        assert.ok(left + size.width <= viewport.width - viewportPadding);
        assert.ok(top + size.height <= viewport.height - viewportPadding);
      },
    ),
    propertyOptions,
  );
});

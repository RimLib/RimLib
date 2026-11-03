import assert from "node:assert/strict";
import { test } from "node:test";

import {
  virtualModHeight,
  virtualScrollTopForIndex,
} from "../src/renderer/src/hooks/useVirtualMods";

void test("virtual rows scroll only enough to reveal an explicitly requested item", () => {
  const viewport = 3 * virtualModHeight;

  assert.equal(virtualScrollTopForIndex(0, viewport, 1), 0);
  assert.equal(virtualScrollTopForIndex(0, viewport, 5), 3 * virtualModHeight);
  assert.equal(virtualScrollTopForIndex(5 * virtualModHeight, viewport, 2), 2 * virtualModHeight);
  assert.equal(virtualScrollTopForIndex(2 * virtualModHeight, viewport, -1), 2 * virtualModHeight);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { workshopResultNotice } from "../src/renderer/src/services/workshopActions";
import type { SteamOperationResult } from "../src/shared/types";
import { createEmptyVault } from "../src/shared/vault";

void test("Workshop notices distinguish successful changes, warnings and partial failures", () => {
  const result: SteamOperationResult = {
    vault: createEmptyVault(),
    activeMods: { packageIds: [] },
    subscribed: 0,
    unsubscribed: 0,
    failures: [],
  };
  assert.equal(workshopResultNotice(result, "Synchronized"), "Synchronized");
  assert.equal(
    workshopResultNotice(
      { ...result, subscribed: 2, unsubscribed: 1, warnings: ["Metadata unavailable", "Retry"] },
      "Updated",
    ),
    "Updated (2 subscribed, 1 unsubscribed). Metadata unavailable; Retry",
  );
  assert.equal(
    workshopResultNotice({ ...result, unsubscribed: 1, failures: ["Offline"] }, "Updated"),
    "0 subscribed, 1 unsubscribed; some changes failed",
  );
});

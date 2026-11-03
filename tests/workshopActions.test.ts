import assert from "node:assert/strict";
import { test } from "node:test";

import {
  workshopResultNotice,
  workshopWarningMessage,
} from "../src/renderer/src/services/workshopActions";
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
    "Updated (2 subscribed, 1 unsubscribed); completed with 2 warnings",
  );
  assert.equal(
    workshopResultNotice({ ...result, unsubscribed: 1, failures: ["Offline"] }, "Updated"),
    "0 subscribed, 1 unsubscribed; some changes failed",
  );
});

void test("Workshop warning notifications retain details but remain bounded", () => {
  assert.equal(
    workshopWarningMessage(["Workshop 1 unavailable"]),
    "Workshop 1 unavailable. Existing metadata was preserved where refreshes failed. See the application logs for full details.",
  );
  assert.equal(
    workshopWarningMessage(["One", "Two", "One", "Three", "Four"]),
    "One; Two; Three (+1 more). Existing metadata was preserved where refreshes failed. See the application logs for full details.",
  );
  assert.equal(
    workshopWarningMessage(["Saved information was preserved."]),
    "Saved information was preserved. Existing metadata was preserved where refreshes failed. See the application logs for full details.",
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  useWorkspaceProjection,
  type WorkspaceProjection,
  type WorkspaceProjectionInput,
} from "../src/renderer/src/hooks/useWorkspaceProjection";
import { draftActions } from "../src/renderer/src/utils/drafts";
import type { Mod } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";

function mod(id: string, packageId: string, userTagIds: string[] = []): Mod {
  return {
    id: `steam-${id}`,
    workshopId: id,
    packageId,
    name: `Mod ${id}`,
    author: "Author",
    source: "steam",
    summary: "Summary",
    tags: [],
    userTagIds,
    gameVersions: [],
    screenshots: [],
    subscribed: true,
    downloadedAt: "",
    addedAt: "",
  };
}

function renderProjection(input: WorkspaceProjectionInput): WorkspaceProjection {
  let result: WorkspaceProjection | undefined;
  function Probe() {
    result = useWorkspaceProjection(input);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return requireValue(result);
}

void test("workspace projection composes actual inventory, draft membership and derived indexes", () => {
  const active = mod("1", "author.active", ["qol"]);
  const dependency = mod("2", "author.dependency", ["qol"]);
  const other = mod("3", "author.other", ["other"]);
  const mods = [active, dependency, other];
  const requestedOrder = [dependency.packageId ?? "", "ludeon.rimworld"];
  const input: WorkspaceProjectionInput = {
    active: { packageIds: ["ludeon.rimworld", requireValue(active.packageId)] },
    mods,
    tags: [
      { id: "qol", name: "QoL", color: "#7fbf90" },
      { id: "other", name: "Other", color: "#708090" },
    ],
    localSteamState: { observedIds: ["1", "2", "3"], pending: {} },
    draft: {
      changes: [
        { mod: active, action: draftActions.deactivate },
        { mod: dependency, action: draftActions.activate },
        { mod: other, action: draftActions.unsubscribe },
      ],
      activeOrder: requestedOrder,
    },
  };
  const before = JSON.stringify(input);

  const projection = renderProjection(input);

  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(
    projection.actualPanels.active.map((entry) => entry.packageId),
    ["ludeon.rimworld", "author.active"],
  );
  assert.deepEqual(
    projection.membershipPanels.active.map((entry) => entry.packageId),
    ["ludeon.rimworld", "author.dependency"],
  );
  assert.deepEqual(
    projection.panels.active.map((entry) => entry.packageId),
    ["author.dependency", "ludeon.rimworld"],
  );
  assert.deepEqual(
    projection.restoreTargets.map((entry) => entry.id),
    [dependency.id],
  );
  assert.equal(projection.inactiveCountByTagId.get("qol"), 1);
  assert.equal(projection.inactiveCountByTagId.get("other"), 1);
  assert.deepEqual(projection.draftActionsById.get(active.id), [draftActions.deactivate]);
  assert.deepEqual(projection.draftActionsById.get(dependency.id), [draftActions.activate]);
  assert.ok(projection.draftActivityDelta.deactivatedIds.has(active.id));
  assert.ok(projection.draftActivityDelta.activatedIds.has(dependency.id));
  assert.equal(
    projection.actualById.get(active.id),
    projection.actualPanels.active.find((entry) => entry.id === active.id),
  );
  assert.deepEqual(
    projection.autoSortDependencyCandidates.map((entry) => entry.id),
    [active.id, other.id],
  );
});

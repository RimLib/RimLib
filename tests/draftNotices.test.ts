import assert from "node:assert/strict";
import { test } from "node:test";

import { hasStagedDependencyActivations } from "../src/renderer/src/utils/draftNotices";
import { draftActions } from "../src/renderer/src/utils/drafts";
import { draftMod } from "./helpers/drafts";

const first = draftMod("dependency-1");
const second = draftMod("dependency-2");

void test("dependency activation notices remain current only while every target is staged", () => {
  const staged = [
    { mod: first, action: draftActions.subscribe },
    { mod: first, action: draftActions.activate },
    { mod: second, action: draftActions.activate },
  ];

  assert.equal(hasStagedDependencyActivations(staged, [first.id, second.id]), true);
  assert.equal(hasStagedDependencyActivations(staged, [first.id]), true);
  assert.equal(
    hasStagedDependencyActivations(
      staged.filter((change) => change.mod.id !== second.id),
      [first.id, second.id],
    ),
    false,
  );
  assert.equal(hasStagedDependencyActivations([], [first.id]), false);
  assert.equal(hasStagedDependencyActivations(staged, []), false);
});

void test("subscription changes alone do not keep a dependency activation notice current", () => {
  assert.equal(
    hasStagedDependencyActivations([{ mod: first, action: draftActions.subscribe }], [first.id]),
    false,
  );
});

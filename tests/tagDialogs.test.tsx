import assert from "node:assert/strict";
import { test } from "node:test";

import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BulkTagsModal,
  type BulkTagsModalProps,
} from "../src/renderer/src/components/modals/BulkTagsModal";
import { TagDialogs } from "../src/renderer/src/components/modals/TagDialogs";
import {
  bulkTagOperation,
  closedTagDialog,
  type TagDialog,
  tagDialogReducer,
} from "../src/renderer/src/utils/tagDialogs";
import { saveUserTag } from "../src/shared/tags";
import type { Mod, ModTag, ModVault } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import { normalizeVault } from "../src/shared/vault";

const tag: ModTag = { id: "qol", name: "Quality of life", color: "#7fbf90" };
const mod = (id: string): Mod => ({
  id,
  name: id,
  author: "Author",
  source: "steam",
  subscribed: false,
  summary: "Keep",
  tags: ["Steam"],
  userTagIds: [],
  gameVersions: [],
  screenshots: [],
  addedAt: "",
  downloadedAt: "",
});
const makeVault = (): ModVault =>
  normalizeVault({
    mods: [mod("a"), mod("b"), mod("c")],

    userTags: [{ ...tag, extension: "Preserve tag metadata" }],
    settings: { workshopModsPath: "/unavailable" },
    extension: "Preserve vault metadata",
  });
const noop = () => undefined;
const renderDialogs = (dialog: TagDialog) =>
  TagDialogs({
    workflow: { dialog, dispatch: noop, assign: noop, save: noop, remove: noop, applyBulk: noop },
    mods: [mod("a"), mod("b")],
    tags: [tag],
    disabled: false,
  });

void test("tag manager create, edit and delete have explicit return paths without overlapping dialogs", () => {
  const manager = tagDialogReducer(closedTagDialog, { type: "manage" });
  assert.equal(manager.kind, "manager");
  for (const editor of [
    tagDialogReducer(manager, { type: "create", initialName: "Tribal" }),
    tagDialogReducer(manager, { type: "edit", tag }),
  ]) {
    assert.equal(editor.kind, "editor");
    assert.equal(tagDialogReducer(editor, { type: "close" }), manager);
    assert.equal(tagDialogReducer(editor, { type: "saved", tagId: "new" }), manager);
    const html = renderToStaticMarkup(renderDialogs(editor));
    assert.doesNotMatch(html, /Search tags for selected mods|Manage tags/);
  }
  const deleting = tagDialogReducer(manager, { type: "delete", tag });
  assert.equal(deleting.kind, "delete");
  assert.deepEqual(tagDialogReducer(deleting, { type: "close" }), manager);
  assert.equal(tagDialogReducer(manager, { type: "close" }), closedTagDialog);
});

void test("bulk tag creation snapshots the selected IDs and keeps its chooser mounted while editing", () => {
  const ids = ["a", "b"];
  const bulk = tagDialogReducer(closedTagDialog, { type: "bulk", modIds: ids, assigned: true });
  ids.push("c");
  assert.deepEqual(bulkTagOperation(bulk)?.modIds, ["a", "b"]);
  const editor = tagDialogReducer(bulk, { type: "create", initialName: "Tribal" });
  assert.equal(bulkTagOperation(editor), bulkTagOperation(bulk));
  assert.equal(tagDialogReducer(editor, { type: "close" }), bulk);
  const bulkView: ReactElement<{ children?: ReactNode }> = renderDialogs(bulk);
  const editorView: ReactElement<{ children?: ReactNode }> = renderDialogs(editor);
  const before = Children.toArray(bulkView.props.children);
  const after = Children.toArray(editorView.props.children);
  const beforeIndex = before.findIndex(
    (child) => isValidElement(child) && child.type === BulkTagsModal,
  );
  const afterIndex = after.findIndex(
    (child) => isValidElement(child) && child.type === BulkTagsModal,
  );
  assert.ok(beforeIndex >= 0);
  assert.equal(afterIndex, beforeIndex);
  const chooser = after[afterIndex];
  assert.ok(isValidElement<BulkTagsModalProps>(chooser));
  const previousChooser = before[beforeIndex];
  assert.ok(isValidElement<BulkTagsModalProps>(previousChooser));
  assert.equal(chooser.key, previousChooser.key);
  assert.equal(chooser.props.hidden, true);
  assert.deepEqual(
    chooser.props.mods.map((entry) => entry.id),
    ["a", "b"],
  );
  const saved = tagDialogReducer(editor, { type: "saved", tagId: "tribal" });
  assert.deepEqual(bulkTagOperation(saved), {
    assigned: true,
    modIds: ["a", "b"],
    createdTagId: "tribal",
  });
  assert.equal(bulkTagOperation(bulk)?.createdTagId, undefined);
});

void test("Mod Info creation snapshots its targets and closes rather than returning to an unrelated manager", () => {
  const ids = ["b", "a"];
  const editor = tagDialogReducer(closedTagDialog, {
    type: "create",
    initialName: "Tribal",
    modIds: ids,
  });
  ids.length = 0;
  assert.equal(editor.kind, "editor");
  assert.deepEqual(editor.assignToModIds, ["b", "a"]);
  assert.equal(tagDialogReducer(editor, { type: "saved", tagId: "tribal" }), closedTagDialog);
});

void test("invalid dialog transitions cannot overwrite an editor, open empty bulk actions or create tags from removal", () => {
  assert.equal(
    tagDialogReducer(closedTagDialog, { type: "bulk", assigned: true, modIds: [] }),
    closedTagDialog,
  );
  assert.equal(tagDialogReducer(closedTagDialog, { type: "saved", tagId: "qol" }), closedTagDialog);
  assert.equal(tagDialogReducer(closedTagDialog, { type: "delete", tag }), closedTagDialog);
  const editor = tagDialogReducer(closedTagDialog, { type: "create", initialName: "Tribal" });
  assert.equal(tagDialogReducer(editor, { type: "manage" }), editor);
  assert.equal(tagDialogReducer(editor, { type: "create", initialName: "Other" }), editor);
  const removing = tagDialogReducer(closedTagDialog, {
    type: "bulk",
    assigned: false,
    modIds: ["a"],
  });
  assert.equal(tagDialogReducer(removing, { type: "create", initialName: "Other" }), removing);
});

void test("creating a tag assigns the entire selected group atomically and preserves unrelated records", () => {
  const original = makeVault();
  const before = JSON.stringify(original);
  const next = saveUserTag(original, { id: "tribal", name: "Tribal", color: "#d7a84f" }, "create", [
    "b",
    "a",
  ]);
  assert.deepEqual(requireValue(next.mods[0]).userTagIds, ["tribal"]);
  assert.deepEqual(requireValue(next.mods[1]).userTagIds, ["tribal"]);
  assert.equal(next.mods[2], original.mods[2]);
  assert.equal(next.settings, original.settings);

  assert.equal(next.localSteamState, original.localSteamState);
  assert.equal(JSON.stringify(original), before);
});

void test("renaming and recoloring preserves tag identity, assignments and unknown extension fields", () => {
  const original = makeVault();
  const next = saveUserTag(original, { ...tag, name: "QoL", color: "#ffffff" }, "edit");
  assert.equal(next.mods, original.mods);
  assert.equal(next.userTags.length, 1);
  assert.equal(requireValue(next.userTags[0]).name, "QoL");
  assert.ok(JSON.stringify(next).includes("Preserve tag metadata"));
  assert.ok(JSON.stringify(next).includes("Preserve vault metadata"));
});

void test("stale edits, duplicate names and missing selection targets cannot partially create or replace tags", () => {
  const original = makeVault();
  const before = JSON.stringify(original);
  assert.throws(
    () => saveUserTag(original, { id: "new", name: " quality OF life ", color: "red" }, "create"),
    /unique/,
  );
  assert.throws(() => saveUserTag(original, { ...tag, name: " " }, "edit"), /nonempty/);
  assert.throws(() => saveUserTag(original, { ...tag, name: "Other" }, "create"), /tag changed/);
  assert.throws(
    () => saveUserTag(original, { id: "deleted", name: "Other", color: "red" }, "edit"),
    /tag changed/,
  );
  assert.throws(
    () =>
      saveUserTag(original, { id: "new", name: "Other", color: "red" }, "create", ["a", "deleted"]),
    /selected mods or tags changed/,
  );
  assert.equal(JSON.stringify(original), before);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ManageTagsModal } from "../src/renderer/src/components/modals/ManageTagsModal";
import { SubscribedModsPanelView as SubscribedModsPanel } from "../src/renderer/src/components/panels/SubscribedModsPanel";
import type { Mod } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import { normalizeVault } from "../src/shared/vault";

const mod = (id: string): Mod => ({
  id: `steam-${id}`,
  workshopId: id,
  packageId: `author.mod${id}`,
  name: `Mod ${id}`,
  author: "Author",
  source: "steam",
  summary: "Retained summary",
  tags: [],
  userTagIds: ["qol"],
  gameVersions: [],
  screenshots: [],
  subscribed: true,
  downloadedAt: "",
  addedAt: "",
  notes: "Keep my note",
});
const saved = normalizeVault({
  mods: [mod("1"), mod("2"), mod("3")],

  userTags: [{ id: "qol", name: "QoL", color: "#7fbf90" }],
});
const noop = () => undefined;

void test("subscribed panel keeps game ordering without displaying position numbers or adding Core/local entries", () => {
  const html = renderToStaticMarkup(
    <SubscribedModsPanel
      mods={[mod("2"), mod("1")]}
      totalCount={2}
      tags={requireValue(saved.userTags)}
      search=""
      searchScope="all"
      sort="active"
      activeIds={new Set(["steam-1", "steam-2"])}
      activeOrder={
        new Map([
          ["steam-2", 1],
          ["steam-1", 4],
        ])
      }
      onSelect={noop}
      onSearch={noop}
      onSearchScope={noop}
      onSort={noop}
      onSubscribe={noop}
      onUnsubscribe={noop}
    />,
  );
  assert.match(html, /aria-label="Subscribed mods"/);
  assert.doesNotMatch(html, /Load order|>#\d+</);
  assert.ok(html.indexOf("Mod 2") < html.indexOf("Mod 1"));
  assert.match(html, /2 active/);
  assert.doesNotMatch(html, /Unapplied draft|Core \/ DLC/);
});

void test("subscribed active rows warn when dependency packages are not active", () => {
  const dependent = {
    ...mod("1"),
    dependencies: [{ packageId: "brrainz.harmony", displayName: "Harmony" }],
  };
  const html = renderToStaticMarkup(
    <SubscribedModsPanel
      mods={[dependent]}
      totalCount={1}
      tags={[]}
      search=""
      searchScope="all"
      sort="active"
      activeIds={new Set([dependent.id])}
      missingDependenciesById={new Map([[dependent.id, dependent.dependencies]])}
      onSelect={noop}
      onSearch={noop}
      onSearchScope={noop}
      onSort={noop}
      onSubscribe={noop}
      onUnsubscribe={noop}
    />,
  );
  assert.match(html, /1 missing dependency/);
  assert.match(html, /Missing active dependencies: Harmony/);
});

void test("tag management keeps long names in their own column with accessible edit/delete tools", () => {
  const name = "A very long tag name ".repeat(5);
  const html = renderToStaticMarkup(
    <ManageTagsModal
      tags={[{ id: "long", name, color: "#7fbf90" }]}
      onCreate={noop}
      onEdit={noop}
      onDelete={noop}
      onClose={noop}
    />,
  );
  assert.match(html, /tag-manager-modal/);
  assert.match(html, /role="listitem"/);
  assert.ok(html.includes(`aria-label="Edit ${name}"`));
  assert.ok(html.includes(`title="${name}"`));
  assert.match(html, /data-tip="Edit tag"/);
});

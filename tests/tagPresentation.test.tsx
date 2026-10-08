import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AppHeader } from "../src/renderer/src/components/AppHeader";
import { ModRowView as ModRow } from "../src/renderer/src/components/common/ModRow";
import { TagAssignments } from "../src/renderer/src/components/common/TagAssignments";
import { TagChip } from "../src/renderer/src/components/common/TagChip";
import { BulkTagsModal } from "../src/renderer/src/components/modals/BulkTagsModal";
import { ManageTagsModal } from "../src/renderer/src/components/modals/ManageTagsModal";
import { ModInfoPanel } from "../src/renderer/src/components/panels/ModInfoPanel";
import {
  ModsPanelView as ModsPanel,
  type ModsPanelViewProps as ModsPanelProps,
} from "../src/renderer/src/components/panels/ModsPanel";
import { filterLibrary } from "../src/renderer/src/utils/library";
import { tagChipStyle } from "../src/renderer/src/utils/tagColors";
import { searchScopes } from "../src/renderer/src/utils/uiConstants";
import type { Mod, ModTag } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";

const noop = () => undefined;
const tag: ModTag = { id: "qol", name: "Quality of life", color: "#7fbf90" };
const mod = (id: string): Mod => ({
  id,
  workshopId: id,
  packageId: `author.mod${id}`,
  name: `Mod ${id}`,
  author: "Author",
  summary: "Summary",
  source: "steam",
  tags: [],
  userTagIds: [tag.id],
  subscribed: true,
  screenshots: [],
  gameVersions: [],
  addedAt: "",
  downloadedAt: `2026-01-0${id}`,
});
const panelProps: ModsPanelProps = {
  mode: "subscribed",
  mods: [mod("1"), mod("2")],
  totalCount: 2,
  tags: [tag],
  search: "",
  searchScope: searchScopes.all,
  sort: "active",
  activeIds: new Set(["2"]),
  activeOrder: new Map([["2", 1]]),
  onSearch: noop,
  onSearchScope: noop,
  onSort: noop,
  onSelect: noop,
  onSubscribe: noop,
  onUnsubscribe: noop,
};

function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel > 0.04045 ? ((channel + 0.055) / 1.055) ** 2.4 : channel / 12.92));
  return (
    requireValue(rgb[0]) * 0.2126 + requireValue(rgb[1]) * 0.7152 + requireValue(rgb[2]) * 0.0722
  );
}

void test("tag chip text selects the higher black/white contrast and exceeds 4.5:1 across the color spectrum", () => {
  assert.equal(tagChipStyle("#000000").color, "#ffffff");
  assert.equal(tagChipStyle("#ffffff").color, "#000000");
  for (let red = 0; red < 256; red += 17) {
    for (let green = 0; green < 256; green += 17) {
      for (let blue = 0; blue < 256; blue += 17) {
        const color = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
        const style = tagChipStyle(color);
        const background = luminance(style.backgroundColor);
        const foreground = luminance(style.color);
        const contrast =
          (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
        assert.ok(contrast >= 4.5, `${color}: ${contrast}`);
        assert.equal(style.backgroundColor, color);
      }
    }
  }
});

void test("tag colors normalize shorthand and named colors, with safe readable fallbacks for invalid values", () => {
  assert.deepEqual(tagChipStyle("  #FFF "), { backgroundColor: "#ffffff", color: "#000000" });
  assert.deepEqual(tagChipStyle("green"), { backgroundColor: "#008000", color: "#ffffff" });
  for (const invalid of [
    "",
    "constructor",
    "__proto__",
    "url(https://example.test/image)",
    "#nothex",
    "transparent",
  ]) {
    assert.deepEqual(tagChipStyle(invalid), { backgroundColor: "#202832", color: "#ffffff" });
  }
});

void test("filled chips escape tag names and have a background and contrasting text without dot elements", () => {
  const html = renderToStaticMarkup(<TagChip tag={{ ...tag, name: "<script>Unsafe</script>" }} />);
  assert.match(html, /background-color:#7fbf90;color:#000000/);
  assert.match(html, /&lt;script&gt;Unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<i\b|<script>/);
});

void test("mod rows, tag assignment, management and bulk editing share the filled chip representation", () => {
  const views = [
    renderToStaticMarkup(
      <ModRow
        mod={mod("1")}
        tags={[tag]}
        active
        selected
        subscriptionAction="unsubscribe"
        onSelect={noop}
        onToggle={noop}
      />,
    ),
    renderToStaticMarkup(
      <TagAssignments tags={[tag]} assignedIds={[]} onToggle={noop} onCreate={noop} />,
    ),
    renderToStaticMarkup(
      <ManageTagsModal tags={[tag]} onCreate={noop} onEdit={noop} onDelete={noop} onClose={noop} />,
    ),
    renderToStaticMarkup(
      <BulkTagsModal
        mods={[mod("1")]}
        tags={[tag]}
        assigned
        onClose={noop}
        onConfirm={noop}
        onCreateTag={noop}
      />,
    ),
  ];
  for (const html of views) {
    assert.match(html, /class="user-tag"/);
    assert.match(html, /background-color:#7fbf90;color:#000000/);
    assert.doesNotMatch(html, /<i\b/);
  }
  assert.ok(
    requireValue(views[0]).indexOf('class="active-pill"') <
      requireValue(views[0]).indexOf('class="user-tag"'),
  );
});

void test("active sorting combines with scoped search and keeps the game's order without editing tags", () => {
  const mods = [mod("1"), { ...mod("2"), author: "Special author", userTagIds: [] }, mod("3")];
  const before = JSON.stringify(mods);
  const order = new Map([
    ["3", 1],
    ["2", 3],
  ]);
  const ids = new Set(["2", "3"]);
  assert.deepEqual(
    filterLibrary(mods, "", searchScopes.all, "active", [], order).map((entry) => entry.id),
    ["3", "2", "1"],
  );
  assert.deepEqual(
    filterLibrary(mods, "special", searchScopes.author, "active", [], order).map(
      (entry) => entry.id,
    ),
    ["2"],
  );
  assert.deepEqual(
    filterLibrary(mods, "", searchScopes.all, "oldest", [], order).map((entry) => entry.id),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    filterLibrary(mods, "", searchScopes.all, "active").map((entry) => entry.id),
    ["3", "2", "1"],
  );
  assert.deepEqual(ids, new Set(["2", "3"]));
  assert.equal(JSON.stringify(mods), before);
});

void test("search scope selector replaces tag filtering and personal tag names remain searchable", () => {
  const realTag = { ...tag, id: "tag-active", name: "Active" };
  const html = renderToStaticMarkup(
    <ModsPanel {...panelProps} searchScope={searchScopes.tags} tags={[realTag]} />,
  );
  assert.match(html, /aria-label="Search subscribed mods by"/);
  assert.match(html, /<option value="all">All<\/option>/);
  assert.match(html, /<option value="tags" selected="">Tags<\/option>/);
  assert.doesNotMatch(html, /Filter subscribed by tag|All tags|Untagged|system:active/);
  assert.deepEqual(
    filterLibrary(
      [{ ...mod("1"), userTagIds: [realTag.id] }, mod("2")],
      "active",
      searchScopes.tags,
      "newest",
      [realTag],
    ).map((entry) => entry.id),
    ["1"],
  );
});

void test("the header contains labeled icon commands and status messages without library or tag statistics", () => {
  for (const disabled of [false, true]) {
    const html = renderToStaticMarkup(
      <AppHeader
        notice="Ready"
        activeError="Config unavailable"
        disabled={disabled}
        onOpenSettings={noop}
        onManageTags={noop}
        onSync={noop}
        onUnsubscribeInactive={noop}
      />,
    );
    assert.match(html, /<span>Manage Tags<\/span>/);
    assert.match(html, /<span>Sync Workshop<\/span>/);
    assert.match(html, /lucide-tags/);
    assert.match(html, /lucide-refresh-cw/);
    assert.doesNotMatch(html, /Library statistics|\d+ saved|\d+ subscribed|\d+ tags/);
    assert.match(html, /<span>Unsubscribe non-active<\/span>/);
    assert.equal((html.match(/<button[^>]*disabled=""/g) ?? []).length, disabled ? 3 : 1);
    assert.ok(html.indexOf("Ready") < html.indexOf("Active status could not be fully verified"));
  }
});

void test("Mod Info retains long content and constrains horizontal overflow through wrapping rather than truncating metadata", async () => {
  const content = "VeryLongUnbrokenText".repeat(100);
  const html = renderToStaticMarkup(
    <ModInfoPanel
      mod={{
        ...mod("1"),
        name: content,
        author: content,
        packageId: content,
        summary: content,
        gameVersions: [content],
      }}
      tags={[{ ...tag, name: content }]}
      onRemoveModFromLibrary={noop}
      onAssignTag={noop}
      onCreateTag={noop}
    />,
  );
  assert.ok((html.match(new RegExp(content, "g")) ?? []).length >= 6);
  const css = await readFile("src/renderer/src/styles/custom.css", "utf8");
  const tagsCss = await readFile("src/renderer/src/styles/tags.css", "utf8");
  assert.match(css, /\.mod-info\s*\{[^}]*min-w-0[^}]*overflow-x-hidden overflow-y-auto/);
  assert.match(css, /\.info-heading\s*\{[^}]*flex-wrap/);
  for (const selector of ["summary", "metadata-list dd", "info-panel .version-row span"]) {
    assert.ok(css.includes(`.${selector} {`));
    assert.match(
      requireValue(css.slice(css.indexOf(`.${selector} {`)).split("}")[0]),
      /overflow-wrap: anywhere/,
    );
  }
  assert.match(
    tagsCss,
    /\.tag-assignments \.user-tag > span\s*\{[^}]*whitespace-normal[^}]*overflow-wrap: anywhere/,
  );
  assert.match(tagsCss, /\.assignment-options\s*\{[^}]*overflow-x-hidden overflow-y-auto/);
});

void test("enabled context actions have a brighter hover and keyboard-focus background without changing disabled actions", async () => {
  const css = await readFile("src/renderer/src/styles/selection.css", "utf8");
  assert.match(
    css,
    /\.mod-context-actions button:not\(:disabled\):hover,[\s\S]*?button:not\(:disabled\):focus-visible\s*\{[^}]*bg-white\/10/,
  );
  assert.match(css, /\.mod-context-actions button\s*\{[^}]*transition-colors/);
});

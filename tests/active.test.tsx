import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ModRowView as ModRow } from "../src/renderer/src/components/common/ModRow";
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

void test("active panel shows Core, load positions and auto-sort while preserving game order", () => {
  const core: Mod = {
    ...mod("core"),
    id: "active-package:ludeon.rimworld",
    workshopId: undefined,
    packageId: "ludeon.rimworld",
    name: "Core",
    source: "local",
    subscribed: false,
  };
  const html = renderToStaticMarkup(
    <SubscribedModsPanel
      mods={[core, mod("2"), mod("1")]}
      totalCount={3}
      tags={requireValue(saved.userTags)}
      search=""
      searchScope="all"
      sort="load-order"
      activeIds={new Set([core.id, "steam-1", "steam-2"])}
      activeOrder={
        new Map([
          [core.id, 1],
          ["steam-2", 2],
          ["steam-1", 4],
        ])
      }
      onSelect={noop}
      onSearch={noop}
      onSearchScope={noop}
      onSort={noop}
      onSubscribe={noop}
      onUnsubscribe={noop}
      onRestore={noop}
      onAutoSort={noop}
    />,
  );
  assert.match(html, /aria-label="Active mods"/);
  assert.match(html, /Auto-sort/);
  assert.match(html, /Restore/);
  const restoreButton = requireValue(
    /<button[^>]*aria-label="Restore active mods"[^>]*>/.exec(html),
  )[0];
  assert.doesNotMatch(restoreButton, /disabled/);
  assert.match(restoreButton, /restore-action/);
  assert.match(html, /lucide-rotate-ccw/);
  const autoSortButton = requireValue(
    /<button[^>]*aria-label="Auto-sort active mods"[^>]*>/.exec(html),
  )[0];
  for (const className of ["px-2.5", "text-xs", "whitespace-nowrap"]) {
    assert.ok(restoreButton.includes(className));
    assert.ok(autoSortButton.includes(className));
  }
  assert.match(html, />Load order<\/option>/);
  assert.doesNotMatch(html, />Active first<\/option>/);
  assert.match(html, /class="official-marker"/);
  assert.match(html, /lucide-shield-check/);
  assert.match(html, /Core<\/span>/);
  assert.match(html, /class="load-order-number" aria-label="Load order 1">1<\/span>/);
  assert.match(html, /class="load-order-number" aria-label="Load order 4">4<\/span>/);
  assert.doesNotMatch(html, /class="active-pill"|lucide-play|>#\d+</);
  assert.ok(html.indexOf("Core") < html.indexOf("Mod 2"));
  assert.ok(html.indexOf("Mod 2") < html.indexOf("Mod 1"));
  assert.match(html, /3 active/);
  assert.doesNotMatch(html, /Unapplied draft|Subscribe to|Unsubscribe from/);
});

void test("Restore exposes its disabled reason without changing its accessible name", () => {
  const reason = "Only RimWorld and DLC are active";
  const html = renderToStaticMarkup(
    <SubscribedModsPanel
      mods={[]}
      totalCount={0}
      tags={[]}
      search=""
      searchScope="all"
      sort="load-order"
      activeIds={new Set()}
      onSelect={noop}
      onSearch={noop}
      onSearchScope={noop}
      onSort={noop}
      onSubscribe={noop}
      onUnsubscribe={noop}
      onRestore={noop}
      restoreDisabledReason={reason}
    />,
  );
  const button = requireValue(/<button[^>]*aria-label="Restore active mods"[^>]*>/.exec(html))[0];
  assert.match(button, /disabled/);
  assert.match(html, new RegExp(`data-tip="${reason}"`));
  assert.match(html, />Restore<\/button>/);
});

void test("active panel exposes distinct compact loading states without hiding fast rows", () => {
  const loadingMetadata = renderToStaticMarkup(
    <SubscribedModsPanel
      mods={[mod("1")]}
      totalCount={1}
      tags={[]}
      search=""
      searchScope="all"
      sort="load-order"
      activeIds={new Set(["steam-1"])}
      activeMetadataLoading
      onSelect={noop}
      onSearch={noop}
      onSearchScope={noop}
      onSort={noop}
      onSubscribe={noop}
      onUnsubscribe={noop}
    />,
  );
  const metadataSection = requireValue(
    /<section[^>]*aria-label="Active mods"[^>]*>/.exec(loadingMetadata),
  )[0];
  const metadataList = requireValue(
    /<div[^>]*class="mod-list virtualized"[^>]*>/.exec(loadingMetadata),
  )[0];
  assert.doesNotMatch(metadataSection, /aria-busy/);
  assert.match(metadataList, /role="list"/);
  assert.match(metadataList, /aria-busy="true"/);
  assert.match(loadingMetadata, /Mod 1/);
  assert.match(loadingMetadata, /role="status"[^>]*aria-live="polite"/);
  assert.match(loadingMetadata, /lucide-loader-circle/);
  assert.match(loadingMetadata, /Loading mod details…/);
  assert.doesNotMatch(loadingMetadata, /Loading active mods|No active mods/);

  const loadingConfiguration = renderToStaticMarkup(
    <SubscribedModsPanel
      mods={[]}
      totalCount={0}
      tags={[]}
      search=""
      searchScope="all"
      sort="load-order"
      activeIds={new Set()}
      activeLoading
      onSelect={noop}
      onSearch={noop}
      onSearchScope={noop}
      onSort={noop}
      onSubscribe={noop}
      onUnsubscribe={noop}
    />,
  );
  const configurationSection = requireValue(
    /<section[^>]*aria-label="Active mods"[^>]*>/.exec(loadingConfiguration),
  )[0];
  const configurationList = requireValue(
    /<div[^>]*class="mod-list virtualized"[^>]*>/.exec(loadingConfiguration),
  )[0];
  assert.doesNotMatch(configurationSection, /aria-busy/);
  assert.match(configurationList, /aria-busy="true"/);
  assert.match(loadingConfiguration, /— mods/);
  assert.match(loadingConfiguration, /— total/);
  assert.match(loadingConfiguration, /Loading active mods…/);
  assert.doesNotMatch(loadingConfiguration, /No active mods|0 mods/);

  const refreshingConfiguration = renderToStaticMarkup(
    <SubscribedModsPanel
      mods={[mod("1")]}
      totalCount={1}
      tags={[]}
      search=""
      searchScope="all"
      sort="load-order"
      activeIds={new Set(["steam-1"])}
      activeRefreshing
      onSelect={noop}
      onSearch={noop}
      onSearchScope={noop}
      onSort={noop}
      onSubscribe={noop}
      onUnsubscribe={noop}
    />,
  );
  assert.match(refreshingConfiguration, /Mod 1/);
  assert.match(refreshingConfiguration, /aria-busy="true"/);
  assert.match(refreshingConfiguration, /Checking active mods…/);
  assert.doesNotMatch(refreshingConfiguration, /Loading active mods|Loading mod details/);
});

void test("official DLC uses the blue Core icon marker while Workshop lookalikes do not", () => {
  const anomaly = {
    ...mod("anomaly"),
    id: "active-package:ludeon.rimworld.anomaly",
    workshopId: undefined,
    packageId: "LUDEON.RIMWORLD.ANOMALY_steam",
    source: "local" as const,
  };
  const render = (entry: Mod) =>
    renderToStaticMarkup(
      <ModRow
        mod={entry}
        tags={[]}
        selected={false}
        active
        loadOrder={5}
        subscriptionAction="unsubscribe"
        onSelect={noop}
        onToggle={noop}
      />,
    );
  assert.match(render(anomaly), /class="official-marker"/);
  assert.match(render(anomaly), /lucide-shield-check/);
  assert.doesNotMatch(
    render({ ...anomaly, id: "steam-lookalike", workshopId: "123" }),
    /class="official-marker"/,
  );
});

void test("load positions use a plain right-aligned tabular number column", async () => {
  const css = await readFile("src/renderer/src/styles/custom.css", "utf8");
  assert.match(css, /\.mod-row-main\s*\{[^}]*grid-cols-\[40px_minmax\(0,1fr\)_auto\]/);
  assert.match(
    css,
    /\.load-order-number\s*\{[^}]*col-start-3[^}]*justify-self-end[^}]*font-variant-numeric: tabular-nums/s,
  );
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
      sort="load-order"
      activeIds={new Set([dependent.id])}
      validationIssuesById={
        new Map([
          [
            dependent.id,
            [
              {
                id: "missing-harmony",
                code: "missing-dependency" as const,
                fix: "activate-dependencies" as const,
                message: "Mod 1 requires active dependency Harmony.",
              },
            ],
          ],
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
  assert.match(html, /1 missing dependency/);
  assert.match(html, /requires active dependency Harmony/);
});

void test("active rows combine version and order findings into one validation error pill", () => {
  const entry = mod("1");
  const html = renderToStaticMarkup(
    <ModRow
      mod={entry}
      tags={[]}
      selected={false}
      active
      validationIssues={[
        {
          id: "version",
          code: "incompatible-version",
          message: "Mod 1 supports RimWorld 1.5, not 1.6.",
        },
        {
          id: "order",
          code: "load-order",
          fix: "auto-sort",
          orderRule: "load-after",
          message: "Mod 1 must load after Harmony.",
        },
      ]}
      subscriptionAction="unsubscribe"
      onSelect={noop}
      onToggle={noop}
    />,
  );
  assert.match(html, /2 validation errors/);
  assert.match(html, /supports RimWorld 1.5, not 1.6/);
  assert.match(html, /must load after Harmony/);
});

void test("tag management keeps long names in their own column with accessible edit/delete tools", () => {
  const name = "A very long tag name ".repeat(5);
  const html = renderToStaticMarkup(
    <ManageTagsModal
      tags={[{ id: "long", name, color: "#7fbf90" }]}
      inactiveCountByTagId={new Map([["long", 1]])}
      onAddTagToActive={noop}
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

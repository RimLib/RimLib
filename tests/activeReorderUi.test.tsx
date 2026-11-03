import assert from "node:assert/strict";
import { test } from "node:test";

import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ModContextMenuContent } from "../src/renderer/src/components/common/ModContextMenu";
import { ModRowView } from "../src/renderer/src/components/common/ModRow";
import {
  ActiveModStatusFilters,
  ModsPanelView,
} from "../src/renderer/src/components/panels/ModsPanel";
import {
  type ModFilter,
  modFilters,
  modPanelModes,
  modSorts,
  modTagFilters,
  searchScopes,
} from "../src/renderer/src/utils/uiConstants";
import type { Mod } from "../src/shared/types";

const noop = () => undefined;
const mod = (id: string): Mod => ({
  id,
  workshopId: id,
  packageId: `author.${id}`,
  name: `Mod ${id}`,
  author: "Author",
  source: "steam",
  summary: "Description",
  tags: [],
  gameVersions: ["1.6"],
  screenshots: [],
  subscribed: true,
  addedAt: "2026-01-01T00:00:00.000Z",
  downloadedAt: "2026-01-01T00:00:00.000Z",
});
const mods = [mod("one"), mod("two")];
const panelProps = {
  mods,
  totalCount: mods.length,
  tags: [],
  selectedModId: mods[0]?.id,
  search: "",
  searchScope: searchScopes.all,
  sort: modSorts.loadOrder,
  activeIds: new Set(mods.map(({ id }) => id)),
  activeOrder: new Map(mods.map(({ id }, index) => [id, index + 1])),
  onSearch: noop,
  onSearchScope: noop,
  onSort: noop,
  onSelect: noop,
  onSubscribe: noop,
  onUnsubscribe: noop,
  onReorderActive: noop,
};

function findElement(
  node: ReactNode,
  predicate: (node: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) {
      continue;
    }
    if (predicate(child)) {
      return child;
    }
    const found = findElement(child.props.children as ReactNode, predicate);
    if (found) {
      return found;
    }
  }
  return undefined;
}

void test("only an unfiltered Active load-order view exposes draggable reorder grips", () => {
  const active = renderToStaticMarkup(
    <ModsPanelView {...panelProps} mode={modPanelModes.active} />,
  );
  assert.equal((active.match(/class="drag-handle "/g) ?? []).length, mods.length);
  assert.equal((active.match(/draggable="true"/g) ?? []).length, mods.length);
  assert.doesNotMatch(active, /class="drag-handle disabled"/);

  const searched = renderToStaticMarkup(
    <ModsPanelView {...panelProps} mode={modPanelModes.active} search="framework" />,
  );
  assert.equal((searched.match(/class="drag-handle disabled"/g) ?? []).length, mods.length);
  assert.equal((searched.match(/draggable="false"/g) ?? []).length, mods.length);
  assert.equal(
    (searched.match(/title="Clear the Active search to drag mods"/g) ?? []).length,
    mods.length,
  );

  const tagFiltered = renderToStaticMarkup(
    <ModsPanelView
      {...panelProps}
      mode={modPanelModes.active}
      tagFilter={modTagFilters.untagged}
    />,
  );
  assert.equal((tagFiltered.match(/class="drag-handle disabled"/g) ?? []).length, mods.length);
  assert.equal(
    (tagFiltered.match(/title="Show all tags to drag mods"/g) ?? []).length,
    mods.length,
  );

  const differentlySorted = renderToStaticMarkup(
    <ModsPanelView {...panelProps} mode={modPanelModes.active} sort={modSorts.newest} />,
  );
  const library = renderToStaticMarkup(
    <ModsPanelView {...panelProps} mode={modPanelModes.inactive} sort={modSorts.newest} />,
  );
  assert.doesNotMatch(differentlySorted, /drag-handle|draggable=/);
  assert.doesNotMatch(library, /drag-handle|draggable=/);
});

void test("Active row filters disable dragging, while a Library-only removed filter does not", () => {
  const markup = renderToStaticMarkup(
    <ModsPanelView
      {...panelProps}
      mode={modPanelModes.active}
      filter={modFilters.invalid}
      invalidCount={1}
    />,
  );
  assert.match(
    markup,
    /aria-label="Show all 2 active mods"[^>]*aria-controls="subscribed-mods-list"[^>]*aria-pressed="false"/,
  );
  assert.match(
    markup,
    /aria-label="Show 1 invalid active mod"[^>]*aria-controls="subscribed-mods-list"[^>]*aria-pressed="true"/,
  );
  assert.match(markup, />1 invalid<\/button>/);
  assert.equal((markup.match(/class="drag-handle disabled"/g) ?? []).length, mods.length);
  assert.equal(
    (markup.match(/title="Show all Active mods to drag mods"/g) ?? []).length,
    mods.length,
  );

  const newOnly = renderToStaticMarkup(
    <ModsPanelView
      {...panelProps}
      mode={modPanelModes.active}
      filter={modFilters.pendingActivation}
      statusFilter={modFilters.pendingActivation}
      newCount={mods.length}
    />,
  );
  assert.equal((newOnly.match(/class="drag-handle disabled"/g) ?? []).length, mods.length);
  assert.equal((newOnly.match(/draggable="false"/g) ?? []).length, mods.length);
  assert.equal(
    (newOnly.match(/title="Show all Active mods to drag mods"/g) ?? []).length,
    mods.length,
  );

  const removedInLibrary = renderToStaticMarkup(
    <ModsPanelView
      {...panelProps}
      mode={modPanelModes.active}
      filter={modFilters.all}
      statusFilter={modFilters.pendingDeactivation}
      removedCount={1}
      removedVisibleCount={1}
    />,
  );
  assert.equal((removedInLibrary.match(/class="drag-handle "/g) ?? []).length, mods.length);
  assert.equal((removedInLibrary.match(/draggable="true"/g) ?? []).length, mods.length);
  assert.doesNotMatch(removedInLibrary, /class="drag-handle disabled"/);
});

void test("Active footer exposes accessible singular and plural labels for every status chip", () => {
  const singular = renderToStaticMarkup(
    <ActiveModStatusFilters
      displayedTotal="4"
      filter={modFilters.all}
      invalidCount={1}
      newCount={1}
      removedCount={1}
      removedVisibleCount={1}
      totalCount={4}
      visibleCount={4}
    />,
  );
  assert.match(singular, /aria-label="Active mod status filters"/);
  assert.match(
    singular,
    /aria-label="Show all 4 active mods"[^>]*aria-controls="subscribed-mods-list"[^>]*aria-pressed="true"/,
  );
  assert.match(
    singular,
    /aria-label="Show 1 invalid active mod"[^>]*aria-controls="subscribed-mods-list"[^>]*aria-pressed="false"/,
  );
  assert.match(
    singular,
    /aria-label="Show 1 removed mod in Library"[^>]*aria-controls="unsubscribed-mods-list"[^>]*aria-pressed="false"/,
  );
  assert.match(
    singular,
    /aria-label="Show 1 new active mod"[^>]*aria-controls="subscribed-mods-list"[^>]*aria-pressed="false"/,
  );
  assert.match(singular, />1 invalid<\/button>/);
  assert.match(singular, />1 removed<\/button>/);
  assert.match(singular, />1 new<\/button>/);

  const plural = renderToStaticMarkup(
    <ActiveModStatusFilters
      displayedTotal="6"
      filter={modFilters.pendingActivation}
      invalidCount={2}
      newCount={2}
      removedCount={2}
      removedVisibleCount={2}
      totalCount={6}
      visibleCount={2}
    />,
  );
  assert.match(plural, /aria-label="Show 2 invalid active mods"[^>]*aria-pressed="false"/);
  assert.match(plural, /aria-label="Show 2 removed mods in Library"[^>]*aria-pressed="false"/);
  assert.match(plural, /aria-label="Show 2 new active mods"[^>]*aria-pressed="true"/);
});

void test("Active footer status chips are mutually exclusive and re-clicking one restores total", () => {
  const filters = [
    {
      value: modFilters.invalid,
      label: "Show 1 invalid active mod",
    },
    {
      value: modFilters.pendingDeactivation,
      label: "Show 1 removed mod in Library",
    },
    {
      value: modFilters.pendingActivation,
      label: "Show 1 new active mod",
    },
  ] as const;

  for (const selectedFilter of filters) {
    const selected: ModFilter[] = [];
    const tree = ActiveModStatusFilters({
      displayedTotal: "4",
      invalidCount: 1,
      newCount: 1,
      removedCount: 1,
      removedVisibleCount: 1,
      totalCount: 4,
      visibleCount: 1,
      filter: selectedFilter.value,
      onFilter: (value) => selected.push(value),
    });
    const total = findElement(
      tree,
      (node) => node.props["aria-label"] === "Show all 4 active mods",
    );
    const selectedButton = findElement(
      tree,
      (node) => node.props["aria-label"] === selectedFilter.label,
    );
    assert.ok(total);
    assert.ok(selectedButton);
    assert.equal(total.props["aria-pressed"], false);
    assert.equal(selectedButton.props["aria-pressed"], true);
    assert.equal((renderToStaticMarkup(tree).match(/aria-pressed="true"/g) ?? []).length, 1);
    (selectedButton.props.onClick as () => void)();
    assert.deepEqual(selected, [modFilters.all]);
  }

  const selected: ModFilter[] = [];
  const tree = ActiveModStatusFilters({
    displayedTotal: "4",
    invalidCount: 1,
    newCount: 1,
    removedCount: 1,
    removedVisibleCount: 1,
    totalCount: 4,
    visibleCount: 4,
    filter: modFilters.all,
    onFilter: (value) => selected.push(value),
  });
  const total = findElement(tree, (node) => node.props["aria-label"] === "Show all 4 active mods");
  assert.ok(total);
  assert.equal(total.props["aria-pressed"], true);
  assert.equal((renderToStaticMarkup(tree).match(/aria-pressed="true"/g) ?? []).length, 1);
  (total.props.onClick as () => void)();
  for (const target of filters) {
    const button = findElement(tree, (node) => node.props["aria-label"] === target.label);
    assert.ok(button);
    assert.equal(button.props["aria-pressed"], false);
    (button.props.onClick as () => void)();
  }
  assert.deepEqual(selected, [modFilters.all, ...filters.map(({ value }) => value)]);
});

void test("row drag handlers report before and after placement from the pointer position", () => {
  const renderRow = (ModRowView as unknown as { type: (props: object) => ReactNode }).type;
  const started: string[] = [];
  const hovered: [string, "before" | "after"][] = [];
  const dropped: [string, "before" | "after"][] = [];
  let ended = 0;
  let prevented = 0;
  const transferred: [string, string][] = [];
  const dataTransfer = {
    dropEffect: "none",
    effectAllowed: "none",
    setData: (type: string, value: string) => transferred.push([type, value]),
  };
  const tree = renderRow({
    mod: mods[0],
    tags: [],
    selected: false,
    active: true,
    loadOrder: 1,
    subscriptionAction: "unsubscribe",
    showReorderHandle: true,
    reorderable: true,
    onSelect: noop,
    onToggle: noop,
    onReorderDragStart: (id: string) => started.push(id),
    onReorderDragOver: (id: string, placement: "before" | "after") => hovered.push([id, placement]),
    onReorderDrop: (id: string, placement: "before" | "after") => dropped.push([id, placement]),
    onReorderDragEnd: () => ended++,
  });
  const handle = findElement(
    tree,
    (node) =>
      typeof node.props.className === "string" && node.props.className.includes("drag-handle"),
  );
  const row = findElement(tree, (node) => node.props.role === "listitem");
  assert.ok(handle);
  assert.ok(row);

  (handle.props.onDragStart as (event: object) => void)({
    dataTransfer,
    preventDefault: () => prevented++,
  });
  assert.equal(dataTransfer.effectAllowed, "move");
  assert.deepEqual(transferred, [["text/plain", "one"]]);
  assert.deepEqual(started, ["one"]);

  const currentTarget = {
    getBoundingClientRect: () => ({ top: 100, height: 80 }),
  };
  const dragEvent = (clientY: number) => ({
    clientY,
    currentTarget,
    dataTransfer,
    preventDefault: () => prevented++,
  });
  const onDragOver = row.props.onDragOver as (event: object) => void;
  const onDrop = row.props.onDrop as (event: object) => void;
  onDragOver(dragEvent(120));
  onDragOver(dragEvent(170));
  onDrop(dragEvent(120));
  onDrop(dragEvent(170));
  assert.equal(dataTransfer.dropEffect, "move");
  assert.deepEqual(hovered, [
    ["one", "before"],
    ["one", "after"],
  ]);
  assert.deepEqual(dropped, [
    ["one", "before"],
    ["one", "after"],
  ]);
  assert.equal(prevented, 4);

  (handle.props.onDragEnd as () => void)();
  assert.equal(ended, 1);
});

void test("Move to position is callback-gated and honors its disabled reason", () => {
  let moves = 0;
  const baseProps = {
    count: 1,
    showSubscription: false,
    onAddTags: noop,
    onRemoveTags: noop,
    onRemoveFromLibrary: noop,
  };
  const enabledTree = ModContextMenuContent({
    ...baseProps,
    onMoveToPosition: () => moves++,
  });
  const enabled = findElement(
    enabledTree,
    (node) =>
      node.props.role === "menuitem" &&
      Children.toArray(node.props.children as ReactNode).includes("Move to position…"),
  );
  assert.ok(enabled);
  assert.equal(enabled.props.disabled, false);
  (enabled.props.onClick as () => void)();
  assert.equal(moves, 1);

  const disabledTree = ModContextMenuContent({
    ...baseProps,
    positionDisabledReason: "Active configuration is unavailable",
    onMoveToPosition: () => moves++,
  });
  const disabled = findElement(
    disabledTree,
    (node) =>
      node.props.role === "menuitem" &&
      Children.toArray(node.props.children as ReactNode).includes("Move to position…"),
  );
  assert.ok(disabled);
  assert.equal(disabled.props.disabled, true);
  (disabled.props.onClick as () => void)();
  assert.equal(moves, 1);
  assert.match(renderToStaticMarkup(disabledTree), /title="Active configuration is unavailable"/);

  const withoutCallback = renderToStaticMarkup(<ModContextMenuContent {...baseProps} />);
  assert.doesNotMatch(withoutCallback, /Move to position/);
});

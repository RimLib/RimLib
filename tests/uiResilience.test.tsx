import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AppHeader } from "../src/renderer/src/components/AppHeader";
import { ErrorNotification } from "../src/renderer/src/components/common/ErrorNotification";
import { PanelErrorBoundary } from "../src/renderer/src/components/common/PanelErrorBoundary";
import { TooltipIconButton } from "../src/renderer/src/components/common/TooltipIconButton";
import { reportRendererError } from "../src/renderer/src/services/diagnostics";
import { performUiAction } from "../src/renderer/src/services/uiActions";
import { errorMessage } from "../src/renderer/src/utils/errors";
import { positionTooltip, type TooltipPlacement } from "../src/renderer/src/utils/tooltips";
import type { Mod } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";

const noop = () => undefined;
const mod: Mod = {
  id: "steam-123",
  workshopId: "123",
  name: "Mod",
  author: "Author",
  source: "steam",
  summary: "Saved description",
  tags: [],
  userTagIds: ["qol"],
  gameVersions: [],
  screenshots: [],
  subscribed: true,
  downloadedAt: "",
  addedAt: "",
};

void test("notification title has visibly stronger typography and permits synthesized bold without changing description weight", async () => {
  const html = renderToStaticMarkup(
    <ErrorNotification message="Steam is unavailable" onDismiss={noop} />,
  );
  assert.match(html, /<strong class="error-notification-title">Action failed<\/strong>/);
  assert.match(html, /<p class="error-notification-description[^>]*>Steam is unavailable<\/p>/);
  const css = await readFile("src/renderer/src/styles/notifications.css", "utf8");
  assert.match(css, /@layer utilities/);
  assert.match(
    css,
    /\.error-notification \.error-notification-title\s*\{[^}]*display: block;[^}]*font-size: 15px;[^}]*font-weight: 800;[^}]*font-synthesis: weight;/,
  );
  assert.match(
    css,
    /\.error-notification \.error-notification-description\s*\{[^}]*font-size: 13px;[^}]*font-weight: 400;/,
  );
});

void test("subscription rows use opposite action columns and two-column content grids without a reserved date column", async () => {
  const css = await readFile("src/renderer/src/styles/custom.css", "utf8");
  const tags = await readFile("src/renderer/src/styles/tags.css", "utf8");
  assert.match(css, /\.mod-row\s*\{[^}]*grid-cols-\[minmax\(0,1fr\)_42px\]/);
  assert.match(css, /\.mod-row\.action-start\s*\{\s*@apply grid-cols-\[42px_minmax\(0,1fr\)\]/);
  assert.match(css, /\.mod-row\.action-start > \.tooltip-action\s*\{\s*@apply col-start-1/);
  assert.match(css, /\.mod-row\.action-start > \.mod-row-main\s*\{\s*@apply col-start-2/);
  assert.match(css, /\.mod-row-main\s*\{[^}]*grid-cols-\[40px_minmax\(0,1fr\)\]/);
  assert.match(css, /\.mod-row-status\s*\{\s*@apply col-start-2 row-start-2/);
  assert.doesNotMatch(tags, /\.row-tags/);
  assert.match(css, /grid-rows-\[minmax\(0,1fr\)_24px\]/);
  assert.match(css, /\.mod-row-main \.thumb\s*\{\s*@apply col-start-1 row-span-2/);
  assert.doesNotMatch(css, /\.date-pill/);
});

void test("the action runner handles synchronous and asynchronous failures without resetting data or header status", async () => {
  const library = {
    mods: [mod],
    selectedModId: mod.id,
    userTags: [{ id: "qol", name: "QoL", color: "#00ff00" }],
  };
  const before = JSON.stringify(library);
  const notice = "Library ready";
  const notifications: string[] = [];
  const notify = (error: unknown) => notifications.push(errorMessage(error));
  const details =
    "Error invoking remote method 'mod:reveal-folder': Error: The mod folder was not found: /Volumes/" +
    "Disconnected drive/".repeat(200);
  assert.equal(
    await performUiAction<unknown>(() => {
      throw new Error(details);
    }, notify),
    undefined,
  );
  let busy = true;
  assert.equal(
    await performUiAction<unknown>(async () => {
      try {
        throw new Error("Default browser unavailable");
      } finally {
        busy = false;
      }
    }, notify),
    undefined,
  );
  assert.equal(busy, false);
  assert.equal(notice, "Library ready");
  assert.equal(JSON.stringify(library), before);
  assert.equal(notifications.length, 2);
  assert.match(requireValue(notifications[0]), /^The mod folder was not found/);
  assert.equal(notifications[1], "Default browser unavailable");
  assert.equal(await performUiAction<unknown>(() => "retry succeeded", notify), "retry succeeded");
  assert.equal(notifications.length, 2);
});

void test("error formatting cannot throw while handling a broken or unexpected error value", () => {
  const broken = new Error();
  Object.defineProperty(broken, "message", {
    get: () => {
      throw new Error("Bad error getter");
    },
  });
  assert.match(errorMessage(broken), /could not be completed/);
  assert.equal(
    errorMessage("Error: Error invoking remote method 'mod:reveal-folder': Error: Folder missing"),
    "Folder missing",
  );
});

void test("a panel failure retains its children for retry and shows a small isolated fallback", () => {
  const content = <section data-mod-id={mod.id}>Saved mod details</section>;
  const errors: unknown[] = [];
  const boundary = new PanelErrorBoundary({
    name: "Mod Info",
    children: content,
    onError: (error) => errors.push(error),
  });
  assert.equal(boundary.render(), content);
  boundary.state = PanelErrorBoundary.getDerivedStateFromError();
  const error = new Error("Rendering failed");
  boundary.componentDidCatch(error, { componentStack: "ModInfoPanel" });
  assert.deepEqual(errors, [error]);
  const html = renderToStaticMarkup(boundary.render());
  assert.match(html, /Mod Info could not be displayed/);
  assert.match(html, /Your library was retained/);
  assert.match(html, />Retry<\/button>/);
  assert.doesNotMatch(html, /Rendering failed|Loading database/);
  boundary.state = { failed: false };
  assert.equal(boundary.render(), content);
});

void test("diagnostic failures do not interrupt reporting or panel recovery", () => {
  const original = Reflect.get(globalThis, "window") as Window | undefined;
  try {
    Object.assign(globalThis, {
      window: {
        appDiagnostics: {
          reportError: () => {
            throw new Error("IPC unavailable");
          },
        },
      },
    });
    assert.doesNotThrow(() => {
      reportRendererError("react.error", new Error("Original error"));
    });
    let notified = false;
    const boundary = new PanelErrorBoundary({
      name: "Library",
      children: null,
      onError: () => {
        notified = true;
      },
    });
    assert.doesNotThrow(() => {
      boundary.componentDidCatch(new Error("Original error"), { componentStack: "ModsPanel" });
    });
    assert.equal(notified, true);
  } finally {
    if (!original) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", original);
    }
  }
});

void test("even extremely long header notices have shrinking, single-line containers", () => {
  const html = renderToStaticMarkup(
    <AppHeader
      notice={"/Volumes/Drive/".repeat(1000)}
      disabled={false}
      onOpenSettings={noop}
      onManageTags={noop}
      onSync={noop}
      onUnsubscribeInactive={noop}
    />,
  );
  assert.match(html, /<header class="flex min-h-\[74px\] min-w-0/);
  assert.match(html, /class="flex min-w-0 flex-1 items-center/);
  assert.match(html, /<span class="min-w-0 truncate">/);
  assert.match(html, /aria-label="Manage Tags"/);
  assert.match(html, /aria-label="Sync Workshop"/);
});

const viewport = { width: 1180, height: 720 };
const rect = (left: number, top: number) => ({
  left,
  top,
  right: left + 34,
  bottom: top + 34,
  width: 34,
  height: 34,
});

void test("tooltip placement follows the requested side when there is room", () => {
  const anchor = rect(500, 300);
  const size = { width: 200, height: 32 };
  assert.deepEqual(positionTooltip(anchor, size, viewport, "top"), { left: 417, top: 260 });
  assert.deepEqual(positionTooltip(anchor, size, viewport, "bottom"), { left: 417, top: 342 });
  assert.deepEqual(positionTooltip(anchor, size, viewport, "left"), { left: 292, top: 301 });
  assert.deepEqual(positionTooltip(anchor, size, viewport, "right"), { left: 542, top: 301 });
});

void test("tooltips flip at viewport edges and long labels stay inside the viewport", () => {
  const size = { width: 320, height: 80 };
  const cases: [ReturnType<typeof rect>, TooltipPlacement][] = [
    [rect(4, 300), "left"],
    [rect(1140, 300), "right"],
    [rect(500, 0), "top"],
    [rect(500, 680), "bottom"],
    [rect(0, 0), "top"],
    [rect(1146, 686), "bottom"],
  ];
  for (const [anchor, placement] of cases) {
    const result = positionTooltip(anchor, size, viewport, placement);
    assert.ok(result.left >= 8 && result.top >= 8);
    assert.ok(result.left + size.width <= viewport.width - 8);
    assert.ok(result.top + size.height <= viewport.height - 8);
  }
  assert.equal(positionTooltip(rect(4, 300), size, viewport, "left").left, 46);
  assert.equal(positionTooltip(rect(1140, 300), size, viewport, "right").left, 812);
  assert.equal(positionTooltip(rect(500, 0), size, viewport, "top").top, 42);
  assert.equal(positionTooltip(rect(500, 680), size, viewport, "bottom").top, 592);
});

void test("tooltip triggers keep accessible command labels and descriptions without in-panel tooltip content", () => {
  const html = renderToStaticMarkup(
    <TooltipIconButton
      label="Steam is closed"
      aria-label="Subscribe to Mod"
      aria-describedby="existing-description"
      disabled
      placement="left"
    >
      <span>Icon</span>
    </TooltipIconButton>,
  );
  assert.match(html, /class="tooltip-action" data-tip="Steam is closed"/);
  assert.match(html, /aria-label="Subscribe to Mod"/);
  assert.match(html, /aria-describedby="existing-description"/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /class="tooltip |role="tooltip"/);
});

import { ArrowLeft, ArrowRight, Tag, Tags, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useWorkspaceStore } from "../../stores/WorkspaceStoreProvider";
import { menuFocusIndex, type MenuPoint, positionContextMenu } from "../../utils/modSelection";
import { keyboardKeys, modPanelModes } from "../../utils/uiConstants";

export interface ModContextMenuContentProps {
  count: number;
  subscribed: boolean;
  tagsDisabledReason?: string;
  removeTagsDisabledReason?: string;
  subscriptionDisabledReason?: string;
  removalDisabledReason?: string;
  onAddTags: () => void;
  onRemoveTags: () => void;
  onSubscription: () => void;
  onRemoveFromLibrary: () => void;
}

export function ModContextMenuContent({
  count,
  subscribed,
  tagsDisabledReason,
  removeTagsDisabledReason,
  subscriptionDisabledReason,
  removalDisabledReason,
  onAddTags,
  onRemoveTags,
  onSubscription,
  onRemoveFromLibrary,
}: ModContextMenuContentProps) {
  const removeReason = tagsDisabledReason ?? removeTagsDisabledReason;
  const libraryReason =
    removalDisabledReason ??
    tagsDisabledReason ??
    (subscribed ? "Unsubscribe these mods before removing them from the library" : undefined);
  return (
    <ul className="menu mod-context-actions" role="menu" aria-label="Selected mod actions">
      <li className="menu-title" role="presentation">
        {count} {count === 1 ? "mod" : "mods"} selected
      </li>
      <li role="none" title={tagsDisabledReason}>
        <button
          type="button"
          role="menuitem"
          disabled={Boolean(tagsDisabledReason)}
          onClick={() => {
            if (!tagsDisabledReason) {
              onAddTags();
            }
          }}
        >
          <Tags size={16} aria-hidden />
          Add tags
        </button>
      </li>
      <li role="none" title={removeReason}>
        <button
          type="button"
          role="menuitem"
          disabled={Boolean(removeReason)}
          onClick={() => {
            if (!removeReason) {
              onRemoveTags();
            }
          }}
        >
          <Tag size={16} aria-hidden />
          Remove tags
        </button>
      </li>
      <li role="none" title={subscriptionDisabledReason}>
        <button
          type="button"
          role="menuitem"
          className={subscribed ? "context-unsubscribe" : "context-subscribe"}
          disabled={Boolean(subscriptionDisabledReason)}
          onClick={() => {
            if (!subscriptionDisabledReason) {
              onSubscription();
            }
          }}
        >
          {subscribed ? <ArrowLeft size={16} aria-hidden /> : <ArrowRight size={16} aria-hidden />}
          {subscribed ? "Unsubscribe" : "Subscribe"}
        </button>
      </li>
      <li role="none" title={libraryReason}>
        <button
          type="button"
          role="menuitem"
          className="context-unsubscribe"
          disabled={Boolean(libraryReason)}
          onClick={() => {
            if (!libraryReason) {
              onRemoveFromLibrary();
            }
          }}
        >
          <Trash2 size={16} aria-hidden />
          Remove from library
        </button>
      </li>
    </ul>
  );
}

export function WorkspaceModContextMenu(props: Omit<ModContextMenuContentProps, "subscribed">) {
  const contextMenu = useWorkspaceStore((state) => state.contextMenu);
  const focusedModId = useWorkspaceStore((state) => state.focusedModId);
  const close = useWorkspaceStore((state) => state.actions.closeContext);

  if (!contextMenu) {
    return null;
  }
  return (
    <ModContextMenu
      {...props}
      x={contextMenu.x}
      y={contextMenu.y}
      focusKey={focusedModId}
      subscribed={contextMenu.panel === modPanelModes.subscribed}
      onClose={close}
    />
  );
}

export function ModContextMenu({
  x,
  y,
  focusKey,
  onClose,
  ...props
}: MenuPoint & ModContextMenuContentProps & { focusKey?: string; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) {
      return;
    }
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPosition(
      positionContextMenu({ x, y }, element.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
    (
      element.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? element
    ).focus({ preventScroll: true });
  }, [x, y, focusKey]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== keyboardKeys.escape && event.key !== "Tab") {
        return;
      }
      event.preventDefault();
      onClose();
      returnFocus.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ),
    ];
    const next = menuFocusIndex(
      event.key,
      buttons.indexOf(document.activeElement as HTMLButtonElement),
      buttons.length,
    );
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    buttons[next]?.focus();
  }

  return createPortal(
    <div
      className="mod-context-menu"
      ref={container}
      tabIndex={-1}
      onKeyDown={navigate}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      style={{
        left: position?.left ?? x,
        top: position?.top ?? y,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <ModContextMenuContent {...props} />
    </div>,
    document.body,
  );
}

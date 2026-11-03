import {
  ArrowLeft,
  ArrowRight,
  CircleMinus,
  CirclePlus,
  ListOrdered,
  Tag,
  Tags,
  Trash2,
} from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useWorkspaceStore } from "../../stores/WorkspaceStoreProvider";
import { menuFocusIndex, type MenuPoint, positionContextMenu } from "../../utils/modSelection";
import { keyboardKeys, modPanelModes } from "../../utils/uiConstants";

export interface ModContextMenuContentProps {
  count: number;
  subscribed?: boolean;
  showSubscription?: boolean;
  tagsDisabledReason?: string;
  removeTagsDisabledReason?: string;
  subscriptionDisabledReason?: string;
  subscribeDisabledReason?: string;
  unsubscribeDisabledReason?: string;
  activityDisabledReason?: string;
  removalDisabledReason?: string;
  positionDisabledReason?: string;
  removalRequiresUnsubscribe?: boolean;
  onAddTags: () => void;
  onRemoveTags: () => void;
  onSubscription?: () => void;
  onSubscribe?: () => void;
  onUnsubscribe?: () => void;
  onAddToActive?: () => void;
  onRemoveFromActive?: () => void;
  onMoveToPosition?: () => void;
  onRemoveFromLibrary: () => void;
}

export function ModContextMenuContent({
  count,
  subscribed,
  showSubscription = true,
  tagsDisabledReason,
  removeTagsDisabledReason,
  subscriptionDisabledReason,
  subscribeDisabledReason,
  unsubscribeDisabledReason,
  activityDisabledReason,
  removalDisabledReason,
  positionDisabledReason,
  removalRequiresUnsubscribe = false,
  onAddTags,
  onRemoveTags,
  onSubscription,
  onSubscribe,
  onUnsubscribe,
  onAddToActive,
  onRemoveFromActive,
  onMoveToPosition,
  onRemoveFromLibrary,
}: ModContextMenuContentProps) {
  const removeReason = tagsDisabledReason ?? removeTagsDisabledReason;
  const libraryReason = removalDisabledReason ?? tagsDisabledReason;
  const libraryActionDescription = removalRequiresUnsubscribe
    ? count > 1
      ? `Unsubscribe and remove ${count} mods from library`
      : "Unsubscribe and remove from library"
    : count > 1
      ? `Remove ${count} mods from library`
      : "Remove from library";
  const addToActiveDescription = count > 1 ? `Add ${count} mods to Active` : "Add mod to Active";
  const removeFromActiveDescription =
    count > 1 ? `Remove ${count} mods from Active` : "Remove mod from Active";
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
      {onAddToActive && (
        <li role="none" title={activityDisabledReason ?? addToActiveDescription}>
          <button
            type="button"
            role="menuitem"
            className="context-activate"
            aria-description={activityDisabledReason ?? addToActiveDescription}
            disabled={Boolean(activityDisabledReason)}
            onClick={() => {
              if (!activityDisabledReason) {
                onAddToActive();
              }
            }}
          >
            <CirclePlus size={16} aria-hidden />
            Add to Active
          </button>
        </li>
      )}
      {onRemoveFromActive && (
        <li role="none" title={activityDisabledReason ?? removeFromActiveDescription}>
          <button
            type="button"
            role="menuitem"
            className="context-deactivate"
            aria-description={activityDisabledReason ?? removeFromActiveDescription}
            disabled={Boolean(activityDisabledReason)}
            onClick={() => {
              if (!activityDisabledReason) {
                onRemoveFromActive();
              }
            }}
          >
            <CircleMinus size={16} aria-hidden />
            Remove from Active
          </button>
        </li>
      )}
      {onMoveToPosition && (
        <li role="none" title={positionDisabledReason}>
          <button
            type="button"
            role="menuitem"
            disabled={Boolean(positionDisabledReason)}
            onClick={() => {
              if (!positionDisabledReason) {
                onMoveToPosition();
              }
            }}
          >
            <ListOrdered size={16} aria-hidden />
            Move to position…
          </button>
        </li>
      )}
      {showSubscription && onSubscribe && (
        <li role="none" title={subscribeDisabledReason}>
          <button
            type="button"
            role="menuitem"
            className="context-subscribe"
            disabled={Boolean(subscribeDisabledReason)}
            onClick={() => {
              if (!subscribeDisabledReason) {
                onSubscribe();
              }
            }}
          >
            <ArrowRight size={16} aria-hidden />
            Subscribe
          </button>
        </li>
      )}
      {showSubscription && onUnsubscribe && (
        <li role="none" title={unsubscribeDisabledReason}>
          <button
            type="button"
            role="menuitem"
            className="context-unsubscribe"
            disabled={Boolean(unsubscribeDisabledReason)}
            onClick={() => {
              if (!unsubscribeDisabledReason) {
                onUnsubscribe();
              }
            }}
          >
            <ArrowLeft size={16} aria-hidden />
            Unsubscribe
          </button>
        </li>
      )}
      {showSubscription && !onSubscribe && !onUnsubscribe && onSubscription && (
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
            {subscribed ? (
              <ArrowLeft size={16} aria-hidden />
            ) : (
              <ArrowRight size={16} aria-hidden />
            )}
            {subscribed ? "Unsubscribe" : "Subscribe"}
          </button>
        </li>
      )}
      <li role="none" title={libraryReason ?? libraryActionDescription}>
        <button
          type="button"
          role="menuitem"
          className="context-unsubscribe"
          aria-description={libraryReason ?? libraryActionDescription}
          disabled={Boolean(libraryReason)}
          onClick={() => {
            if (!libraryReason) {
              onRemoveFromLibrary();
            }
          }}
        >
          <Trash2 size={16} aria-hidden />
          Remove
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
      showSubscription={contextMenu.panel === modPanelModes.inactive}
      onMoveToPosition={
        contextMenu.panel === modPanelModes.active ? props.onMoveToPosition : undefined
      }
      onAddToActive={contextMenu.panel === modPanelModes.inactive ? props.onAddToActive : undefined}
      onRemoveFromActive={
        contextMenu.panel === modPanelModes.active ? props.onRemoveFromActive : undefined
      }
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

  useLayoutEffect(() => {
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
    const scrollContainer = returnFocus.current?.closest<HTMLElement>('[role="list"]');
    const openingScrollPosition = scrollContainer
      ? { left: scrollContainer.scrollLeft, top: scrollContainer.scrollTop }
      : undefined;
    const scroll = () => {
      // Chromium may deliver a scroll notification after the right-click's reveal scroll has
      // already finished and this menu has mounted. Ignore that stale notification, but dismiss
      // the menu once its owning list actually moves away from the opening position.
      if (
        scrollContainer &&
        openingScrollPosition &&
        (scrollContainer.scrollLeft !== openingScrollPosition.left ||
          scrollContainer.scrollTop !== openingScrollPosition.top)
      ) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    scrollContainer?.addEventListener("scroll", scroll);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      scrollContainer?.removeEventListener("scroll", scroll);
    };
  }, [focusKey, onClose, x, y]);

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

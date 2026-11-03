import { ChevronDown, RefreshCw } from "lucide-react";
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { workshopSyncModes } from "../../../../shared/domainConstants";
import type { WorkshopSyncMode } from "../../../../shared/types";
import { menuFocusIndex } from "../../utils/modSelection";
import { tooltipPlacements } from "../../utils/tooltips";
import { keyboardKeys } from "../../utils/uiConstants";
import { TooltipIconButton } from "./TooltipIconButton";

interface WorkshopSyncControlProps {
  disabled: boolean;
  onSync: (mode: WorkshopSyncMode) => void;
}

interface WorkshopSyncControlViewProps extends WorkshopSyncControlProps {
  containerRef?: RefObject<HTMLDivElement | null>;
  menuId: string;
  open: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMenuToggle: () => void;
  onSelect: (mode: WorkshopSyncMode) => void;
}

export function WorkshopSyncControlView({
  containerRef,
  disabled,
  menuId,
  open,
  onKeyDown,
  onMenuToggle,
  onSelect,
  onSync,
}: WorkshopSyncControlViewProps) {
  return (
    <div className="workshop-sync-control" ref={containerRef} onKeyDown={onKeyDown}>
      <TooltipIconButton
        className="ghost-action workshop-sync-primary px-3 text-[13px] whitespace-nowrap"
        label="Sync Workshop"
        placement={tooltipPlacements.bottom}
        disabled={disabled}
        onClick={() => {
          onSync(workshopSyncModes.full);
        }}
      >
        <RefreshCw size={18} aria-hidden />
        <span>Sync Workshop</span>
      </TooltipIconButton>
      <TooltipIconButton
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        className="ghost-action workshop-sync-trigger"
        data-workshop-sync-menu-trigger="true"
        label="Choose Workshop sync type"
        placement={tooltipPlacements.bottom}
        disabled={disabled}
        onClick={onMenuToggle}
      >
        <ChevronDown size={16} aria-hidden />
      </TooltipIconButton>
      {open && (
        <ul className="workshop-sync-menu" id={menuId} role="menu" aria-label="Workshop sync type">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSelect(workshopSyncModes.light);
              }}
            >
              <span className="workshop-sync-menu-title">Light refresh</span>
              <span className="workshop-sync-menu-description">
                Check only for new and removed Workshop mods.
              </span>
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSelect(workshopSyncModes.full);
              }}
            >
              <span className="workshop-sync-menu-title">Full refresh</span>
              <span className="workshop-sync-menu-description">
                Refresh every installed mod and its Workshop metadata.
              </span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export function WorkshopSyncControl({ disabled, onSync }: WorkshopSyncControlProps) {
  const container = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const menuId = useId();
  const [requestedOpen, setRequestedOpen] = useState(false);
  const open = requestedOpen && !disabled;

  useEffect(() => {
    if (disabled) {
      setRequestedOpen(false);
    }
  }, [disabled]);

  const trigger = useCallback(
    () =>
      container.current?.querySelector<HTMLButtonElement>(
        '[data-workshop-sync-menu-trigger="true"]',
      ),
    [],
  );

  const close = useCallback(
    (restoreFocus = false) => {
      setRequestedOpen(false);
      if (restoreFocus) {
        trigger()?.focus({ preventScroll: true });
      }
    },
    [trigger],
  );

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const buttons = container.current?.querySelectorAll<HTMLButtonElement>(
      '.workshop-sync-menu button[role="menuitem"]',
    );
    const index = focusOnOpen.current === "last" ? (buttons?.length ?? 1) - 1 : 0;
    buttons?.[index]?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        close();
      }
    };
    const dismiss = () => {
      close();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [close, open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === keyboardKeys.escape && open) {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab" && open) {
      close();
      return;
    }
    const menuTrigger = trigger();
    if (
      event.target === menuTrigger &&
      (event.key === keyboardKeys.arrowDown || event.key === keyboardKeys.arrowUp)
    ) {
      event.preventDefault();
      focusOnOpen.current = event.key === keyboardKeys.arrowUp ? "last" : "first";
      setRequestedOpen(true);
      return;
    }
    if (!open) {
      return;
    }
    const buttons = [
      ...(container.current?.querySelectorAll<HTMLButtonElement>(
        '.workshop-sync-menu button[role="menuitem"]',
      ) ?? []),
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

  function select(mode: WorkshopSyncMode) {
    close();
    onSync(mode);
  }

  return (
    <WorkshopSyncControlView
      containerRef={container}
      disabled={disabled}
      menuId={menuId}
      open={open}
      onKeyDown={handleKeyDown}
      onMenuToggle={() => {
        focusOnOpen.current = "first";
        setRequestedOpen((current) => !current);
      }}
      onSelect={select}
      onSync={select}
    />
  );
}

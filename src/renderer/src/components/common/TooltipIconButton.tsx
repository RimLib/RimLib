import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { type TooltipPlacement, tooltipPlacements } from "../../utils/tooltips";
import { keyboardKeys } from "../../utils/uiConstants";
import { FloatingTooltip } from "./FloatingTooltip";

interface TooltipIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  label: string;
  placement?: TooltipPlacement;
  tooltipClassName?: string;
}

export function TooltipIconButton({
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  children,
  className = "icon-button",
  label,
  placement = tooltipPlacements.top,
  title: _title,
  tooltipClassName = "",
  type = "button",
  onClick,
  ...buttonProps
}: TooltipIconButtonProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = Boolean(label) && (hovered || focused);
  const close = useCallback(() => {
    setHovered(false);
    setFocused(false);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === keyboardKeys.escape) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [open, close]);

  return (
    <span
      ref={anchor}
      className={`tooltip-action ${tooltipClassName}`.trim()}
      data-tip={label}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") {
          setHovered(true);
        }
      }}
      onPointerLeave={() => {
        setHovered(false);
      }}
      onFocusCapture={() => {
        setFocused(true);
      }}
      onBlurCapture={() => {
        setFocused(false);
      }}
    >
      <button
        {...buttonProps}
        aria-label={ariaLabel ?? label}
        aria-describedby={open ? [describedBy, id].filter(Boolean).join(" ") : describedBy}
        className={className}
        type={type}
        onClick={(event) => {
          close();
          onClick?.(event);
        }}
      >
        {children}
      </button>
      {open && <FloatingTooltip anchor={anchor} id={id} label={label} placement={placement} />}
    </span>
  );
}

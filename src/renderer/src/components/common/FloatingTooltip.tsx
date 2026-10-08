import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { positionTooltip, type TooltipPlacement } from "../../utils/tooltips";

export function FloatingTooltip({
  anchor,
  id,
  label,
  placement,
}: {
  anchor: RefObject<HTMLSpanElement | null>;
  id: string;
  label: string;
  placement: TooltipPlacement;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();

  useLayoutEffect(() => {
    const measure = () => {
      if (!anchor.current || !content.current) {
        return;
      }
      setPosition(
        positionTooltip(
          anchor.current.getBoundingClientRect(),
          content.current.getBoundingClientRect(),
          { width: window.innerWidth, height: window.innerHeight },
          placement,
        ),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [anchor, label, placement]);

  // A body portal escapes overflow clipping and stacking contexts in panels and modals.
  return createPortal(
    <div
      className="tooltip tooltip-open tooltip-overlay"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className="tooltip-content" ref={content} id={id} role="tooltip">
        {label}
      </div>
    </div>,
    document.body,
  );
}

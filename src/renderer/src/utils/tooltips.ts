import type { ConstantValue } from "../../../shared/domainConstants";
import { viewportPadding } from "./uiConstants";

export const tooltipPlacements = Object.freeze({
  top: "top",
  bottom: "bottom",
  left: "left",
  right: "right",
} as const);
export type TooltipPlacement = ConstantValue<typeof tooltipPlacements>;
const tooltipGap = 8;
interface Rectangle {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}
interface Size {
  width: number;
  height: number;
}
const opposite: Record<TooltipPlacement, TooltipPlacement> = {
  top: tooltipPlacements.bottom,
  bottom: tooltipPlacements.top,
  left: tooltipPlacements.right,
  right: tooltipPlacements.left,
};

export function positionTooltip(
  anchor: Rectangle,
  tooltip: Size,
  viewport: Size,
  requested: TooltipPlacement,
) {
  const padding = viewportPadding;
  const gap = tooltipGap;
  const space = {
    top: anchor.top - padding - gap,
    bottom: viewport.height - anchor.bottom - padding - gap,
    left: anchor.left - padding - gap,
    right: viewport.width - anchor.right - padding - gap,
  };
  const required =
    requested === tooltipPlacements.top || requested === tooltipPlacements.bottom
      ? tooltip.height
      : tooltip.width;
  const placement =
    space[requested] < required && space[opposite[requested]] > space[requested]
      ? opposite[requested]
      : requested;
  let left = anchor.left + (anchor.width - tooltip.width) / 2;
  let top = anchor.top + (anchor.height - tooltip.height) / 2;
  if (placement === tooltipPlacements.top) {
    top = anchor.top - tooltip.height - gap;
  }
  if (placement === tooltipPlacements.bottom) {
    top = anchor.bottom + gap;
  }
  if (placement === tooltipPlacements.left) {
    left = anchor.left - tooltip.width - gap;
  }
  if (placement === tooltipPlacements.right) {
    left = anchor.right + gap;
  }
  return {
    left: Math.max(padding, Math.min(left, viewport.width - tooltip.width - padding)),
    top: Math.max(padding, Math.min(top, viewport.height - tooltip.height - padding)),
  };
}

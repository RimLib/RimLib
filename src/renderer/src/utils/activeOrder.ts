export interface ActiveOrderItem {
  id: string;
}

export interface ActiveOrderMove<T extends ActiveOrderItem> {
  /** The concrete source item moved by this replay step. */
  readonly item: T;
  readonly id: string;
  /** One-based position immediately before this step is applied. */
  readonly fromPosition: number;
  /** One-based position passed to `moveActiveModsToPosition`. */
  readonly toPosition: number;
}

export type ActiveDropPlacement = "before" | "after";

function sameOrder<T>(first: readonly T[], second: readonly T[]): boolean {
  return first.length === second.length && first.every((item, index) => item === second[index]);
}

function hasUniqueIds(items: readonly ActiveOrderItem[]): boolean {
  return new Set(items.map(({ id }) => id)).size === items.length;
}

/**
 * Moves the requested items into one contiguous block whose first item is at
 * `startPosition`. The position is one-based in the resulting order, while the
 * block itself always follows the items' existing canonical order.
 *
 * Invalid, ambiguous, or no-op requests preserve the original array reference.
 */
export function moveActiveModsToPosition<T extends ActiveOrderItem>(
  items: readonly T[],
  itemIds: readonly string[],
  startPosition: number,
): readonly T[] {
  if (
    !items.length ||
    !itemIds.length ||
    !Number.isInteger(startPosition) ||
    !hasUniqueIds(items)
  ) {
    return items;
  }

  const requestedIds = new Set(itemIds);
  const selected = items.filter(({ id }) => requestedIds.has(id));
  if (selected.length !== requestedIds.size) {
    return items;
  }

  const remaining = items.filter(({ id }) => !requestedIds.has(id));
  const maximumStartPosition = remaining.length + 1;
  if (startPosition < 1 || startPosition > maximumStartPosition) {
    return items;
  }

  const insertionIndex = startPosition - 1;
  const reordered = [
    ...remaining.slice(0, insertionIndex),
    ...selected,
    ...remaining.slice(insertionIndex),
  ];
  return sameOrder(items, reordered) ? items : reordered;
}

/**
 * Derives deterministic, concrete moves that replay `source` into `target`.
 *
 * `undefined` rejects ambiguous inputs whose unique identity sets do not
 * match. An empty array therefore unambiguously means that the order already
 * matches. Walking the target from left to right also makes every emitted
 * position valid for an immediate `moveActiveModsToPosition` replay.
 */
export function deriveActiveOrderMoves<T extends ActiveOrderItem>(
  source: readonly T[],
  target: readonly T[],
): readonly ActiveOrderMove<T>[] | undefined {
  if (source.length !== target.length || !hasUniqueIds(source) || !hasUniqueIds(target)) {
    return undefined;
  }

  const sourceIds = new Set(source.map(({ id }) => id));
  if (target.some(({ id }) => !sourceIds.has(id))) {
    return undefined;
  }

  let replay: readonly T[] = [...source];
  const moves: ActiveOrderMove<T>[] = [];
  for (let targetIndex = 0; targetIndex < target.length; targetIndex++) {
    const id = target[targetIndex]?.id;
    if (id === undefined || replay[targetIndex]?.id === id) {
      continue;
    }

    const sourceIndex = replay.findIndex((item) => item.id === id);
    const item = replay[sourceIndex];
    if (sourceIndex < 0 || !item) {
      return undefined;
    }

    const fromPosition = sourceIndex + 1;
    const toPosition = targetIndex + 1;
    const next = moveActiveModsToPosition(replay, [id], toPosition);
    if (next === replay) {
      return undefined;
    }
    moves.push({ item, id, fromPosition, toPosition });
    replay = next;
  }

  return moves;
}

/** Moves one item immediately before or after another item in canonical order. */
export function moveActiveModRelative<T extends ActiveOrderItem>(
  items: readonly T[],
  itemId: string,
  targetId: string,
  placement: ActiveDropPlacement,
): readonly T[] {
  if (itemId === targetId || !hasUniqueIds(items)) {
    return items;
  }

  const itemIndex = items.findIndex(({ id }) => id === itemId);
  const targetIndex = items.findIndex(({ id }) => id === targetId);
  if (itemIndex < 0 || targetIndex < 0) {
    return items;
  }

  const item = items[itemIndex];
  if (!item) {
    return items;
  }

  const remaining = items.filter((_, index) => index !== itemIndex);
  const remainingTargetIndex = remaining.findIndex(({ id }) => id === targetId);
  const insertionIndex = remainingTargetIndex + Number(placement === "after");
  const reordered = [
    ...remaining.slice(0, insertionIndex),
    item,
    ...remaining.slice(insertionIndex),
  ];
  return sameOrder(items, reordered) ? items : reordered;
}

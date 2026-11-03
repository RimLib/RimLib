import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveActiveOrderMoves,
  moveActiveModRelative,
  moveActiveModsToPosition,
} from "../src/renderer/src/utils/activeOrder";

interface Item {
  id: string;
  label: string;
}

const items: readonly Item[] = ["a", "b", "c", "d", "e"].map((id) => ({
  id,
  label: id.toUpperCase(),
}));
const ids = (order: readonly Item[]) => order.map(({ id }) => id);

void test("moves one active mod to a validated one-based final position", () => {
  const toStart = moveActiveModsToPosition(items, ["d"], 1);
  assert.deepEqual(ids(toStart), ["d", "a", "b", "c", "e"]);

  const toEnd = moveActiveModsToPosition(items, ["b"], 5);
  assert.deepEqual(ids(toEnd), ["a", "c", "d", "e", "b"]);
});

void test("moves multiple active mods as a canonical-order-preserving block", () => {
  const reordered = moveActiveModsToPosition(items, ["d", "b"], 3);
  assert.deepEqual(ids(reordered), ["a", "c", "b", "d", "e"]);
  assert.equal(reordered[2], items[1]);
  assert.equal(reordered[3], items[3]);

  const toEnd = moveActiveModsToPosition(items, ["d", "b"], 4);
  assert.deepEqual(ids(toEnd), ["a", "c", "e", "b", "d"]);
});

void test("position moves leave their input untouched and preserve its reference for no-ops", () => {
  const snapshot = [...items];
  const alreadyThere = moveActiveModsToPosition(items, ["b", "c"], 2);

  assert.equal(alreadyThere, items);
  assert.deepEqual(items, snapshot);
  assert.notEqual(moveActiveModsToPosition(items, ["b", "c"], 1), items);
});

void test("position moves safely reject invalid positions, unknown IDs, and ambiguous orders", () => {
  for (const position of [0, -1, 1.5, Number.NaN, 5]) {
    assert.equal(moveActiveModsToPosition(items, ["b", "d"], position), items);
  }
  assert.equal(moveActiveModsToPosition(items, [], 1), items);
  assert.equal(moveActiveModsToPosition(items, ["missing"], 1), items);
  assert.equal(moveActiveModsToPosition(items, ["b", "missing"], 1), items);

  const ambiguous = [...items, { id: "b", label: "Duplicate" }];
  assert.equal(moveActiveModsToPosition(ambiguous, ["b"], 1), ambiguous);
});

void test("derives deterministic left-to-right moves that replay into the target order", () => {
  const target = [items[2], items[0], items[4], items[1], items[3]] as readonly Item[];
  const moves = deriveActiveOrderMoves(items, target);

  assert.ok(moves);
  assert.deepEqual(
    moves.map(({ id, fromPosition, toPosition }) => ({ id, fromPosition, toPosition })),
    [
      { id: "c", fromPosition: 3, toPosition: 1 },
      { id: "e", fromPosition: 5, toPosition: 3 },
    ],
  );
  assert.equal(moves[0]?.item, items[2]);
  assert.equal(moves[1]?.item, items[4]);

  const replayed = moves.reduce<readonly Item[]>(
    (order, move) => moveActiveModsToPosition(order, [move.id], move.toPosition),
    items,
  );
  assert.deepEqual(ids(replayed), ids(target));
});

void test("derived positions describe the evolving replay order", () => {
  const target = [...items].reverse();
  const moves = deriveActiveOrderMoves(items, target);

  assert.ok(moves);
  assert.deepEqual(
    moves.map(({ id, fromPosition, toPosition }) => ({ id, fromPosition, toPosition })),
    [
      { id: "e", fromPosition: 5, toPosition: 1 },
      { id: "d", fromPosition: 5, toPosition: 2 },
      { id: "c", fromPosition: 5, toPosition: 3 },
      { id: "b", fromPosition: 5, toPosition: 4 },
    ],
  );
});

void test("derivation distinguishes an unchanged order from invalid identity sets", () => {
  assert.deepEqual(deriveActiveOrderMoves(items, [...items]), []);

  const duplicateSource = [...items, { id: "a", label: "Duplicate" }];
  const duplicateTarget = [...items.slice(0, -1), { id: "a", label: "Duplicate" }];
  const mismatchedTarget = [...items.slice(0, -1), { id: "missing", label: "Missing" }];
  assert.equal(deriveActiveOrderMoves(duplicateSource, duplicateSource), undefined);
  assert.equal(deriveActiveOrderMoves(items, duplicateTarget), undefined);
  assert.equal(deriveActiveOrderMoves(items, mismatchedTarget), undefined);
  assert.equal(deriveActiveOrderMoves(items, items.slice(0, -1)), undefined);
});

void test("moves one active mod before or after a relative target", () => {
  assert.deepEqual(ids(moveActiveModRelative(items, "d", "b", "before")), [
    "a",
    "d",
    "b",
    "c",
    "e",
  ]);
  assert.deepEqual(ids(moveActiveModRelative(items, "b", "d", "after")), ["a", "c", "d", "b", "e"]);
  assert.deepEqual(ids(moveActiveModRelative(items, "a", "e", "after")), ["b", "c", "d", "e", "a"]);
});

void test("relative moves are immutable and preserve the original reference for unsafe or no-op requests", () => {
  const snapshot = [...items];
  for (const request of [
    { itemId: "b", targetId: "c", placement: "before" },
    { itemId: "b", targetId: "a", placement: "after" },
    { itemId: "b", targetId: "b", placement: "before" },
    { itemId: "missing", targetId: "b", placement: "before" },
    { itemId: "b", targetId: "missing", placement: "after" },
  ] as const) {
    assert.equal(
      moveActiveModRelative(items, request.itemId, request.targetId, request.placement),
      items,
    );
  }
  assert.deepEqual(items, snapshot);

  const ambiguous = [...items, { id: "b", label: "Duplicate" }];
  assert.equal(moveActiveModRelative(ambiguous, "b", "d", "before"), ambiguous);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  MoveActiveModModal,
  validateMoveActivePosition,
} from "../src/renderer/src/components/modals/MoveActiveModModal";

const noop = () => undefined;

void test("move-active position validation accepts only an available whole-number position", () => {
  assert.deepEqual(validateMoveActivePosition(" 3 ", 7), { position: 3 });
  assert.deepEqual(validateMoveActivePosition("", 7), { error: "Enter a position." });
  assert.deepEqual(validateMoveActivePosition("1.5", 7), {
    error: "Enter a whole number between 1 and 7.",
  });
  assert.deepEqual(validateMoveActivePosition("2e1", 25), {
    error: "Enter a whole number between 1 and 25.",
  });
  assert.deepEqual(validateMoveActivePosition("0", 7), {
    error: "Enter a position between 1 and 7.",
  });
  assert.deepEqual(validateMoveActivePosition("8", 7), {
    error: "Enter a position between 1 and 7.",
  });
  assert.deepEqual(validateMoveActivePosition("1", 0), {
    error: "There are no Active positions available.",
  });
});

void test("move-active modal exposes its staged single-mod workflow accessibly", () => {
  const html = renderToStaticMarkup(
    <MoveActiveModModal
      modNames={["Camera+"]}
      activeCount={12}
      initialPosition={4}
      onClose={noop}
      onConfirm={noop}
    />,
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="move-active-mod-title"/);
  assert.match(html, />Move active mod</);
  assert.match(html, /Move <strong>Camera\+<\/strong> to a new position/);
  assert.match(html, /stays pending until you apply it/);
  assert.match(html, /Position \(1–12\)/);
  assert.match(html, /type="number"/);
  assert.match(html, /min="1"/);
  assert.match(html, /max="12"/);
  assert.match(html, /value="4"/);
  assert.match(html, /Currently at position 4/);
  assert.match(html, /disabled=""[^>]*>[\s\S]*Stage move/);
  assert.match(html, /class="modal-backdrop"/);
});

void test("move-active modal uses plural copy and names every selected mod", () => {
  const html = renderToStaticMarkup(
    <MoveActiveModModal
      modNames={["Harmony", "Camera+"]}
      activeCount={6}
      initialPosition={2}
      onClose={noop}
      onConfirm={noop}
    />,
  );

  assert.match(html, />Move active mods</);
  assert.match(html, /<strong>2 mods<\/strong> \(Harmony, Camera\+\)/);
});

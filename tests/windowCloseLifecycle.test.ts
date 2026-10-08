import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type PreventableCloseEvent,
  type RendererUnavailableReason,
  WindowCloseLifecycle,
} from "../src/main/windowCloseLifecycle";

type CloseListener = (event: PreventableCloseEvent) => void;
type ClosedListener = () => void;
type CloseReadyListener = (sender: unknown, senderFrame: unknown, error?: unknown) => void;

function setup() {
  const sender = {};
  let senderFrame = {};
  const closeListeners = new Set<CloseListener>();
  const closedListeners = new Set<ClosedListener>();
  const closeReadyListeners = new Set<CloseReadyListener>();
  let rendererDestroyed = false;
  let quitRequested = false;
  let requestThrows = false;
  const calls = {
    awaitingSave: 0,
    closed: 0,
    closeWindow: 0,
    rendererSave: 0,
    resumeQuit: 0,
    savesCompleted: 0,
    saveFailures: [] as string[],
    rendererUnavailable: [] as RendererUnavailableReason[],
    closeWithoutSave: [] as RendererUnavailableReason[],
  };
  let foreignCloseReadyCalls = 0;
  const foreignCloseReady: CloseReadyListener = () => {
    foreignCloseReadyCalls++;
  };
  closeReadyListeners.add(foreignCloseReady);

  const emitClosed = () => {
    for (const listener of [...closedListeners]) {
      listener();
    }
  };
  const emitClose = () => {
    const closeState = { prevented: false as boolean };
    for (const listener of [...closeListeners]) {
      listener({
        preventDefault: () => {
          closeState.prevented = true;
        },
      });
    }
    if (!closeState.prevented) {
      emitClosed();
    }
    return closeState.prevented;
  };

  const lifecycle = new WindowCloseLifecycle({
    rendererSender: sender,
    isRendererSenderFrame: (eventSenderFrame) => eventSenderFrame === senderFrame,
    isRendererDestroyed: () => rendererDestroyed,
    requestRendererSave: () => {
      calls.rendererSave++;
      if (requestThrows) {
        throw new Error("WebContents was destroyed");
      }
    },
    closeWindow: () => {
      calls.closeWindow++;
      emitClose();
    },
    listenForWindowClose: (listener) => {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    listenForWindowClosed: (listener) => {
      closedListeners.add(listener);
      return () => closedListeners.delete(listener);
    },
    listenForCloseReady: (listener) => {
      closeReadyListeners.add(listener);
      return () => closeReadyListeners.delete(listener);
    },
    isQuitRequested: () => quitRequested,
    resumeQuit: () => {
      calls.resumeQuit++;
    },
    callbacks: {
      onAwaitingSave: () => {
        calls.awaitingSave++;
      },
      onSaveFailed: (error) => {
        calls.saveFailures.push(error);
        quitRequested = false;
      },
      onSavesCompleted: () => {
        calls.savesCompleted++;
      },
      onRendererUnavailable: (reason) => {
        calls.rendererUnavailable.push(reason);
      },
      onCloseWithoutSave: (reason) => {
        calls.closeWithoutSave.push(reason);
      },
      onClosed: () => {
        calls.closed++;
      },
    },
  });

  return {
    calls,
    closeListeners,
    closeReadyListeners,
    closedListeners,
    emitClose,
    foreignCloseReady,
    foreignCloseReadyCalls: () => foreignCloseReadyCalls,
    lifecycle,
    sender,
    get senderFrame() {
      return senderFrame;
    },
    replaceSenderFrame: () => {
      senderFrame = {};
      return senderFrame;
    },
    setQuitRequested: (value: boolean) => {
      quitRequested = value;
    },
    setRendererDestroyed: (value: boolean) => {
      rendererDestroyed = value;
    },
    setRequestThrows: (value: boolean) => {
      requestThrows = value;
    },
    sendCloseReady: (eventSender: unknown, eventSenderFrame: unknown, error?: unknown) => {
      for (const listener of [...closeReadyListeners]) {
        listener(eventSender, eventSenderFrame, error);
      }
    },
  };
}

void test("a healthy renderer receives one save request and may take indefinitely to acknowledge it", () => {
  const harness = setup();
  assert.equal(harness.emitClose(), true);
  assert.deepEqual(harness.lifecycle.state, { status: "awaiting-save" });
  assert.equal(harness.calls.rendererSave, 1);
  assert.equal(harness.calls.closeWindow, 0);

  assert.equal(harness.emitClose(), true);
  assert.equal(harness.calls.rendererSave, 1);
  assert.deepEqual(harness.lifecycle.state, { status: "awaiting-save" });

  harness.sendCloseReady({}, harness.senderFrame, undefined);
  assert.deepEqual(harness.lifecycle.state, { status: "awaiting-save" });
  assert.equal(harness.calls.closeWindow, 0);

  harness.sendCloseReady(harness.sender, {}, undefined);
  assert.deepEqual(harness.lifecycle.state, { status: "awaiting-save" });
  assert.equal(harness.calls.closeWindow, 0);

  harness.sendCloseReady(harness.sender, harness.senderFrame, undefined);
  assert.deepEqual(harness.lifecycle.state, { status: "allowed", saved: true });
  assert.equal(harness.calls.savesCompleted, 1);
  assert.equal(harness.calls.closeWindow, 1);
  assert.equal(harness.calls.closed, 1);
});

void test("close acknowledgement follows the current main frame after navigation replaces it", () => {
  const harness = setup();
  const detachedFrame = harness.senderFrame;
  const currentFrame = harness.replaceSenderFrame();
  harness.emitClose();

  harness.sendCloseReady(harness.sender, detachedFrame, undefined);
  assert.deepEqual(harness.lifecycle.state, { status: "awaiting-save" });
  assert.equal(harness.calls.closeWindow, 0);

  harness.sendCloseReady(harness.sender, currentFrame, undefined);
  assert.deepEqual(harness.lifecycle.state, { status: "allowed", saved: true });
  assert.equal(harness.calls.closeWindow, 1);
});

void test("a save failure keeps the window open, ignores a stale acknowledgement and permits retry", () => {
  const harness = setup();
  harness.setQuitRequested(true);
  harness.emitClose();
  harness.sendCloseReady(harness.sender, harness.senderFrame, "Disk is full");
  assert.deepEqual(harness.lifecycle.state, { status: "save-failed", error: "Disk is full" });
  assert.deepEqual(harness.calls.saveFailures, ["Disk is full"]);
  assert.equal(harness.calls.closeWindow, 0);
  assert.equal(harness.calls.resumeQuit, 0);

  harness.sendCloseReady(harness.sender, harness.senderFrame, undefined);
  assert.deepEqual(harness.lifecycle.state, { status: "save-failed", error: "Disk is full" });
  assert.equal(harness.calls.closeWindow, 0);

  harness.emitClose();
  assert.deepEqual(harness.lifecycle.state, { status: "awaiting-save" });
  assert.equal(harness.calls.rendererSave, 2);
  harness.sendCloseReady(harness.sender, harness.senderFrame, undefined);
  assert.deepEqual(harness.lifecycle.state, { status: "allowed", saved: true });
  assert.equal(harness.calls.closeWindow, 1);
});

void test("empty and malformed close acknowledgements fail closed with a useful error", () => {
  for (const error of ["", "   ", false, 0, null]) {
    const harness = setup();
    harness.emitClose();
    harness.sendCloseReady(harness.sender, harness.senderFrame, error);

    assert.equal(harness.lifecycle.state.status, "save-failed");
    assert.ok(harness.calls.saveFailures[0]?.trim());
    assert.equal(harness.calls.closeWindow, 0);
    assert.equal(harness.calls.closed, 0);
  }
});

void test("successful acknowledgement resumes an outstanding application quit", () => {
  const harness = setup();
  harness.setQuitRequested(true);
  harness.emitClose();
  harness.sendCloseReady(harness.sender, harness.senderFrame, undefined);
  assert.equal(harness.calls.closeWindow, 1);
  assert.equal(harness.calls.resumeQuit, 1);
});

void test("renderer failure during the handshake stops waiting and uses the disk-preservation fallback", () => {
  for (const reason of ["load-failed", "preload-error", "render-process-gone"] as const) {
    const harness = setup();
    harness.emitClose();
    harness.lifecycle.rendererUnavailable(reason);
    assert.deepEqual(harness.lifecycle.state, { status: "allowed", saved: false });
    assert.deepEqual(harness.calls.rendererUnavailable, [reason]);
    assert.deepEqual(harness.calls.closeWithoutSave, [reason]);
    assert.equal(harness.calls.closeWindow, 1);
    assert.equal(harness.calls.closed, 1);
  }
});

void test("a destroyed WebContents or failed send never starts an impossible wait", () => {
  const destroyed = setup();
  destroyed.setRendererDestroyed(true);
  assert.equal(destroyed.emitClose(), true);
  assert.equal(destroyed.calls.rendererSave, 0);
  assert.deepEqual(destroyed.calls.closeWithoutSave, ["web-contents-destroyed"]);
  assert.deepEqual(destroyed.lifecycle.state, { status: "allowed", saved: false });

  const failedSend = setup();
  failedSend.setRequestThrows(true);
  assert.equal(failedSend.emitClose(), true);
  assert.equal(failedSend.calls.rendererSave, 1);
  assert.deepEqual(failedSend.calls.closeWithoutSave, ["save-request-failed"]);
  assert.deepEqual(failedSend.lifecycle.state, { status: "allowed", saved: false });
});

void test("closing disposes only the lifecycle's listeners", () => {
  const harness = setup();
  assert.equal(harness.closeReadyListeners.size, 2);
  harness.emitClose();
  harness.sendCloseReady(harness.sender, harness.senderFrame, undefined);
  assert.equal(harness.closeListeners.size, 0);
  assert.equal(harness.closedListeners.size, 0);
  assert.equal(harness.closeReadyListeners.size, 1);
  assert.ok(harness.closeReadyListeners.has(harness.foreignCloseReady));
  assert.equal(harness.foreignCloseReadyCalls(), 1);
});

export interface PreventableCloseEvent {
  preventDefault(): void;
}

export type RendererUnavailableReason =
  | "load-failed"
  | "preload-error"
  | "render-process-gone"
  | "save-request-failed"
  | "web-contents-destroyed";

export type WindowCloseLifecycleState =
  | Readonly<{ status: "open" }>
  | Readonly<{ status: "awaiting-save" }>
  | Readonly<{ status: "save-failed"; error: string }>
  | Readonly<{ status: "renderer-gone"; reason: RendererUnavailableReason }>
  | Readonly<{ status: "allowed"; saved: boolean }>;

interface WindowCloseLifecycleCallbacks {
  onAwaitingSave(): void;
  onSaveFailed(error: string): void;
  onSavesCompleted(): void;
  onRendererUnavailable(reason: RendererUnavailableReason): void;
  onCloseWithoutSave(reason: RendererUnavailableReason): void;
  onClosed(): void;
}

interface WindowCloseLifecycleOptions {
  rendererSender: unknown;
  isRendererSenderFrame(senderFrame: unknown): boolean;
  isRendererDestroyed(): boolean;
  requestRendererSave(): void;
  closeWindow(): void;
  listenForWindowClose(listener: (event: PreventableCloseEvent) => void): () => void;
  listenForWindowClosed(listener: () => void): () => void;
  listenForCloseReady(
    listener: (sender: unknown, senderFrame: unknown, error?: unknown) => void,
  ): () => void;
  isQuitRequested(): boolean;
  resumeQuit(): void;
  callbacks: WindowCloseLifecycleCallbacks;
}

/**
 * Coordinates the renderer save handshake for one BrowserWindow.
 *
 * A healthy renderer is deliberately given as long as it needs to save. Once the
 * renderer is known to be unavailable, waiting cannot protect any more data, so
 * the existing on-disk vault is left untouched and the window is allowed to close.
 */
export class WindowCloseLifecycle {
  private currentState: WindowCloseLifecycleState = { status: "open" };
  private readonly removeListeners: (() => void)[] = [];
  private disposed = false;

  constructor(private readonly options: WindowCloseLifecycleOptions) {
    this.removeListeners.push(
      options.listenForWindowClose((event) => {
        this.handleWindowClose(event);
      }),
      options.listenForWindowClosed(() => {
        this.handleWindowClosed();
      }),
      options.listenForCloseReady((sender, senderFrame, error) => {
        this.handleCloseReady(sender, senderFrame, error);
      }),
    );
  }

  get state(): WindowCloseLifecycleState {
    return this.currentState;
  }

  rendererUnavailable(reason: RendererUnavailableReason): void {
    if (
      this.disposed ||
      this.currentState.status === "allowed" ||
      this.currentState.status === "renderer-gone"
    ) {
      return;
    }
    const closeWasPending = this.currentState.status === "awaiting-save";
    this.currentState = { status: "renderer-gone", reason };
    this.options.callbacks.onRendererUnavailable(reason);
    if (closeWasPending) {
      this.allowCloseWithoutSave(reason);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const removeListener of this.removeListeners.splice(0)) {
      removeListener();
    }
  }

  private handleWindowClose(event: PreventableCloseEvent): void {
    if (this.disposed || this.currentState.status === "allowed") {
      return;
    }
    event.preventDefault();
    if (this.currentState.status === "renderer-gone") {
      this.allowCloseWithoutSave(this.currentState.reason);
      return;
    }
    if (this.options.isRendererDestroyed()) {
      const closeWasPending = this.currentState.status === "awaiting-save";
      this.rendererUnavailable("web-contents-destroyed");
      if (!closeWasPending) {
        this.allowCloseWithoutSave("web-contents-destroyed");
      }
      return;
    }
    if (this.currentState.status === "awaiting-save") {
      return;
    }

    this.currentState = { status: "awaiting-save" };
    this.options.callbacks.onAwaitingSave();
    try {
      this.options.requestRendererSave();
    } catch {
      this.rendererUnavailable("save-request-failed");
    }
  }

  private handleCloseReady(sender: unknown, senderFrame: unknown, error?: unknown): void {
    if (
      this.disposed ||
      sender !== this.options.rendererSender ||
      !this.options.isRendererSenderFrame(senderFrame) ||
      this.currentState.status !== "awaiting-save"
    ) {
      return;
    }
    if (error !== undefined) {
      const message =
        typeof error === "string" && error.trim().length > 0
          ? error
          : "The renderer reported a save failure without an error message.";
      this.currentState = { status: "save-failed", error: message };
      this.options.callbacks.onSaveFailed(message);
      return;
    }
    this.currentState = { status: "allowed", saved: true };
    this.options.callbacks.onSavesCompleted();
    this.finishClose();
  }

  private allowCloseWithoutSave(reason: RendererUnavailableReason): void {
    if (this.disposed || this.currentState.status === "allowed") {
      return;
    }
    this.currentState = { status: "allowed", saved: false };
    this.options.callbacks.onCloseWithoutSave(reason);
    this.finishClose();
  }

  private finishClose(): void {
    const resumeQuit = this.options.isQuitRequested();
    this.options.closeWindow();
    if (resumeQuit) {
      this.options.resumeQuit();
    }
  }

  private handleWindowClosed(): void {
    if (this.disposed) {
      return;
    }
    this.dispose();
    this.options.callbacks.onClosed();
  }
}

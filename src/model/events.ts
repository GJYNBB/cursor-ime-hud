export interface Disposable {
  dispose(): void;
}

export type Event<T> = (listener: (event: T) => void) => Disposable;

/**
 * Tiny framework-neutral event emitter used by lower layers that must not
 * depend on VS Code APIs. It intentionally implements only the subset the
 * detector layer needs: subscribe, fire, and dispose.
 */
export class SimpleEventEmitter<T> implements Disposable {
  private readonly listeners = new Set<(event: T) => void>();
  private disposed = false;

  public readonly event: Event<T> = (listener) => {
    if (this.disposed) {
      return { dispose: () => undefined };
    }

    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  };

  public fire(event: T): void {
    if (this.disposed) {
      return;
    }

    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

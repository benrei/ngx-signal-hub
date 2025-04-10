import {
  DestroyRef,
  Injectable,
  Injector,
  effect,
  signal,
  computed,
  untracked,
  Signal,
} from '@angular/core';

/** Represents an event in the event bus with a key, data, and timestamp. */
export interface BusEvent<T = unknown> {
  key: string;
  data: T;
  timestamp: number;
}

/** Represents a subscription to the event bus. */
export interface BusEventSubscription {
  unsubscribe: () => void;
  // Potentially other methods or properties later
}

/** A hybrid event bus service for emitting and observing events using Signals and callbacks. */
@Injectable({ providedIn: 'root' })
export class SignalBusService {
  private readonly eventQueue = signal<BusEvent[]>([]);
  private readonly eventRegistry = signal<Map<string, BusEvent>>(new Map());
  private readonly subscribers = new Map<
    string,
    ((event: BusEvent<unknown>) => void)[]
  >();

  constructor(injector: Injector) {
    effect(
      () => {
        const queuedEvents = this.eventQueue();
        if (!queuedEvents.length) return;

        untracked(() => {
          const registry = this.eventRegistry();
          const updatedRegistry = new Map(registry);

          for (const event of queuedEvents) {
            updatedRegistry.set(event.key, event);
            this.notifySubscribers(event);
          }

          this.eventRegistry.set(updatedRegistry);
          this.eventQueue.set([]);
        });
      },
      { injector }
    );
  }

  /** Emits an event with the given key and data, triggering subscribers and updating the registry. */
  emit<T>(key: string, data: T): void {
    if (!key) throw new Error('Key cannot be empty');
    if (data == null) throw new Error('Data cannot be null or undefined');

    const event: BusEvent<T> = { key, data, timestamp: Date.now() };
    this.eventQueue.update((queue) => [...queue, event]);
  }

  /** Subscribes to events matching a query, optionally auto-cleaning with DestroyRef. Returns a BusEventSubscription object. */
  subscribe<T>(
    query: string,
    callback: (event: BusEvent<T>) => void,
    destroyRef?: DestroyRef
  ): BusEventSubscription {
    const unsubscribeFn = this.internalSubscribe(query, callback, destroyRef);
    return {
      unsubscribe: unsubscribeFn,
    };
  }

  /** Returns a Signal for observing the latest event for a specific key, or null if none exists. */
  toSignal<T>(key: string): Signal<BusEvent<T> | null> {
    return computed(() => this.eventRegistry().get(key) as BusEvent<T> | null);
  }

  /** Returns a Signal for observing the latest events for multiple keys, returning an array of matches. */
  toSignalMultiple<T>(keys: string[]): Signal<BusEvent<T>[]> {
    return computed(() => {
      const registry = this.eventRegistry();
      return keys
        .map((key) => registry.get(key) as BusEvent<T>)
        .filter(Boolean);
    });
  }

  /** Removes an event from the registry by its key. */
  drop(key: string): void {
    this.eventRegistry.update((registry) => {
      const updated = new Map(registry);
      updated.delete(key);
      return updated;
    });
  }

  /** Resets the registry, removing all events. */
  reset(): void {
    this.eventRegistry.set(new Map());
  }

  private internalSubscribe<T>(
    query: string,
    callback: (event: BusEvent<T>) => void,
    destroyRef?: DestroyRef
  ): () => void {
    const safeCallback = callback as (event: BusEvent<unknown>) => void;
    const callbacks = this.subscribers.get(query) ?? [];
    callbacks.push(safeCallback);
    this.subscribers.set(query, callbacks);

    let manualUnsubscribe = true;
    if (destroyRef) {
      manualUnsubscribe = false;
      destroyRef.onDestroy(() => this.unsubscribe(query, safeCallback));
    }

    return () => {
      if (manualUnsubscribe) {
        this.unsubscribe(query, safeCallback);
      }
    };
  }

  private notifySubscribers(event: BusEvent): void {
    this.subscribers.forEach((callbacks, query) => {
      if (this.matchQuery(event.key, query)) {
        callbacks.forEach((callback) => {
          try {
            callback(event);
          } catch (error) {
            console.warn(`Subscriber error for query "${query}":`, error);
          }
        });
      }
    });
  }

  private unsubscribe<T>(
    query: string,
    callback: (event: BusEvent<T>) => void
  ): void {
    const callbacks = this.subscribers.get(query);
    if (!callbacks) return;

    const updatedCallbacks = callbacks.filter(
      (cb) => cb !== (callback as (event: BusEvent<unknown>) => void)
    );
    if (updatedCallbacks.length) {
      this.subscribers.set(query, updatedCallbacks);
    } else {
      this.subscribers.delete(query);
    }
  }

  private matchQuery(key: string, query: string): boolean {
    if (key === query) return true;

    if (query === '*') return true;

    if (key.includes(':') && query.includes(':')) {
      const [keyPart1] = key.split(':');
      const [queryPart1, queryPart2] = query.split(':');

      if (keyPart1 === queryPart1 && queryPart2 === '*') return true;
    }

    return false;
  }
}

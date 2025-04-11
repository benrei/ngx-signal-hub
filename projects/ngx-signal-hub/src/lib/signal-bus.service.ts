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

/**
 * Represents an event in the signal hub with a key, data, and timestamp.
 */
export interface HubEvent<T = unknown> {
  key: string;
  data: T;
  timestamp: number;
}

/**
 * Represents the options for subscribing to a signal hub event.
 */
export interface HubEventOptions<T> {
  /** The key/query string to match events against (e.g., 'user:login', 'user:*'). */
  key: string;
  /** The callback function to execute when an event matches the query. */
  callback: (event: HubEvent<T>) => void | Promise<void>;
  /** Optional DestroyRef for auto-cleaning subscriptions. */
  destroyRef?: DestroyRef;
  /** If true, replays the latest event for the key on subscription. */
  replayLatest?: boolean;
  /** Optional error handler for callback errors. */
  onError?: (error: unknown, event: HubEvent<T>) => void;
}

/**
 * Represents a subscription to the signal hub.
 */
export interface HubSubscription {
  unsubscribe: () => void;
}

/**
 * A hybrid signal hub service for publishing and observing events using Signals and callbacks.
 * Supports pub/sub with key-based routing, pattern matching, and Signal-based event observation.
 *
 * @example
 * ```typescript
 * @Component({...})
 * export class MyComponent {
 *   constructor(private signalHub: SignalHubService, private destroyRef: DestroyRef) {
 *     // Synchronous subscription
 *     this.signalHub.on({
 *       key: 'user:*',
 *       callback: (event) => console.log(event.data),
 *       destroyRef: this.destroyRef,
 *       replayLatest: true,
 *     });
 *
 *     // Asynchronous subscription
 *     this.signalHub.onAsync({
 *       key: 'user:login',
 *       callback: async (event) => {
 *         await fetch('/log', { method: 'POST', body: JSON.stringify(event.data) });
 *         console.log(event.data);
 *       },
 *       replayLatest: true,
 *       onError: (err) => console.error('Event error:', err),
 *     });
 *
 *     // Publish an event
 *     this.signalHub.publish('user:login', { id: 123 });
 *
 *     // Clear a specific event
 *     this.signalHub.clearEvent('user:login');
 *
 *     // Reset everything
 *     this.signalHub.reset({ clearSubscribers: true });
 *   }
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class SignalHubService {
  private readonly eventQueue = signal<HubEvent[]>([]);
  private readonly eventRegistry = signal<Map<string, HubEvent>>(new Map());
  private readonly subscribers = new Map<
    string,
    Array<{
      callback: (event: HubEvent<unknown>) => void | Promise<void>;
      onError?: (error: unknown, event: HubEvent<unknown>) => void;
    }>
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

  /**
   * Publishes an event with the given key and data, triggering subscribers and updating the registry.
   *
   * @param key - The event key (e.g., 'user:login').
   * @param data - The event data (must not be null or undefined).
   * @throws Error if key is empty or data is null/undefined.
   *
   * @example
   * ```typescript
   * signalHub.publish('user:login', { id: 123 });
   * // Triggers subscribers to 'user:login' or 'user:*'
   * ```
   */
  publish<T>(key: string, data: T): void {
    if (!key) throw new Error('Key cannot be empty');
    if (data == null) throw new Error('Data cannot be null or undefined');

    const event: HubEvent<T> = { key, data, timestamp: Date.now() };
    this.eventQueue.update((queue) => [...queue, event]);
  }

  /**
   * Publishes an event with the given key, triggering subscribers and updating the registry.
   *
   * @param key - The event key (e.g., 'user:login').
   * @throws Error if key is empty.
   *
   * @example
   * ```typescript
   * signalHub.publish('user:login');
   * // Triggers subscribers to 'user:login' or 'user:*'
   * ```
   */
  publishNoData(key: string): void {
    if (!key) throw new Error('Key cannot be empty');
    const event: HubEvent<undefined> = { key, data: undefined, timestamp: Date.now() };
    this.eventQueue.update((queue) => [...queue, event]);
  }

  /**
   * Subscribes to events matching a query with a synchronous callback, optionally auto-cleaning with DestroyRef.
   * Supports pattern matching (e.g., 'user:*') and optional replay of the latest event.
   *
   * @param options - Subscription options including key, callback, and optional settings.
   * @returns A HubSubscription object with an unsubscribe method.
   * @throws Error if key is empty or callback is not a function.
   *
   * @example
   * ```typescript
   * signalHub.subscribe({
   *   key: 'user:*',
   *   callback: (event) => console.log(event.data),
   *   replayLatest: true,
   *   destroyRef: inject(DestroyRef),
   *   onError: (err) => console.error('Error:', err),
   * });
   * ```
   */
  subscribe<T>({
    key,
    callback,
    destroyRef,
    replayLatest,
    onError,
  }: HubEventOptions<T>): HubSubscription {
    if (!key) throw new Error('Key cannot be empty');
    if (typeof callback !== 'function') throw new Error('Callback must be a function');

    if (replayLatest) {
      const latestEvent = this.eventRegistry().get(key) as HubEvent<T> | undefined;
      if (latestEvent) {
        try {
          callback(latestEvent);
        } catch (error) {
          if (onError) {
            onError(error, latestEvent);
          } else {
            console.warn(`Replay error for query "${key}":`, error);
          }
        }
      }
    }
    return this.internalSubscribe(key, callback, destroyRef, onError);
  }

  /**
   * Subscribes to events matching a query with an asynchronous callback, optionally auto-cleaning with DestroyRef.
   * Supports pattern matching (e.g., 'user:*') and optional replay of the latest event.
   *
   * @param options - Subscription options including key, callback, and optional settings.
   * @returns A Promise resolving to a HubSubscription object with an unsubscribe method.
   * @throws Error if key is empty or callback is not a function.
   *
   * @example
   * ```typescript
   * await signalHub.subscribeAsync({
   *   key: 'user:*',
   *   callback: async (event) => console.log(event.data),
   *   replayLatest: true,
   *   destroyRef: inject(DestroyRef),
   *   onError: (err) => console.error('Error:', err),
   * });
   * ```
   */
  async subscribeAsync<T>({
    key,
    callback,
    destroyRef,
    replayLatest,
    onError,
  }: HubEventOptions<T>): Promise<HubSubscription> {
    if (!key) throw new Error('Key cannot be empty');
    if (typeof callback !== 'function') throw new Error('Callback must be a function');

    if (replayLatest) {
      const latestEvent = this.eventRegistry().get(key) as HubEvent<T> | undefined;
      if (latestEvent) {
        try {
          await callback(latestEvent);
        } catch (error) {
          if (onError) {
            onError(error, latestEvent);
          } else {
            console.warn(`Replay error for query "${key}":`, error);
          }
        }
      }
    }
    return this.internalSubscribe(key, callback, destroyRef, onError);
  }

  /**
   * A shorthand for subscribing to events with a synchronous callback, with optional replay and auto-cleanup.
   *
   * @param options - Options including key, callback, and optional replayLatest, destroyRef, and onError.
   * @returns A HubSubscription object with an unsubscribe method.
   *
   * @example
   * ```typescript
   * signalHub.on({
   *   key: 'user:login',
   *   callback: (event) => console.log(event.data),
   *   replayLatest: true,
   *   destroyRef: inject(DestroyRef),
   *   onError: (err) => console.error('Error:', err),
   * });
   * ```
   */
  on<T>({ key, callback, replayLatest, destroyRef, onError }: HubEventOptions<T>): HubSubscription {
    return this.subscribe({ key, callback, replayLatest, destroyRef, onError });
  }

  /**
   * A shorthand for subscribing to events with an asynchronous callback, with optional replay and auto-cleanup.
   *
   * @param options - Options including key, callback, and optional replayLatest, destroyRef, and onError.
   * @returns A Promise resolving to a HubSubscription object with an unsubscribe method.
   *
   * @example
   * ```typescript
   * await signalHub.onAsync({
   *   key: 'user:login',
   *   callback: async (event) => console.log(event.data),
   *   replayLatest: true,
   *   destroyRef: inject(DestroyRef),
   *   onError: (err) => console.error('Error:', err),
   * });
   * ```
   */
  async onAsync<T>({
    key,
    callback,
    replayLatest,
    destroyRef,
    onError,
  }: HubEventOptions<T>): Promise<HubSubscription> {
    return this.subscribeAsync({ key, callback, replayLatest, destroyRef, onError });
  }

  /**
   * Subscribes to a single event matching the key with a synchronous callback, auto-unsubscribing after the first match.
   *
   * @param options - Options including key, callback, and optional replayLatest and onError.
   * @returns A HubSubscription object with an unsubscribe method.
   *
   * @example
   * ```typescript
   * signalHub.once({
   *   key: 'user:login',
   *   callback: (event) => console.log('Logged in:', event.data),
   *   replayLatest: true,
   *   onError: (err) => console.error('Error:', err),
   * });
   * ```
   */
  once<T>({ key, callback, replayLatest, onError }: HubEventOptions<T>): HubSubscription {
    let subscription: HubSubscription | null = null;
    // Guarantees the callback runs exactly once, even in the same `notifySubscribers` cycle.
    let hasRun = false;

    subscription = this.subscribe({
      key,
      callback: (event) => {
        if (hasRun) return; // Skip if already run.
        hasRun = true;
        subscription?.unsubscribe(); // Unsubscribe first
        callback(event as HubEvent<T>);
      },
      replayLatest,
      onError,
    });
    return subscription;
  }

  /**
   * Subscribes to a single event matching the key with an asynchronous callback, auto-unsubscribing after the first match.
   *
   * @param options - Options including key, callback, and optional replayLatest and onError.
   * @returns A Promise resolving to a HubSubscription object with an unsubscribe method.
   *
   * @example
   * ```typescript
   * await signalHub.onceAsync({
   *   key: 'user:login',
   *   callback: async (event) => console.log('Logged in:', event.data),
   *   replayLatest: true,
   *   onError: (err) => console.error('Error:', err),
   * });
   * ```
   */
  async onceAsync<T>({
    key,
    callback,
    replayLatest,
    onError,
  }: HubEventOptions<T>): Promise<HubSubscription> {
    let subscription: HubSubscription | null = null;
    subscription = await this.subscribeAsync({
      key,
      callback: async (event) => {
        await callback(event as HubEvent<T>);
        subscription?.unsubscribe();
      },
      replayLatest,
      onError,
    });
    return subscription;
  }

  /**
   * Returns a Signal for observing the latest event for a specific key, or null if none exists.
   *
   * @param key - The event key to observe (e.g., 'user:login').
   * @returns A Signal emitting the latest HubEvent or null.
   * @throws Error if key is empty.
   *
   * @example
   * ```typescript
   * const userLogin = signalHub.toSignal('user:login');
   * effect(() => console.log(userLogin()?.data));
   * ```
   */
  toSignal<T>(key: string): Signal<HubEvent<T> | null> {
    if (!key) throw new Error('Key cannot be empty');
    return computed(() => this.eventRegistry().get(key) as HubEvent<T> | null);
  }

  /**
   * Returns a Signal for observing the latest events for multiple keys, returning an array of matches.
   *
   * @param keys - Array of event keys to observe.
   * @returns A Signal emitting an array of matching HubEvents.
   * @throws Error if keys array is empty or contains invalid keys.
   *
   * @example
   * ```typescript
   * const events = signalHub.toSignalMultiple(['user:login', 'user:logout']);
   * effect(() => console.log(events()));
   * ```
   */
  toSignalMultiple<T>(keys: string[]): Signal<HubEvent<T>[]> {
    if (!keys.length) throw new Error('Keys array cannot be empty');
    if (keys.some((key) => !key)) throw new Error('All keys must be non-empty');
    return computed(() => {
      const registry = this.eventRegistry();
      return keys.map((key) => registry.get(key) as HubEvent<T>).filter(Boolean);
    });
  }

  /**
   * Clears a specific event from the registry by its key.
   *
   * @param key - The event key to clear.
   * @throws Error if key is empty.
   *
   * @example
   * ```typescript
   * signalHub.clearEvent('user:login');
   * // Removes 'user:login' from the registry, affecting replayLatest and signals
   * ```
   */
  clearEvent(key: string): void {
    if (!key) throw new Error('Key cannot be empty');
    this.eventRegistry.update((registry) => {
      const updated = new Map(registry);
      updated.delete(key);
      return updated;
    });
  }

  /**
   * Resets the event registry, optionally clearing all subscribers.
   *
   * @param options - Optional settings for the reset operation.
   * @param options.clearSubscribers - If true, also clears all subscribers (default: false).
   *
   * @example
   * ```typescript
   * signalHub.reset(); // Clears event registry only
   * signalHub.reset({ clearSubscribers: true }); // Clears registry and subscribers
   * ```
   */
  reset(options: { clearSubscribers?: boolean } = {}): void {
    this.eventRegistry.set(new Map());
    if (options.clearSubscribers) {
      this.subscribers.clear();
    }
  }

  /**
   * Unsubscribes all callbacks for a specific key or all subscribers if no key is provided.
   *
   * @param key - Optional key to unsubscribe all callbacks for. If omitted, all subscribers are removed.
   *
   * @example
   * ```typescript
   * signalHub.unsubscribeAll('user:login'); // Remove all 'user:login' subscribers
   * signalHub.unsubscribeAll(); // Remove all subscribers
   * ```
   */
  unsubscribeAll(key?: string): void {
    if (key) {
      this.subscribers.delete(key);
    } else {
      this.subscribers.clear();
    }
  }

  private internalSubscribe<T>(
    query: string,
    callback: (event: HubEvent<T>) => void | Promise<void>,
    destroyRef?: DestroyRef,
    onError?: (error: unknown, event: HubEvent<T>) => void
  ): HubSubscription {
    const safeCallback = callback as (event: HubEvent<unknown>) => void | Promise<void>;
    const safeOnError = onError as ((error: unknown, event: HubEvent<unknown>) => void) | undefined;
    const callbacks = this.subscribers.get(query) ?? [];
    callbacks.push({ callback: safeCallback, onError: safeOnError });
    this.subscribers.set(query, callbacks);

    let manualUnsubscribe = true;
    if (destroyRef) {
      manualUnsubscribe = false;
      destroyRef.onDestroy(() => this.unsubscribe(query, safeCallback));
    }

    return {
      unsubscribe: () => {
        if (manualUnsubscribe) {
          this.unsubscribe(query, safeCallback);
        }
      },
    };
  }

  private async notifySubscribers(event: HubEvent): Promise<void> {
    const subscriberPromises: Promise<void>[] = [];

    this.subscribers.forEach((subscribers, query) => {
      if (this.matchQuery(event.key, query)) {
        subscribers.forEach(({ callback, onError }) => {
          const promise = Promise.resolve()
            .then(() => callback(event))
            .catch((error) => {
              if (onError) {
                onError(error, event);
              } else {
                console.warn(`Subscriber error for query "${query}":`, error);
              }
            });
          subscriberPromises.push(promise);
        });
      }
    });

    await Promise.all(subscriberPromises);
  }

  private unsubscribe<T>(
    query: string,
    callback: (event: HubEvent<T>) => void | Promise<void>
  ): void {
    const callbacks = this.subscribers.get(query);
    if (!callbacks) return;

    const updatedCallbacks = callbacks.filter(
      (sub) => sub.callback !== (callback as (event: HubEvent<unknown>) => void | Promise<void>)
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

import {
  Injectable,
  Injector,
  effect,
  signal,
  computed,
  Signal,
  untracked,
  DestroyRef,
} from '@angular/core';

/** Represents an event in the signal hub with a key, data, and timestamp. */
export interface HubEvent<T = unknown> {
  key: string;
  data: T;
  timestamp: number;
}

/** Represents the options for subscribing to a single signal hub event. */
export interface HubEventOptions<T> {
  /** The key to match events against (e.g., 'user:login'). */
  key: string;
  /** The callback function to execute when an event matches the key. */
  callback: (event: HubEvent<T>) => void | Promise<void>;
  /** Optional DestroyRef for auto-cleaning subscriptions. */
  destroyRef?: DestroyRef;
  /** If true, replays the latest event for the key on subscription. */
  replayLatest?: boolean;
  /** Optional error handler for callback errors. */
  onError?: (error: unknown, event: HubEvent<T>) => void;
  /** Optional condition(s) to unsubscribe when true (signal) or when event is received (key). */
  until?: (string | Signal<boolean>) | (string | Signal<boolean>)[];
}

/** Represents the options for subscribing to multiple signal hub events with combineLatest behavior. */
export interface HubCombineLatestOptions<T> {
  /** Array of keys to match events against (e.g., ['user:login', 'user:logout']). */
  keys: string[];
  /** The callback function to execute with the latest events for all keys. */
  callback: (events: HubEvent<T>[]) => void | Promise<void>;
  /** Optional DestroyRef for auto-cleaning subscriptions. */
  destroyRef?: DestroyRef;
  /** If true, replays the latest events for the keys on subscription. */
  replayLatest?: boolean;
  /** Optional error handler for callback errors. */
  onError?: (error: unknown, events: HubEvent<T>[]) => void;
  /** Optional sorting for combined events (e.g., 'timestamp' or 'key'). */
  sortBy?: 'timestamp' | 'key';
}

/** Represents a subscription to the signal hub. */
export interface HubSubscription {
  unsubscribe: () => void;
}

@Injectable({ providedIn: 'root' })
export class SignalHubService {
  private readonly eventRegistry = signal<Map<string, HubEvent>>(new Map(), {
    equal: (a, b) => a === b,
  });

  private readonly subscribers = new Map<
    string,
    Set<{
      callback: (event: HubEvent) => void | Promise<void>;
      onError?: (error: unknown, event: HubEvent) => void;
    }>
  >();

  constructor(private readonly injector: Injector) {}

  publish<T = unknown>(key: string, data?: T): void {
    if (!key) throw new Error('Key cannot be empty');

    const event: HubEvent<T> = { key, data: data as T, timestamp: Date.now() };
    this.eventRegistry.update((registry) => new Map(registry).set(key, event));
    this.notifySubscribers(event);
  }

  on<T>(options: HubEventOptions<T>): HubSubscription {
    const { key, callback, destroyRef, replayLatest, onError, until } = options;
    if (!key) throw new Error('Key cannot be empty');
    if (typeof callback !== 'function') throw new Error('Callback must be a function');

    const unsubscribers: (() => void)[] = [];
    let mainSubscription: HubSubscription | null = null;

    // Handle unsubscription conditions (from takeUntil)
    const unsubscribeAll = () => {
      unsubscribers.forEach((unsub) => unsub());
      mainSubscription?.unsubscribe();
    };

    if (until) {
      const conditions = Array.isArray(until) ? until : [until];
      // Check signals immediately
      const signals = conditions.filter((c): c is Signal<boolean> => typeof c !== 'string');
      if (signals.some((signal) => signal())) {
        return { unsubscribe: () => {} };
      }

      for (const condition of conditions) {
        if (typeof condition === 'string') {
          const sub = this.internalSubscribe(condition, unsubscribeAll, undefined, undefined, true);
          unsubscribers.push(sub.unsubscribe);
        } else {
          const signal = condition;
          const effectRef = effect(
            () => {
              if (signal()) unsubscribeAll();
            },
            { injector: this.injector }
          );
          unsubscribers.push(() => effectRef.destroy());
        }
      }
    }

    // Replay latest event if requested
    if (replayLatest) {
      untracked(() => {
        const latestEvent = this.findLatestEventForKey(key) as HubEvent<T> | undefined;
        if (latestEvent) {
          try {
            callback(latestEvent);
          } catch (error) {
            this.handleError(error, latestEvent, onError, key);
          }
        }
      });
    }

    mainSubscription = this.internalSubscribe(key, callback, destroyRef, onError);
    return { unsubscribe: unsubscribeAll };
  }

  subscribe = this.on;

  once<T>({ key, callback, replayLatest, onError, until }: HubEventOptions<T>): HubSubscription {
    let subscription: HubSubscription | null = null;
    const onceCallback = (event: HubEvent<T>) => {
      subscription?.unsubscribe();
      try {
        callback(event);
      } catch (error) {
        this.handleError(error, event, onError, key);
      }
    };
    subscription = this.on({ key, callback: onceCallback, replayLatest, onError, until });
    return subscription;
  }

  onCombineLatest<T>(options: HubCombineLatestOptions<T>): HubSubscription {
    const { keys, callback, destroyRef, replayLatest, onError, sortBy } = options;
    if (!keys?.length) throw new Error('Keys array cannot be empty');

    const sourceSignals = keys.map((key) => this.toSignal<T>(key));
    const combinedSignal = computed(() => {
      const events = sourceSignals.map((s) => s()).filter((e): e is HubEvent<T> => e !== null);
      if (events.length === keys.length) {
        return sortBy === 'timestamp'
          ? events.sort((a, b) => b.timestamp - a.timestamp)
          : sortBy === 'key'
          ? events.sort((a, b) => a.key.localeCompare(b.key))
          : events;
      }
      return null;
    });

    const effectRef = effect(
      () => {
        const combinedEvents = combinedSignal();
        if (!combinedEvents) return;
        if (!replayLatest && !this.eventRegistry().size) return;

        try {
          callback(combinedEvents);
        } catch (error) {
          onError
            ? onError(error, combinedEvents)
            : console.warn(`onCombineLatest error for keys [${keys.join(', ')}]:`, error);
        }
      },
      { injector: this.injector }
    );

    const unsubscribe = () => effectRef.destroy();
    if (destroyRef) {
      destroyRef.onDestroy(unsubscribe);
    }

    return { unsubscribe };
  }

  toSignal<T>(key: string): Signal<HubEvent<T> | null> {
    if (!key) throw new Error('Key cannot be empty');
    if (key.includes('*'))
      throw new Error('toSignal does not support wildcards. Use toSignalMultiple instead.');

    return computed(() => (this.eventRegistry().get(key) as HubEvent<T>) ?? null);
  }

  toSignalMultiple<T>(
    keys: string[],
    options: { sortBy?: 'timestamp' | 'key' } = {}
  ): Signal<HubEvent<T>[]> {
    if (!keys?.length) throw new Error('Keys array cannot be empty');

    return computed(() => {
      const registry = this.eventRegistry();
      const matchingEvents = new Map<string, HubEvent<T>>();

      for (const query of keys) {
        if (!query) continue;
        const isWildcard = query.includes('*');
        if (!isWildcard) {
          const event = registry.get(query) as HubEvent<T> | undefined;
          if (event) {
            matchingEvents.set(event.key, event);
          }
        } else {
          const regex = this.buildWildcardRegex(query);
          for (const [eventKey, event] of registry.entries()) {
            if (regex.test(eventKey)) {
              matchingEvents.set(eventKey, event as HubEvent<T>);
            }
          }
        }
      }

      const eventsArray = Array.from(matchingEvents.values());
      if (options.sortBy === 'timestamp') {
        return eventsArray.sort((a, b) => b.timestamp - a.timestamp);
      }
      if (options.sortBy === 'key') {
        return eventsArray.sort((a, b) => a.key.localeCompare(b.key));
      }
      return eventsArray;
    });
  }

  clearEvent(key: string): void {
    if (!key) throw new Error('Key cannot be empty');
    this.eventRegistry.update((registry) => {
      const updated = new Map(registry);
      updated.delete(key);
      return updated;
    });
  }

  reset(options: { clearSubscribers?: boolean } = {}): void {
    this.eventRegistry.set(new Map());
    if (options.clearSubscribers) {
      this.subscribers.clear();
    }
  }

  private internalSubscribe<T>(
    query: string,
    callback: (event: HubEvent<T>) => void | Promise<void>,
    destroyRef?: DestroyRef,
    onError?: (error: unknown, event: HubEvent<T>) => void,
    once = false
  ): HubSubscription {
    const subscriber = {
      callback: callback as (event: HubEvent) => void | Promise<void>,
      onError: onError as ((error: unknown, event: HubEvent) => void) | undefined,
    };

    const subscriberSet = this.subscribers.get(query) ?? new Set();
    subscriberSet.add(subscriber);
    this.subscribers.set(query, subscriberSet);

    const unsubscribe = () => {
      const currentSubscribers = this.subscribers.get(query);
      currentSubscribers?.delete(subscriber);
      if (currentSubscribers?.size === 0) {
        this.subscribers.delete(query);
      }
    };

    if (once) {
      const originalCallback = subscriber.callback;
      subscriber.callback = (event: HubEvent) => {
        unsubscribe();
        return originalCallback(event);
      };
    }

    if (destroyRef) {
      destroyRef.onDestroy(unsubscribe);
    }

    return { unsubscribe };
  }

  private notifySubscribers(event: HubEvent): void {
    this.subscribers.forEach((subscribers, query) => {
      if (this.matchQuery(event.key, query)) {
        subscribers.forEach(({ callback, onError }) => {
          try {
            Promise.resolve(callback(event)).catch((error) => {
              this.handleError(error, event, onError, query);
            });
          } catch (error) {
            this.handleError(error, event, onError, query);
          }
        });
      }
    });
  }

  private findLatestEventForKey(key: string): HubEvent | undefined {
    if (!key.includes('*')) {
      return this.eventRegistry().get(key);
    }
    const regex = this.buildWildcardRegex(key);
    let latestEvent: HubEvent | undefined;
    for (const [eventKey, event] of this.eventRegistry().entries()) {
      if (regex.test(eventKey)) {
        if (!latestEvent || event.timestamp > latestEvent.timestamp) {
          latestEvent = event;
        }
      }
    }
    return latestEvent;
  }

  private handleError(error: unknown, event: HubEvent, handler?: Function, query?: string): void {
    if (handler) {
      handler(error, event);
    } else {
      console.warn(`SignalHub error for query "${query}" on event "${event.key}":`, error);
    }
  }

  private matchQuery(key: string, query: string): boolean {
    if (query === '*' || key === query) return true;
    if (!query.includes('*')) return false;
    return this.buildWildcardRegex(query).test(key);
  }

  private buildWildcardRegex(query: string): RegExp {
    const pattern = query.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^:]+');
    return new RegExp(`^${pattern}$`);
  }
}

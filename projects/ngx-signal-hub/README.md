# ngx-signal-hub ✨

[![npm version](https://badge.fury.io/js/ngx-signal-hub.svg)](https://badge.fury.io/js/ngx-signal-hub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
A lightweight, reactive signal hub service for Angular applications built using **Angular Signals**. It offers a hybrid approach, allowing both traditional callback-based subscriptions and efficient Signal-based observation of the latest event state.

Perfect for decoupled communication between components, services, or modules within your Angular application.


## [Playground (Stackblitz)](https://stackblitz.com/edit/ngx-signal-hub)


## Why ngx-signal-hub?

* **Leverages Angular Signals:** Built upon `@angular/core/signals` (`signal`, `computed`, `effect`) for a modern, reactive, and potentially more performant event handling mechanism compared to older patterns.
* **Hybrid Approach:** Get the best of both worlds:
    * Use  `on()`, `once()` or `subscribe()` for traditional callback logic that needs to react to *every* event emission.
    * Use `toSignal()` or `toSignalMultiple()` to get a `Signal` representing the *latest* event data for specific keys, ideal for reactive UI updates or derived state.
* **Automatic Cleanup:** Integrates seamlessly with `DestroyRef` to automatically unsubscribe callbacks, preventing common memory leaks in Angular applications.
* **Simple & Type-Safe:** Provides a clean, minimal API with TypeScript support.
* **Flexible Subscriptions:** Supports exact key matching, a global wildcard (`*`) to subscribe to all events, and prefix-based wildcard subscriptions using a colon (`:`) where `key: *` will match any key starting with `key:`.

## Features

* ✅ Emit events with a key and payload.
* ✅ Subscribe to events using callbacks.
* ✅ Watch the latest event(s) for specific keys as Signals.
* ✅ Automatic unsubscription via `DestroyRef` or `once()`.
* ✅ Manual unsubscription support.
* ✅ Wildcard key subscriptions (`feature:*`, `*`).
* ✅ Remove specific event keys from the registry (`clearEvent()`).
* ✅ Reset the entire event registry (`reset()`).
* ✅ Unsubscribes all callbacks for a specific key or all subscribers if no key is provided with `unsubscribeAll()`.
* ✅ Lightweight and focused.

## Installation

```bash
npm install ngx-signal-hub
# or
yarn add ngx-signal-hub
```

**Compatibility**: Requires Angular v17 or higher (due to Signals).

## Usage
`SignalHubService` is provided in 'root', so you can inject it directly into your components, directives, or services.

- `publish()`
  - Publishes an event with the given key and data, triggering subscribers and updating the registry.
- `on(), onAsync(), once(), onceAsync(), subscribe(), subscribeAsync()`
   - Subscribes to events matching a key/query with a callback.
- `toSignal()`
   - Returns a Signal for observing the latest event for a specific key, or null if none exists.
- `toSignalMultiple()`
   - Returns a Signal for observing the latest events for multiple keys, returning an array of matches.
- `clearEvent()`
   - Clears a specific event from the registry by its key
- `reset()`
   - Resets the registry, removing all events.
- `unsubscribeAll()`
  - Unsubscribes all callbacks for a specific key or all subscribers if no key is provided.

### Basic examples

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignalHubService, HubEvent, HubSubscription } from 'ngx-signal-hub';

interface DemoData {
  text: string;
  value: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h2>Signal Bus Demo</h2>

    <div>
      <h3>Emit Events</h3>
      <button (click)="publishMessage()">Emit Message Event</button>
      <button (click)="publishData()">Emit Data Event</button>
    </div>

    <hr />

    <div>
      <h3>Watch Events (Signal)</h3>
      Data event: <br /> 
      <pre>{{ dataSignal() | json }}</pre>
      Message event: <br /> 
      <pre>{{ messageSignal() | json }}</pre>
    </div>
  `,
})
export class App {
  private readonly hub = inject(SignalHubService);
  private readonly destroyRef = inject(DestroyRef);

  dataSignal = this.hub.toSignal<DemoData>('data');
  messageSignal = this.hub.toSignal<string>('message');

  constructor() {
    this.hub.on<DemoData>({
      key: 'data',
      callback: (event) => console.log(`Data event: `, event);
      destroyRef: this.destroyRef
    });

    this.hub.once<string>({
      key: 'message',
      callback: (event) => {
        console.log('Only triggered once and then cleaned up', event);
      }
    });
  }

  publishMessage(): void {
    this.hub.publish('message', 'A simple message');
  }

  publishData(): void {
    this.hub.publish('data', { text: 'Hello from data event', value: 123 });
  }
}
```
# ngx-signal-hub ✨

[![npm version](https://badge.fury.io/js/ngx-signal-hub.svg)](https://badge.fury.io/js/ngx-signal-hub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
A lightweight, reactive event bus service for Angular applications built using **Angular Signals**. It offers a hybrid approach, allowing both traditional callback-based subscriptions and efficient Signal-based observation of the latest event state.

Perfect for decoupled communication between components, services, or modules within your Angular application.


## [Playground (Stackblitz)](https://stackblitz.com/edit/ngx-signal-hub)


## Why ngx-signal-hub?

* **Leverages Angular Signals:** Built upon `@angular/core/signals` (`signal`, `computed`, `effect`) for a modern, reactive, and potentially more performant event handling mechanism compared to older patterns.
* **Hybrid Approach:** Get the best of both worlds:
    * Use `subscribe()` for traditional callback logic that needs to react to *every* event emission.
    * Use `watch()` or `watchMultiple()` to get a `Signal` representing the *latest* event data for specific keys, ideal for reactive UI updates or derived state.
* **Automatic Cleanup:** Integrates seamlessly with `DestroyRef` to automatically unsubscribe callbacks, preventing common memory leaks in Angular applications.
* **Simple & Type-Safe:** Provides a clean, minimal API with TypeScript support.
* **Flexible Subscriptions:** Supports exact key matching, a global wildcard (`*`) to subscribe to all events, and prefix-based wildcard subscriptions using a colon (`:`) where `query: *` will match any key starting with `query:`.

## Features

* ✅ Emit events with a key and payload.
* ✅ Subscribe to events using callbacks.
* ✅ Watch the latest event(s) for specific keys as Signals.
* ✅ Automatic unsubscription via `DestroyRef`.
* ✅ Manual unsubscription support.
* ✅ Wildcard key subscriptions (`feature:*`, `*`).
* ✅ Remove specific event keys from the registry (`drop`).
* ✅ Reset the entire event registry (`reset`).
* ✅ Lightweight and focused.

## Installation

```bash
npm install ngx-signal-hub
# or
yarn add ngx-signal-hub
```

**Compatibility**: Requires Angular v16 or higher (due to Signals).

## Usage
`EventBusService` is provided in 'root', so you can inject it directly into your components, directives, or services.

- `emit()`
  - Emits an event with a specific key and data payload.
- `subscribe()`
   - Subscribes to events matching a given key or wildcard, invoking a callback for each matching event.
- `toSignal()`
   - Returns a Signal that provides the latest emitted event for a specific key.
- `toSignalMultiple()`
   - Returns a Signal that provides an array of the latest emitted events for multiple specified keys.
- `drop()`
   - Removes the stored event for a specific key from the registry.
- `reset()`
   - Clears the entire event registry.


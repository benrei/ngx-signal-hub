# ngx-signal-hub

[![npm version](https://badge.fury.io/js/ngx-signal-hub.svg)](https://badge.fury.io/js/ngx-signal-hub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight, reactive event hub for Angular applications using Angular Signals. Enables decoupled communication with both callback-based subscriptions and Signal-based event observation.

[Playground (Stackblitz)](https://stackblitz.com/edit/ngx-signal-hub?file=src%2Fmain.ts)

## Why ngx-signal-hub?

- **Angular Signals**: Built on `@angular/core/signals` for reactive event handling.
- **Hybrid Approach**: Supports callback-based (`on`, `once`, `onCombineLatest`) and Signal-based (`toSignal`, `toSignalMultiple`) event observation.
- **Automatic Cleanup**: Integrates with `DestroyRef` for memory leak prevention.
- **Type-Safe**: Strong TypeScript support with generics for event data.
- **Flexible Matching**: Supports exact keys, global wildcard (`*`), and prefix wildcards (e.g., `user:*`).

## Features

- Emit events with `publish(key, data)`.
- Subscribe to events with `on`, `once`.
- Observe latest events with `toSignal` (single key) or `toSignalMultiple` (multiple keys/patterns).
- Combine multiple events with `onCombineLatest`.
- Clear specific events with `clearEvent(key)`.
- Reset registry with `reset()`.
- Lightweight and Angular-native.

## Installation

```bash
npm install ngx-signal-hub
# or
yarn add ngx-signal-hub
```

**Compatibility**: Requires Angular v17+ (Signals).

## Usage

`SignalHubService` is provided in `root` for easy injection into components, services, or directives.

- `publish(key, data)`: Publishes an event, triggering subscribers and updating the registry.
- `on(options)` / `subscribe(options)`: Subscribes to events with a callback.
- `once(options)`: Subscribes to a single event and auto-unsubscribes.
- `onCombineLatest(options)`: Subscribes to multiple keys, emitting when all have values.
- `toSignal(key)`: Returns a Signal for the latest event of a specific key.
- `toSignalMultiple(keys, options)`: Returns a Signal for latest events matching multiple keys/patterns.
- `clearEvent(key)`: Removes a specific event from the registry.
- `reset(options)`: Clears the registry, optionally unsubscribing all callbacks.

### Example

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { SignalHubService, HubEvent } from 'ngx-signal-hub';

interface DemoData {
  text: string;
  value: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <h2>Signal Hub Demo</h2>
    <button (click)="publishMessage()">Emit Message</button>
    <button (click)="publishData()">Emit Data</button>
    <hr>
    <h3>Signal Output</h3>
    <pre>Data: {{ dataSignal() | json }}</pre>
    <pre>Message: {{ messageSignal() | json }}</pre>
  `,
})
export class App {
  private hub = inject(SignalHubService);
  private destroyRef = inject(DestroyRef);

  dataSignal = this.hub.toSignal<DemoData>('data');
  messageSignal = this.hub.toSignal<string>('message');

  constructor() {
    this.hub.on<DemoData>({
      key: 'data',
      callback: (event) => console.log('Data:', event),
      destroyRef: this.destroyRef,
    });

    this.hub.once<string>({
      key: 'message',
      callback: (event) => console.log('Message (once):', event),
    });

    this.hub.on({
      key: 'data',
      callback: (event) => console.log('Data until stopped:', event),
      until: 'stop:event',
    });
  }

  publishMessage() {
    this.hub.publish('message', 'Hello World');
  }

  publishData() {
    this.hub.publish('data', { text: 'Test', value: 42 });
  }
}
```
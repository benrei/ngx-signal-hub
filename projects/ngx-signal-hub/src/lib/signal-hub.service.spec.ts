import { TestBed } from '@angular/core/testing';
import { SignalHubService, HubEvent } from './signal-hub.service';
import { DestroyRef, InjectionToken } from '@angular/core';

class MockDestroyRef implements DestroyRef {
  private destroyCallbacks: Set<() => void> = new Set();

  onDestroy(callback: () => void): () => void {
    this.destroyCallbacks.add(callback);
    return () => {
      this.destroyCallbacks.delete(callback);
    };
  }

  triggerDestroy() {
    for (const cb of Array.from(this.destroyCallbacks)) {
      cb();
    }
    this.destroyCallbacks.clear();
  }
}

const MOCK_DESTROY_REF = new InjectionToken<MockDestroyRef>('MOCK_DESTROY_REF');

describe('SignalHubService', () => {
  let service: SignalHubService;
  let mockDestroyRef: MockDestroyRef;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SignalHubService,
        { provide: MOCK_DESTROY_REF, useClass: MockDestroyRef },
        { provide: DestroyRef, useExisting: MOCK_DESTROY_REF },
      ],
    });
    service = TestBed.inject(SignalHubService);
    mockDestroyRef = TestBed.inject(MOCK_DESTROY_REF);
  });

  describe('publish', () => {
    it('should throw if key is empty', () => {
      expect(() => service.publish('', {})).toThrowError('Key cannot be empty');
    });

    it('should throw if data is null or undefined', () => {
      expect(() => service.publish('key', null)).toThrowError('Data cannot be null or undefined');
      expect(() => service.publish('key', undefined)).toThrowError(
        'Data cannot be null or undefined'
      );
    });

    it('should add event to queue and update registry', (done) => {
      service.publish('test:key', { foo: 'bar' });

      setTimeout(() => {
        const signal = service.toSignal('test:key');
        const event = signal();
        expect(event).toBeTruthy();
        expect(event?.key).toBe('test:key');
        expect(event?.data).toEqual({ foo: 'bar' });
        done();
      }, 0);
    });
  });

  describe('publishNoData', () => {
    it('should throw if key is empty', () => {
      expect(() => service.publishNoData('')).toThrowError('Key cannot be empty');
    });

    it('should publish event with undefined data', (done) => {
      service.publishNoData('test:nodata');

      setTimeout(() => {
        const event = service.toSignal('test:nodata')();
        expect(event).toBeTruthy();
        expect(event?.data).toBeUndefined();
        done();
      }, 0);
    });
  });

  describe('subscribe and on', () => {
    it('should throw if key is empty or callback not function', () => {
      expect(() => service.subscribe({ key: '', callback: () => {} })).toThrowError(
        'Key cannot be empty'
      );
      expect(() => service.subscribe({ key: 'key', callback: null as any })).toThrowError(
        'Callback must be a function'
      );
    });

    it('should call callback on matching event', (done) => {
      const callback = jasmine.createSpy('callback');
      service.subscribe({ key: 'user:login', callback });

      service.publish('user:login', { id: 1 });

      setTimeout(() => {
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(
          jasmine.objectContaining({ key: 'user:login', data: { id: 1 } })
        );
        done();
      }, 0);
    });

    it('should support replayLatest option', (done) => {
      service.publish('replay:key', { val: 42 });

      const callback = jasmine.createSpy('callbackReplay');
      service.subscribe({ key: 'replay:key', callback, replayLatest: true });

      setTimeout(() => {
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(
          jasmine.objectContaining({ key: 'replay:key', data: { val: 42 } })
        );
        done();
      }, 0);
    });

    it('should auto-unsubscribe with destroyRef', (done) => {
      const callback = jasmine.createSpy('callbackDestroy');
      const subscription = service.subscribe({
        key: 'destroy:key',
        callback,
        destroyRef: mockDestroyRef,
      });

      service.publish('destroy:key', { a: 1 });

      setTimeout(() => {
        expect(callback).toHaveBeenCalledTimes(1);

        mockDestroyRef.triggerDestroy();

        service.publish('destroy:key', { a: 2 });

        setTimeout(() => {
          expect(callback).toHaveBeenCalledTimes(1);
          done();
        }, 0);
      }, 0);
    });
  });

  describe('subscribeAsync and onAsync', () => {
    it('should call async callback on matching event', (done) => {
      const callback = jasmine.createSpy('asyncCallback').and.callFake(async () => {
        await Promise.resolve();
      });
      service.subscribeAsync({ key: 'async:key', callback }).then(() => {
        service.publish('async:key', { foo: 'bar' });

        setTimeout(() => {
          expect(callback).toHaveBeenCalledTimes(1);
          done();
        }, 0);
      });
    });

    it('should support replayLatest with async callback', (done) => {
      service.publish('async:replay', { val: 123 });

      const callback = jasmine.createSpy('asyncReplay').and.callFake(async () => {
        await Promise.resolve();
      });
      service.subscribeAsync({ key: 'async:replay', callback, replayLatest: true }).then(() => {
        setTimeout(() => {
          expect(callback).toHaveBeenCalledTimes(1);
          done();
        }, 0);
      });
    });
  });

  describe('once and onceAsync', () => {
    it('should call callback once and unsubscribe', (done) => {
      const callback = jasmine.createSpy('onceCallback');
      const subscription = service.once({ key: 'once:key', callback });

      service.publish('once:key', { a: 1 });
      service.publish('once:key', { a: 2 });

      setTimeout(() => {
        expect(callback).toHaveBeenCalledTimes(1);
        subscription.unsubscribe();
        done();
      }, 0);
    });

    it('should call async callback once and unsubscribe', (done) => {
      let called = false;
      const callback = jasmine.createSpy('onceAsyncCallback').and.callFake(async () => {
        if (called) return;
        called = true;
        await Promise.resolve();
      });
      service.onceAsync({ key: 'once:async', callback }).then((subscription) => {
        service.publish('once:async', { a: 1 });

        setTimeout(() => {
          service.publish('once:async', { a: 2 });

          setTimeout(() => {
            expect(callback).toHaveBeenCalledTimes(1);
            subscription.unsubscribe();
            done();
          }, 50);
        }, 50);
      });
    });
  });

  describe('onCombineLatest and onCombineLatestAsync', () => {
    it('should throw if keys array is empty or contains empty keys', () => {
      expect(() =>
        service.onCombineLatest({
          keys: [],
          callback: () => {},
        })
      ).toThrowError('Keys array cannot be empty');

      expect(() =>
        service.onCombineLatest({
          keys: ['valid', ''],
          callback: () => {},
        })
      ).toThrowError('All keys must be non-empty');
    });

    it('should call callback with all latest events', (done) => {
      const keys = ['key1', 'key2'];
      const callback = jasmine.createSpy('combineLatestCallback');

      service.onCombineLatest({ keys, callback, replayLatest: true });

      service.publish('key1', { v: 1 });
      service.publish('key2', { v: 2 });

      setTimeout(() => {
        expect(callback).toHaveBeenCalled();
        const calls = callback.calls.allArgs();
        const lastCallEvents = calls[calls.length - 1][0];
        expect(lastCallEvents.length).toBe(2);
        expect(lastCallEvents.map((e: HubEvent) => e.key)).toEqual(keys);
        done();
      }, 0);
    });

    it('should call async callback with all latest events', (done) => {
      const keys = ['akey1', 'akey2'];
      const callback = jasmine.createSpy('combineLatestAsyncCallback').and.callFake(async () => {
        await Promise.resolve();
      });

      service.onCombineLatestAsync({ keys, callback, replayLatest: true }).then(() => {
        service.publish('akey1', { v: 1 });
        service.publish('akey2', { v: 2 });

        setTimeout(() => {
          expect(callback).toHaveBeenCalled();
          done();
        }, 0);
      });
    });
  });

  describe('toSignal and toSignalMultiple', () => {
    it('should throw if key is empty', () => {
      expect(() => service.toSignal('')).toThrowError('Key cannot be empty');
    });

    it('should return signal for single key', (done) => {
      service.publish('signal:key', { foo: 'bar' });

      setTimeout(() => {
        const signal = service.toSignal('signal:key');
        expect(signal()).toBeTruthy();
        expect(signal()?.data).toEqual({ foo: 'bar' });
        done();
      }, 0);
    });

    it('should throw if keys array is empty or contains empty keys', () => {
      expect(() => service.toSignalMultiple([])).toThrowError('Keys array cannot be empty');
      expect(() => service.toSignalMultiple(['valid', ''])).toThrowError(
        'All keys must be non-empty'
      );
    });

    it('should return signal for multiple keys', (done) => {
      service.publish('multi:key1', { a: 1 });
      service.publish('multi:key2', { b: 2 });

      setTimeout(() => {
        const signal = service.toSignalMultiple(['multi:key1', 'multi:key2']);
        const events = signal();
        expect(events.length).toBe(2);
        expect(events.map((e) => e.key)).toEqual(['multi:key1', 'multi:key2']);
        done();
      }, 0);
    });
  });

  describe('clearEvent', () => {
    it('should throw if key is empty', () => {
      expect(() => service.clearEvent('')).toThrowError('Key cannot be empty');
    });

    it('should remove event from registry', (done) => {
      service.publish('clear:key', { foo: 'bar' });

      setTimeout(() => {
        expect(service.toSignal('clear:key')()).toBeTruthy();

        service.clearEvent('clear:key');

        setTimeout(() => {
          expect(service.toSignal('clear:key')()).toBeUndefined();
          done();
        }, 0);
      }, 0);
    });
  });

  describe('reset', () => {
    it('should clear event registry', (done) => {
      service.publish('reset:key', { foo: 'bar' });

      setTimeout(() => {
        expect(service.toSignal('reset:key')()).toBeTruthy();

        service.reset();

        setTimeout(() => {
          expect(service.toSignal('reset:key')()).toBeUndefined();
          done();
        }, 0);
      }, 0);
    });

    it('should clear subscribers if clearSubscribers is true', (done) => {
      const callback = jasmine.createSpy('resetCallback');
      service.subscribe({ key: 'reset:sub', callback });

      service.reset({ clearSubscribers: true });

      service.publish('reset:sub', {});

      setTimeout(() => {
        expect(callback).not.toHaveBeenCalled();
        done();
      }, 0);
    });
  });

  describe('unsubscribeAll', () => {
    it('should remove all subscribers for a key', (done) => {
      const callback = jasmine.createSpy('unsubscribeAllCallback');
      service.subscribe({ key: 'unsub:key', callback });

      service.unsubscribeAll('unsub:key');

      service.publish('unsub:key', {});

      setTimeout(() => {
        expect(callback).not.toHaveBeenCalled();
        done();
      }, 0);
    });

    it('should remove all subscribers if no key provided', (done) => {
      const callback1 = jasmine.createSpy('callback1');
      const callback2 = jasmine.createSpy('callback2');

      service.subscribe({ key: 'key1', callback: callback1 });
      service.subscribe({ key: 'key2', callback: callback2 });

      service.unsubscribeAll();

      service.publish('key1', {});
      service.publish('key2', {});

      setTimeout(() => {
        expect(callback1).not.toHaveBeenCalled();
        expect(callback2).not.toHaveBeenCalled();
        done();
      }, 0);
    });
  });

  describe('internalSubscribe and unsubscribe', () => {
    it('should add and remove subscriber correctly', () => {
      const callback = jasmine.createSpy('internalCallback');
      const subscription = service['internalSubscribe']('internal:key', callback);

      expect(service['subscribers'].get('internal:key')?.length).toBe(1);

      subscription.unsubscribe();

      expect(service['subscribers'].has('internal:key')).toBeFalse();
    });
  });

  describe('matchQuery', () => {
    it('should match exact keys', () => {
      expect(service['matchQuery']('a:b', 'a:b')).toBeTrue();
    });

    it('should match wildcard *', () => {
      expect(service['matchQuery']('anything', '*')).toBeTrue();
    });

    it('should match prefix with *', () => {
      expect(service['matchQuery']('user:login', 'user:*')).toBeTrue();
      expect(service['matchQuery']('user:logout', 'user:*')).toBeTrue();
      expect(service['matchQuery']('admin:login', 'user:*')).toBeFalse();
    });

    it('should not match if no conditions met', () => {
      expect(service['matchQuery']('a:b', 'c:d')).toBeFalse();
    });
  });
});

// The native MTP session is shared within a process. Queue until the native
// function returns, not merely until it calls its done callback: Go releases
// its session mutex in a defer after that callback.
let nativeQueue = Promise.resolve();

export const nativeErrorResult = (error) => ({
  error,
  stderr: null,
  data: null,
});

export function decodeNativeResult(value) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Native MTP response must be a JSON object');
  }
  return {
    error: parsed.error || null,
    stderr: parsed.errorType || null,
    data: parsed.data,
  };
}

export class NativeInvoker {
  constructor({
    ffi,
    callbackType,
    functions,
    reportError = () => {},
    trace = () => {},
  }) {
    this.ffi = ffi;
    this.callbackType = callbackType;
    this.functions = functions;
    this.reportError = reportError;
    this.trace = trace;
  }

  invoke(name, args = [], { callbacks = [], onCompleted } = {}) {
    const operation = nativeQueue.then(() =>
      this.run(name, args, callbacks, onCompleted),
    );
    nativeQueue = operation.catch(() => {});
    return operation;
  }

  run(name, args, callbacks, onCompleted) {
    return new Promise((resolve) => {
      const pointers = [];
      let result;
      let callbackError;
      let completed = false;
      const started = performance.now();
      const fail = (error) => {
        callbackError ||= error;
      };
      const finish = (error) => {
        if (completed) return;
        completed = true;
        if (error) fail(error);
        for (const pointer of pointers) {
          try {
            this.ffi.unregister(pointer);
          } catch (cleanupError) {
            fail(cleanupError);
          }
        }
        if (!result && !callbackError)
          fail(new Error(`Native ${name} returned without a result`));
        if (result && onCompleted) {
          try {
            onCompleted(result);
          } catch (handlerError) {
            fail(handlerError);
          }
        }
        const output = callbackError
          ? nativeErrorResult(callbackError)
          : result;
        if (callbackError) {
          try {
            this.reportError(callbackError, `Kalam.${name}`);
          } catch {
            /* Error reporting cannot strand an operation. */
          }
        }
        try {
          this.trace('native-operation', {
            name,
            durationMs: performance.now() - started,
            failed: !!(output.error || output.stderr),
          });
        } catch {
          /* Diagnostics must not affect the native lifetime. */
        }
        resolve(output);
      };
      const register = (handler) => {
        const pointer = this.ffi.register((value) => {
          // Never throw through the native stack or release a callback while Go
          // can still call it. Cleanup only runs from the native completion hook.
          if (completed) return;
          try {
            handler(decodeNativeResult(value));
          } catch (error) {
            fail(error);
          }
        }, this.ffi.pointer(this.callbackType));
        pointers.push(pointer);
        return pointer;
      };
      try {
        const callbackPointers = callbacks.map(register);
        const done = register((value) => {
          result = value;
        });
        this.functions[name].async(...args, ...callbackPointers, done, finish);
      } catch (error) {
        finish(error);
      }
    });
  }
}

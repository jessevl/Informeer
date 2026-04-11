interface PromiseWithResolversResult<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

declare global {
  interface PromiseConstructor {
    withResolvers?<T>(): PromiseWithResolversResult<T>;
  }
}

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers<T>(): PromiseWithResolversResult<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;

    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });

    return { promise, resolve, reject };
  };
}

export {};
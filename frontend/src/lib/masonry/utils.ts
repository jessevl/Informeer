/**
 * Utility functions for the masonry virtualizer
 * Based on @tanstack/virtual with modifications for colSpan support
 */

export type NoInfer<A extends any> = [A][A extends any ? 0 : never];

export type PartialKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export function memo<TDeps extends ReadonlyArray<any>, TResult>(
  getDeps: () => [...TDeps],
  fn: (...args: NoInfer<[...TDeps]>) => TResult,
  opts: {
    key: false | string;
    debug?: () => boolean;
    onChange?: (result: TResult) => void;
    initialDeps?: TDeps;
  }
) {
  let deps = opts.initialDeps ?? [];
  let result: TResult | undefined;

  function memoizedFunction(): TResult {
    const newDeps = getDeps();

    const depsChanged =
      newDeps.length !== deps.length ||
      newDeps.some((dep: any, index: number) => deps[index] !== dep);

    if (!depsChanged) {
      return result!;
    }

    deps = newDeps;
    result = fn(...newDeps);
    opts?.onChange?.(result);

    return result;
  }

  memoizedFunction.updateDeps = (newDeps: [...TDeps]) => {
    deps = newDeps;
  };

  return memoizedFunction;
}

export function memoResult<TArgs extends any[], TResult>(fn: (...args: TArgs) => TResult) {
  let lastArgs: TArgs | undefined;
  let lastResult: TResult | undefined;

  return function (...args: TArgs): TResult {
    if (lastArgs && args.length === lastArgs.length) {
      let isSame = true;
      for (let index = 0; index < args.length; index++) {
        if (!Object.is(args[index], lastArgs[index])) {
          isSame = false;
          break;
        }
      }
      if (isSame) {
        return lastResult as TResult;
      }
    }

    lastArgs = args;
    lastResult = fn(...args);
    return lastResult;
  };
}

export function notUndefined<T>(value: T | undefined, msg?: string): T {
  if (value === undefined) {
    throw new Error(`Unexpected undefined${msg ? `: ${msg}` : ''}`);
  } else {
    return value;
  }
}

export const approxEqual = (a: number, b: number) => Math.abs(a - b) < 1.01;

export const debounce = (targetWindow: Window & typeof globalThis, fn: Function, ms: number) => {
  let timeoutId: number;
  return function (this: any, ...args: Array<any>) {
    targetWindow.clearTimeout(timeoutId);
    timeoutId = targetWindow.setTimeout(() => fn.apply(this, args), ms);
  };
};

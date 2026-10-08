import { defaultReadTimeoutMs } from "./limits";

export async function mapWithConcurrency<T, Result>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer.");
  }
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await map(values[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

// Only use this for reads: a timed-out operation may still finish in the background.
export async function withReadTimeout<T>(
  promise: Promise<T>,
  message: string,
  milliseconds = defaultReadTimeoutMs,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

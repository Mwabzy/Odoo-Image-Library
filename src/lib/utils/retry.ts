type RetryContext = {
  attempt: number;
  retriesRemaining: number;
};

type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  shouldRetry?: (error: unknown, context: RetryContext) => boolean;
  onRetry?: (error: unknown, context: RetryContext & { delayMs: number }) => void;
};

export function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function retryWithBackoff<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
) {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 750;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const factor = options.factor ?? 2;

  let attempt = 0;

  while (true) {
    try {
      return await task(attempt);
    } catch (error) {
      const retriesRemaining = retries - attempt;
      const context = {
        attempt,
        retriesRemaining
      };
      const canRetry =
        retriesRemaining > 0 &&
        (options.shouldRetry ? options.shouldRetry(error, context) : true);

      if (!canRetry) {
        throw error;
      }

      const delayMs = Math.min(maxDelayMs, baseDelayMs * factor ** attempt);
      options.onRetry?.(error, {
        ...context,
        delayMs
      });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

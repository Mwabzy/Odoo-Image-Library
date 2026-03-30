import { retryWithBackoff } from "@/lib/utils/retry";

type FetchWithRetryOptions = Omit<RequestInit, "signal"> & {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetryStatus?: number[];
};

export function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
    }
  };
}

export function isRetryableResponseStatus(status: number) {
  return [408, 420, 423, 425, 429, 500, 502, 503, 504].includes(status);
}

export function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    /timed out/i.test(error.message) ||
    /network/i.test(error.message) ||
    /socket/i.test(error.message) ||
    /fetch failed/i.test(error.message)
  );
}

export async function fetchWithRetry(
  input: string | URL | Request,
  options: FetchWithRetryOptions = {}
) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retryableStatuses = options.shouldRetryStatus ?? [
    408,
    420,
    423,
    425,
    429,
    500,
    502,
    503,
    504
  ];

  return retryWithBackoff(async () => {
    const { signal, dispose } = createTimeoutSignal(timeoutMs);

    try {
      const response = await fetch(input, {
        ...options,
        signal,
        cache: options.cache ?? "no-store"
      });

      if (retryableStatuses.includes(response.status)) {
        throw new Error(`HTTP ${response.status} returned for ${String(input)}`);
      }

      return response;
    } finally {
      dispose();
    }
  }, {
    retries: options.retries ?? 3,
    baseDelayMs: options.baseDelayMs ?? 750,
    maxDelayMs: options.maxDelayMs ?? 5_000,
    shouldRetry: (error) => {
      if (isRetryableNetworkError(error)) {
        return true;
      }

      if (error instanceof Error) {
        const statusMatch = /HTTP (\d+)/.exec(error.message);
        const status = statusMatch ? Number(statusMatch[1]) : NaN;
        return Number.isFinite(status) && isRetryableResponseStatus(status);
      }

      return false;
    }
  });
}

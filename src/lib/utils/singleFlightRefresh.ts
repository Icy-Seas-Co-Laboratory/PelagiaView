type Timer = ReturnType<typeof setTimeout>;

export type RefreshScheduler = {
  setTimeout(callback: () => void, delayMs: number): Timer;
  clearTimeout(timer: Timer): void;
};

export type SingleFlightRefreshOptions = {
  pollDelayMs: number;
  shouldPoll: () => boolean;
  scheduler?: RefreshScheduler;
};

export function isCurrentRefresh(
  intent: number,
  currentIntent: number,
  client: unknown,
  currentClient: unknown,
  scope: string,
  currentScope: string
): boolean {
  return intent === currentIntent && client === currentClient && scope === currentScope;
}

/**
 * Runs at most one refresh at a time. Requests received while it is running
 * collapse into one follow-up, and periodic polling starts only after a run
 * settles. Callers own response freshness checks because their scopes differ.
 */
export function createSingleFlightRefresh(
  run: () => Promise<void>,
  { pollDelayMs, shouldPoll, scheduler = globalThis }: SingleFlightRefreshOptions
) {
  let timer: Timer | null = null;
  let inFlight: Promise<void> | null = null;
  let followUpPending = false;
  let stopped = false;

  function clearTimer() {
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
  }

  function schedule(delayMs: number) {
    if (stopped) return;
    clearTimer();
    timer = scheduler.setTimeout(() => {
      timer = null;
      void refresh();
    }, delayMs);
  }

  function schedulePoll() {
    if (!stopped && timer === null && shouldPoll()) schedule(pollDelayMs);
  }

  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve();
    clearTimer();
    if (inFlight) {
      followUpPending = true;
      return inFlight;
    }
    const current = Promise.resolve().then(run).finally(() => {
      if (inFlight !== current) return;
      inFlight = null;
      if (followUpPending) {
        followUpPending = false;
        void refresh();
      } else {
        schedulePoll();
      }
    });
    inFlight = current;
    return current;
  }

  function stop() {
    stopped = true;
    followUpPending = false;
    clearTimer();
  }

  return { refresh, schedule, stop };
}

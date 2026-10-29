/** Serialize system writes and replace pending values; never queue slider history. */
export function createCoalescedWrite<T>(write: (value: T) => Promise<unknown>, delayMs: number, onError: (error: unknown) => void) {
  let pending: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const flush = async () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (running || !pending) return;
    const { value } = pending;
    pending = undefined;
    running = true;
    try { await write(value); } catch (error) { onError(error); }
    finally {
      running = false;
      if (pending) void flush();
    }
  };
  return {
    push(value: T) {
      pending = { value };
      if (!running && timer === undefined) timer = setTimeout(() => { void flush(); }, delayMs);
    },
    flush,
  };
}

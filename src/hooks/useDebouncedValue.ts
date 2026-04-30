import { useEffect, useState } from 'react';

const DEFAULT_DELAY_MS = 200;

/**
 * Delays updating the returned value until `value` has been stable for `delayMs`.
 * Use for expensive derivations (e.g. full canvas reprocessing on slider input).
 */
export function useDebouncedValue<T>(value: T, delayMs = DEFAULT_DELAY_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

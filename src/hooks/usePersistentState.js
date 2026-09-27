import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSetting, saveSetting } from '../utils/storage';

// Components sharing a key (e.g. the path format in the tree and in the details panel) stay in sync.
const subscribers = new Map();

function subscribersOf(key) {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  return subscribers.get(key);
}

/**
 * `useState` that remembers its value in localStorage (unless `enabled` is false, e.g. when
 * embedded). `override` (e.g. from a URL parameter) takes precedence over the stored value.
 */
export function usePersistentState(key, defaultValue, { enabled = true, validate, override } = {}) {
  const [value, setValue] = useState(() => {
    if (override !== undefined && override !== null) return override;
    if (!enabled) return defaultValue;
    const stored = loadSetting(key, defaultValue);
    return validate && !validate(stored) ? defaultValue : stored;
  });
  // The latest value, updated eagerly so consecutive functional updates chain correctly.
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!enabled) return undefined;
    const listeners = subscribersOf(key);
    const listener = (next) => {
      valueRef.current = next;
      setValue(next);
    };
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, [enabled, key]);

  const update = useCallback(
    (next) => {
      const resolved = typeof next === 'function' ? next(valueRef.current) : next;
      valueRef.current = resolved;
      setValue(resolved);
      if (!enabled) return;
      saveSetting(key, resolved);
      subscribersOf(key).forEach((listener) => listener(resolved));
    },
    [enabled, key]
  );

  return [value, update];
}

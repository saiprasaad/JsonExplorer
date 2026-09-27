import { useCallback, useState } from 'react';
import { loadSetting, saveSetting } from '../utils/storage';

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

  const update = useCallback(
    (next) => {
      setValue((previous) => {
        const resolved = typeof next === 'function' ? next(previous) : next;
        if (enabled) saveSetting(key, resolved);
        return resolved;
      });
    },
    [enabled, key]
  );

  return [value, update];
}

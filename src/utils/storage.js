const PREFIX = 'json-explorer:';
// localStorage quotas are ~5 MB of UTF-16 per origin; leave room for the second document.
export const MAX_PERSISTED_LENGTH = 1_500_000;

let persistence = true;

/**
 * Turns storage on or off. Embedded viewers turn it off: they must neither pick up the
 * settings of the full app on the same site nor change them.
 */
export function setPersistence(enabled) {
  persistence = enabled;
}

export function loadSetting(key, fallback) {
  if (!persistence) return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveSetting(key, value) {
  if (!persistence) return false;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadText(key) {
  if (!persistence) return null;
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/**
 * Persists a document. Documents that are too large (or that exceed the quota) are removed
 * instead, so a reload never resurrects an older version of the user's work.
 */
export function saveText(key, text) {
  if (!persistence) return false;
  try {
    if (text.length > MAX_PERSISTED_LENGTH) {
      window.localStorage.removeItem(PREFIX + key);
      return false;
    }
    window.localStorage.setItem(PREFIX + key, text);
    return true;
  } catch {
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      // Storage is unavailable (private mode or disabled) — nothing to clean up.
    }
    return false;
  }
}

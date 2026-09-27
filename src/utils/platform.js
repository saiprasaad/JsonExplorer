export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

export const MOD_KEY = isMac ? '⌘' : 'Ctrl';
export const ALT_KEY = isMac ? '⌥' : 'Alt';
export const SHIFT_KEY = isMac ? '⇧' : 'Shift';

export function shortcutLabel(...keys) {
  return keys.join(isMac ? '' : '+');
}

/** True when a keyboard event originates from a text field or the Monaco editor. */
export function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest('.monaco-editor')) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function hasModifier(event) {
  return isMac ? event.metaKey : event.ctrlKey;
}

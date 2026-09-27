// Monaco cannot run in jsdom, so tests use plain textareas that honour the same props.
// `onMount` is intentionally not called: the app treats a missing editor instance as
// "Monaco still loading" and falls back to updating React state directly.

export function Editor({ value, defaultValue, onChange, options }) {
  return (
    <textarea
      data-testid="monaco-editor"
      aria-label="JSON editor"
      value={value ?? defaultValue ?? ''}
      readOnly={options?.readOnly}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
}

export function DiffEditor({ original, modified }) {
  return (
    <div data-testid="monaco-diff-editor">
      <textarea data-testid="diff-original" defaultValue={original} readOnly />
      <textarea data-testid="diff-modified" defaultValue={modified} readOnly />
    </div>
  );
}

export const loader = { config() {}, init: () => Promise.resolve({}) };

export default Editor;

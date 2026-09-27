export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadUrl(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadText(text, filename, mimeType = 'application/json') {
  downloadBlob(new Blob([text], { type: `${mimeType};charset=utf-8` }), filename);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or unsupported — fall back to execCommand below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

export function isJsonFile(file) {
  return /\.(json|geojson|jsonc|txt|har|map|webmanifest)$/i.test(file.name) || /json|text\/plain/.test(file.type) || !file.type;
}

export function suggestFileName(name, fallback = 'data.json') {
  const trimmed = (name || '').trim();
  if (!trimmed) return fallback;
  return /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.json`;
}

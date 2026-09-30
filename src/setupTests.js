// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom lacks the layout APIs React Flow relies on; these shims follow React Flow's testing guide.
// Tests for the command-line tool run in plain Node (no DOM), so everything here is DOM-only.
if (typeof window !== 'undefined') {
  class ResizeObserverMock {
    constructor(callback) {
      this.callback = callback;
    }

    observe(target) {
      this.callback([{ target, contentRect: { width: 1000, height: 800 } }]);
    }

    unobserve() {}

    disconnect() {}
  }

  class DOMMatrixReadOnlyMock {
    constructor(transform) {
      const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
      this.m22 = scale !== undefined ? Number(scale) : 1;
    }
  }

  global.ResizeObserver = ResizeObserverMock;
  global.DOMMatrixReadOnly = DOMMatrixReadOnlyMock;

  Object.defineProperties(global.HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get() {
        return parseFloat(this.style.height) || 1;
      },
    },
    offsetWidth: {
      configurable: true,
      get() {
        return parseFloat(this.style.width) || 1;
      },
    },
  });

  global.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });
}

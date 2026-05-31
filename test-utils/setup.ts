import "@testing-library/jest-dom/vitest";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// Mock AudioContext
class MockAudioContext {
  createOscillator() {
    return {
      connect: () => {},
      frequency: { setValueAtTime: () => {} },
      start: () => {},
      stop: () => {},
      type: "sine",
    };
  }
  createGain() {
    return {
      connect: () => {},
      gain: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
    };
  }
  get destination() {
    return {};
  }
}

Object.defineProperty(globalThis, "AudioContext", { value: MockAudioContext });

// Mock import.meta.env
Object.defineProperty(import.meta, "env", {
  value: {
    VITE_PESASWAP_PUBLISHABLE_KEY: "pk_test_123",
    VITE_BACKEND_URL: "http://localhost:8787",
    MODE: "test",
    DEV: true,
  },
});

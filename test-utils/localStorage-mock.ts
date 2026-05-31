/**
 * localStorage mock for Vitest
 * Use: vi.mock() or import directly in test setup
 */

class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }

  get length(): number {
    return Object.keys(this.store).length;
  }

  key(index: number): string | null {
    return Object.keys(this.store)[index] ?? null;
  }
}

export function setupLocalStorageMock() {
  const mock = new LocalStorageMock();
  Object.defineProperty(globalThis, "localStorage", { value: mock, writable: true });
  return mock;
}

export function seedLocalStorage(data: { tables?: any[]; catalogue?: any[]; invoices?: any[] }) {
  if (data.tables) localStorage.setItem("fxengine.merchant.tables", JSON.stringify(data.tables));
  if (data.catalogue) localStorage.setItem("fxengine.merchant.catalogue", JSON.stringify(data.catalogue));
  if (data.invoices) localStorage.setItem("fxengine.merchant.invoices", JSON.stringify(data.invoices));
}

import { describe, it, expect, beforeEach } from "vitest";
import { markOnboardingDone, shouldShowOnboarding } from "../components/OnboardingWizard";
import { isDemoHost } from "../components/DemoBanner";

function mockLocalStorage() {
  const store: Record<string, string> = {};
  const ls = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: ls,
    configurable: true,
  });
}

describe("onboarding storage", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it("shows until marked done", () => {
    expect(shouldShowOnboarding()).toBe(true);
    markOnboardingDone();
    expect(shouldShowOnboarding()).toBe(false);
  });
});

describe("isDemoHost", () => {
  it("detects github.io", () => {
    expect(isDemoHost("dikeramidas.github.io")).toBe(true);
    expect(isDemoHost("localhost")).toBe(false);
    expect(isDemoHost("127.0.0.1")).toBe(false);
  });
});

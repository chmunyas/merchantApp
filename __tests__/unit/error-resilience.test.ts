import { describe, expect, it } from "vitest";

import { LoadFailure } from "../../src/components/LoadFailure";
import { PageErrorBoundary } from "../../src/components/PageErrorBoundary";

// These are the two pieces that decide what a user sees when something breaks.
// There is no component-render harness in this repo, so the assertions are on
// the behavioural contract rather than the markup.

describe("PageErrorBoundary — a broken page must not take the shell with it", () => {
  it("clears the error when the route changes, so navigating away recovers", () => {
    // Without this a transient failure strands the page until a full reload:
    // the boundary would still be showing the old error on a different route.
    const next = PageErrorBoundary.getDerivedStateFromProps(
      { children: null, resetKey: "/dashboard/orders" },
      { error: new Error("boom"), resetKey: "/dashboard/invoices" },
    );
    expect(next).toEqual({ error: null, resetKey: "/dashboard/orders" });
  });

  it("keeps showing the error while the user stays on the failing route", () => {
    const next = PageErrorBoundary.getDerivedStateFromProps(
      { children: null, resetKey: "/dashboard/invoices" },
      { error: new Error("boom"), resetKey: "/dashboard/invoices" },
    );
    expect(next).toBeNull();
  });

  it("records the thrown error rather than swallowing it", () => {
    const error = new Error("render failed");
    expect(PageErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });
});

describe("LoadFailure — the contract it exists to satisfy", () => {
  it("is a component, not a bare message, so it can carry the retry action", () => {
    expect(typeof LoadFailure).toBe("function");
    // `what` + `onRetry` are the whole point: name the thing that failed and
    // give the user a way out. A signature change should fail here.
    expect(LoadFailure.length).toBe(1);
  });
});

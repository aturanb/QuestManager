import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CatalogButton } from "./CatalogButton";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");

function props(overrides: Partial<Parameters<typeof CatalogButton>[0]> = {}) {
  return {
    entries: 18100,
    fetchedAt: "2026-10-08T10:00:00.000Z",
    now: NOW,
    serverOffsetMs: 0,
    busy: false,
    error: null,
    onRefresh: vi.fn(),
    ...overrides,
  };
}

describe("CatalogButton", () => {
  it("shows how many app mappings are cached and when they were fetched", () => {
    render(<CatalogButton {...props()} />);
    expect(screen.getByText(/18,100 apps/)).toBeInTheDocument();
    expect(screen.getByText(/2h 0m ago/)).toBeInTheDocument();
  });

  it("says the app list has never been fetched when there is no cache", () => {
    render(<CatalogButton {...props({ entries: 5, fetchedAt: null })} />);
    expect(screen.getByText(/never fetched/i)).toBeInTheDocument();
  });

  it("asks the server for a fresh catalog when clicked", () => {
    const onRefresh = vi.fn();
    render(<CatalogButton {...props({ onRefresh })} />);
    fireEvent.click(screen.getByRole("button", { name: /update app list/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables the button while a refresh is in flight", () => {
    render(<CatalogButton {...props({ busy: true })} />);
    const button = screen.getByRole("button", { name: /updating/i });
    expect(button).toBeDisabled();
  });

  it("surfaces a failed refresh without hiding the cached count", () => {
    render(<CatalogButton {...props({ error: "catalog_refresh_failed: HTTP 503" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("HTTP 503");
    expect(screen.getByText(/18,100 apps/)).toBeInTheDocument();
  });
});

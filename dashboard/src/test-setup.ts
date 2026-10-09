import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// A language picked in one test must not leak into the next.
afterEach(() => localStorage.clear());

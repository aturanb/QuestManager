import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// A language picked in one browser test must not leak into the next. Node-only
// configuration tests do not provide Web Storage.
afterEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
});

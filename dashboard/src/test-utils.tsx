import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { LANG_STORAGE, LangProvider } from "./i18n";

/** Renders as on a browser where staff picked Turkish; rerender keeps the provider. */
export function renderTurkish(ui: ReactElement) {
  localStorage.setItem(LANG_STORAGE, "tr");
  return render(ui, { wrapper: LangProvider });
}

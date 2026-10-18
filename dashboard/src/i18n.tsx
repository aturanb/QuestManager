import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { messages, type Lang, type Messages } from "./messages";

export type { Lang, Messages };

/** Per browser, like the admin key: each counter PC or phone keeps its own pick. */
export const LANG_STORAGE = "cq-lang";

/** A pick made on this browser wins; until then the browser's own language decides. */
export function initialLang(stored: string | null, browserLanguages: readonly string[]): Lang {
  if (stored === "en" || stored === "tr") return stored;
  return browserLanguages[0]?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

type I18n = { lang: Lang; t: Messages; setLang: (lang: Lang) => void };

// Without a provider (component tests) everything renders in English.
const I18nContext = createContext<I18n>({ lang: "en", t: messages.en, setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() =>
    initialLang(localStorage.getItem(LANG_STORAGE), navigator.languages ?? [navigator.language])
  );
  // Screen readers pick their voice from it.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(LANG_STORAGE, next);
    setLangState(next);
  }, []);
  const value = useMemo(() => ({ lang, t: messages[lang], setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

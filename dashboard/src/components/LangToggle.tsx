import { useI18n, type Lang } from "../i18n";

// Each language is named in its own words, whichever one the board is showing.
const CHOICES: Array<[Lang, string]> = [
  ["en", "English"],
  ["tr", "Türkçe"],
];

export function LangToggle() {
  const { lang, t, setLang } = useI18n();
  return (
    <div className="lang" role="group" aria-label={t.language}>
      {CHOICES.map(([code, name]) => (
        <button key={code} type="button" lang={code} title={name} aria-pressed={lang === code} onClick={() => setLang(code)}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

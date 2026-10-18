import { useState } from "react";
import { useI18n } from "../i18n";
import { LangToggle } from "./LangToggle";

export function KeyPrompt({ initial, onSave }: { initial: string; onSave: (key: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  return (
    <div className="keyprompt" role="dialog" aria-labelledby="keyprompt-title">
      <div className="keyprompt-head">
        <p className="brand">CafeQuest</p>
        <LangToggle />
      </div>
      <h2 id="keyprompt-title">{t.keyPrompt.title}</h2>
      <p>{t.keyPrompt.body(<code>ADMIN_API_KEY</code>, <code>.env</code>)}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value.trim());
        }}
      >
        <input
          type="password"
          aria-label={t.keyPrompt.label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoFocus
        />
        <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
          {t.keyPrompt.connect}
        </button>
      </form>
    </div>
  );
}

import { useState } from "react";

export function KeyPrompt({ initial, onSave }: { initial: string; onSave: (key: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="keyprompt" role="dialog" aria-labelledby="keyprompt-title">
      <p className="brand">CafeQuest</p>
      <h2 id="keyprompt-title">Enter the admin key</h2>
      <p>
        It's <code>ADMIN_API_KEY</code> in the <code>.env</code> file on the café PC. This browser
        remembers it, so you only enter it once.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value.trim());
        }}
      >
        <input
          type="password"
          aria-label="Admin key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoFocus
        />
        <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
          Connect
        </button>
      </form>
    </div>
  );
}

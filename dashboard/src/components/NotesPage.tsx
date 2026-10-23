import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ApiError, createNote, deleteNote, getNotes, newNoteRequestId, updateNote } from "../api";
import { useI18n } from "../i18n";
import type { Note } from "../types";

type NoteError = "loadFailed" | "saveFailed" | "deleteFailed" | "conflict" | "notFound";
type NoteStatus = "added" | "edited" | "deleted";

/** Kept in App so the admin-key prompt cannot unmount an unsaved draft. */
export type NoteDrafts = {
  content: string;
  edit: Note | null;
  createRequest: { id: string; content: string } | null;
};

/** A dedicated page kept mounted across navigation so pending saves stay owned. */
export function NotesPage({ active, apiKey, onUnauthorized, drafts, setDrafts }: {
  active: boolean;
  apiKey: string;
  onUnauthorized: () => void;
  drafts: NoteDrafts;
  setDrafts: Dispatch<SetStateAction<NoteDrafts>>;
}) {
  const { t } = useI18n();
  const n = t.notes;
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [loading, setLoading] = useState(false);
  const draft = drafts.content;
  const edit = drafts.edit;
  const setDraft = (content: string) => setDrafts((current) => ({ ...current, content }));
  const setEdit = (edit: Note | null) => setDrafts((current) => ({ ...current, edit }));
  const [query, setQuery] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [pending, setPending] = useState<"add" | "edit" | "delete" | null>(null);
  const [error, setError] = useState<NoteError | null>(null);
  const [status, setStatus] = useState<NoteStatus | null>(null);
  const pendingRef = useRef(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    if (pendingRef.current) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const result = await getNotes(apiKey);
      if (generation === loadGeneration.current) setNotes(result.notes);
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
      else setError("loadFailed");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [apiKey, onUnauthorized]);

  useEffect(() => {
    if (active) void load();
    return () => { loadGeneration.current += 1; };
  }, [active, load]);

  async function mutate(kind: "add" | "edit" | "delete", operation: () => Promise<void>) {
    if (pendingRef.current || loading) return;
    pendingRef.current = true;
    setPending(kind);
    setError(null);
    setStatus(null);
    try {
      await operation();
      setStatus(kind === "add" ? "added" : kind === "edit" ? "edited" : "deleted");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
      else if (cause instanceof ApiError && cause.status === 409) setError("conflict");
      else if (cause instanceof ApiError && cause.status === 404) setError("notFound");
      else setError(kind === "delete" ? "deleteFailed" : "saveFailed");
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  const disabled = loading || pending !== null;
  const matching = notes?.filter((note) => note.content.toLocaleLowerCase(t.locale).includes(query.trim().toLocaleLowerCase(t.locale))) ?? [];
  // Keep the editor reachable even if search or a remote deletion removes its saved row.
  const visible = edit
    ? [notes?.find((note) => note.id === edit.id) ?? edit, ...matching.filter((note) => note.id !== edit.id)]
    : matching;

  return (
    <section className="notes-page" aria-label={n.title}>
      <header className="notes-heading">
        <h2>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M14 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9zM14 3v6h6M8 13h8M8 17h5" />
            </svg>
            {n.title}
        </h2>
        <p>{n.subtitle}</p>
        {notes && <span className="notes-count">{n.count(notes.length)}</span>}
      </header>
      <div className="notes-body">
        <p className="notes-hint">{n.shared}</p>
        <div className="notes-feedback" aria-live="polite">
          {error && <p role="alert" className="note" data-tone="bad">{n[error]}</p>}
          {status && <p role="status" className="note" data-tone="ok">{n[status]}</p>}
        </div>
        <div className="notes-layout">
          <form className="notes-compose" onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim() || !notes) return;
            void mutate("add", async () => {
              const content = draft.trim();
              const request = drafts.createRequest?.content === content
                ? drafts.createRequest : { id: newNoteRequestId(), content };
              setDrafts((current) => ({ ...current, createRequest: request }));
              const { note } = await createNote(apiKey, content, request.id);
              setNotes((current) => [note, ...(current ?? []).filter((item) => item.id !== note.id)]);
              setDrafts((current) => ({ ...current, content: "", createRequest: null }));
              setQuery("");
            });
          }}>
            <label htmlFor="new-note">{n.label}</label>
            <textarea id="new-note" rows={5} maxLength={5000} value={draft} placeholder={n.placeholder} disabled={disabled} onChange={(event) => setDraft(event.target.value)} />
            <div className="notes-actions">
              <span className="notes-hint">{n.characters(draft.length)}</span>
              <button className="btn btn-primary" disabled={disabled || !notes || !draft.trim()}>{pending === "add" ? n.saving : n.add}</button>
            </div>
          </form>
          <div className="notes-saved">
            <div className="notes-toolbar">
              <label className="notes-search" htmlFor="notes-search">{n.search}
                <input id="notes-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              <button className="btn" type="button" disabled={disabled} onClick={() => void load()}>{n.refresh}</button>
            </div>
            {loading && <p className="notes-hint" role="status">{n.loading}</p>}
            {notes && visible.length === 0 && <p className="notes-empty">{notes.length ? n.noMatches : n.empty}</p>}
            <div className="notes-list">
              {visible.map((note) => (
                <article className="notes-card" key={note.id}>
                  {edit?.id === note.id ? (
                    <form onSubmit={(event) => {
                      event.preventDefault();
                      if (!edit.content.trim()) return;
                      void mutate("edit", async () => {
                        const { note: saved } = await updateNote(apiKey, edit.id, edit.content.trim(), edit.revision);
                        setNotes((current) => [saved, ...(current ?? []).filter((item) => item.id !== saved.id)]);
                        setEdit(null);
                      });
                    }}>
                      <label htmlFor={`edit-${note.id}`}>{n.editLabel}</label>
                      <textarea id={`edit-${note.id}`} rows={5} maxLength={5000} value={edit.content} disabled={disabled} onChange={(event) => setEdit({ ...edit, content: event.target.value })} autoFocus />
                      <div className="notes-actions">
                        <button className="btn" type="button" disabled={disabled} onClick={() => { setEdit(null); setError(null); }}>{n.cancel}</button>
                        <button className="btn btn-primary" disabled={disabled || !edit.content.trim()}>{pending === "edit" ? n.saving : n.save}</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="notes-content">{note.content}</p>
                      <div className="notes-card-footer">
                        <time dateTime={note.updatedAt}>{n.updated(new Date(note.updatedAt).toLocaleString(t.locale, { dateStyle: "medium", timeStyle: "short" }))}</time>
                        <div className="notes-actions">
                          <button className="btn" type="button" disabled={disabled || edit !== null} onClick={() => { setEdit({ ...note }); setDeleteId(null); setError(null); setStatus(null); }}>{n.edit}</button>
                          <button className="btn btn-stop" type="button" disabled={disabled || edit !== null} onClick={() => { setDeleteId(note.id); setError(null); setStatus(null); }}>{n.delete}</button>
                        </div>
                      </div>
                    </>
                  )}
                  {deleteId === note.id && (
                    <div className="notes-confirm" role="group" aria-label={n.confirmDelete}>
                      <p>{n.confirmDelete}</p>
                      <div className="notes-actions">
                        <button className="btn" type="button" disabled={disabled} onClick={() => setDeleteId(null)}>{n.keep}</button>
                        <button className="btn btn-remove" type="button" disabled={disabled} onClick={() => void mutate("delete", async () => {
                          await deleteNote(apiKey, note.id, note.revision);
                          setNotes((current) => (current ?? []).filter((item) => item.id !== note.id));
                          setDeleteId(null);
                        })}>{pending === "delete" ? n.deleting : n.deleteConfirm}</button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

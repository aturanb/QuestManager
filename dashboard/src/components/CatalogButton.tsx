import { formatAgo } from "../time";

export type CatalogButtonProps = {
  /** Mappings currently loaded server-side, or null before the first status read. */
  entries: number | null;
  fetchedAt: string | null;
  now: number;
  serverOffsetMs: number;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
};

/**
 * Pulls a fresh package-name → Meta App ID list from the community catalog.
 * A failed refresh keeps the cached count visible: staff lose nothing by trying.
 */
export function CatalogButton({
  entries,
  fetchedAt,
  now,
  serverOffsetMs,
  busy,
  error,
  onRefresh,
}: CatalogButtonProps) {
  return (
    <div className="catalog">
      <p className="catalog-status">
        App list: {entries === null ? "size unknown" : `${entries.toLocaleString("en-US")} apps known`},{" "}
        {fetchedAt ? `updated ${formatAgo(fetchedAt, now, serverOffsetMs)}` : "never fetched"}
      </p>
      <button className="btn" type="button" onClick={onRefresh} disabled={busy}>
        {busy ? "Updating…" : "Update app list"}
      </button>
      {error && (
        <p className="note" data-tone="bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

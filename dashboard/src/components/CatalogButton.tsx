import { useI18n } from "../i18n";
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
  const { t } = useI18n();
  const size = entries === null ? t.catalog.sizeUnknown : t.catalog.appsKnown(entries.toLocaleString(t.locale));
  const age = fetchedAt ? t.catalog.updated(formatAgo(fetchedAt, now, serverOffsetMs, t.time)) : t.catalog.neverFetched;
  return (
    <div className="catalog">
      <p className="catalog-status">{t.catalog.status(size, age)}</p>
      <button className="btn" type="button" onClick={onRefresh} disabled={busy}>
        {busy ? t.catalog.updating : t.catalog.update}
      </button>
      {error && (
        <p className="note" data-tone="bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

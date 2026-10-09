import { useI18n } from "../i18n";

export type SelectionBarProps = {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClear: () => void;
};

export function SelectionBar({ selectedCount, totalCount, onSelectAll, onClear }: SelectionBarProps) {
  const { t } = useI18n();
  return (
    <div className="selection-bar" role="toolbar" aria-label={t.bulk.actions}>
      <p className="selection-count" aria-live="polite">{t.bulk.selected(selectedCount)}</p>
      <div className="selection-pick">
        <button
          className="btn"
          type="button"
          aria-label={t.bulk.selectAll}
          disabled={selectedCount === totalCount}
          onClick={onSelectAll}
        >
          {t.bulk.selectAllShort}
        </button>
        {selectedCount > 0 && (
          <button className="btn-text" type="button" aria-label={t.bulk.clear} onClick={onClear}>
            {t.bulk.clearShort}
          </button>
        )}
      </div>
    </div>
  );
}

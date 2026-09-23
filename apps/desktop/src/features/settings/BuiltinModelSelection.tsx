import { useState } from "react";
import { Search } from "lucide-react";
import type { BuiltinProviderModelChoice } from "@pideck/protocol";
import { useT } from "../../lib/i18n/use-t";
import { primaryButton, secondaryButton } from "../../components/Dialog";

type SelectionProps = {
  models: BuiltinProviderModelChoice[];
  providerEnabled: boolean;
  onSave: (models: BuiltinProviderModelChoice[]) => Promise<BuiltinProviderModelChoice[] | null>;
};

function useModelSelection(
  initialModels: SelectionProps["models"],
  onSave: SelectionProps["onSave"],
) {
  const [saved, setSaved] = useState(initialModels);
  const [draft, setDraft] = useState(initialModels);
  const [saving, setSaving] = useState(false);
  const dirty = draft.some((model, index) => model.enabled !== saved[index]?.enabled);

  async function save() {
    setSaving(true);
    try {
      const models = await onSave(draft);
      if (models) {
        setSaved(models);
        setDraft(models);
      }
    } finally {
      setSaving(false);
    }
  }

  return { draft, setDraft, saving, dirty, save, cancel: () => setDraft(saved) };
}

export function BuiltinModelSelection({ models, providerEnabled, onSave }: SelectionProps) {
  const t = useT();
  const { draft, setDraft, saving, dirty, save, cancel } = useModelSelection(models, onSave);
  const [search, setSearch] = useState("");
  const emptySelection = providerEnabled && !draft.some((model) => model.enabled);

  return (
    <div className="flex flex-col gap-2">
      <ModelChecklist
        models={draft}
        saving={saving}
        search={search}
        onSearch={setSearch}
        onChange={setDraft}
      />
      {dirty && <p className="text-xs text-muted">{t("providersLoginModelsUnsaved")}</p>}
      {emptySelection && (
        <p role="status" className="text-xs text-danger">
          {t("providersLoginModelsRequired")}
        </p>
      )}
      <p className="text-xs text-muted">{t("providersLoginModelsDraftHint")}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={secondaryButton}
          disabled={saving || !dirty}
          onClick={cancel}
        >
          {t("commonCancel")}
        </button>
        <button
          type="button"
          className={primaryButton}
          disabled={saving || !dirty || emptySelection}
          onClick={() => void save()}
        >
          {t("commonSave")}
        </button>
      </div>
    </div>
  );
}

function ModelChecklist({
  models,
  saving,
  search,
  onSearch,
  onChange,
}: {
  models: BuiltinProviderModelChoice[];
  saving: boolean;
  search: string;
  onSearch: (value: string) => void;
  onChange: (next: BuiltinProviderModelChoice[]) => void;
}) {
  const t = useT();
  const enabledCount = models.filter((model) => model.enabled).length;
  const query = search.trim().toLowerCase();
  const filtered = query
    ? models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query))
    : models;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">
          {t("providersLoginModelsCount", { enabled: enabledCount, total: models.length })}
        </span>
        <button
          type="button"
          className="text-[11px] text-muted hover:text-foreground disabled:opacity-40"
          disabled={saving}
          onClick={() => {
            const enable = models.some((model) => !model.enabled);
            onChange(models.map((model) => ({ ...model, enabled: enable })));
          }}
        >
          {enabledCount === models.length ? t("providersSelectNone") : t("providersSelectAll")}
        </button>
      </div>
      {models.length > 8 && (
        <div className="relative">
          <Search className="absolute left-2 top-2 text-muted" size={13} />
          <input
            className="h-7 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-xs outline-none focus:border-focus"
            placeholder={t("providersSearchModels")}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
      )}
      <div className="max-h-64 overflow-auto rounded-md border border-border bg-surface">
        {filtered.length === 0 ? (
          <p className="p-3 text-center text-xs text-muted">{t("providersModelsEmpty")}</p>
        ) : (
          filtered.map((model) => (
            <label
              key={model.id}
              className="flex h-9 cursor-pointer items-center gap-2.5 border-b border-border px-3 last:border-b-0 hover:bg-surface-overlay"
            >
              <input
                type="checkbox"
                checked={model.enabled}
                disabled={saving}
                onChange={(event) =>
                  onChange(
                    models.map((item) =>
                      item.id === model.id ? { ...item, enabled: event.target.checked } : item,
                    ),
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate text-xs" title={model.id}>
                {model.name}
              </span>
              {model.name !== model.id && (
                <span className="hidden truncate font-mono text-[10px] text-muted sm:block">
                  {model.id}
                </span>
              )}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

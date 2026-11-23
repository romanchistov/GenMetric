import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Modal from "./Modal";
import { report } from "./errors";
import { type Case } from "./CaseHeader";

const FIELDS = [["Архив", "archive"], ["Фонд", "fond"], ["Опись", "opis"], ["Дело", "delo"], ["Церковь", "church"],
                ["Село", "village"], ["Уезд", "uyezd"], ["Губерния", "guberniya"]] as const;

/** «Ф.56 Оп.6 Д.4, Христорождественская, с. Борисоглебское» — без года. */
export function reqsText(c: Case): string {
  const fod = [["Ф.", c.fond], [" Оп.", c.opis], [" Д.", c.delo]]
    .filter(([, v]) => (v ?? "").trim()).map(([k, v]) => `${k}${(v ?? "").trim()}`).join("").trim();
  return [fod || "ФОД не заполнен", (c.church ?? "").trim(), (c.village ?? "").trim()].filter(Boolean).join(", ");
}

/**
 * Реквизиты записи на правке (задача 16, Роман 23.11.2026): строка «Ф.56
 * Оп.6 Д.4, … — изменить». Изменённые реквизиты уходят в `entry_save` (`reqs`)
 * при сохранении записи: запись ляжет в дело своего года с ними; текущие
 * реквизиты прихода (экран «Дело») при этом не меняются.
 */
export default function EntryReqs({ entryId, value, onChange }: {
  entryId: number; value: Case | null; onChange: (c: Case | null) => void;
}) {
  const [own, setOwn] = useState<Case | null>(null);
  const [edit, setEdit] = useState<Case | null>(null);
  useEffect(() => {
    let alive = true;
    invoke<Case | null>("entry_case", { id: entryId })
      .then((c) => { if (alive) setOwn(c); })
      .catch((e) => report("Не удалось прочитать реквизиты записи", e));
    return () => { alive = false; };
  }, [entryId]);
  if (!own) return null;
  const shown = value ?? own;
  return (
    <span className="entryreqs" data-entry-reqs>
      {" "}Реквизиты: <b>{reqsText(shown)}</b>{value ? " (изменятся при сохранении)" : ""}{" "}
      <button type="button" className="linkish" data-entry-reqs-edit onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEdit({ ...shown })}>изменить</button>
      {edit && (
        <Modal title="Реквизиты этой записи" kind="entry-reqs" onClose={() => setEdit(null)}>
          <p className="hint">Изменятся только у этой записи — при «Сохранить изменения». Реквизиты для новых записей — на экране «Дело».</p>
          {FIELDS.map(([label, k]) => (
            <div className="field" key={k}>
              <label>{label}</label>
              <input data-field data-entry-reqs-field={k} value={edit[k] ?? ""} autoComplete="off" spellCheck={false}
                     onChange={(e) => { const v = e.target.value; setEdit((c) => c && { ...c, [k]: v || null }); }} />
            </div>
          ))}
          <div className="modalbar">
            <button type="button" className="primary" data-entry-reqs-ok onClick={() => {
              // Ничего не поменяли — ничего и не переносим: у года бывает два
              // дела с одинаковыми реквизитами (ревьюер 23.11.2026).
              const same = FIELDS.every(([, k]) => (edit[k] ?? "").trim() === (own[k] ?? "").trim());
              onChange(same ? null : edit); setEdit(null);
            }}>Готово</button>
            <button type="button" className="toggle" onClick={() => setEdit(null)}>Отмена (Esc)</button>
          </div>
        </Modal>
      )}
    </span>
  );
}

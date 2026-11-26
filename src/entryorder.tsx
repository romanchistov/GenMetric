import { useParishFlag } from "./flags";

/**
 * Порядок записей «по вводу | по книге» (задача 19, Роман 26.11.2026,
 * спека 2026-11-26-poryadok-po-knige). Одна общая настройка на все разделы и
 * приходы (`ui_entry_order` в `COMMON_SETTINGS`, «1» — по книге); формы и
 * окно выгрузки слышат друг друга через событие окна (`useParishFlag`).
 * Изначально — «по вводу».
 */
export const ENTRY_ORDER = "ui_entry_order";

export function useEntryOrder(): [boolean, (byBook: boolean) => void] {
  return useParishFlag(ENTRY_ORDER, "Порядок записей", false);
}

/** Строка списка «Набрано»: место в порядке книги считает Rust
 *  (`book_order`, поле `book` ответа `entry_list`). */
type Booked = { book?: number };

/**
 * Список для показа. `saved` всегда по вводу — формы берут из него последнюю
 * набранную запись (месяц, счёт, страница); «по книге» меняет только показ:
 * последняя по книге — сверху.
 */
export function shownOrder<T extends Booked>(saved: T[], byBook: boolean): T[] {
  return byBook ? [...saved].sort((a, b) => (b.book ?? 0) - (a.book ?? 0)) : saved;
}

/** Переключатель «Порядок: по вводу | по книге» — заголовок «Набрано» и окно
 *  выгрузки. Щелчок не уводит курсор из поля формы. */
export function EntryOrderToggle({ byBook, onChange, bare }: { byBook: boolean; onChange: (byBook: boolean) => void; bare?: boolean }) {
  const keep = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() };
  return (
    <span className="entryorder" role="group" aria-label="Порядок записей" data-entry-order={byBook ? "book" : "input"}>
      {!bare && <span className="entryorderlabel">Порядок:</span>}
      {([false, true] as const).map((v) => (
        <button key={String(v)} type="button" className={byBook === v ? "on" : ""} aria-pressed={byBook === v} {...keep}
                data-entry-order-set={v ? "book" : "input"} onClick={() => { if (byBook !== v) onChange(v); }}
                title={v ? "По дате обряда, странице и номеру записи" : "Последняя набранная — сверху"}>
          {v ? "по книге" : "по вводу"}
        </button>
      ))}
    </span>
  );
}

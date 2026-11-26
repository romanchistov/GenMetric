import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { report } from "./errors";
import Modal from "./Modal";
import PlaceCard, { type PlaceInfo } from "./PlaceCard";
import { PLACE_RENAMED } from "./PersonBlock";
import { entriesWord } from "./dossier";

/**
 * Справочник населённых пунктов (задача 9, спека 2026-11-26-spravochnik-np).
 * Роман 11.11.2026: отдельное окно со всеми пунктами — дозаполнить пустые
 * поля (уезд, волость, губерния, ссылка Familio) перед выгрузкой, «не
 * добираясь до карточки через пустую запись». Щелчок по строке — та же
 * карточка пункта на правку; после неё — снова справочник.
 */

type Row = {
  name: string; np_type: string | null; volost: string | null; uyezd: string | null;
  guberniya: string | null; familio_url: string | null; uses: number; gaps: boolean;
};

/** Отбор по названию без учёта регистра и «ё». */
const fold = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();
const has = (v: string | null) => !!(v && v.trim());

export default function PlacesBlock() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [gapsOnly, setGapsOnly] = useState(false);
  const [card, setCard] = useState<PlaceInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Прокрутка списка: окно справочника на время карточки убирается, после
   *  неё список встаёт на то же место (проверяющий 26.11.2026). */
  const scrolled = useRef(0);

  async function load() {
    try {
      setRows(await invoke<Row[]>("place_directory"));
    } catch (e) {
      report("Не удалось прочитать справочник населённых пунктов", e);
    }
  }

  useEffect(() => { void load(); }, []);

  async function edit(name: string) {
    setNote(null);
    try {
      const info = await invoke<PlaceInfo | null>("place_get", { name });
      if (!info) {
        setNote(`Пункта «${name}» уже нет под этим названием — список обновлён.`);
        await load();
        return;
      }
      setCard(info);
    } catch (e) {
      report(`Не удалось открыть карточку «${name}»`, e);
    }
  }

  /** Название ушло (переименовали, объединили) — всем формам: формы живут
   *  скрытыми, пока открыто «О программе», и недонабранная запись со старым
   *  названием при сохранении завела бы пустой пункт заново (ревьюер
   *  26.11.2026; так же делают PersonBlock и CaseHeader). */
  function renamed(oldName: string, newName: string) {
    if (oldName !== newName) window.dispatchEvent(new CustomEvent(PLACE_RENAMED, { detail: { oldName, newName } }));
  }

  /** Карточка закрыта — снова справочник, строки свежие. */
  function back() {
    setCard(null);
    void load();
  }

  const all = rows ?? [];
  const gaps = all.filter((r) => r.gaps).length;
  const q = fold(query);
  const shown = all.filter((r) => (!gapsOnly || r.gaps) && (!q || fold(r.name).includes(q)));

  return (
    <div className="cleanupblock" data-places>
      <h2 className="sub-h2">Справочник населённых пунктов</h2>
      <p className="hint">
        Все пункты, заведённые в программе, — чтобы дозаполнить тип, волость, уезд, губернию и ссылку Familio
        перед выгрузкой. Щелчок по строке открывает карточку пункта. Число справа — записи этого прихода
        (пункт с «0 записей» может быть занят делом или другим приходом).
        {rows && ` Пунктов: ${all.length}, с пустыми полями: ${gaps}.`}
      </p>
      <button type="button" className="toggle" data-places-open disabled={!rows} onClick={() => { void load(); setOpen(true); }}>
        Открыть справочник
      </button>

      {open && !card && (
        <Modal title="Справочник населённых пунктов" kind="places" onClose={() => setOpen(false)}>
          <div className="row findrow">
            <input data-places-query value={query} placeholder="найти пункт" autoComplete="off" spellCheck={false}
                   onChange={(e) => setQuery(e.target.value)} />
            <label className="placesgaps">
              <input type="checkbox" data-places-gaps checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} />
              {" "}только с пустыми полями ({gaps})
            </label>
          </div>
          {note && <p className="hint" data-places-note>{note}</p>}
          {shown.length === 0 && <p className="hint" data-places-empty>{all.length ? "Ничего не найдено." : "Пунктов пока нет."}</p>}
          {/* Окно не шире колонки программы — строка в два яруса, а не
              таблица в семь столбцов. Пустое поле названо словами. */}
          {shown.length > 0 && (
            <ul className="placeslist" data-places-list
                ref={(el) => { if (el && el.dataset.restored !== "1") { el.scrollTop = scrolled.current; el.dataset.restored = "1"; } }}
                onScroll={(e) => { scrolled.current = e.currentTarget.scrollTop; }}>
              {shown.map((r) => (
                <li key={r.name} data-place={r.name} className={r.gaps ? "gaps" : ""}
                    onClick={() => void edit(r.name)}>
                  <span className="val">
                    <button type="button" className="linkish">{[r.np_type?.trim(), r.name].filter(Boolean).join(" ")}</button>
                    <span className="sub">{[
                      has(r.volost) ? `${r.volost} вол.` : "нет волости",
                      has(r.uyezd) ? `${r.uyezd} у.` : "нет уезда",
                      has(r.guberniya) ? `${r.guberniya} губ.` : "нет губернии",
                      has(r.np_type) ? "" : "нет типа",
                      has(r.familio_url) ? "" : "нет ссылки Familio",
                    ].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="tier">{entriesWord(r.uses)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="modalbar">
            <button type="button" className="toggle" onClick={() => setOpen(false)}>Закрыть (Esc)</button>
          </div>
        </Modal>
      )}

      {card && (
        <PlaceCard
          name={card.name}
          similar={[]}
          existing={card}
          defaults={{ guberniya: "", uyezd: "" }}
          onPick={back}
          onSaved={(saved) => { renamed(card.name, saved); back(); }}
          onMerged={(kept, dropped) => { renamed(dropped, kept); back(); }}
          onCancel={back}
        />
      )}
    </div>
  );
}

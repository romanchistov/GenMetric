import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { report } from "./errors";
import Modal from "./Modal";
import PlaceCard, { type PlaceInfo } from "./PlaceCard";
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

  async function load() {
    try {
      setRows(await invoke<Row[]>("place_directory"));
    } catch (e) {
      report("Не удалось прочитать справочник населённых пунктов", e);
    }
  }

  useEffect(() => { void load(); }, []);

  async function edit(name: string) {
    try {
      const info = await invoke<PlaceInfo | null>("place_get", { name });
      if (!info) { await load(); return; }
      setCard(info);
    } catch (e) {
      report(`Не удалось открыть карточку «${name}»`, e);
    }
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
        перед выгрузкой. Щелчок по строке открывает карточку пункта.
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
          {shown.length === 0 && <p className="hint" data-places-empty>{all.length ? "Ничего не найдено." : "Пунктов пока нет."}</p>}
          {/* Окно не шире колонки программы — строка в два яруса, а не
              таблица в семь столбцов. Пустое поле названо словами. */}
          {shown.length > 0 && (
            <ul className="placeslist" data-places-list>
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
          onSaved={back}
          onMerged={back}
          onCancel={back}
        />
      )}
    </div>
  );
}

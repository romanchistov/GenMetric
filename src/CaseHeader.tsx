import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Suggest from "./Suggest";
import { focusNextField } from "./focus";
import { dismissWarn, report } from "./errors";
import { dirtyForms, setClearer, setDirty } from "./dirty";
import ExportPanel from "./ExportPanel";
import ParishDialog from "./ParishDialog";
import { takeReviewMark } from "./reviewmark";
import ReviewDialog from "./ReviewDialog";
import Modal from "./Modal";
import PlaceCard, { type PlaceInfo, type Similar } from "./PlaceCard";
import { PLACE_RENAMED, usePlaceRenamed } from "./PersonBlock";
import { placeCase } from "./names";
import { placeTypes } from "./placetypes";

/**
 * Шапка дела: архив, фонд, опись, дело, приход, год, кто индексирует.
 *
 * РЕКВИЗИТЫ — ТЕКУЩИЕ (задача 16, Роман 23.11.2026): «из вкладки дело
 * убрать год… ФОД не меняется, он меняется только после того как
 * пользователь сам руками его изменил». Экран правит текущие реквизиты
 * прихода (`case_reqs_save`); новая запись ложится в дело «свой год +
 * текущие реквизиты» (`records::save_entry_window`); набранное не меняется.
 * Опечатка в реквизитах уже набранного дела — «Дела прихода» → «Исправить».
 *
 * Требование 3.4: вводится один раз и держится неизменной, пока человек сам
 * её не поменяет. В Excel это была та же идея, и Роман назвал её среди того,
 * что нужно обязательно сохранить.
 *
 * Церковь, село, уезд и губерния вместе образуют ключ прихода. По нему
 * переносится накопленная статистика подсказок между годами: индексируют
 * приходами, год за годом, поэтому на второй год подсказки почти всегда
 * попадают с первой буквы. Ключ — общий для всех лет; церковь с 13.11.2026
 * у каждого года своя (п. 139: в 1858 и 1914 годах храмы разные).
 */

export type Case = {
  id: number;
  archive: string | null;
  fond: string | null;
  opis: string | null;
  delo: string | null;
  church: string | null;
  village: string | null;
  uyezd: string | null;
  guberniya: string | null;
  year: number | null;
  indexer: string | null;
};

const EMPTY: Case = {
  id: 0, archive: null, fond: null, opis: null, delo: null, church: null,
  village: null, uyezd: null, guberniya: null, year: null, indexer: null,
};


/** Дело прихода в списке (задача 16): год, реквизиты, сколько записей. */
type CaseRow = { case: Case; entries: number };

/** «запись», «записи», «записей» — по числу. */
function entriesWord(n: number): string {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return "записи";
  return "записей";
}

/** Подпись дела: «1910 · Ф.56 Оп.6 Д.4 · Христорождественская, Борисоглебское». */
export function caseLabel(c: Case): string {
  const fod = [["Ф.", c.fond], [" Оп.", c.opis], [" Д.", c.delo]]
    .filter(([, v]) => (v ?? "").trim()).map(([k, v]) => `${k}${(v ?? "").trim()}`).join("").trim();
  const where = [c.church, c.village].map((v) => (v ?? "").trim()).filter(Boolean).join(", ");
  return [c.year ?? "без года", fod || "ФОД не заполнен", where].filter((v) => v !== "").join(" · ");
}

export default function CaseHeader({ onSaved, reload, parishName, onOpenEntry, viewBlock }: {
  /** Текущие реквизиты прочитаны или сохранены. При первом чтении `year` —
   *  год дела последней работы: с него формы начинают после запуска. */
  onSaved: (c: Case) => void; reload: number; parishName: string;
  /** «Открыть запись» из списка на сверку. */
  onOpenEntry: (section: number, id: number) => void;
  /** Блок «Вид формы» — между кнопкой сохранения и выгрузкой. */
  viewBlock?: React.ReactNode;
}) {
  const [okText, setOkText] = useState("");
  const [review, setReview] = useState(false);
  // null — ещё не прочитано: кнопка «Список на сверку…» не мигает до ответа.
  const [toReview, setToReview] = useState<number | null>(null);
  const [c, setC] = useState<Case>(EMPTY);
  /** Реквизиты у прихода уже есть (сохранены или есть дела): иначе — новый
   *  приход, первое сохранение открывает карточку села. */
  const [hasReqs, setHasReqs] = useState(false);
  const [parishes, setParishes] = useState(false);
  // Реквизиты поправлены, но не сохранены: смена прихода их не должна терять
  // молча (проверяющий 02.10.2026).
  const [edited, setEdited] = useState(false);
  // Пункт переименовали или объединили в карточке НП формы, а в «Селе»
  // стоит прежнее название: иначе «Сохранить» записало бы его обратно
  // (ревьюер 03.11.2026).
  usePlaceRenamed((oldName, newName) =>
    setC((prev) => ((prev.village ?? "").trim() === oldName ? { ...prev, village: newName } : prev)));
  const editedRef = useRef(false);
  editedRef.current = edited;
  useEffect(() => {
    setDirty("Дело", edited);
    return () => setDirty("Дело", false);
  }, [edited]);
  // «Очистить» в окне «Приходы» (ревьюер 03.11.2026): поправленные
  // реквизиты — как были сохранены.
  useEffect(() => {
    setClearer("Дело", () => load());
    return () => setClearer("Дело", null);
  });
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [fixing, setFixing] = useState<CaseRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  /** Первое чтение после запуска (или смены прихода): формам — год дела
   *  последней работы. */
  const startup = useRef(true);
  function load() {
    invoke<CaseRow[]>("case_list")
      .then(setCases)
      .catch((e) => report("Не удалось прочитать дела прихода", e));
    invoke<Case | null>("case_reqs_get")
      .then(async (reqs) => {
        setEdited(false);
        setOk(false);
        if (!reqs) {
          setC(EMPTY);
          setHasReqs(false);
          return;
        }
        setC(reqs);
        setHasReqs(true);
        if (startup.current) {
          startup.current = false;
          const current = await invoke<Case | null>("case_load", { year: null })
            .catch((e) => { report("Не удалось прочитать дело последней работы", e); return null; });
          onSaved({ ...reqs, id: current?.id ?? 0, year: current?.year ?? null });
        }
      })
      .catch((e) => report("Не удалось прочитать реквизиты", e));
    invoke<number>("review_count")
      .then((n) => {
        setToReview(n);
        // Сразу после импорта список открывается сам (Роман 20.10.2026):
        // окно импорта ставит отметку и перезагружает программу.
        // Отметка снимается всегда (проверяющий 20.10.2026).
        if (takeReviewMark() && n > 0) setReview(true);
      })
      .catch((e) => report("Не удалось прочитать список на сверку", e));
  }
  // Запись сохранена — список дел (число записей) перечитать; но не поверх
  // несохранённой правки реквизитов.
  useEffect(() => { if (!editedRef.current) load(); }, [reload]);

  const set = (k: keyof Case) => (v: string) => {
    setC((prev) => {
      const next = v === "" ? null : v;
      // Suggest сообщает значение и без правки (выбор того же) — «поправлено»
      // только когда оно действительно другое.
      if ((prev[k] ?? null) !== next) setEdited(true);
      return { ...prev, [k]: next };
    });
  };

  /** Enter и стрелки ведут по форме, как в остальных полях программы.
   *  Шапка заполняется редко, но спотыкаться на ней всё равно незачем. */
  function plainKeys(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      // Shift+Enter — назад: заказчик 15.09.2026 возвращался в пропущенное
      // поле мышью. Стрелка вверх делала это и раньше, но её не нашли.
      focusNextField(e.currentTarget, e.shiftKey && e.key === "Enter" ? -1 : 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusNextField(e.currentTarget, -1);
    }
  }

  // Год — число, а не строка. Текстовое поле отдавало сюда строку, и
  // сохранение дела падало на разборе: программа ждёт число. Ошибка нашлась
  // на скриншоте до того, как её увидел тестировщик.
  const text = (label: string, k: "archive" | "fond" | "opis" | "delo" | "church"
                | "village" | "uyezd" | "guberniya" | "indexer", hint?: string) => (
    <div className="field">
      <label>{label}</label>
      <input
        data-field
        value={(c[k] as string | null) ?? ""}
        onChange={(e) => set(k)(e.target.value)}
        onKeyDown={plainKeys}
        autoComplete="off"
        spellCheck={false}
      />
      {hint && <div className="fieldhint">{hint}</div>}
    </div>
  );

  // --- Карточка села прихода (Роман 06.10.2026) ---
  // «При создании прихода программа не предлагает заполнить карточку этого
  // села… карточка остаётся пустой»; его решение — «предлагать заполнить
  // сразу при создании прихода». После первого сохранения дела нового прихода
  // карточка открывается сама, если села нет в справочнике или у него нет
  // подробностей. Позже — ссылкой «карточка» в поле «Село».
  const [villageCard, setVillageCard] = useState<{ name: string; similar: Similar[]; existing?: PlaceInfo;
                                                   defaults: { guberniya: string; uyezd: string } } | null>(null);
  async function openVillageCard(from: Case, auto: boolean) {
    const text = (from.village ?? "").trim();
    if (!text || document.querySelector(".modal")) return;
    const defaults = { guberniya: from.guberniya ?? "", uyezd: from.uyezd ?? "" };
    try {
      const existing = await invoke<PlaceInfo | null>("place_get", { name: text });
      if (existing) {
        const filled = [existing.np_type, existing.guberniya, existing.uyezd, existing.volost]
          .some((v) => (v ?? "").trim() !== "");
        if (auto && filled) return;
        setVillageCard({ name: existing.name, similar: [], existing, defaults });
        return;
      }
      const r = await invoke<{ known: boolean; similar: Similar[] }>("place_check", { name: text });
      // Сама открывшаяся карточка похожих не показывает: село только что
      // набрано в деле, и вопрос «не это ли вы имели в виду» тут лишний.
      setVillageCard({ name: text, similar: auto ? [] : r.similar, defaults });
    } catch (e) {
      report(`Не удалось открыть карточку села «${text}»`, e);
    }
  }
  function villageSaved(saved: string) {
    const was = villageCard;
    setVillageCard(null);
    // В деле — название, как оно стоит в справочнике: по нему выгрузка
    // находит карточку села (чистое название она выводит сама). Поправили
    // название или комментарий — дело изменено и ждёт «Сохранить дело».
    if (was && (c.village ?? "").trim() !== saved) set("village")(saved);
    // Уезд и губерния карточки — в поля дела (Роман 03.11.2026: «указанные в
    // ней „Уезд“ и „Губерния“ должны автоматически подтянуться»). Карточку
    // только что подтвердили — её значения главнее.
    void fillFromVillage(saved, true).then(villageCardClosed);
  }

  /** Уезд и губерния села из справочника — в поля дела: `card` — из только
   *  что сохранённой карточки (заменяют), иначе — только в пустые поля. */
  async function fillFromVillage(name: string, card: boolean) {
    try {
      const p = await invoke<PlaceInfo | null>("place_get", { name });
      if (!p) return;
      // Пустота — по текущему делу, а не по замыканию: пока шёл запрос,
      // в «Уезд» могли начать набирать (ревьюер 03.11.2026).
      setC((prev) => {
        let next = prev;
        for (const k of ["uyezd", "guberniya"] as const) {
          const v = (p[k] ?? "").trim();
          if (v && (card || !(prev[k] ?? "").trim()) && (prev[k] ?? "") !== v) next = { ...next, [k]: v };
        }
        if (next !== prev) setEdited(true);
        return next;
      });
    } catch (e) {
      report(`Не удалось прочитать карточку села «${name}»`, e);
    }
  }

  /**
   * Уход из поля «Село» (Роман 03.11.2026: «Если введенного в поле „Село“
   * населенного пункта еще нет в справочнике, программа должна
   * автоматически открывать модальное окно создания нового НП (как это
   * работает при вводе неизвестного НП в записях…)»). Известное село — его
   * уезд и губерния в пустые поля дела. Только набранное в этот заход: проход
   * клавишами по готовому делу ничего не открывает.
   */
  async function leaveVillage(value: string, related: EventTarget | null, typed: boolean) {
    const text = value.trim();
    if (!text || !typed || (related === null && !document.hasFocus()) || document.querySelector(".modal")) return;
    try {
      const r = await invoke<{ known: boolean; canonical?: string | null; similar: Similar[] }>("place_check", { name: text });
      // Пока ждали ответ, поле могло измениться или открыться другое окно.
      if (villageNow.current.trim() !== text || document.querySelector(".modal")) return;
      if (r.known) {
        const name = r.canonical || text;
        if (name !== text) set("village")(name);
        await fillFromVillage(name, false);
        return;
      }
      // Ушли из «Село» щелчком по «Сохранить дело»: щелчок достаётся
      // карточке — дело сохраняется само, когда её закроют (п. 120).
      // По нажатию мыши на кнопке, не по relatedTarget: на macOS щелчок не
      // переводит на неё фокус. Щелчок успел дойти до кнопки (дело уже
      // сохраняется) — отметку снял onClick, второй раз не сохраняем.
      saveAfterCard.current = performance.now() - savePressed.current < 1000;
      setVillageCard({ name: text, similar: r.similar,
                       defaults: { guberniya: c.guberniya ?? "", uyezd: c.uyezd ?? "" } });
    } catch (e) {
      report(`Не удалось проверить село «${text}»`, e);
    }
  }
  const villageNow = useRef("");
  villageNow.current = c.village ?? "";
  /** Карточку села открыл щелчок по «Сохранить дело» (п. 120, 04.11.2026):
   *  после неё дело сохраняется само — уже с уездом и губернией карточки. */
  const saveAfterCard = useRef(false);
  const savePressed = useRef(-Infinity);
  const [saveNow, setSaveNow] = useState(0);
  function villageCardClosed() {
    if (!saveAfterCard.current) return;
    saveAfterCard.current = false;
    // После перерисовки: сохранение должно видеть село, уезд и губернию из
    // карточки, а не значения до неё.
    setSaveNow((n) => n + 1);
  }
  useEffect(() => {
    if (saveNow > 0) void save();
  }, [saveNow]);

  async function save() {
    setBusy(true);
    setOk(false);
    try {
      await invoke("case_reqs_save", { reqs: c });
      // Прежняя жёлтая полоса («Новое дело…», «Сначала сохраните дело»)
      // после сохранения устарела.
      dismissWarn();
      const firstSave = !hasReqs;
      setEdited(false);
      setHasReqs(true);
      onSaved(c);
      setOkText("Сохранено. Новые записи получат эти реквизиты; набранные раньше не изменились"
        + " (их реквизиты — в «Делах прихода» ниже).");
      setOk(true);
      // Новый приход: реквизиты сохранены впервые — карточка его села.
      if (firstSave) void openVillageCard(c, true);
    } catch (e) {
      report("Не удалось сохранить реквизиты", e);
    } finally {
      setBusy(false);
    }
  }

  /** «Исправить реквизиты» дела — у всех его записей (задача 16). */
  async function fixCase(row: CaseRow) {
    try {
      await invoke("case_fix", { case: row.case });
      setFixing(null);
      load();
    } catch (e) {
      report("Не удалось исправить реквизиты дела", e);
    }
  }

  return (
    <section>
      {/* Приход — файл; открыт один (спека 2026-10-02, п. 1.4). */}
      <div className="parishrow main">
        <span>Приход: <b>{parishName || c.village || "без названия"}</b></span>
        {/* Кнопкой, не ссылкой: Роман 03.10.2026 — «не всегда интуитивно
            понятно, что это кликабельные элементы». */}
        <button type="button" className="toggle" onClick={() => setParishes(true)}>Сменить…</button>
        {/* Список на сверку — всегда под рукой, и когда всё сверено (Роман
            20.10 и 06.11.2026, п. 125: «кнопка на сверку была доступна всегда,
            а не только после импорта»): в нём и сделанное, его можно вернуть. */}
        {toReview === 0 && (
          <button type="button" className="toggle" data-review-open onClick={() => setReview(true)}>Список на сверку…</button>
        )}
      </div>
      {parishes && <ParishDialog onClose={() => setParishes(false)} />}
      {/* Заметно и всегда под рукой, пока список не пуст (Роман 20.10.2026: второй
          тестировщик не заметил прежнюю строку, и ошибки импорта осели в базе). */}
      {toReview !== null && toReview > 0 && (
        <div className="reviewbar" data-review-bar>
          <span>На сверку после импорта: <b>{toReview}</b> — проверьте, пока ошибки импорта не разошлись по базе.</span>
          <button type="button" className="primary" onClick={() => setReview(true)}>Открыть список на сверку</button>
        </div>
      )}
      {review && (
        <ReviewDialog
          onClose={() => { setReview(false); invoke<number>("review_count").then(setToReview)
            .catch((e) => report("Не удалось прочитать список на сверку", e)); }}
          onOpenEntry={(section, id) => {
            // Форма занята — запись в неё не откроется (формы сами берегут
            // набранное). Окно списка при этом не закрываем: раньше оно
            // закрывалось, и человек терял место в списке (проверяющий 03.10.2026).
            const form = ["", "Рождения", "Браки", "Смерти"][section] ?? "";
            if (dirtyForms().includes(form)) return form;
            setReview(false);
            onOpenEntry(section, id);
            return null;
          }}
        />
      )}
      <h2 className="caseyear">Реквизиты</h2>
      <p className="hint">
        Заполняются один раз и держатся, пока вы сами их не измените. Каждая новая
        запись получает те реквизиты, что стоят здесь сейчас, — в любом разделе и
        любом году (год ставится в форме). Изменили — новые реквизиты получат только
        записи, набранные после этого.
      </p>

      <Suggest label="Архив" kind="archive" browse value={c.archive ?? ""} onChange={set("archive")} />
      <div className="row fod">
        {text("Фонд", "fond")}
        {text("Опись", "opis")}
        {text("Дело", "delo")}
      </div>
      <Suggest label="Церковь" kind="church" value={c.church ?? ""} onChange={set("church")} />
      {/* Заглавная буква — как в поле НП формы; «карточка» — тип, волость и
          ссылка Familio села прихода. */}
      <Suggest label="Село" kind="place" value={c.village ?? ""} onChange={set("village")}
               fix={(text, final) => placeCase(text, placeTypes(), final)}
               onLeave={(v, related, typed) => void leaveVillage(v, related, typed)}
               action={{ label: "карточка", onClick: () => void openVillageCard(c, false) }} />
      {villageCard && (
        <PlaceCard name={villageCard.name} similar={villageCard.similar} existing={villageCard.existing}
                   defaults={villageCard.defaults} defaultType="с." fillBare
                   onPick={(name) => { setVillageCard(null); set("village")(name); void fillFromVillage(name, false).then(villageCardClosed); }}
                   onSaved={villageSaved}
                   onMerged={(kept, dropped) => {
                     setVillageCard(null);
                     // Село дел в базе объединение уже поправило — здесь
                     // только поле, без «дело изменено».
                     setC((prev) => ((prev.village ?? "").trim() === dropped ? { ...prev, village: kept } : prev));
                     window.dispatchEvent(new CustomEvent(PLACE_RENAMED, { detail: { oldName: dropped, newName: kept } }));
                     // Карточку открыл щелчок «Сохранить дело» — после объединения
                     // дело сохраняется так же, как после карточки (ревьюер 04.11.2026).
                     void fillFromVillage(kept, false).then(villageCardClosed);
                   }}
                   onCancel={() => { setVillageCard(null); villageCardClosed(); }} />
      )}
      <Suggest label="Уезд" kind="uyezd" browse value={c.uyezd ?? ""} onChange={set("uyezd")} />
      <Suggest label="Губерния" kind="guberniya" browse value={c.guberniya ?? ""} onChange={set("guberniya")} />
      {/* Года здесь нет (задача 16, Роман 23.11.2026): «год пусть будет
          только во вкладках рождение, брак, смерть». */}
      {text("Кто индексирует", "indexer")}

      <button className="primary" data-case-save onMouseDown={() => { savePressed.current = performance.now(); }}
              onClick={() => { savePressed.current = -Infinity; saveAfterCard.current = false; void save(); }} disabled={busy}>
        {busy ? "Сохраняю…" : "Сохранить реквизиты"}
      </button>
      {ok && <p className="hint">{okText}</p>}

      {/* Дела прихода (задача 16): какие реквизиты у набранного и правка
          опечатки сразу у всех записей дела. */}
      {cases.length > 0 && (
        <details className="caselist" data-case-list>
          <summary>Дела прихода: {cases.length}</summary>
          <table className="facts">
            <tbody>
              {cases.map((row) => (
                <tr key={row.case.id} data-case-row={row.case.id}>
                  <td>{caseLabel(row.case)}</td>
                  <td>записей: {row.entries}</td>
                  <td><button type="button" className="linkish" data-case-fix={row.case.id}
                              onClick={() => setFixing({ ...row, case: { ...row.case } })}>Исправить</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {fixing && (
        <Modal title={`Реквизиты дела ${fixing.case.year ?? "без года"}`} kind="case-fix" onClose={() => setFixing(null)}>
          <p className="hint">Изменятся у всех записей этого дела: {fixing.entries}. Текущие реквизиты для новых записей — не меняются.</p>
          {([["Архив", "archive"], ["Фонд", "fond"], ["Опись", "opis"], ["Дело", "delo"], ["Церковь", "church"],
             ["Село", "village"], ["Уезд", "uyezd"], ["Губерния", "guberniya"]] as const).map(([label, k]) => (
            <div className="field" key={k}>
              <label>{label}</label>
              <input data-field data-case-fix-field={k} value={fixing.case[k] ?? ""} autoComplete="off" spellCheck={false}
                     onChange={(e) => { const v = e.target.value; setFixing((f) => f && { ...f, case: { ...f.case, [k]: v || null } }); }} />
            </div>
          ))}
          <div className="modalbar">
            <button type="button" className="primary" data-case-fix-save onClick={() => void fixCase(fixing)}>
              Исправить у {fixing.entries} {entriesWord(fixing.entries)}
            </button>
            <button type="button" className="toggle" onClick={() => setFixing(null)}>Отмена (Esc)</button>
          </div>
        </Modal>
      )}

      {/* «Всегда в столбик» — между «Сохранить дело» и «Выгрузкой» (Роман
          07.10.2026). */}
      {viewBlock}

      {hasReqs && <ExportPanel mkCase={c} />}
    </section>
  );
}

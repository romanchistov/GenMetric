import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { report } from "./errors";
import NameResolve from "./NameResolve";

/**
 * «Запомненные написания имён и отчеств» на «ⓘ О программе» (задача 15,
 * спека 2026-11-26-zapomnennye-napisaniya). Роман 20.11.2026: «как нам
 * править ошибочные связи неправильных имён? Вот я вбил Ивлиева, такого
 * отчества нет, он предложил Иулиева, я выбрал, а сейчас хочу поменять на
 * Иоилева». Соответствие из окна сверки запоминается навсегда, и окно для
 * этого написания больше не открывается — здесь его видно, можно изменить
 * (то же окно сверки) или удалить (программа спросит снова). Набранные
 * записи не меняются: для них — «Найти в записях».
 */

type Alias = { kind: "name" | "patr"; form: string; form_norm: string; target: string | null };

/** Сколько строк показывать списком. */
const SHOWN = 300;

/** Отбор без учёта регистра, «ё» и конечного «ъ» — как сверка со словарём. */
const fold = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/ъ(?=\s|$)/g, "").trim();

export default function AliasesBlock() {
  const [all, setAll] = useState<Alias[] | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Alias | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    try {
      setAll(await invoke<Alias[]>("alias_list"));
    } catch (e) {
      report("Не удалось прочитать запомненные написания", e);
    }
  }

  useEffect(() => { void load(); }, []);

  async function change(a: Alias, target: string | null) {
    setEditing(null);
    try {
      await invoke("alias_save", { kind: a.kind, form: a.form, target, gender: null });
      setNote(target ? `«${a.form}» теперь становится «${target}». Набранные записи не изменились.`
        : `«${a.form}» запомнено как не отчество. Набранные записи не изменились.`);
      await load();
    } catch (e) {
      report(`Не удалось запомнить соответствие «${a.form}» → «${target}»`, e);
    }
  }

  /** «Удалить» — со второго нажатия: удаление действует во всех приходах
   *  (ревьюер 26.11.2026: промах мышью терял решение без отмены). */
  const [sure, setSure] = useState<string | null>(null);

  async function remove(a: Alias) {
    const key = `${a.kind}|${a.form_norm}`;
    if (sure !== key) { setSure(key); return; }
    setSure(null);
    try {
      await invoke("alias_remove", { kind: a.kind, formNorm: a.form_norm });
      setNote(`«${a.form}» забыто: при следующем наборе программа снова спросит, ${a.kind === "patr" ? "какому отчеству" : "какому имени"} оно соответствует.`);
      await load();
    } catch (e) {
      report(`Не удалось удалить «${a.form}»`, e);
    }
  }

  const q = fold(query);
  const shown = (all ?? []).filter((a) => !q || fold(a.form).includes(q) || fold(a.target ?? "").includes(q));

  return (
    <div className="cleanupblock" data-aliases>
      <h2 className="sub-h2">Запомненные написания имён и отчеств</h2>
      <p className="hint">
        Что вы выбрали в окне «Какому имени соответствует…»: программа помнит это и больше не спрашивает.
        «Изменить» — выбрать другое слово, «Удалить» — при следующем наборе программа спросит снова.
        Набранные записи не меняются — для них «Найти в записях» выше.
      </p>
      {all && all.length === 0 && <p className="hint" data-aliases-empty>Запомненных написаний пока нет.</p>}
      {all && all.length > 0 && (
        <>
          <div className="row findrow">
            <input data-aliases-query value={query} placeholder="найти написание" autoComplete="off" spellCheck={false}
                   onChange={(e) => setQuery(e.target.value)} />
            <span className="fieldhint">
              {q ? `найдено ${shown.length} из ${all.length}` : `всего ${all.length}`}
              {shown.length > SHOWN ? `, показаны первые ${SHOWN}` : ""}
            </span>
          </div>
          <table className="facts" data-aliases-list>
            <tbody>
              {shown.slice(0, SHOWN).map((a) => (
                <tr key={`${a.kind}|${a.form_norm}`} data-alias={a.form}>
                  <td>{a.target ? `«${a.form}» → «${a.target}»` : `«${a.form}» — ${a.kind === "patr" ? "не отчество" : "новое имя"}`}</td>
                  <td className="fieldhint">{a.target ? (a.kind === "patr" ? "отчество" : "имя") : ""}</td>
                  <td>
                    <button type="button" className="linkish" data-alias-change onClick={() => { setNote(null); setEditing(a); }}>
                      Изменить
                    </button>{" "}
                    <button type="button" className={sure === `${a.kind}|${a.form_norm}` ? "danger" : "linkish"} data-alias-remove
                            onClick={() => void remove(a)}>
                      {sure === `${a.kind}|${a.form_norm}` ? "Да, удалить во всех приходах" : "Удалить"}
                    </button>
                    {sure === `${a.kind}|${a.form_norm}` && (
                      <button type="button" className="linkish" onClick={() => setSure(null)}>Отмена</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {note && <p className="hint" data-aliases-note>{note}</p>}
      {editing && (
        <NameResolve
          word={editing.form}
          kind={editing.kind}
          onPick={(v) => void change(editing, v)}
          onCancel={() => setEditing(null)}
          onNotPatr={() => void change(editing, null)}
          cancelLabel="Не менять"
        />
      )}
    </div>
  );
}

import { EMPTY_PERSON, nameSurnameOf, type Person } from "./PersonBlock";

/**
 * Родственник восприемника, родителя и поручителя (задача 7, Роман
 * 12.11.2026; спека 2026-11-25-rodstvenniki-poruchitelej). В «Рождениях» —
 * «Родственник восприемника или родителя № *» и «№ **» (роли
 * `kin_godparent1/2`), в «Браках» — «Родственник поручителя или жениха № *»
 * и «… или невесты № **» (`kin_witness1/2`). Колонки — как в шаблоне Familio:
 * «чей родств.», «родство», звание, Н.П., ФИО. Блоки изначально свёрнуты.
 */
export type Kin = Person & { kinship: string; kinOf: string };

export const NEW_KIN: Kin = { ...EMPTY_PERSON, kinship: "", kinOf: "" };

/** Пол по родству: «муж» восприемницы — М, иначе по имени. */
export function kinSex(k: string): "М" | "Ж" | undefined {
  const v = k.trim().toLowerCase().split(/[\s(]/)[0];
  if (["отец", "брат", "дядя", "дед", "супруг", "муж", "сын", "отчим"].includes(v)) return "М";
  if (["мать", "сестра", "тетка", "тётка", "бабка", "супруга", "жена", "дочь", "мачеха"].includes(v)) return "Ж";
  return undefined;
}

/** Набран ли человек: без ИОФ «чей» и родство — не человек (спека). */
export const kinFilled = (k: Kin) => k.iof.trim() !== "";

/** Поля записи для сохранения сверх общих полей персоны. */
export const kinExtra = (k: Kin) => ({ kinship: k.kinship.trim() || null, kin_of: k.kinOf.trim() || null });

type KinMention = {
  first_name: string | null; patronymic: string | null; surname: string | null;
  place: string | null; rank: string | null; note: string | null;
  kinship?: string | null; kin_of?: string | null;
};

/** Человек записи на правке → блок формы. */
export function kinOf(m: KinMention | undefined): Kin {
  if (!m) return { ...NEW_KIN };
  return {
    ...NEW_KIN,
    iof: [m.first_name, m.patronymic, m.surname].filter(Boolean).join(" "),
    nameSurname: nameSurnameOf(m), place: m.place ?? "", rank: m.rank ?? "", note: m.note ?? "",
    kinship: m.kinship ?? "", kinOf: m.kin_of ?? "",
  };
}

/** «Чей родств.» — только роли своего раздела (долг п. 28, Роман
 *  26.11.2026): перечень `kin_of` один на «Рождения» и «Браки». Убираются
 *  лишь чужие роли поставки; своё вписанное остаётся. */
const BIRTH_ONLY = new Set(["восприемника №1", "восприемника №2", "восприемника №3", "восприемника №4", "отца", "матери"]);
const MARRIAGE_ONLY = new Set(["поручителя №1", "поручителя №2", "поручителя №3", "поручителя №4", "поручителя №5", "поручителя №6", "жениха", "невесты"]);
const kinKey = (v: string) => v.trim().toLowerCase();
/** Номер восприемника или поручителя в значении («поручителя №5» → 5). */
const numberOf = (v: string, who: string) => {
  const m = new RegExp(`^${who} №(\\d+)$`).exec(kinKey(v));
  return m ? Number(m[1]) : null;
};
/** Номеров — столько, сколько восприемников (поручителей) в форме (Нинель
 *  27.11.2026, Бэклог р. 3 п. 41: «в рождениях натыкала 4 воспреемника, а в
 *  списке родственников только 2»). */
export const kinOfBirth = (gods: number) => (v: string) =>
  !MARRIAGE_ONLY.has(kinKey(v)) && (numberOf(v, "восприемника") ?? 0) <= gods;
export const kinOfMarriage = (witnesses: number) => (v: string) =>
  !BIRTH_ONLY.has(kinKey(v)) && (numberOf(v, "поручителя") ?? 0) <= witnesses;

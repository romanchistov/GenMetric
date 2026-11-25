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

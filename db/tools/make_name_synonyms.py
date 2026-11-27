"""Таблица синонимов имён для «Поиска» (задача 13, спека 2026-11-27-sinonimy-imen).

Источник — выгрузка приложения RusNamesDesktop (словарь Петровского):
HTML со встроенным `const DATA = {...}` — `docs` (документальные имена) и
`forms` (производные формы по видам). Роман 27.11.2026: «Можно, кладём в
репозиторий». Решения Романа по спорным связям (таблица «Синонимы имён — на
решение (26.11)») записаны ниже перечнями — их правят здесь.

    python3 db/tools/make_name_synonyms.py <выгрузка.html>

Пишет db/name_synonyms.csv (связи) и db/name_patronymics.csv (отчества имён
групп). Программа вшивает оба файла (`search/synonyms.rs`).
"""
import csv
import json
import re
import sys
from pathlib import Path

KIND = {"old": "старая церковная", "colloquial": "разговорная", "old_colloquial": "старо-разговорная",
        "popular": "народная", "vulgar": "простонародная"}

# Список 1 «Одна форма — два имени»: «разные» — связи формы не берутся.
FORM_SPLIT = {"веденей", "флор"}
# Список 2 «Форма — сама имя»: «разные» — связь не берётся. Пары разного пола
# не склеиваются никогда (Роман 26.11.2026).
NOT_SAME = {("виктор", "викторин"), ("герман", "германик"), ("никита", "аникита"),
            ("ксения", "поликсения"), ("филон", "филимон"), ("флор", "флорентий"),
            ("флор", "флориан"), ("ива", "ив"), ("илия", "илья"), ("кирилла", "кирилл"),
            ("лавра", "лавр"), ("фома", "фомаида")}
# Список 3 — опечатки распознавания в данных приложения.
TYPOS = {"вйктор", "знна"}


def norm(s: str) -> str:
    return s.strip().lower().replace("ё", "е")


def patronymics(text: str) -> list[str]:
    """«Егорович, Егоровна; разг. Егорыч.» → ['Егорович', 'Егоровна', 'Егорыч']."""
    out = []
    for part in re.split(r"[;,]| и ", text or ""):
        word = re.sub(r"^(разг\.|стар\.|прост\.)\s*", "", part.strip()).strip(" .")
        if word and " " not in word and word[0].isupper():
            out.append(word)
    return out


def main() -> int:
    html = Path(sys.argv[1]).read_text(encoding="utf-8")
    start = html.index("const DATA = ") + len("const DATA = ")
    data, _ = json.JSONDecoder().raw_decode(html, start)
    docs = {norm(d[0]): d for d in data["docs"]}
    gender_of = {norm(d[0]): d[1].upper() for d in data["docs"]}

    links = []  # (пол, форма, документальное, вид)
    by_form: dict[tuple[str, str], set[str]] = {}
    for kind, rows in data["forms"].items():
        for r in rows:
            doc, form, g = norm(r[0]), norm(r[3]), r[1].upper()
            if form == doc or form in TYPOS or doc in TYPOS:
                continue
            if (form, doc) in NOT_SAME:
                continue
            if form in docs and gender_of.get(form, g) != g:
                continue  # форма — имя другого пола
            by_form.setdefault((g, form), set()).add(doc)
            links.append((g, form, doc, KIND[kind]))
    links = [l for l in links if not (l[1] in FORM_SPLIT and len(by_form[(l[0], l[1])]) > 1)]
    links = sorted(set(links))

    root = Path(__file__).resolve().parents[1]
    with open(root / "name_synonyms.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["gender", "form", "documental", "kind"])
        w.writerows(links)

    # Отчества — для мужских имён, что попали в связи (и форм, и документальных).
    pat: dict[str, set[str]] = {}
    for g, form, doc, _ in links:
        if g != "М":
            continue
        pat.setdefault(doc, set()).update(patronymics(docs[doc][4]) if doc in docs else [])
    for kind, rows in data["forms"].items():
        for r in rows:
            form = norm(r[3])
            if r[1].upper() == "М" and any(l[1] == form and l[0] == "М" for l in links):
                pat.setdefault(form, set()).update(patronymics(r[4]))
    # И отчества нашего словаря (старые «Егоров», «Егорова» и современные) —
    # в записях лежат его формы.
    with open(root / "seed" / "name_dict.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            name = norm(r["name"])
            if name in pat and r["gender"] == "М":
                pat[name].update(v for v in (r["patr_old_m"], r["patr_old_f"], r["patr_m"], r["patr_f"]) if v)
    with open(root / "name_patronymics.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["name", "patronymic"])
        for name in sorted(pat):
            for p in sorted(pat[name]):
                w.writerow([name, p])
    print(f"связей: {len(links)}; имён с отчествами: {len(pat)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

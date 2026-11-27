//! Синонимы имён для «Поиска» (задача 13, спека 2026-11-27-sinonimy-imen):
//! «Сильвестр Георгиевич» и «Сильвестр Егорович» — один человек. Таблица —
//! `db/name_synonyms.csv` (связи «форма → документальное имя» словаря
//! Петровского с решениями Романа, собирает `db/tools/make_name_synonyms.py`)
//! и `db/name_patronymics.csv` (отчества имён групп). Вшита в программу:
//! справочник неизменяемый, база её не хранит.
//!
//! Группы — внутри пола: мужское и женское имя не склеиваются никогда.
//! Имя группы сводится к её представителю (наименьшему по алфавиту), отчество
//! — к метке представителя с полом отчества. Сведённое — только для
//! сравнения (ключ персоны, склейка семьи); на экран идёт записанное.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::text::normalize_name;

const LINKS: &str = include_str!("../../../../db/name_synonyms.csv");
const PATRONYMICS: &str = include_str!("../../../../db/name_patronymics.csv");

pub struct Synonyms {
    /// (женское?, имя) → представитель группы.
    names: HashMap<(bool, String), String>,
    /// Отчество → метка «представитель + пол отчества».
    patronymics: HashMap<String, String>,
}

fn find(parent: &mut HashMap<String, String>, x: &str) -> String {
    let mut cur = x.to_string();
    while let Some(next) = parent.get(&cur).filter(|n| **n != cur).cloned() {
        cur = next;
    }
    cur
}

impl Synonyms {
    fn build() -> Synonyms {
        // Союз связей внутри пола; корень — наименьший по алфавиту.
        let mut parent: [HashMap<String, String>; 2] = [HashMap::new(), HashMap::new()];
        let mut members: [HashSet<String>; 2] = [HashSet::new(), HashSet::new()];
        for line in LINKS.lines().skip(1) {
            let f: Vec<&str> = line.split(',').collect();
            if f.len() < 3 {
                continue;
            }
            let g = usize::from(f[0] == "Ж");
            let (a, b) = (normalize_name(f[1]), normalize_name(f[2]));
            if a.is_empty() || b.is_empty() {
                continue;
            }
            members[g].insert(a.clone());
            members[g].insert(b.clone());
            let (ra, rb) = (find(&mut parent[g], &a), find(&mut parent[g], &b));
            if ra != rb {
                let (lo, hi) = if ra < rb { (ra, rb) } else { (rb, ra) };
                parent[g].insert(hi, lo);
            }
        }
        let mut names = HashMap::new();
        for g in 0..2 {
            for m in members[g].clone() {
                let root = find(&mut parent[g], &m);
                names.insert((g == 1, m), root);
            }
        }
        // Отчества — по мужским группам: «Егорович» и «Георгиевич» — одна метка.
        let mut patronymics = HashMap::new();
        for line in PATRONYMICS.lines().skip(1) {
            let Some((name, patr)) = line.split_once(',') else { continue };
            let name = normalize_name(name);
            let Some(root) = names.get(&(false, name)) else { continue };
            let patr = normalize_name(patr);
            if patr.is_empty() {
                continue;
            }
            let female = patr.ends_with('а');
            patronymics.insert(patr, format!("{root}#{}", if female { "ж" } else { "м" }));
        }
        Synonyms { names, patronymics }
    }

    /// Имя (нормализованное) → представитель группы. Пол неизвестен — по
    /// той группе, где имя есть; есть в обеих и разные — как есть.
    pub fn first(&self, name: &str, female: Option<bool>) -> String {
        let pick = |f: bool| self.names.get(&(f, name.to_string()));
        match female {
            Some(f) => pick(f),
            None => match (pick(false), pick(true)) {
                (Some(m), Some(w)) if m != w => None,
                (m, w) => m.or(w),
            },
        }
        .cloned()
        .unwrap_or_else(|| name.to_string())
    }

    /// Отчество (нормализованное) → метка группы имени отца.
    pub fn patronymic(&self, patr: &str) -> String {
        self.patronymics.get(patr).cloned().unwrap_or_else(|| patr.to_string())
    }
}

pub fn synonyms() -> &'static Synonyms {
    static ONE: OnceLock<Synonyms> = OnceLock::new();
    ONE.get_or_init(Synonyms::build)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_by_decisions() {
        let s = synonyms();
        let same = |a: &str, b: &str, f: bool| s.first(&normalize_name(a), Some(f)) == s.first(&normalize_name(b), Some(f));
        assert!(same("Егор", "Георгий", false), "народная форма");
        assert!(same("Егорий", "Георгий", false));
        assert!(same("Авдотья", "Евдокия", true));
        assert!(same("Ульяна", "Юлиания", true) && same("Ульяна", "Юлиана", true), "Роман: Юлиана = Юлиания");
        assert!(same("Апанас", "Афанасий", false), "простонародная");
        assert!(!same("Никита", "Аникита", false), "Роман: разные");
        assert!(!same("Юрий", "Георгий", false), "Роман: Юрий ≠ Георгий");
        assert!(!same("Виктор", "Викторин", false));
        assert!(!same("Венедикт", "Евгений", false), "Веденей — разные");
        assert_eq!(s.first("калина", Some(false)), s.first("каллиник", Some(false)), "Калина у мужчин");
        assert_eq!(s.first("калина", Some(true)), s.first("каллиникия", Some(true)), "Калина у женщин");
        assert_eq!(s.first("калина", None), "калина", "пол неизвестен — не гадаем");
        assert_eq!(s.first("егор", None), s.first("георгий", Some(false)), "есть только у мужчин");
        assert_eq!(s.first("неизвестнослов", Some(false)), "неизвестнослов");
        let p = |w: &str| s.patronymic(&normalize_name(w));
        assert_eq!(p("Егорович"), p("Георгиевич"));
        assert_eq!(p("Егоровна"), p("Георгиевна"));
        assert_eq!(p("Егоров"), p("Георгиевич"), "старая форма — тоже");
        assert_ne!(p("Егорович"), p("Егоровна"), "сын и дочь — разные отчества");
        assert_ne!(p("Юрьевич"), p("Георгиевич"));
        assert_eq!(p("Петрович"), "петрович", "вне групп — как есть");
    }
}

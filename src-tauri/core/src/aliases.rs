//! «Запомненные написания имён и отчеств» (задача 15, 26.11.2026, спека
//! 2026-11-26-zapomnennye-napisaniya): соответствия окна сверки
//! (`name_alias`) — посмотреть и удалить. «Изменить» — то же `alias_save`,
//! что и окно сверки при наборе.
//!
//! Соответствия общие для всех приходов (`parish_sync.sql`, шаг 4), поэтому
//! удаление оставляет отметку в общем файле (`common.name_alias_removed`):
//! без неё сверка вернула бы соответствие из общего файла или из другого
//! прихода. Набранные записи не меняются.

use rusqlite::Connection;
use serde::Serialize;

use crate::statement;

#[derive(Debug, Serialize, PartialEq)]
pub struct Alias {
    /// "name" или "patr".
    pub kind: String,
    /// Как в документе.
    pub form: String,
    pub form_norm: String,
    /// Слово словаря; пусто — «это не отчество» (или «новое имя» старых баз).
    pub target: Option<String>,
}

fn s(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn list(conn: &Connection) -> Result<Vec<Alias>, String> {
    let mut stmt = conn.prepare(&statement("alias_list")?).map_err(s)?;
    let rows = stmt
        .query_map([], |r| Ok(Alias { kind: r.get(0)?, form: r.get(1)?, form_norm: r.get(2)?, target: r.get(3)? }))
        .map_err(s)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(s)
}

/// Удалить соответствие; с подключённым общим файлом — и отметить удаление
/// там. Сверку зовёт вызывающий (команда окна — `with_conn_shared`).
pub fn remove(conn: &Connection, kind: &str, form_norm: &str) -> Result<(), String> {
    if kind != "name" && kind != "patr" {
        return Err(format!("Неизвестный вид соответствия: {kind}"));
    }
    let args = rusqlite::named_params! { ":kind": kind, ":form_norm": form_norm };
    if crate::parish::has_common(conn) {
        conn.execute(&statement("alias_removed_mark")?, args).map_err(s)?;
    }
    conn.execute(&statement("alias_remove")?, args).map_err(s)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parish;
    use crate::text::normalize_name;
    use std::path::{Path, PathBuf};

    fn seed() -> Option<PathBuf> {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/seed.sqlite");
        p.exists().then_some(p)
    }

    fn save(conn: &Connection, kind: &str, form: &str, target: Option<&str>) {
        conn.execute(&statement("alias_save").unwrap(), rusqlite::named_params! {
            ":kind": kind, ":form": form, ":form_norm": normalize_name(form),
            ":target": target, ":gender": None::<String>,
        }).unwrap();
    }

    fn target(conn: &Connection, kind: &str, form: &str) -> Option<Option<String>> {
        list(conn).unwrap().into_iter()
            .find(|a| a.kind == kind && a.form_norm == normalize_name(form))
            .map(|a| a.target)
    }

    /// Задача 15: удалённое в одном приходе не возвращается сверкой ни в нём,
    /// ни в другом приходе; изменённое доходит до другого; решение после
    /// удаления остаётся.
    #[test]
    fn remove_survives_sync() {
        let Some(seed) = seed() else {
            crate::seed_missing("тест запомненных написаний пропущен");
            return;
        };
        let dir = std::env::temp_dir().join(format!("genmetric-aliases-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let a = parish::open_current(&dir, &seed).unwrap();
        save(&a.conn, "patr", "Ивлиева", Some("Иулиева"));
        save(&a.conn, "name", "Пилагия", Some("Пелагея"));
        save(&a.conn, "patr", "Кесарев", None);
        parish::sync(&a.conn).unwrap();
        assert_eq!(target(&a.conn, "patr", "Ивлиева"), Some(Some("Иулиева".into())));
        assert_eq!(target(&a.conn, "patr", "Кесарев"), Some(None), "«это не отчество» — в списке");
        let a_id = a.id;
        drop(a);

        let b_id = parish::create(&dir, &seed, "Второй").unwrap();
        let b = parish::open(&dir, &seed, b_id).unwrap();
        assert_eq!(target(&b.conn, "name", "Пилагия"), Some(Some("Пелагея".into())), "сверка принесла в Б");
        // Изменение в Б — новее, доходит до А (время — с секундами: прежнее
        // решение отодвигаем, как в db/test_parish.py).
        b.conn.execute("UPDATE common.name_alias SET created_at = datetime('now', '-1 hour')", []).unwrap();
        save(&b.conn, "patr", "Ивлиева", Some("Иоилева"));
        // В Б удалено.
        remove(&b.conn, "name", &normalize_name("Пилагия")).unwrap();
        parish::sync(&b.conn).unwrap();
        assert_eq!(target(&b.conn, "name", "Пилагия"), None, "удалено в Б");
        drop(b);

        let a = parish::open(&dir, &seed, a_id).unwrap();
        assert_eq!(target(&a.conn, "name", "Пилагия"), None, "сверка убрала удалённое и в А");
        assert_eq!(target(&a.conn, "patr", "Ивлиева"), Some(Some("Иоилева".into())), "изменение из Б — в А");
        let common: i64 = a.conn.query_row(
            "SELECT count(*) FROM common.name_alias WHERE form_norm = ?1", [normalize_name("Пилагия")], |r| r.get(0)).unwrap();
        assert_eq!(common, 0, "и в общем файле нет");

        // Решение, принятое позже удаления, остаётся.
        a.conn.execute("UPDATE common.name_alias_removed SET removed_at = datetime('now', '-1 minute')", []).unwrap();
        save(&a.conn, "name", "Пилагия", Some("Пелагия"));
        parish::sync(&a.conn).unwrap();
        assert_eq!(target(&a.conn, "name", "Пилагия"), Some(Some("Пелагия".into())), "новое решение после удаления");
        drop(a);
        let b = parish::open(&dir, &seed, b_id).unwrap();
        assert_eq!(target(&b.conn, "name", "Пилагия"), Some(Some("Пелагия".into())), "и в Б");

        assert!(remove(&b.conn, "fam", "x").is_err(), "неизвестный вид — отказ");
        drop(b);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

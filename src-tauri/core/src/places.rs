//! Справочник населённых пунктов (задача 9, 26.11.2026, спека
//! 2026-11-26-spravochnik-np): все пункты, по одному на название — лучшая
//! строка по правилу `place_find`, — с числом записей. Правка — готовой
//! карточкой пункта (`place_update`); здесь только чтение.

use rusqlite::Connection;
use serde::Serialize;

use crate::statement;

#[derive(Debug, Serialize, PartialEq)]
pub struct PlaceRow {
    pub name: String,
    pub np_type: Option<String>,
    pub volost: Option<String>,
    pub uyezd: Option<String>,
    pub guberniya: Option<String>,
    pub familio_url: Option<String>,
    /// Записей, где у кого-то этот пункт, — по всем строкам с тем же названием.
    pub uses: i64,
    /// Пусто хоть одно из: тип, волость, уезд, губерния, ссылка Familio.
    pub gaps: bool,
}

fn empty(v: &Option<String>) -> bool {
    v.as_deref().map_or(true, |s| s.trim().is_empty())
}

pub fn directory(conn: &Connection) -> Result<Vec<PlaceRow>, String> {
    let mut stmt = conn.prepare(&statement("place_directory")?).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let mut row = PlaceRow {
                name: r.get(0)?, np_type: r.get(1)?, volost: r.get(2)?, uyezd: r.get(3)?,
                guberniya: r.get(4)?, familio_url: r.get(5)?, uses: r.get(6)?, gaps: false,
            };
            row.gaps = [&row.np_type, &row.volost, &row.uyezd, &row.guberniya, &row.familio_url]
                .into_iter().any(empty);
            Ok(row)
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// Двойник без подробностей рядом с полным пунктом — одна строка, полная;
    /// записи считаются по обоим; признак пустых полей.
    #[test]
    fn one_row_per_name() {
        let seed = Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/seed.sqlite");
        if !seed.exists() {
            crate::seed_missing("тест справочника пунктов пропущен");
            return;
        }
        let dir = std::env::temp_dir().join(format!("genmetric-places-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("p.sqlite");
        std::fs::copy(&seed, &db).unwrap();
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("
            INSERT INTO place (id, name, name_norm, origin) VALUES (901, 'Шишкино', 'шишкино', 'archive');
            INSERT INTO place (id, name, name_norm, np_type, volost, uyezd, guberniya, full_location, familio_url, origin)
                 VALUES (902, 'Шишкино', 'шишкино', 'д.', 'Нежитинская', 'Буйский', 'Костромская',
                         'д. Шишкино, Нежитинская волость, Буйский уезд, Костромская губерния', 'https://familio.org/x', 'user');
            INSERT INTO place (id, name, name_norm, np_type, uyezd, guberniya, full_location, origin)
                 VALUES (903, 'Бухарино', 'бухарино', 'с.', 'Буйский', 'Костромская', 'с. Бухарино, Буйский уезд', 'user');
            INSERT INTO mk_case (id, year) VALUES (1, 1905);
            INSERT INTO entry (id, case_id, section) VALUES (1, 1, 1);
            INSERT INTO entry (id, case_id, section) VALUES (2, 1, 1);
            INSERT INTO person_mention (entry_id, role_code, sort_order, place_id) VALUES (1, 'father', 1, 901);
            INSERT INTO person_mention (entry_id, role_code, sort_order, place_id) VALUES (1, 'mother', 2, 902);
            INSERT INTO person_mention (entry_id, role_code, sort_order, place_id) VALUES (2, 'father', 1, 902);
        ").unwrap();
        let rows = directory(&conn).unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["Бухарино", "Шишкино"], "по одному на название, по алфавиту");
        let sh = &rows[1];
        assert_eq!(sh.volost.as_deref(), Some("Нежитинская"), "лучшая строка — полная");
        assert_eq!(sh.uses, 2, "записи — по обоим двойникам, отец и мать одной записи — одна");
        assert!(!sh.gaps, "всё заполнено");
        assert!(rows[0].gaps, "у Бухарино нет волости и ссылки");
        assert_eq!(rows[0].uses, 0);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

//! Порядок записей «по книге» (задача 19, спека 2026-11-26-poryadok-po-knige).
//!
//! Роман 26.11.2026: пропущенная запись, набранная позже, в «Набрано» и в
//! выгрузке стояла после более поздних. «По книге» — по дате обряда
//! («Сортируем по обряду»), затем по странице («5» < «5об» < «6», у разворота
//! «5об-6» — первая часть), затем по номеру записи, мужская раньше женской.
//! Запись без даты встаёт сразу после записи с наибольшей парой «страница,
//! номер», меньшей, чем у неё; нет такой — первой.
//!
//! Список «Набрано» получает место записи в этом порядке (`EntryBrief.book`),
//! выгрузки — временную таблицу `x_order` (`fill_x_order`).

use std::cmp::Ordering;
use std::collections::BTreeMap;

use rusqlite::Connection;

/// Общая настройка порядка (`COMMON_SETTINGS`): «1» — по книге, иначе по вводу.
pub const ORDER_KEY: &str = "ui_entry_order";

/// Что нужно о записи для порядка книги.
#[derive(Debug, Clone)]
pub struct BookRow {
    pub id: i64,
    pub page: Option<String>,
    pub no_male: Option<i64>,
    pub no_female: Option<i64>,
    /// Дата обряда (год, месяц, день) — `book_date`; None — запись без даты.
    pub date: Option<(i64, i64, i64)>,
}

/// Дата записи для порядка: полная дата обряда; без неё — полная дата
/// события (браки хранят венчание в полях события; обряд без даты —
/// `Wait.byEvent`); иначе None. Год обряда без своего — год события.
pub fn book_date(event: (Option<i64>, Option<i64>, Option<i64>), rite: (Option<i64>, Option<i64>, Option<i64>))
    -> Option<(i64, i64, i64)>
{
    let (ed, em, ey) = event;
    let (rd, rm, ry) = rite;
    if let (Some(d), Some(m), Some(y)) = (rd, rm, ry.or(ey)) {
        return Some((y, m, d));
    }
    if let (Some(d), Some(m), Some(y)) = (ed, em, ey) {
        return Some((y, m, d));
    }
    None
}

/// Страница как номер листа: (число, «об»). У разворота «5об-6» — первая
/// часть. Без числа — None (меньше любой страницы с числом).
pub fn page_key(page: Option<&str>) -> Option<(i64, bool)> {
    let first = page?.split(['-', '–', '—']).next()?.trim().to_lowercase();
    let digits: String = first.chars().take_while(|c| c.is_ascii_digit()).collect();
    let n = digits.parse::<i64>().ok()?;
    Some((n, first[digits.len()..].trim_start().starts_with("об")))
}

/// Пара «страница, номер» (мужская раньше женской при том же номере).
type Pair = (Option<(i64, bool)>, Option<i64>, u8);

fn pair(r: &BookRow) -> Pair {
    let (no, female) = match (r.no_male, r.no_female) {
        (Some(n), _) => (Some(n), 0),
        (None, Some(n)) => (Some(n), 1),
        (None, None) => (None, 0),
    };
    (page_key(r.page.as_deref()), no, female)
}

/// Порядок книги: номера записей (`id`) от первой по книге к последней.
pub fn book_order(rows: &[BookRow]) -> Vec<i64> {
    let keyed: Vec<(Pair, &BookRow)> = rows.iter().map(|r| (pair(r), r)).collect();
    let mut dated: Vec<&(Pair, &BookRow)> = keyed.iter().filter(|(_, r)| r.date.is_some()).collect();
    dated.sort_by(|a, b| a.1.date.cmp(&b.1.date).then_with(|| a.0.cmp(&b.0)).then_with(|| a.1.id.cmp(&b.1.id)));
    let mut undated: Vec<&(Pair, &BookRow)> = keyed.iter().filter(|(_, r)| r.date.is_none()).collect();
    undated.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.id.cmp(&b.1.id)));
    let mut out: Vec<&(Pair, &BookRow)> = dated;
    // Без даты — по своей паре: после записи с наибольшей меньшей парой
    // (при равных таких — после стоящей позже); нет такой — в начало, за
    // уже поставленными туда же.
    let mut head = 0;
    for u in undated {
        let mut at: Option<usize> = None;
        for (i, x) in out.iter().enumerate() {
            if x.0.cmp(&u.0) == Ordering::Less {
                match at {
                    Some(j) if out[j].0 > x.0 => {}
                    _ => at = Some(i),
                }
            }
        }
        match at {
            Some(i) => {
                if i < head {
                    head += 1;
                }
                out.insert(i + 1, u);
            }
            None => {
                out.insert(head, u);
                head += 1;
            }
        }
    }
    out.iter().map(|(_, r)| r.id).collect()
}

/// Выгрузка «по книге»: временная таблица `x_order(entry_id, pos)` — место
/// записи в порядке книги внутри раздела и года книги. `export_prepare`
/// сортирует по ней; пустая (порядок «по вводу») — прежний порядок по `id`.
pub fn fill_x_order(conn: &Connection, by_book: bool) -> Result<(), String> {
    let s = |e: rusqlite::Error| format!("порядок выгрузки: {e}");
    conn.execute_batch("DROP TABLE IF EXISTS temp.x_order;
                        CREATE TEMP TABLE x_order (entry_id INTEGER PRIMARY KEY, pos INTEGER NOT NULL);").map_err(s)?;
    if !by_book {
        return Ok(());
    }
    let mut stmt = conn.prepare(
        "SELECT id, section, coalesce(rite_year, event_year), page, no_male, no_female,
                event_day, event_month, event_year, rite_day, rite_month, rite_year
           FROM entry").map_err(s)?;
    let mut groups: BTreeMap<(i64, Option<i64>), Vec<BookRow>> = BTreeMap::new();
    let rows = stmt.query_map([], |r| {
        Ok(((r.get::<_, i64>(1)?, r.get::<_, Option<i64>>(2)?), BookRow {
            id: r.get(0)?, page: r.get(3)?, no_male: r.get(4)?, no_female: r.get(5)?,
            date: book_date((r.get(6)?, r.get(7)?, r.get(8)?), (r.get(9)?, r.get(10)?, r.get(11)?)),
        }))
    }).map_err(s)?;
    for row in rows {
        let (key, row) = row.map_err(s)?;
        groups.entry(key).or_default().push(row);
    }
    let mut ins = conn.prepare("INSERT INTO x_order (entry_id, pos) VALUES (?1, ?2)").map_err(s)?;
    let mut pos = 0i64;
    for rows in groups.values() {
        for id in book_order(rows) {
            pos += 1;
            ins.execute([id, pos]).map_err(s)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: i64, page: &str, m: Option<i64>, f: Option<i64>, date: Option<(i64, i64, i64)>) -> BookRow {
        BookRow { id, page: (!page.is_empty()).then(|| page.to_string()), no_male: m, no_female: f, date }
    }

    #[test]
    fn export_order_by_section_and_year() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE entry (id INTEGER PRIMARY KEY, section INTEGER, page TEXT, no_male INTEGER, no_female INTEGER,
                                 event_day INTEGER, event_month INTEGER, event_year INTEGER,
                                 rite_day INTEGER, rite_month INTEGER, rite_year INTEGER);
             INSERT INTO entry VALUES (1, 1, '5', 3, NULL, 14, 1, 1905, 15, 1, 1905),
                                      (2, 1, '6', 5, NULL, 16, 1, 1905, 17, 1, 1905),
                                      (3, 1, '5об', 4, NULL, 15, 1, 1905, 16, 1, 1905),
                                      (4, 2, '1', 1, NULL, 2, 2, 1905, NULL, NULL, NULL),
                                      (5, 1, '1', 1, NULL, 2, 1, 1904, 3, 1, 1904);").unwrap();
        let order = |c: &Connection| -> Vec<i64> {
            let mut st = c.prepare("SELECT entry_id FROM x_order ORDER BY pos").unwrap();
            st.query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect()
        };
        fill_x_order(&conn, true).unwrap();
        assert_eq!(order(&conn), vec![5, 1, 3, 2, 4], "раздел и год книги — группами, внутри — по книге");
        fill_x_order(&conn, false).unwrap();
        assert!(order(&conn).is_empty(), "по вводу — таблица пуста");
    }

    #[test]
    fn pages_like_sheets() {
        let k = |p: &str| page_key(Some(p));
        assert!(k("5") < k("5об") && k("5об") < k("6"));
        assert_eq!(k("5об-6"), k("5об"), "разворот — первая часть");
        assert_eq!(k("5 об."), k("5об"));
        assert!(k("10") > k("9"), "числом, не строкой");
        assert_eq!(k("б/н"), None);
        assert!(None < k("1"), "без числа — меньше любой");
    }

    #[test]
    fn dates_by_rite() {
        assert_eq!(book_date((Some(30), Some(12), Some(1904)), (Some(2), Some(1), Some(1905))), Some((1905, 1, 2)), "обряд");
        assert_eq!(book_date((Some(3), Some(2), Some(1890)), (None, None, None)), Some((1890, 2, 3)), "брак — венчание в полях события");
        assert_eq!(book_date((Some(3), Some(2), Some(1890)), (None, Some(2), Some(1890))), Some((1890, 2, 3)), "без дня обряда — событие");
        assert_eq!(book_date((None, Some(2), Some(1890)), (None, None, Some(1890))), None, "без полной даты");
    }

    #[test]
    fn skipped_entry_takes_its_place() {
        // Пример Романа: № м. 3 и № м. 5, затем пропущенная № м. 4.
        let rows = [row(1, "5", Some(3), None, Some((1905, 1, 15))), row(2, "6", Some(5), None, Some((1905, 1, 17))),
                    row(3, "5об", Some(4), None, Some((1905, 1, 16)))];
        assert_eq!(book_order(&rows), vec![1, 3, 2]);
        // Дата и страница те же — по номеру, мужская № 4 раньше женской № 4.
        let rows = [row(1, "7", None, Some(4), Some((1905, 2, 1))), row(2, "7", Some(5), None, Some((1905, 2, 1))),
                    row(3, "7", Some(4), None, Some((1905, 2, 1)))];
        assert_eq!(book_order(&rows), vec![3, 1, 2]);
    }

    #[test]
    fn undated_after_its_neighbour() {
        // Без даты, стр. 5об-6, № м. 8 — сразу после стр. 5об-6, № м. 7.
        let rows = [row(1, "5об-6", Some(7), None, Some((1905, 3, 1))), row(2, "7", Some(9), None, Some((1905, 3, 2))),
                    row(3, "5об-6", Some(8), None, None), row(4, "1", Some(1), None, None), row(5, "5об-6", Some(6), None, Some((1905, 3, 5)))];
        // № 6 позже по дате, но пара у него меньше: № 8 — после № 7 (его пара
        // наибольшая из меньших), № 1 без даты и меньше всех — первой.
        assert_eq!(book_order(&rows), vec![4, 1, 3, 2, 5]);
        // Два без даты подряд — по своей паре; без предшественника — в начало по порядку.
        let rows = [row(1, "", None, None, None), row(2, "", Some(1), None, None), row(3, "2", Some(1), None, Some((1905, 1, 1)))];
        assert_eq!(book_order(&rows), vec![1, 2, 3]);
    }
}

import { useLayoutEffect, type RefObject } from "react";

/**
 * Список «Набрано» занимает свободное место до низа окна (Роман 19.10.2026:
 * «Если на экране есть место, пусть программа растягивает список
 * предыдущих записей до самого низа окна»). Высота из стилей (14em) —
 * наименьшая; место считается при показе формы, смене размера окна и списка.
 *
 * Высота ставится в следующем кадре и только если изменилась: правка высоты
 * прямо в отклике ResizeObserver меняла размер наблюдаемого блока, и WebView2
 * сообщал «ResizeObserver loop completed with undelivered notifications» —
 * полоса «Непредвиденная ошибка» при каждой смене высоты окна, а сброс
 * высоты перед замером дёргал таблицу (Mike 20.10.2026, Windows).
 */
export function useFillDown(ref: RefObject<HTMLElement | null>, deps: unknown[]): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const fit = () => {
      if (el.offsetParent === null) return;
      // Наименьшая высота — 14em из стилей, без сброса своей высоты на замер.
      const least = 14 * (parseFloat(getComputedStyle(el).fontSize) || 16);
      // Под списком — отступы и рамка его блока и окна: их меряем, а не
      // берём числом. Запас 12 px был меньше настоящих 18 px, и страница при
      // любой высоте окна выходила за него на 6 px — колесо её сдвигало
      // (Роман 26.11.2026, Бэклог р. 3 п. 31). Верх — от начала страницы,
      // а не окна: прокрутка не меняет расчёт.
      const box = el.getBoundingClientRect();
      const app = el.closest(".app")?.getBoundingClientRect();
      const below = app ? Math.max(0, app.bottom - box.bottom) : 12;
      const room = window.innerHeight - (box.top + window.scrollY) - below;
      const want = room > least ? `${Math.floor(room)}px` : "";
      if (el.style.maxHeight !== want) el.style.maxHeight = want;
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const seen = new IntersectionObserver(later);
    seen.observe(el);
    // Блоки над списком свернули или развернули, сменили масштаб — место
    // другое (ревьюер 19.10.2026).
    const sized = new ResizeObserver(later);
    if (el.parentElement) sized.observe(el.parentElement.parentElement ?? el.parentElement);
    window.addEventListener("resize", later);
    return () => { cancelAnimationFrame(frame); seen.disconnect(); sized.disconnect(); window.removeEventListener("resize", later); };
  }, deps);
}

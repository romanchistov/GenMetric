import { clearDirtyForms } from "./dirty";

/**
 * Отказ «Открыть» запись, пока в форме есть несохранённое, — прямо под
 * нажатой ссылкой, с кнопкой «Очистить и открыть» (Олег 20.11.2026, Бэклог
 * р. 3 п. 6: «жму открыть, ничего не происходит» — отказ писался серой
 * строкой внизу блока, вне взгляда). Очистка — та же, что в окне «Приходы»
 * (`clearDirtyForms`): новая запись — как «следующая», правка — как
 * «Отменить»; запись в базе не трогается.
 */
export default function OpenRefused({ forms, onOpen }: { forms: string[]; onOpen: () => void }) {
  return (
    <span className="openrefused" data-open-refused role="alert">
      Сначала сохраните или очистите набранное: {forms.join(", ")}.{" "}
      <button type="button" className="toggle small" data-open-refused-clear
              onClick={() => { clearDirtyForms(); onOpen(); }}>
        Очистить и открыть
      </button>
    </span>
  );
}

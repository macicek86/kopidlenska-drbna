// Pole „Zveřejnit v“ pro nastavení importů, které píšou v noci (src/publish-time.js).
import { field, input } from "./ui.js";

export function publishTimeField(value, hint = "Platí pro článek, který jde rovnou na web. Prázdné: hned, jak ho Drběna napíše.") {
  return field("Zveřejnit v", `<input class="${input}" type="time" name="publishTime" value="${value}">`, hint);
}

// „, v 7:00“ do popisů, kdy článek vyjde.
export const atTime = (time) => (time ? ` v ${time.replace(/^0/, "")}` : "");

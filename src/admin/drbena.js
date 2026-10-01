// Redakce: povaha kozy Drběny. Jedno místo pro hlas, kterým píše zprávy města i fotbal.
import { DEFAULT_FOOTBALL, DEFAULT_PERSONA, FOOTBALL_MAX, PERSONA_MAX } from "../drbena.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { badge, callout, field, input, pageHead } from "./ui.js";

const BASE = "/redakce/drbena";

function state(own) {
  return own ? badge("Vlastní text", "info") : badge("Výchozí text");
}

export function adminDrbena(ctx, data, message) {
  const drbena = data.drbena ?? { persona: "", football: "" };
  const body = `${pageHead(
    "Koza Drběna",
    "Podle tohohle píše Drběna zprávy z Munipolisu i fotbal. Pravidla o faktech, datech, rubrikách a duplicitách platí vždy, tady jde jen o povahu a styl.",
  )}
    <form class="panel form" method="post" action="${BASE}/ulozit" data-dirty>
      <header class="panel-head"><h2>Povaha Drběny</h2>${state(drbena.persona)}</header>
      ${callout("Když pole vymažete a uložíte, vrátí se výchozí text. Změna platí pro další články, napsané zůstanou, jak jsou.")}
      ${field("Kdo Drběna je a jak píše", `<textarea class="${input}" name="persona" rows="24" maxlength="${PERSONA_MAX}">${esc(drbena.persona || DEFAULT_PERSONA)}</textarea>`, "Platí pro všechno, co Drběna píše.")}
      ${field(`U fotbalu ${state(drbena.football)}`, `<textarea class="${input}" name="football" rows="6" maxlength="${FOOTBALL_MAX}">${esc(drbena.football || DEFAULT_FOOTBALL)}</textarea>`, "Fotbalové zvyky navíc. Ve fotbalových článcích se přidají k povaze.")}
      <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-primary" type="submit">Uložit povahu</button></div>
    </form>`;
  return adminShell(ctx, data, "drbena", message, body, { title: "Koza Drběna" });
}

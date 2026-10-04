// Hlášky po uložení formuláře redakce (`?ok=klíč`). Bere je i historie změn (src/audit.js).
import { OUTAGE_OK } from "./post-outages.js";
import { PLACES_OK } from "./post-places.js";
import { YARDS_OK } from "./post-yards.js";
import { DOCTORS_OK } from "./post-doctors.js";
import { REQUESTS_OK } from "./post-requests.js";
import { STOCK_OK } from "./post-stock.js";
import { IMPORT_OK } from "./post-munipolis.js";
import { DRBENA_OK } from "./post-drbena.js";
import { FOOTBALL_OK } from "./post-fotbal.js";
import { DENIK_OK } from "./post-denik.js";
import { SKOLA_OK } from "./post-skola.js";
import { CHAT_OK } from "./post-chat.js";
import { MESSAGES_OK } from "./post-messages.js";
import { ARTICLES_OK } from "./post-articles.js";
import { ADS_OK } from "./post-ads.js";
import { EVENTS_OK } from "./post-events.js";

export const OK = {
  ...ARTICLES_OK,
  ...ADS_OK,
  ...EVENTS_OK,
  web: "Svoz a kontakt jsou uložené.",
  texty: "Texty jsou uložené.",
  uvitani: "Texty jsou uložené. Uvítací okno se ukáže znovu všem, i těm, kdo ho už viděli.",
  heslo: "Heslo je změněné.",
  jmeno: "Údaje jsou uložené.",
  rubrika: "Rubrika je uložená.",
  "rubrika-upravena": "Rubrika je upravená.",
  "rubrika-smazana": "Rubrika je smazaná.",
  clovek: "Přispěvatel má účet.",
  "clovek-vypnut": "Účet je vypnutý.",
  "clovek-zapnut": "Účet je zase aktivní.",
  "clovek-heslo": "Heslo přispěvatele je nastavené.",
  "clovek-udaje": "Údaje přispěvatele jsou uložené.",
  ...OUTAGE_OK,
  ...PLACES_OK,
  ...YARDS_OK,
  ...DOCTORS_OK,
  ...REQUESTS_OK,
  ...STOCK_OK,
  ...IMPORT_OK,
  ...DRBENA_OK,
  ...FOOTBALL_OK,
  ...DENIK_OK,
  ...SKOLA_OK,
  ...CHAT_OK,
  ...MESSAGES_OK,
};

export function messageFrom(url) {
  const chyba = url.searchParams.get("chyba");
  if (chyba) return { text: chyba, kind: "bad" };
  const ok = url.searchParams.get("ok");
  if (ok && OK[ok]) return { text: OK[ok], kind: "ok" };
  return { text: "", kind: "ok" };
}

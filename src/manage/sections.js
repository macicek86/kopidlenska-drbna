// Stránka odkazu pro správce: co jde u které sekce zapsat. Formuláře jsou stejné jako v redakci
// (src/admin/places.js, doctors.js, yards.js), jen míří na `/sprava/<token>/<akce>`.
// `audit` je adresa stejného formuláře v redakci (historie změn ho podle ní vyfotí) a `ok` jeho hláška.
import * as places from "../admin/places.js";
import * as doctors from "../admin/doctors.js";
import * as yards from "../admin/yards.js";
import { DOCTOR_ACTIONS, loadDoctors } from "../doctors-db.js";
import { hoursSummary as doctorHours, periodClosed, spanSummary } from "../doctors.js";
import { formatLong } from "../format.js";
import { PLACE_ACTIONS, loadPlaces } from "../places-db.js";
import { placeSummary } from "../places.js";
import { closureLabel } from "../view.js";
import { pragueNow } from "../waste.js";
import { YARD_ACTIONS, loadYards } from "../yards-db.js";
import { changeSummary, hoursSummary as yardHours } from "../yards.js";

const changeHours = (change) => (periodClosed(change) ? "Zavřeno" : spanSummary(change));

export const MANAGE_SECTIONS = {
  "oteviraci-doba": {
    actions: PLACE_ACTIONS,
    idField: "placeId",
    page: "/oteviraci-doba",
    changeTable: "place_changes",
    changeParent: "place_id",
    async load(env, id) {
      return (await loadPlaces(env)).find((row) => row.id === id) ?? null;
    },
    facts: (row) => [
      ["Popisek", row.label],
      ["Adresa", row.place],
      ["Telefon", row.phone],
      ["Otevírací doba", placeSummary(row)],
      ["Co tu najdete", row.offers.join(", ")],
    ],
    changes: (row) =>
      row.changes.map((change) => ({
        id: change.id,
        when: change.kind === "trvala" ? `${change.applied ? "Platí" : "Začne"} od ${formatLong(change.startsOn)}` : closureLabel(change),
        what: [change.kind === "trvala" ? "Nová otevírací doba" : "", change.note, change.kind === "trvala" ? placeSummary(change) : changeHours(change)].filter(Boolean).join(" · "),
        cancel: !(change.kind === "trvala" && change.applied),
      })),
    forms: [
      { key: "zavreno", action: "zmena", label: "Zavřeno nebo jiná doba", title: "Zavřeno nebo jiná doba", wide: true, render: places.changeForm, primary: true },
      { key: "nova-doba", action: "zmena", label: "Nová otevírací doba natrvalo", title: "Nová otevírací doba", wide: true, render: places.newHoursForm },
      { key: "hodiny", action: "hodiny", label: "Opravit běžnou dobu", title: "Běžná otevírací doba", wide: true, render: places.hoursForm },
      { key: "nabidka", action: "nabidka", label: "Co tu najdete", title: "Co tu najdete", render: places.offersForm },
      { key: "udaje", action: "udaje", label: "Adresa a telefon", title: "Adresa a telefon", render: places.detailsForm },
    ],
    audit: { zmena: "/zmena", hodiny: "/hodiny", nabidka: "/nabidka", udaje: "/udaje", zrusit: "/zmena/smazat" },
    ok: (action, value) =>
      ({ zmena: value?.kind === "trvala" ? "misto-nova-doba" : "misto-zmena", hodiny: "misto-doba", nabidka: "misto-nabidka", udaje: "misto-udaje", zrusit: "misto-zmena-smazana" })[action],
  },
  lekari: {
    actions: DOCTOR_ACTIONS,
    idField: "doctorId",
    page: "/lekari",
    changeTable: "doctor_changes",
    changeParent: "doctor_id",
    async load(env, id) {
      return (await loadDoctors(env, { today: pragueNow().date })).find((row) => row.id === id) ?? null;
    },
    facts: (row) => [
      ["Obor", row.specialty],
      ["Místo", row.place],
      ["Telefon", row.phone],
      ["Ordinační hodiny", doctorHours(row)],
    ],
    changes: (row) => row.changes.map((change) => ({ id: change.id, when: closureLabel(change), what: `${change.note} · ${changeHours(change)}`, cancel: true })),
    forms: [
      { key: "zmena", action: "zmena", label: "Zavřeno, dovolená, jiné hodiny", title: "Dočasná změna", wide: true, render: doctors.changeForm, primary: true },
      { key: "hodiny", action: "hodiny", label: "Běžné ordinační hodiny", title: "Ordinační hodiny", wide: true, render: doctors.hoursForm },
      { key: "udaje", action: "udaje", label: "Obor, místo a telefon", title: "Obor, místo a telefon", render: doctors.detailsForm },
    ],
    audit: { zmena: "/zmena", hodiny: "/hodiny", udaje: "/udaje", zrusit: "/zmena/smazat" },
    ok: (action) => ({ zmena: "lekar-zmena", hodiny: "lekar-hodiny", udaje: "lekar-udaje", zrusit: "lekar-zmena-smazana" })[action],
  },
  dvory: {
    actions: YARD_ACTIONS,
    idField: "yardId",
    page: "/sberne-dvory",
    changeTable: "yard_closures",
    changeParent: "yard_id",
    async load(env, id) {
      return (await loadYards(env, { today: pragueNow().date })).find((row) => row.id === id) ?? null;
    },
    facts: (row) => [
      ["Místo", row.place],
      ["Otevírací doba", yardHours(row)],
      ["Co se tam vozí", row.accepts],
    ],
    changes: (row) =>
      [...row.closures, ...(row.changes ?? [])]
        .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id - b.id)
        .map((change) => ({ id: change.id, when: closureLabel(change), what: change.week ? `${changeSummary(change)} · ${change.reason}` : `Zavřeno · ${change.reason}`, cancel: true })),
    forms: [
      { key: "zmena", action: "zmena", label: "Zavřeno nebo jiná doba", title: "Zavřeno nebo jiná doba", wide: true, render: yards.closureForm, primary: true },
      { key: "hodiny", action: "hodiny", label: "Otevírací doba", title: "Otevírací doba", wide: true, render: yards.hoursForm },
      { key: "udaje", action: "udaje", label: "Místo a co se tam vozí", title: "Místo a co se tam vozí", render: yards.detailsForm },
    ],
    audit: { zmena: "/zmena", uzavreni: "/zmena", hodiny: "/hodiny", udaje: "/udaje", zrusit: "/uzavreni/smazat" },
    ok: (action) => ({ zmena: "dvur-zmena", uzavreni: "dvur-zmena", hodiny: "dvur-hodiny", udaje: "dvur-udaje", zrusit: "uzavreni-smazane" })[action],
  },
};

// Které okno patří k akci: u otevírací doby posílají „Zavřeno…“ i „Nová doba“ stejnou akci, liší je `kind`.
export function formKey(spec, action, fields) {
  const forms = spec.forms.filter((form) => form.action === action);
  if (forms.length > 1) return fields.kind === "trvala" ? "nova-doba" : forms[0].key;
  return forms[0]?.key ?? "";
}

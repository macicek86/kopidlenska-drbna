// Čtení adres a formulářů redakce: co otevřít v okně a pole z odeslaného formuláře.
import { WEEK_DAYS } from "./yards.js";

function positiveParam(url, name) {
  const id = Number(url.searchParams.get(name));
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

// Co má redakce otevřít v okně. Každá sekce si z toho vezme, co zná.
export function adminQuery(url) {
  return {
    fresh: url.searchParams.has("novy"),
    editingId: positiveParam(url, "id"),
    confirmId: positiveParam(url, "smazat"),
    proposalId: positiveParam(url, "navrh"),
    targetId: positiveParam(url, "clanek"),
    withdrawId: positiveParam(url, "stahnout"),
    discardId: positiveParam(url, "smazat-navrh"),
    cancelId: positiveParam(url, "zrusit"),
    closureYardId: positiveParam(url, "uzavreni"),
    hoursId: positiveParam(url, "hodiny"),
    changeId: positiveParam(url, "zmena"),
    newHoursId: positiveParam(url, "nova-doba"),
    accessId: positiveParam(url, "upravit"),
    passwordId: positiveParam(url, "heslo"),
    disableId: positiveParam(url, "vypnout"),
    noticeId: positiveParam(url, "oznameni"),
    noticeFresh: url.searchParams.has("nove-oznameni"),
    importId: positiveParam(url, "zprava"),
    importSettings: url.searchParams.has("nastaveni"),
  };
}

export async function formFields(request) {
  const form = await request.formData();
  const text = (name) => String(form.get(name) ?? "");
  const id = Number(text("id"));
  return {
    id: Number.isInteger(id) && id > 0 ? id : undefined,
    title: text("title"),
    excerpt: text("excerpt"),
    body: text("body"),
    category: text("category"),
    published: form.get("published") === "1",
    image: form.get("image"),
    imageFocus: text("image_focus"),
    imageCaption: text("image_caption"),
    place: text("place"),
    startsOn: text("startsOn"),
    startsTime: text("startsTime"),
    description: text("description"),
    password: text("password"),
    login: text("login"),
    email: text("email"),
    name: text("name"),
    note: text("note"),
    active: text("active"),
    articleId: Number.isInteger(Number(text("clanek"))) && Number(text("clanek")) > 0 ? Number(text("clanek")) : undefined,
    current: text("current"),
    next: text("next"),
    wasteNote: text("wasteNote"),
    holidayNote: text("holidayNote"),
    weekday: text("weekday"),
    weekParity: text("weekParity"),
    stepDays: text("stepDays"),
    accepts: text("accepts"),
    week: WEEK_DAYS.map(({ day }) => ({
      day,
      open: form.get(`open-${day}`) === "1",
      from: text(`from-${day}`),
      to: text(`to-${day}`),
    })),
    endsOn: text("endsOn"),
    reason: text("reason"),
    alias: text("alias"),
    sortOrder: text("sortOrder"),
    yardId: Number.isInteger(Number(text("yardId"))) && Number(text("yardId")) > 0 ? Number(text("yardId")) : undefined,
    specialty: text("specialty"),
    phone: text("phone"),
    link: text("link"),
    enabled: form.get("enabled") === "1",
    adId: Number.isInteger(Number(text("nabidka"))) && Number(text("nabidka")) > 0 ? Number(text("nabidka")) : undefined,
    changeNote: text("changeNote"),
    placeId: Number.isInteger(Number(text("placeId"))) && Number(text("placeId")) > 0 ? Number(text("placeId")) : undefined,
    label: text("label"),
    doctorId: Number.isInteger(Number(text("doctorId"))) && Number(text("doctorId")) > 0 ? Number(text("doctorId")) : undefined,
    code: text("code"),
    parentId: Number.isInteger(Number(text("parentId"))) && Number(text("parentId")) > 0 ? Number(text("parentId")) : undefined,
    rubricId: Number.isInteger(Number(text("rubric_id"))) && Number(text("rubric_id")) > 0 ? Number(text("rubric_id")) : undefined,
    areas: form.getAll("areaId").map((id, index) => ({
      id: String(id),
      name: String(form.getAll("areaName")[index] ?? ""),
      code: String(form.getAll("areaCode")[index] ?? ""),
      sortOrder: String(form.getAll("areaSort")[index] ?? ""),
      enabled: form.getAll("areaOn").map(String).includes(String(id)),
    })),
    doctorWeek: WEEK_DAYS.map(({ day }) => ({
      day,
      morning: {
        open: form.get(`am-open-${day}`) === "1",
        from: text(`am-from-${day}`),
        to: text(`am-to-${day}`),
        note: text(`am-note-${day}`),
      },
      afternoon: {
        open: form.get(`pm-open-${day}`) === "1",
        from: text(`pm-from-${day}`),
        to: text(`pm-to-${day}`),
        note: text(`pm-note-${day}`),
      },
    })),
    permissions: form.getAll("permission").map((item) => String(item)),
    confirm: text("confirm") === "1",
    kind: text("kind"),
    endsTime: text("endsTime"),
    places: text("places"),
    sourceUrl: text("sourceUrl"),
    feedUrl: text("feedUrl"),
    persona: text("persona"),
    football: text("football"),
    articleText: text("text"),
    autoPublish: form.get("autoPublish") === "1",
    clubUrl: text("clubUrl"),
    truthUrl: text("truthUrl"),
    previews: form.get("previews") === "1",
    clubNews: form.get("clubNews") === "1",
    useCrest: form.get("useCrest") === "1",
    intervalHours: text("intervalHours"),
    ids: form.getAll("ids").map(Number),
    withFootball: form.get("withFootball") === "1",
    sourceLink: form.get("sourceLink") === "1",
    freshDays: text("freshDays"),
  };
}

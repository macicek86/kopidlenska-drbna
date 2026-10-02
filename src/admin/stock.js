// Redakce: Knihovna obrázků. Ilustrační fotky podle témat, které Koza Drběna dává ke zprávám bez vlastní fotky.
import { STOCK_LABEL } from "../stock.js";
import { esc, mediaUrl } from "../view.js";
import { photoControl } from "./articles.js";
import { adminShell } from "./shell.js";
import {
  badge,
  callout,
  cancelLink,
  confirmForm,
  field,
  formFoot,
  hidden,
  input,
  modal,
  modalLink,
  openButton,
  pageHead,
  panel,
} from "./ui.js";

const BASE = "/redakce/obrazky";
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

function topicOptions(topics, chosenId) {
  return topics.map((topic) => `<option value="${topic.id}"${topic.id === chosenId ? " selected" : ""}>${esc(topic.name)}</option>`).join("");
}

function uploadForm(stock, topicId) {
  return `<form class="form" method="post" action="${BASE}/nahrat" enctype="multipart/form-data">
    ${field("Téma", `<select class="${input}" name="topicId" required>${topicOptions(stock.topics, topicId)}</select>`)}
    ${field(
      "Fotky",
      `<input class="control" type="file" name="images" multiple required accept="${ACCEPT}">`,
      "Můžete vybrat víc fotek najednou, nejvýš 20. Před odesláním se v prohlížeči zmenší.",
    )}
    ${field(
      "Popisek",
      `<input class="${input}" name="image_caption" maxlength="160" placeholder="Foto: Jana Nováková">`,
      `Nepovinné, pro všechny nahrané fotky. Ve zprávě bude „${STOCK_LABEL} · popisek“.`,
    )}
    ${formFoot("Nahrát", cancelLink(BASE))}
  </form>`;
}

function imageForm(stock, image) {
  return `<form class="form" method="post" action="${BASE}/fotka" enctype="multipart/form-data">
    ${hidden("id", image.id)}
    ${field("Téma", `<select class="${input}" name="topicId" required>${topicOptions(stock.topics, image.topicId)}</select>`)}
    ${photoControl({ imageKey: image.imageKey, imageFocus: image.imageFocus, imageCaption: image.caption })}
    <p class="hint">Výřez a popisek dostane každá zpráva, ke které se fotka dá. Zprávy, které ji už mají, zůstanou beze změny.</p>
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function topicForm(topic) {
  return `<form class="form" method="post" action="${BASE}/tema">
    ${topic ? hidden("id", topic.id) : ""}
    ${field("Název", `<input class="${input}" name="name" required maxlength="80" value="${esc(topic?.name ?? "")}" placeholder="Hasiči a bezpečnost">`)}
    ${field(
      "Kdy ho použít",
      `<textarea class="${input}" name="hint" maxlength="200" rows="2" placeholder="Hasiči, policie, nehody, varování.">${esc(topic?.hint ?? "")}</textarea>`,
      "Podle toho Drběna pozná, ke kterým zprávám se téma hodí.",
    )}
    ${field("Pořadí", `<input class="${input} control-short" type="number" name="sortOrder" min="0" max="999" value="${topic?.sortOrder ?? 0}">`, "Menší číslo je na stránce výš.")}
    ${formFoot("Uložit téma", cancelLink(BASE))}
  </form>`;
}

function settingsForm(stock) {
  const options = [`<option value="">Nic, zpráva bude bez obrázku</option>`, ...stock.topics.map((topic) => `<option value="${topic.id}"${topic.id === stock.fallbackTopicId ? " selected" : ""}>Vzít fotku z tématu ${esc(topic.name)}</option>`)];
  return `<form class="form stock-settings" method="post" action="${BASE}/nastaveni">
    ${field("Když ve vybraném tématu žádná fotka není", `<select class="${input}" name="fallbackTopicId">${options.join("")}</select>`)}
    ${formFoot("Uložit")}
  </form>`;
}

function imageTile(image) {
  return `<li class="stock-tile">
    <img src="${mediaUrl(image.imageKey)}" alt="" loading="lazy">
    <div class="stock-tile-foot">
      ${image.usedAt ? "" : badge("Zatím nepoužitá")}
      ${modalLink(`${BASE}?id=${image.id}`, "Upravit")}
      ${modalLink(`${BASE}?smazat=${image.id}`, "Smazat", "btn-ghost btn-danger-text")}
    </div>
  </li>`;
}

function topicPanel(stock, topic) {
  const fallback = topic.id === stock.fallbackTopicId ? badge("Náhradní téma", "ok") : "";
  const body = `${topic.hint ? `<p class="stock-hint">${esc(topic.hint)} ${fallback}</p>` : fallback}
    ${topic.images.length ? `<ul class="stock-grid">${topic.images.map(imageTile).join("")}</ul>` : `<p class="empty">Zatím žádná fotka.</p>`}`;
  return panel({
    id: `tema-${topic.id}`,
    title: topic.name,
    count: topic.images.length,
    tools: `${modalLink(`${BASE}?nahrat=${topic.id}`, "Nahrát fotky")}
      ${modalLink(`${BASE}?tema=${topic.id}`, "Upravit")}
      ${modalLink(`${BASE}?smazat-tema=${topic.id}`, "Smazat", "btn-ghost btn-danger-text")}`,
    body,
  });
}

function findImage(stock, id) {
  for (const topic of stock.topics) {
    const found = topic.images.find((image) => image.id === id);
    if (found) return found;
  }
  return null;
}

export function adminStock(ctx, data, message, query = {}) {
  const stock = data.stock ?? { topics: [], fallbackTopicId: null };
  const editing = findImage(stock, query.editingId);
  const removing = editing ? null : findImage(stock, query.confirmId);
  const topic = stock.topics.find((row) => row.id === query.topicId) ?? null;
  const removingTopic = stock.topics.find((row) => row.id === query.removeTopicId) ?? null;
  const anyOpen = editing || removing || topic || removingTopic;

  const dialogs = [];
  if (stock.topics.length) {
    dialogs.push(
      modal({
        id: "nahrat",
        title: "Nahrát fotky",
        close: BASE,
        open: Boolean(query.upload) && !anyOpen,
        body: uploadForm(stock, query.uploadTopicId ?? stock.topics[0].id),
      }),
    );
  }
  dialogs.push(modal({ id: "nove-tema", title: "Nové téma", close: BASE, open: Boolean(query.freshTopic) && !anyOpen, body: topicForm(null) }));
  if (editing) dialogs.push(modal({ id: "okno", title: "Upravit fotku", size: "wide", close: BASE, open: true, body: imageForm(stock, editing) }));
  else if (topic) dialogs.push(modal({ id: "okno", title: "Upravit téma", close: BASE, open: true, body: topicForm(topic) }));
  else if (removing) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat fotku",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/fotka/smazat`,
          id: removing.id,
          text: `<img class="stock-confirm" src="${mediaUrl(removing.imageKey)}" alt="">Fotka zmizí z knihovny. Zprávy, které ji už mají, ji nechají.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  } else if (removingTopic) {
    const count = removingTopic.images.length;
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat téma",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/tema/smazat`,
          id: removingTopic.id,
          text: `Téma <b>${esc(removingTopic.name)}</b> zmizí${count ? ` i s fotkami (${count})` : ""}. Zprávy, které je už mají, je nechají.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }

  const total = stock.topics.reduce((sum, row) => sum + row.images.length, 0);
  const actions = `${stock.topics.length ? openButton("nahrat", `${BASE}?nahrat`, "Nahrát fotky") : ""}${openButton("nove-tema", `${BASE}?nove-tema`, "Nové téma", "btn-line")}`;
  const body = `${pageHead(
    "Knihovna obrázků",
    "Ilustrační fotky podle témat. Když zpráva nemá pěknou vlastní fotku (jen plakát nebo nic), Koza Drběna k ní dá fotku z tématu, které sedí. Bere tu, která byla nejdéle nepoužitá.",
    actions,
  )}
    ${total ? "" : callout("Knihovna je zatím prázdná, Drběna proto dává zprávy bez obrázku. Nahrajte do témat pár fotek.", "warn")}
    ${panel({ id: "nastaveni", title: "Náhradní téma", body: settingsForm(stock) })}
    ${stock.topics.map((row) => topicPanel(stock, row)).join("")}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "obrazky", message, body, { title: "Knihovna obrázků" });
}

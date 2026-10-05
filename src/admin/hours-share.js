// Redakce: odkaz ke sdílení místa, ordinace či sběrného dvora (src/hours-share.js). Okno `?sdilet=ID` ukáže
// náhled, jak odkaz uvidí Facebook, a adresu ke zkopírování. Adresa se mění se změnou textu, proto vždy odsud.
import { text as tx } from "../copy.js";
import { shareInfo, sharePath } from "../hours-share.js";
import { esc } from "../view.js";
import { pragueNow } from "../waste.js";
import { callout, input, modal, modalLink } from "./ui.js";

const DEFAULT_IMAGE = "/og.webp";

export function shareButton(base, row) {
  return row.published ? modalLink(`${base}?sdilet=${row.id}`, "Sdílet", "btn-ghost") : "";
}

export function shareDialog(ctx, { kind, base, row }) {
  if (!row?.published) return "";
  const today = pragueNow().date;
  const info = shareInfo(kind, row, today);
  const origin = ctx.mainOrigin ?? "";
  const url = `${origin}${sharePath(kind, row, today)}`;
  const host = origin.replace(/^https?:\/\//, "");
  const preview = `<figure class="share-preview">
      <img src="${esc(info.image || DEFAULT_IMAGE)}" alt="" width="1200" height="630">
      <figcaption>
        ${host ? `<span class="share-host">${esc(host)}</span>` : ""}
        <b>${esc(`${info.title} | ${tx(ctx.copy, "site_name")}`)}</b>
        <span>${esc(info.description)}</span>
      </figcaption>
    </figure>`;
  return modal({
    id: "okno",
    title: `Sdílet: ${row.name}`,
    close: base,
    open: true,
    body: `${callout("Takhle odkaz ukáže Facebook nebo Messenger. Když se změní otevírací doba, změní se i odkaz, aby náhled nezůstal starý. Proto ho berte vždy odsud.")}
      ${preview}
      <div class="link-copy">
        <input class="${input}" id="sdilet-odkaz" value="${esc(url)}" readonly aria-label="Odkaz ke sdílení">
        <button class="btn btn-line btn-sm" type="button" data-copy-field="sdilet-odkaz">Kopírovat</button>
        <button class="btn btn-primary btn-sm" type="button" data-share-field="sdilet-odkaz" data-share-title="${esc(info.title)}" hidden>Sdílet…</button>
      </div>`,
  });
}

// Odesílání e-mailů přes Cloudflare Email Service (binding EMAIL ve wrangler.toml).
// Odesílá se z adresy redakce; doména musí být v Email Service přidaná, jinak Cloudflare e-mail odmítne.
// Místně (wrangler dev) e-mail nikam nejde, Wrangler ho jen vypíše.

export const MAIL_FROM = { email: "redakce@kopidlenskadrbna.org", name: "Kopidlenská drbna" };

export function mailReady(env) {
  return typeof env?.EMAIL?.send === "function";
}

export async function sendMail(env, { to, subject, text, html }) {
  if (!mailReady(env)) return { ok: false, error: "Odesílání e-mailů není nastavené." };
  try {
    await env.EMAIL.send({ from: MAIL_FROM, to, subject, text, html });
    return { ok: true };
  } catch (error) {
    const code = error?.code ? ` (${error.code})` : "";
    return { ok: false, error: `E-mail se nepodařilo odeslat${code}.` };
  }
}

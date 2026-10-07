// Vyrobí klíče VAPID pro upozornění do prohlížeče (src/push/crypto.js) a vypíše příkazy, jak je uložit jako tajemství.
// Klíče se vyrábějí jednou: po výměně přestanou fungovat všechny dosavadní odběry.
const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log("\nUložení do produkce (každý příkaz se zeptá na hodnotu):");
console.log("  npx wrangler secret put VAPID_PUBLIC_KEY");
console.log("  npx wrangler secret put VAPID_PRIVATE_KEY");
console.log("\nMístně: npm run nahled -- --var VAPID_PUBLIC_KEY:… --var VAPID_PRIVATE_KEY:…");

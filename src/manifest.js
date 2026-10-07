// Manifest webu (/site.webmanifest) podle prohlížeče. Safari (iPhone, iPad, Mac) dostane display „standalone“:
// bez něj iPhone nepošle upozornění (src/push/) ani drbně přidané na plochu, a sám instalaci nikdy nenabízí.
// Ostatní (Chrome, Edge, Firefox, Android) dostanou „browser“, takže drbnu nepovažují za aplikaci a nenabízejí ji
// k instalaci. Upozornění v nich fungují i tak.
const MANIFEST = {
  name: "Kopidlenská drbna",
  short_name: "Drbna",
  lang: "cs",
  start_url: "/",
  background_color: "#fffaf5",
  theme_color: "#fffaf5",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export const MANIFEST_PATH = "/site.webmanifest";

// Safari: všechno na iPhonu a iPadu (tam je i Chrome jen převlečené Safari), na Macu jen Safari samo.
// iPad se často hlásí jako Mac, proto se Mac počítá taky.
export function safariLike(userAgent) {
  const ua = String(userAgent ?? "");
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);
}

export function manifestFor(userAgent) {
  return { ...MANIFEST, display: safariLike(userAgent) ? "standalone" : "browser" };
}

export function manifestResponse(request) {
  return new Response(JSON.stringify(manifestFor(request.headers.get("user-agent"))), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      // Liší se podle prohlížeče: sdílená mezipaměť nesmí dát verzi pro iPhone Chromu.
      vary: "User-Agent",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

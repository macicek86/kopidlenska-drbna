// Kostra stránky redakce: hlavička, styly a skripty. `scripts` jsou skripty navíc (Turnstile u přihlášení).
import { esc, FAVICON_TAGS } from "../view.js";

export function adminDocument({ title, body, rich = false, bodyClass = "adm", scripts = "" }) {
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>
  ${FAVICON_TAGS}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,650&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/site.css">
  ${rich ? `<link rel="stylesheet" href="/vendor/trix/trix.css">` : ""}
  <link rel="stylesheet" href="/admin.css">
  <link rel="stylesheet" href="/photo-pick.css">
</head>
<body class="${bodyClass}">
${body}
${scripts}
${rich ? `<script src="/vendor/trix/trix.umd.min.js" defer></script>` : ""}
<script src="/editor.js" defer></script>
<script src="/photo-pick.js" defer></script>
<script src="/assist.js" defer></script>
<script src="/admin.js" defer></script>
<script src="/periods.js" defer></script>
</body>
</html>`;
}

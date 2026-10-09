const ALIAS = { b: "strong", i: "em", h1: "h2", h4: "h3", h5: "h3", h6: "h3", div: "p" };
const DROP = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "noembed",
  "noframes",
  "textarea",
  "title",
  "xmp",
  "template",
  "svg",
  "math",
  "frameset",
  "frame",
  "applet",
  "link",
  "meta",
  "base",
  "form",
]);
const BLOCKS = new Set(["p", "h2", "h3", "blockquote", "ul", "ol", "li"]);
const INLINE = new Set(["strong", "em", "u", "a", "br"]);
const ALLOWED = new Set([...BLOCKS, ...INLINE]);

const NAMED = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  colon: ":",
  tab: "\t",
  newline: "\n",
};

function escapeText(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, "&quot;");
}

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, (all, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    }
    return Object.hasOwn(NAMED, body.toLowerCase()) ? NAMED[body.toLowerCase()] : all;
  });
}

function isRich(value) {
  return /<\/?[a-z][\s\S]*?>/i.test(value);
}

function plainToHtml(value) {
  return value
    .split(/\n{2,}/)
    .filter((part) => part.trim())
    .map((part) => `<p>${escapeText(part).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

// Sledovací parametry cizích služeb (Google, Facebook, Microsoft, Mailchimp…), které lidé kopírují s odkazy.
const TRACKING = /^(?:utm_.*|fbclid|gclid|gbraid|wbraid|dclid|msclkid|igshid|mc_cid|mc_eid|yclid|_hsenc|_hsmi)$/i;

// Odkaz bez sledovacích parametrů. Když žádné nemá, vrátí ho beze změny (ať se nepřekóduje).
export function withoutTracking(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  const names = [...url.searchParams.keys()].filter((name) => TRACKING.test(name));
  if (!names.length) return value;
  for (const name of names) url.searchParams.delete(name);
  return url.toString().replace(/\?(?=#|$)/, "");
}

function safeHref(raw) {
  let value = String(raw ?? "").trim();
  for (let pass = 0; pass < 3; pass += 1) value = decodeEntities(value);
  value = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!value || /\s/.test(value)) return "";
  if (/^https:\/\//i.test(value) || /^http:\/\//i.test(value)) return withoutTracking(value);
  if (/^mailto:/i.test(value) && !/[<>"]/.test(value)) return value;
  if (/^tel:\+?[0-9]{3,15}$/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes(":")) return value;
  return "";
}

function readTag(input, start) {
  let index = start + 1;
  if (input.startsWith("!--", index)) {
    const end = input.indexOf("-->", index);
    return { comment: true, next: end === -1 ? input.length : end + 3 };
  }
  if (input[index] === "!" || input[index] === "?") {
    const end = input.indexOf(">", index);
    return { comment: true, next: end === -1 ? input.length : end + 1 };
  }
  let closing = false;
  if (input[index] === "/") {
    closing = true;
    index += 1;
  }
  const nameStart = index;
  while (index < input.length && /[a-zA-Z0-9]/.test(input[index])) index += 1;
  if (index === nameStart) return null;
  const name = input.slice(nameStart, index).toLowerCase();
  const attrs = {};
  while (index < input.length) {
    while (index < input.length && /[\s/]/.test(input[index])) index += 1;
    if (index >= input.length) return { name, closing, attrs, next: input.length };
    if (input[index] === ">") return { name, closing, attrs, next: index + 1 };
    const attrStart = index;
    while (index < input.length && /[^\s=>/]/.test(input[index])) index += 1;
    const attr = input.slice(attrStart, index).toLowerCase();
    while (index < input.length && /\s/.test(input[index])) index += 1;
    let attrValue = "";
    if (input[index] === "=") {
      index += 1;
      while (index < input.length && /\s/.test(input[index])) index += 1;
      const quote = input[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const end = input.indexOf(quote, index);
        if (end === -1) {
          attrValue = input.slice(index);
          index = input.length;
        } else {
          attrValue = input.slice(index, end);
          index = end + 1;
        }
      } else {
        const valueStart = index;
        while (index < input.length && !/[\s>]/.test(input[index])) index += 1;
        attrValue = input.slice(valueStart, index);
      }
    }
    if (attr && !Object.hasOwn(attrs, attr)) attrs[attr] = attrValue;
  }
  return { name, closing, attrs, next: index };
}

function canHoldBlock(name) {
  return name === "#root" || name === "blockquote" || name === "li";
}

function openTag(stack, name, href = "") {
  const parentName = stack.at(-1).name;
  if (name === "li") {
    if (parentName !== "ul" && parentName !== "ol") return;
  } else if (parentName === "ul" || parentName === "ol") {
    return;
  } else if (BLOCKS.has(name)) {
    while (stack.length > 1 && !canHoldBlock(stack.at(-1).name)) stack.pop();
  }
  if (name === "a" && (stack.some((node) => node.name === "a") || !href)) return;
  if ((stack.at(-1).name === "#root" || stack.at(-1).name === "blockquote") && INLINE.has(name)) {
    openTag(stack, "p");
  }
  const node = { name, href, children: [] };
  stack.at(-1).children.push(node);
  if (name !== "br") stack.push(node);
}

function addText(stack, raw) {
  const text = decodeEntities(raw);
  if (!text) return;
  if (stack.at(-1).name === "ul" || stack.at(-1).name === "ol") {
    if (!text.trim()) return;
    openTag(stack, "li");
  }
  if (stack.at(-1).name === "#root" || stack.at(-1).name === "blockquote") openTag(stack, "p");
  const parent = stack.at(-1);
  if (parent.name === "ul" || parent.name === "ol" || parent.name === "#root") return;
  parent.children.push({ text });
}

function closeTag(stack, name) {
  for (let index = stack.length - 1; index > 0; index -= 1) {
    if (stack[index].name === name) {
      stack.length = index;
      return;
    }
  }
}

function parseRich(input) {
  const root = { name: "#root", children: [] };
  const stack = [root];
  let dropping = "";
  let depth = 0;
  let index = 0;
  while (index < input.length) {
    const mark = input.indexOf("<", index);
    if (mark === -1) {
      if (!dropping) addText(stack, input.slice(index));
      break;
    }
    if (mark > index && !dropping) addText(stack, input.slice(index, mark));
    const token = readTag(input, mark);
    if (!token) {
      if (!dropping) addText(stack, "<");
      index = mark + 1;
      continue;
    }
    index = token.next;
    if (token.comment) continue;
    if (dropping) {
      if (token.name === dropping && !token.closing) depth += 1;
      else if (token.name === dropping && token.closing) {
        depth -= 1;
        if (depth <= 0) dropping = "";
      }
      continue;
    }
    const name = ALIAS[token.name] || token.name;
    if (token.closing) {
      closeTag(stack, name);
      continue;
    }
    if (DROP.has(token.name)) {
      dropping = token.name;
      depth = 1;
      continue;
    }
    if (!ALLOWED.has(name)) continue;
    openTag(stack, name, name === "a" ? safeHref(token.attrs.href || "") : "");
  }
  return root;
}

function serialize(node) {
  if (node.text != null) return escapeText(node.text);
  let inner = node.children.map(serialize).join("");
  if (node.name === "#root") return inner;
  if (node.name === "br") return "<br>";
  if (node.name === "p" || node.name === "h2" || node.name === "h3" || node.name === "li") {
    inner = inner.replace(/(?:<br>)+$/, "");
  }
  if (!inner.replace(/<br>/g, "").trim()) return "";
  if (node.name === "a") {
    const href = escapeAttr(node.href);
    if (/^(?:mailto|tel):/i.test(node.href) || node.href.startsWith("/")) return `<a href="${href}">${inner}</a>`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  }
  return `<${node.name}>${inner}</${node.name}>`;
}

function collectText(node, parts) {
  if (node.text != null) parts.push(node.text);
  else for (const child of node.children) collectText(child, parts);
}

export function prepareArticleBody(value) {
  const raw = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (!isRich(raw)) return { html: raw ? plainToHtml(raw) : "", text: raw };
  const tree = parseRich(raw);
  const parts = [];
  collectText(tree, parts);
  return { html: serialize(tree), text: parts.join("").replace(/\u00a0/g, " ").trim() };
}

export function renderArticleHtml(value) {
  const raw = String(value ?? "");
  if (!isRich(raw)) {
    return raw
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((part) => `<p>${escapeText(part).replaceAll("\n", "<br>")}</p>`)
      .join("");
  }
  return prepareArticleBody(raw).html;
}

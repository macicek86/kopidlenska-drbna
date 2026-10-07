// Sdílení zprávy a karet otevírací doby (src/share.js): „Kopírovat odkaz“, na mobilu „Další…“ se systémovou
// nabídkou místo E-mailu, zavření nabídky klikem jinam, po výběru nebo Esc.
const touch = matchMedia("(hover: none) and (pointer: coarse)").matches;

function setup(share) {
  const more = share.querySelector("[data-share-more]");
  if (more && touch && navigator.share) {
    more.hidden = false;
    share.querySelector(".share-mail")?.setAttribute("hidden", "");
    more.addEventListener("click", () => {
      share.open = false;
      // Zavřená systémová nabídka vrátí chybu AbortError, to je v pořádku.
      navigator.share({ title: more.dataset.shareTitle, url: more.dataset.shareMore }).catch(() => {});
    });
  }
  const copy = share.querySelector("[data-share-copy]");
  if (copy && navigator.clipboard) {
    copy.hidden = false;
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(copy.dataset.shareCopy);
        copy.textContent = "Odkaz zkopírován";
      } catch {
        copy.textContent = "Nepovedlo se zkopírovat";
      }
      setTimeout(() => {
        share.open = false;
        copy.textContent = "Kopírovat odkaz";
      }, 1200);
    });
  }
  share.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => (share.open = false)));
  share.addEventListener("toggle", () => {
    if (share.open) shares.forEach((other) => other !== share && (other.open = false));
  });
  document.addEventListener("click", (event) => {
    if (share.open && !share.contains(event.target)) share.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !share.open) return;
    share.open = false;
    share.querySelector("summary").focus();
  });
}

const shares = document.querySelectorAll("[data-share]");
shares.forEach(setup);

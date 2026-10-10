// Formulář s více obdobími (src/admin/periods.js): přidat a odebrat období, čas jen u „jen do“ a „až od“,
// rozepsání po dnech u „Jiná doba“. Bez skriptu jsou vidět všechna pole a dvě období.
(function () {
  var MAX = 10;

  function blocks(form) {
    return Array.prototype.slice.call(form.querySelectorAll("[data-period]"));
  }

  // Pole i nadpisy se po přidání a odebrání očíslují znovu, ať server dostane p1…pN bez děr.
  function renumber(form) {
    blocks(form).forEach(function (block, at) {
      var n = at + 1;
      var title = block.querySelector("[data-period-title]");
      if (title) title.textContent = "Období " + n;
      block.querySelectorAll("[name]").forEach(function (field) {
        field.name = field.name.replace(/^p(\d+|__N__)-/, "p" + n + "-");
      });
    });
    var single = blocks(form).length <= 1;
    form.querySelectorAll("[data-period-remove]").forEach(function (button) {
      button.hidden = single;
    });
    var add = form.querySelector("[data-period-add]");
    if (add) add.hidden = blocks(form).length >= MAX;
  }

  function paintMode(block) {
    var checked = block.querySelector("[data-period-mode]:checked");
    var mode = checked ? checked.value : "zavreno";
    var time = block.querySelector(".period-time");
    if (time) time.hidden = mode !== "jendo" && mode !== "azod";
    var details = block.querySelector(".period-week");
    if (details && mode === "jina") details.open = true;
  }

  function mount(root) {
    root.querySelectorAll("form[data-periods]").forEach(function (form) {
      if (form.dataset.periodsReady) return;
      form.dataset.periodsReady = "1";
      blocks(form).forEach(paintMode);
      renumber(form);
      var add = form.querySelector("[data-period-add]");
      var template = form.querySelector("template[data-period-template]");
      if (add && template) add.hidden = false;
    });
  }

  document.addEventListener("click", function (event) {
    var add = event.target.closest("[data-period-add]");
    var remove = event.target.closest("[data-period-remove]");
    if (!add && !remove) return;
    var form = event.target.closest("form[data-periods]");
    if (!form) return;
    if (add) {
      var template = form.querySelector("template[data-period-template]");
      var list = form.querySelector("[data-period-list]");
      if (!template || !list || blocks(form).length >= MAX) return;
      var holder = document.createElement("div");
      holder.innerHTML = template.innerHTML.replace(/__N__/g, String(blocks(form).length + 1));
      var block = holder.firstElementChild;
      list.appendChild(block);
      paintMode(block);
      renumber(form);
      document.dispatchEvent(new CustomEvent("drbna:mount", { bubbles: true }));
      var first = block.querySelector("input");
      if (first) first.focus();
      form.classList.add("is-dirty");
    } else {
      var target = remove.closest("[data-period]");
      if (target && blocks(form).length > 1) {
        target.remove();
        renumber(form);
        form.classList.add("is-dirty");
      }
    }
  });

  document.addEventListener("change", function (event) {
    if (event.target.matches && event.target.matches("[data-period-mode]")) {
      paintMode(event.target.closest("[data-period]"));
    }
  });

  document.addEventListener("drbna:mount", function (event) {
    mount(event.target && event.target.querySelectorAll ? event.target : document);
  });
  mount(document);
})();

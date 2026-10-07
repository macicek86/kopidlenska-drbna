// Stránka /upozorneni: zapnutí upozornění, výběr témat (ukládá se hned) a zkušební upozornění.
(() => {
  const root = document.querySelector("[data-push]");
  if (!root) return;
  const msg = root.querySelector("[data-push-msg]");
  const form = root.querySelector("[data-push-form]");
  const saved = root.querySelector("[data-push-saved]");
  const onButton = root.querySelector("[data-push-on]");
  const testButton = root.querySelector("[data-push-test]");
  const offButton = root.querySelector("[data-push-off]");
  const iosHint = root.querySelector("[data-push-ios]");
  const PICKS = ["rubrics", "places", "doctors", "yards", "kinds"];
  let registration = null;
  let subscription = null;

  const say = (text) => {
    msg.textContent = text;
  };

  function show(state) {
    onButton.hidden = state !== "off";
    testButton.hidden = state !== "on";
    offButton.hidden = state !== "on";
    root.classList.toggle("is-on", state === "on");
  }

  function keyBytes(text) {
    const base = text.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base + "===".slice((base.length + 3) % 4));
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  }

  function prefs() {
    const values = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
    return { topics: values("topic"), pick: Object.fromEntries(PICKS.map((name) => [name, values(name)])) };
  }

  function fill(data) {
    const mark = (name, list) => {
      for (const input of form.querySelectorAll(`input[name="${name}"]`)) input.checked = list.map(String).includes(input.value);
    };
    mark("topic", data.topics ?? []);
    for (const name of PICKS) mark(name, data.pick?.[name] ?? []);
    for (const details of form.querySelectorAll("details")) {
      if (details.querySelector("input:checked")) details.open = true;
    }
  }

  async function post(path, body) {
    const response = await fetch(`/upozorneni/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }

  async function save() {
    if (!subscription) return;
    saved.textContent = "Ukládám…";
    const { data } = await post("ulozit", { subscription: subscription.toJSON(), prefs: prefs() }).catch(() => ({ data: {} }));
    saved.textContent = data.ok ? "Uloženo." : data.error || "Uložit se nepodařilo, zkuste to znovu.";
  }

  let timer = 0;
  form.addEventListener("change", () => {
    if (!subscription) return;
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  });

  function onMessage() {
    say(prefs().topics.length ? "Upozornění máte zapnutá. Co chodí, změníte zaškrtnutím níž." : "Upozornění máte zapnutá, ale nic není zaškrtnuté.");
  }

  onButton.addEventListener("click", async () => {
    onButton.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        say(permission === "denied" ? "Upozornění jsou v prohlížeči zakázaná. Povolte je v nastavení webu (ikonka vedle adresy) a zkuste to znovu." : "Bez povolení to nepůjde. Zkuste to znovu.");
        return;
      }
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(root.dataset.key) });
      await save();
      show("on");
      onMessage();
    } catch {
      say("Upozornění se nepodařilo zapnout. Zkuste to prosím znovu.");
    } finally {
      onButton.disabled = false;
    }
  });

  testButton.addEventListener("click", async () => {
    testButton.disabled = true;
    const { data } = await post("zkusit", { endpoint: subscription.endpoint }).catch(() => ({ data: {} }));
    say(data.ok ? "Zkušební upozornění je na cestě. Mělo by přijít do pár vteřin." : data.error || "Poslat se nepodařilo.");
    if (data.gone) {
      subscription = null;
      show("off");
    }
    setTimeout(() => (testButton.disabled = false), 3000);
  });

  offButton.addEventListener("click", async () => {
    offButton.disabled = true;
    try {
      await post("zrusit", { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    } catch {
      // Odběr na straně prohlížeče zůstal: drbna ho stejně smazala a nic už nepošle.
    }
    subscription = null;
    saved.textContent = "";
    offButton.disabled = false;
    show("off");
    say("Upozornění jsou vypnutá.");
  });

  async function start() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      if (ios && !standalone) {
        say("Na iPhonu je potřeba drbnu nejdřív přidat na plochu.");
        iosHint.hidden = false;
      } else say("Tenhle prohlížeč upozornění neumí. Zkuste Chrome, Firefox, Edge nebo Safari.");
      form.hidden = true;
      return;
    }
    registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    subscription = await registration.pushManager.getSubscription();
    if (subscription && Notification.permission === "granted") {
      const { status, data } = await post("nacist", { endpoint: subscription.endpoint }).catch(() => ({ status: 0, data: {} }));
      if (data.ok) fill(data.prefs);
      // Drbna odběr nezná (třeba ho smazala): uloží se znovu s tím, co je zaškrtnuté.
      else if (status === 404) await save();
      show("on");
      onMessage();
      return;
    }
    show("off");
    say(Notification.permission === "denied" ? "Upozornění jsou v prohlížeči zakázaná. Povolte je v nastavení webu a obnovte stránku." : "Vyberte, co vás zajímá, a zapněte upozornění.");
  }

  start().catch(() => say("Upozornění se nepodařilo připravit. Obnovte prosím stránku."));
})();

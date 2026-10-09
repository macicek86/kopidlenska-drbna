// Service worker drbny: jen upozornění (src/push/). Stránky ani soubory nechytá, web funguje jako dřív.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    // Malá ikonka v liště Androidu: prohlížeč z ní bere jen průhlednost, proto bílá koza na průhledném.
    badge: "/badge-96.png",
    lang: "cs",
    data: { url: data.url || "/" },
  };
  if (data.tag) options.tag = data.tag;
  if (data.image) options.image = data.image;
  event.waitUntil(self.registration.showNotification(data.title || "Kopidlenská drbna", options));
});

// Ťuknutí na upozornění: otevřená drbna se přepne na stránku, jinak se otevře nové okno.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin && "focus" in client);
      // navigate() jde jen u okna, které tenhle worker řídí; jinak nové okno.
      if (open) return open.navigate(url).then((client) => (client ?? open).focus()).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});

// Prohlížeč odběr vyměnil: nový pošleme drbně, nastavení zůstane.
self.addEventListener("pushsubscriptionchange", (event) => {
  const old = event.oldSubscription;
  const renew = async () => {
    const fresh = event.newSubscription ?? (old ? await self.registration.pushManager.subscribe(old.options) : null);
    if (!fresh) return;
    await fetch("/upozorneni/obnovit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oldEndpoint: old?.endpoint ?? "", subscription: fresh.toJSON() }),
    });
  };
  event.waitUntil(renew());
});

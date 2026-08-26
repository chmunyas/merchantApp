// PesaSwap Merchant service worker.
// Offline-first shell: precache the offline page + icons + key route shells,
// network-first for navigations (fresh SSR when online, cached/offline fallback
// when not), and cache-first for immutable static assets.
const CACHE = "pesaswap-v4";
const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
// Best-effort route shells so these open even fully offline.
const PRECACHE_ROUTES = ["/"];

function isSensitiveNavigation(url) {
  return (
    url.pathname.startsWith("/me/") ||
    url.pathname.startsWith("/dashboard") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/staff") ||
    url.pathname === "/pay" ||
    url.searchParams.has("o") ||
    url.searchParams.has("r") ||
    url.searchParams.has("i") ||
    url.searchParams.has("tapgo")
  );
}

function cacheableNavigation(url, response) {
  return (
    response.ok &&
    !isSensitiveNavigation(url) &&
    !/no-store|private/i.test(response.headers.get("cache-control") || "")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(PRECACHE);
      await Promise.all(
        PRECACHE_ROUTES.map((route) => cache.add(route).catch(() => {})),
      );
      // Note: no skipWaiting() here — a new version waits so the app can prompt
      // the user to refresh (see the SKIP_WAITING message handler below).
    }),
  );
});

// Let the page activate a waiting update on demand ("Update available" prompt).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API calls — always go to the network.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, fall back to cache, then the offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (cacheableNavigation(url, response)) {
            const cache = await caches.open(CACHE);
            await cache.put(url.pathname, response.clone());
          }
          return response;
        })
        .catch(async () => {
          if (!isSensitiveNavigation(url)) {
            const cached = await caches.match(url.pathname);
            if (cached) return cached;
          }
          return (await caches.match("/offline.html")) || Response.error();
        }),
    );
    return;
  }

  // Static assets: cache-first, then network (and cache hashed/immutable ones).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then(async (response) => {
        if (
          response.ok &&
          (url.pathname.startsWith("/assets/") ||
            url.pathname.startsWith("/icons/"))
        ) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      });
    }),
  );
});

// --- Web Push: payloadless "tickle" -> fetch the text -> show notification ---
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let deviceToken = "";
      try {
        const cache = await caches.open("pesaswap-push");
        const stored = await cache.match("/push-device-token");
        if (stored) deviceToken = await stored.text();
      } catch {
        /* no credential — generic notification only */
      }
      let title = "PesaSwap";
      let body = "You have a new notification";
      try {
        const res = deviceToken
          ? await fetch("/api/push/latest", {
              headers: { "x-push-device-token": deviceToken },
            })
          : null;
        if (res && res.ok) {
          const data = await res.json();
          if (data && data.title) {
            title = data.title;
            body = data.body || body;
          }
        }
      } catch {
        /* fall back to generic text */
      }
      await self.registration.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: "/dashboard/inbox" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const target =
        (event.notification.data && event.notification.data.url) ||
        "/dashboard/inbox";
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if (client.url.includes(target) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })(),
  );
});

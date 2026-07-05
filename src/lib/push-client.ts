// Client-side Web Push enrolment. All guarded so an unsupported browser or a
// denied permission simply returns a status — never throws.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export type PushStatus =
  | "enabled"
  | "denied"
  | "unsupported"
  | "error";

export async function enablePush(venue = "main"): Promise<PushStatus> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    typeof Notification === "undefined"
  ) {
    return "unsupported";
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";

    const registration = await navigator.serviceWorker.ready;
    const res = await fetch(
      `/api/push/vapid?venue=${encodeURIComponent(venue)}`,
    );
    if (!res.ok) return "error";
    const { publicKey } = (await res.json()) as { publicKey?: string };
    if (!publicKey) return "error";

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      }));

    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ venue, subscription, audience: "staff" }),
    });

    // Stash the venue so the SW can fetch the right notification text.
    try {
      const cache = await caches.open("pesaswap-push");
      await cache.put("/push-venue", new Response(venue));
    } catch {
      /* non-fatal */
    }
    return "enabled";
  } catch {
    return "error";
  }
}

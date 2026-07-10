import { useEffect, useRef, useState } from "react";

// Cloudflare Turnstile CAPTCHA widget. Renders only when a TURNSTILE_SITE_KEY is
// configured (server exposes it at /api/auth/turnstile/config); otherwise it is a
// no-op, so account-creation forms work unchanged until you enable protection.
// Emits the verification token via onToken for the form to submit as turnstileToken.
export function TurnstileWidget({
  onToken,
}: {
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/turnstile/config")
      .then((r) => r.json())
      .then((d: { siteKey?: string | null }) => setSiteKey(d.siteKey ?? null))
      .catch(() => setSiteKey(null));
  }, []);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const render = () => {
      if (!w.turnstile || !ref.current) return;
      ref.current.innerHTML = "";
      w.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (token: string) => onToken(token),
        "error-callback": () => onToken(""),
        "expired-callback": () => onToken(""),
      });
    };
    if (w.turnstile) {
      render();
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.body.appendChild(script);
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div ref={ref} className="flex justify-center py-1" />;
}

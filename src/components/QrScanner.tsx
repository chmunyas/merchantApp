import { useEffect, useRef, useState } from "react";

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue?: string }[]>;
};

// A live camera QR scanner using the native BarcodeDetector API (supported on
// Android Chrome — the primary mobile target). Degrades gracefully with a clear
// message + a manual-entry escape hatch when the camera or the API is unavailable.
export function QrScanner({
  onResult,
  onClose,
  onManual,
}: {
  onResult: (value: string) => void;
  onClose: () => void;
  onManual?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let active = true;
    const Detector = (
      window as unknown as { BarcodeDetector?: new (opts: unknown) => BarcodeDetectorLike }
    ).BarcodeDetector;

    if (!Detector) {
      setMessage(
        "Live scanning isn't supported on this browser. Use your phone's camera app to scan, or enter details manually.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Camera is unavailable here — enter details manually.");
      return;
    }

    const detector = new Detector({ formats: ["qr_code"] });
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        const tick = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes?.[0]?.rawValue;
            if (value) {
              active = false;
              onResultRef.current(value);
              return;
            }
          } catch {
            /* transient frame error — keep scanning */
          }
          raf = requestAnimationFrame(() => void tick());
        };
        raf = requestAnimationFrame(() => void tick());
      } catch {
        setMessage(
          "Couldn't access the camera. Allow camera access, or enter details manually.",
        );
      }
    })();

    return () => {
      active = false;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="size-56 rounded-3xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
        <p className="absolute inset-x-0 top-8 text-center text-sm font-semibold text-white">
          Point at a PesaSwap QR code
        </p>
        {message ? (
          <div className="absolute inset-x-0 bottom-28 px-6 text-center text-sm text-white/90">
            {message}
          </div>
        ) : null}
      </div>
      <div className="flex gap-2 bg-black p-3">
        {onManual ? (
          <button
            type="button"
            onClick={onManual}
            className="flex-1 rounded-2xl border border-white/30 py-3 text-sm font-semibold text-white"
          >
            Enter manually
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-2xl bg-white py-3 text-sm font-bold text-black"
        >
          Close
        </button>
      </div>
    </div>
  );
}

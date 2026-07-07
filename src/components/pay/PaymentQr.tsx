import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

import { buildKeQr, resolveKeQrMerchant } from "@/lib/ke-qr";

type PaymentQrProps = {
  /** DBA / trading name shown to the payer inside their bank app (tag 59). */
  merchantName: string;
  /** Merchant till / paybill / account — the routable id (account template). */
  till: string;
  /** Amount in MINOR units (cents). Present => dynamic KE-QR; absent => static. */
  amountMinor?: number | null;
  /** Order / invoice reference (no PII) carried in tag 62/05. */
  reference?: string | null;
  /**
   * Optional closed-loop scan-to-order/pay URL. When provided a "Phone camera"
   * tab is offered alongside the interoperable KE-QR. Omit for pure-payment
   * surfaces that only need the conformant code.
   */
  cameraUrl?: string | null;
  /** Which code to show first. Payment moments default to KE-QR. */
  defaultMode?: "keqr" | "camera";
  size?: number;
  /** Optional PSP id issued from the CBK directory (once PesaSwap is registered). */
  pspId?: string;
  /**
   * Whether to offer the KE-QR at all. Set false for non-KES surfaces (KE-QR is a
   * KES-only domestic standard) — then only the camera URL is shown.
   */
  keqr?: boolean;
  className?: string;
};

/**
 * PaymentQr — presents a **CBK KE-QR conformant** payment code (EMVCo MPM v1.1
 * TLV, scannable by any licensed bank / M-Pesa app) and, optionally, our
 * closed-loop "scan with your phone camera" URL code. One component so every
 * merchant-presented surface produces an identical, standards-conformant QR.
 */
export function PaymentQr({
  merchantName,
  till,
  amountMinor,
  reference,
  cameraUrl,
  defaultMode = "keqr",
  size = 200,
  pspId,
  keqr = true,
  className,
}: PaymentQrProps) {
  const hasCamera = Boolean(cameraUrl);
  const offerKeqr = keqr !== false;
  const [mode, setMode] = useState<"keqr" | "camera">(
    offerKeqr ? (hasCamera ? defaultMode : "keqr") : "camera",
  );

  const keqrValue = offerKeqr
    ? buildKeQr(
        resolveKeQrMerchant({ name: merchantName, merchantId: till, pspId }),
        { amountMinor: amountMinor ?? null, reference: reference ?? null },
      )
    : "";

  const showCamera = hasCamera && (!offerKeqr || mode === "camera");
  const value = showCamera ? (cameraUrl as string) : keqrValue;
  const amountLabel =
    amountMinor != null && amountMinor > 0
      ? `KES ${Math.round(amountMinor / 100).toLocaleString()}`
      : null;

  return (
    <div className={`flex flex-col items-center gap-2 ${className ?? ""}`}>
      {hasCamera && offerKeqr ? (
        <div className="flex rounded-full border border-border bg-muted p-0.5 text-[9px] font-mono uppercase tracking-widest">
          <button
            type="button"
            onClick={() => setMode("keqr")}
            className={`rounded-full px-3 py-1 transition ${
              mode === "keqr"
                ? "bg-foreground text-background"
                : "text-muted-foreground"
            }`}
          >
            Bank / M-Pesa
          </button>
          <button
            type="button"
            onClick={() => setMode("camera")}
            className={`rounded-full px-3 py-1 transition ${
              mode === "camera"
                ? "bg-foreground text-background"
                : "text-muted-foreground"
            }`}
          >
            Phone camera
          </button>
        </div>
      ) : null}

      <div className="rounded-2xl bg-white p-3 ring-1 ring-border">
        <QRCodeSVG value={value} size={size} level="M" />
      </div>

      {showCamera ? (
        <p className="text-center text-[10px] text-muted-foreground">
          Point your phone camera to open
        </p>
      ) : (
        <div className="text-center">
          <p className="text-[10px] font-semibold text-foreground">
            Scan in any bank or M-Pesa app
          </p>
          <p className="text-[9px] text-muted-foreground">
            {merchantName}
            {amountLabel ? ` · ${amountLabel}` : ""} · KE-QR
          </p>
        </div>
      )}
    </div>
  );
}

export default PaymentQr;

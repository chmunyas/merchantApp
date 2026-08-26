import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";

import type { PrintableReceipt } from "@/lib/receipt-print";

/**
 * A1.4 — the printed receipt a member of staff hands to a guest who asks for
 * one (Sunday help centre, "Digital Bill", article 10722442).
 *
 * Portalled to <body> so the print stylesheet in styles.css can hide every
 * sibling. Every number shown here comes from the server's composed receipt,
 * and the payment ids are printed with it — a paper total that cannot be walked
 * back to a payment id is not evidence.
 */
export function PrintReceiptSheet({
  receipt,
  onClose,
}: {
  receipt: PrintableReceipt;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    document.body.classList.add("print-receipt-active");
    return () => document.body.classList.remove("print-receipt-active");
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const money = (minor: number) =>
    `${receipt.currency} ${(minor / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return createPortal(
    <div
      className="print-receipt-portal fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-receipt-title"
    >
      <div className="print-receipt-sheet w-full max-w-sm rounded-2xl bg-white p-6 text-black shadow-xl">
        <div className="print-hide mb-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
          >
            <Printer className="size-4" aria-hidden="true" />
            Print
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium"
          >
            <X className="size-4" aria-hidden="true" />
            Close
          </button>
        </div>

        <h2 id="print-receipt-title" className="text-center text-base font-bold">
          {receipt.venueName}
        </h2>
        <p className="text-center text-xs">
          {receipt.settled ? "Receipt" : "Bill — not yet settled"}
        </p>
        <p className="text-center text-xs">
          {new Date(receipt.issuedAt).toLocaleString()}
        </p>
        {receipt.tableLabel ? (
          <p className="text-center text-xs">Table {receipt.tableLabel}</p>
        ) : null}

        <hr className="my-3 border-dashed border-slate-400" />

        <table className="w-full text-xs">
          <caption className="sr-only">Items on this bill</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="print-amount text-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line, index) => (
              <tr key={`${line.name}-${index}`}>
                <td>
                  {line.qty} × {line.name}
                  {line.notes ? (
                    <span className="block text-[10px]">{line.notes}</span>
                  ) : null}
                </td>
                <td className="print-amount text-right">
                  {money(line.totalMinor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr className="my-3 border-dashed border-slate-400" />

        <table className="w-full text-xs">
          <caption className="sr-only">Totals</caption>
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td className="print-amount text-right">
                {money(receipt.subtotalMinor)}
              </td>
            </tr>
            {receipt.discountMinor > 0 ? (
              <tr>
                <td>Discount</td>
                <td className="print-amount text-right">
                  −{money(receipt.discountMinor)}
                </td>
              </tr>
            ) : null}
            {receipt.serviceChargeMinor > 0 ? (
              <tr>
                <td>Service charge</td>
                <td className="print-amount text-right">
                  {money(receipt.serviceChargeMinor)}
                </td>
              </tr>
            ) : null}
            {receipt.tipMinor > 0 ? (
              <tr>
                <td>Tip</td>
                <td className="print-amount text-right">
                  {money(receipt.tipMinor)}
                </td>
              </tr>
            ) : null}
            <tr className="font-bold">
              <td>Total</td>
              <td className="print-amount text-right">
                {money(receipt.totalMinor)}
              </td>
            </tr>
            <tr>
              <td>Paid</td>
              <td className="print-amount text-right">
                {money(receipt.paidMinor)}
              </td>
            </tr>
            {receipt.remainingMinor > 0 ? (
              <tr className="font-bold">
                <td>Outstanding</td>
                <td className="print-amount text-right">
                  {money(receipt.remainingMinor)}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <hr className="my-3 border-dashed border-slate-400" />

        <p className="text-[10px]">Order {receipt.orderId}</p>
        {receipt.payments.map((payment) => (
          <p key={payment.id} className="text-[10px]">
            Payment {payment.id}
            {payment.method ? ` · ${payment.method}` : ""}
            {payment.reference ? ` · ref ${payment.reference}` : ""}
          </p>
        ))}
        <p className="mt-3 text-center text-[10px]">Thank you.</p>
      </div>
    </div>,
    document.body,
  );
}

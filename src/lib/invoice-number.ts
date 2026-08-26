// `invoices.number` carries a GLOBAL unique index, so a number minted in the
// browser competes with every number minted on the server. Both sides mint here
// to keep that collision space at 64 bits rather than the ~90k a short random
// integer would give — at which point two merchants collide within a few
// thousand invoices and the second publish fails with a 409.

export function invoiceNumber(): string {
  return `INV-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
}

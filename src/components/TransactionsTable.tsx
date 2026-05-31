const rows = [
  {
    id: "TXN-4920211",
    date: "Oct 24, 14:22",
    type: "USD â EUR Swap (Wise)",
    dot: "bg-blue-500",
    amount: "$45,000.00",
    status: "Settled",
    statusClass: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
  {
    id: "TXN-4920208",
    date: "Oct 24, 11:05",
    type: "Withdrawal to HSBC HK",
    dot: "bg-stone-400",
    amount: "$12,400.00",
    status: "Pending",
    statusClass: "bg-amber-50 text-amber-700 border-amber-100",
  },
  {
    id: "TXN-4920201",
    date: "Oct 23, 18:40",
    type: "GBP â NGN Swap (Verto)",
    dot: "bg-emerald-500",
    amount: "Â£8,200.00",
    status: "Settled",
    statusClass: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
  {
    id: "TXN-4920195",
    date: "Oct 23, 09:12",
    type: "Inbound EUR transfer",
    dot: "bg-indigo-500",
    amount: "â¬24,500.00",
    status: "Settled",
    statusClass: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
];

export function TransactionsTable() {
  return (
    <section className="animate-slide-up [animation-delay:200ms]">
      <div className="bg-card border border-border rounded-2xl overflow-hidden ring-1 ring-border">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Recent Transactions
          </h3>
          <div className="flex gap-2">
            <button className="px-3 py-1 text-[10px] font-medium border border-border rounded-md hover:bg-muted">
              Filter
            </button>
            <button className="px-3 py-1 text-[10px] font-medium border border-border rounded-md hover:bg-muted">
              Export CSV
            </button>
          </div>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted">
              <th className="px-6 py-3 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                Transaction ID
              </th>
              <th className="px-6 py-3 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                Date
              </th>
              <th className="px-6 py-3 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-[10px] font-mono text-muted-foreground uppercase tracking-wider text-right">
                Amount
              </th>
              <th className="px-6 py-3 text-[10px] font-mono text-muted-foreground uppercase tracking-wider text-right">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-muted transition-colors">
                <td className="px-6 py-4 font-mono text-xs">{r.id}</td>
                <td className="px-6 py-4 text-xs font-medium">{r.date}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${r.dot}`} />
                    <span className="text-xs">{r.type}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-xs font-bold text-right font-mono">
                  {r.amount}
                </td>
                <td className="px-6 py-4 text-right">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter border ${r.statusClass}`}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}


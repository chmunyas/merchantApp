import { ReactNode } from "react";

export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto" style={{ width: 390 }}>
      <div className="relative rounded-[3rem] border border-border bg-foreground p-3 shadow-2xl">
        <div className="relative overflow-hidden rounded-[2.4rem] bg-background h-[780px]">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-foreground rounded-b-2xl z-30" />
          {children}
        </div>
      </div>
      <p className="text-center mt-4 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        FX Engine Merchant Â· iOS / Android
      </p>
    </div>
  );
}


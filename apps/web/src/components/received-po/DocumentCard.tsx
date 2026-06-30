import type { ReactNode } from "react";

import { Card } from "@/src/components/ui/card";
import { cn } from "@/src/lib/cn";

interface DocumentCardProps {
  title: string;
  description: string;
  status: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export function DocumentCard({
  title,
  description,
  status,
  actions,
  children,
}: DocumentCardProps): JSX.Element {
  const normalizedStatus = status.trim().toLowerCase();
  const statusClassName =
    normalizedStatus === "final" || normalizedStatus === "done"
      ? "border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200"
      : normalizedStatus === "draft" ||
          normalizedStatus === "pending" ||
          normalizedStatus === "generating"
        ? "border-sky-500/25 bg-sky-500/12 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200"
        : normalizedStatus === "failed"
          ? "border-rose-500/25 bg-rose-500/12 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200"
          : "border-kira-warmgray/35 bg-kira-warmgray/20 text-kira-darkgray dark:border-white/10 dark:bg-white/10 dark:text-gray-300";
  const accentClassName = title.toLowerCase().includes("invoice")
    ? "from-[#fefcf5] via-[#faf5e8]/80 to-transparent dark:from-[#282218] dark:via-[#1e1a14]/60 dark:to-transparent"
    : title.toLowerCase().includes("barcode")
      ? "from-[#eefaf6] via-[#e3f4ee]/80 to-transparent dark:from-[#16261f] dark:via-[#131e18]/60 dark:to-transparent"
      : "from-[#f0f4f8] via-[#e8eef4]/80 to-transparent dark:from-[#1a2228] dark:via-[#151b20]/60 dark:to-transparent";
  const glyph = title.toLowerCase().includes("invoice")
    ? "IN"
    : title.toLowerCase().includes("barcode")
      ? "BC"
      : "PL";

  return (
    <Card className="relative flex h-full flex-col gap-5 overflow-hidden border border-kira-warmgray/20 p-0 shadow-[0_24px_70px_-45px_rgba(76,56,37,0.55)]">
      <div
        className={cn("absolute inset-0 bg-gradient-to-b pointer-events-none", accentClassName)}
      />
      <div className="relative flex items-start justify-between gap-4 px-5 pb-4 pt-5">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-black/5 bg-white/75 text-sm font-semibold tracking-[0.18em] text-kira-black shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-white">
            {glyph}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-kira-midgray">
              Document Workspace
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-kira-black dark:text-white">
              {title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-kira-darkgray dark:text-gray-300">
              {description}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
            statusClassName,
          )}
        >
          {status}
        </span>
      </div>
      {children ? <div className="relative space-y-4 px-5 pb-5">{children}</div> : null}
      {actions ? (
        <div className="relative mt-auto flex flex-wrap gap-2 border-t border-kira-warmgray/15 bg-black/[0.02] px-5 py-4 dark:border-white/10 dark:bg-white/[0.03]">
          {actions}
        </div>
      ) : null}
    </Card>
  );
}

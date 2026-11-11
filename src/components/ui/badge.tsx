import type { ComponentProps } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "muted";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-800 ring-slate-300",
  info: "bg-blue-50 text-blue-800 ring-blue-200",
  success: "bg-green-50 text-green-800 ring-green-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-300",
  danger: "bg-red-50 text-red-800 ring-red-200",
  muted: "bg-white text-slate-500 ring-slate-200",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold ring-1 ring-inset", TONE[tone], className)}
      {...props}
    />
  );
}

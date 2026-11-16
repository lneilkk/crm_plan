import { cn } from "./cn";

/** 불러오는 중 표시. label은 화면 읽기 프로그램용이며 보이게 하려면 showLabel을 켠다. */
export function Spinner({ label = "불러오는 중", showLabel = false, className }: { label?: string; showLabel?: boolean; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-slate-600", className)}>
      <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-700" />
      <span className={showLabel ? "" : "sr-only"}>{label}</span>
    </span>
  );
}

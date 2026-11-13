import type { ReactNode } from "react";
import { cn } from "./cn";

/** 목록이 비었을 때. action에 버튼을 넣을 수 있다. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 p-8 text-center", className)}>
      <p className="text-lg font-semibold text-slate-800">{title}</p>
      {description && <p className="text-slate-600">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

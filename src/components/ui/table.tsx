import type { ComponentProps } from "react";
import { cn } from "./cn";

/** 표. 좁은 화면에서는 가로로 스크롤된다. */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className={cn("w-full border-collapse text-left text-base", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-slate-50 text-sm text-slate-600", className)} {...props} />;
}

export function TBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-slate-100", className)} {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-slate-50", className)} {...props} />;
}

export function Th({ className, scope = "col", ...props }: ComponentProps<"th">) {
  return <th scope={scope} className={cn("px-3 py-2 font-semibold whitespace-nowrap", className)} {...props} />;
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-3 py-3 align-middle", className)} {...props} />;
}

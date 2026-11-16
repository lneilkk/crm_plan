import type { ComponentProps } from "react";
import { cn } from "./cn";

const FIELD =
  "block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 " +
  "placeholder:text-slate-400 focus:border-blue-600 focus:outline-2 focus:outline-blue-200 " +
  "disabled:bg-slate-100 aria-invalid:border-red-600";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("mb-1 block text-sm font-semibold text-slate-700", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(FIELD, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(FIELD, "pr-8", className)} {...props} />;
}

/** 입력칸 아래 오류 문구. id를 입력칸의 aria-describedby로 연결한다. */
export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return <p role="alert" className={cn("mt-1 text-sm font-medium text-red-700", className)} {...props} />;
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "치과 CRM",
  description: "예약 · 내원 확인 · 통계",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

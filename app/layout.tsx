import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "입시 컨설팅 대시보드",
  description:
    "미술·만화·웹툰·게임일러스트 계열 입시 상담을 위한 대학 추천 MVP",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

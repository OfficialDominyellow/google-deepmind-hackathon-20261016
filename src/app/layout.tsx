import type { Metadata } from "next";
import { Gowun_Batang, Gaegu } from "next/font/google";
import "./globals.css";

const gowunBatang = Gowun_Batang({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-body",
});

const gaegu = Gaegu({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-hand",
});

export const metadata: Metadata = {
  title: "My Little Picasso — Memories, Drawn from Life.",
  description:
    "실제 가족 사진의 사실과 시간의 흐름을 이해하여 따뜻한 크레용 그림일기로 보존하는 자율형 멀티모달 AI 메모리 에이전트",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${gowunBatang.variable} ${gaegu.variable}`}>
      <body className="min-h-screen antialiased selection:bg-[#D9A441]/30 selection:text-[#3A2E25]">
        {children}
      </body>
    </html>
  );
}


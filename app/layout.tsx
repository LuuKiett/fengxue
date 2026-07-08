import type { Metadata } from "next";
import { Nunito, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "FengXue - Học Tiếng Trung Mỗi Ngày",
  description: "Trang web học tiếng Trung sinh động, dễ thương và hiệu quả qua Flashcards và trò chơi nối từ vui nhộn.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${nunito.variable} ${notoSansSC.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-nunito bg-slate-50 text-slate-800">
        {children}
      </body>
    </html>
  );
}

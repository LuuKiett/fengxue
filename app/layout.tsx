import type { Metadata } from "next";
import { Nunito, Noto_Serif_TC } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

// Traditional Chinese serif — matches the font monchinese.me uses for hanzi (--font-hanzi
// there defaults to Noto Serif TC). Previously this was Noto Sans SC, which is both the
// wrong script region (Simplified, not Traditional — this app teaches TOCFL/Taiwan content)
// and the wrong style (sans, template uses serif).
const notoSerifTC = Noto_Serif_TC({
  variable: "--font-noto-serif-tc",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
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
      className={`${nunito.variable} ${notoSerifTC.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-nunito bg-slate-50 text-slate-800">
        {children}
      </body>
    </html>
  );
}

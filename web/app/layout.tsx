import { Providers } from "@/app/providers";
import type { Metadata } from "next";
import { Libre_Franklin, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const libreFranklin = Libre_Franklin({
  subsets: ["latin"],
  variable: "--font-libre-franklin",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NewsWithFriends",
  description: "Read the news with your friends. Sources, feeds, stars, and comments.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${libreFranklin.variable} ${sourceSerif.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

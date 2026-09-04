import { Providers } from "@/app/providers";
import type { Metadata, Viewport } from "next";
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
  description:
    "Read the news with your friends. Sources, feeds, stars, and comments.",
  // iOS reads none of the manifest for the home screen tile: the icon comes
  // from app/apple-icon.png and the label from `title` here, which is why
  // it is set separately and short enough not to be truncated.
  appleWebApp: {
    capable: true,
    title: "NewsWithFriends",
    statusBarStyle: "default",
  },
};

/**
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` mean anything.
 *
 * Next's default viewport meta omits it, and without it iOS lays the page out
 * inside the safe area and reports every inset as 0 — so the ~18 places in
 * this app that pad for the notch or the home indicator were all quietly
 * evaluating to zero. It matters most in a home-screen web app, which has no
 * browser chrome between the page and the physical edges of the display.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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

import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// IBM Plex Sans is drawn for financial and enterprise interfaces: unambiguous
// digits, a 6 and 8 that never read as each other, and a neutral voice that
// stays out of the way of the numbers.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Squared — Split expenses, settle up for real",
  description:
    "Track shared expenses with friends and settle balances with real bank transfers through Stripe.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

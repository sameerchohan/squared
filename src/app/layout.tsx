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

// Runs before first paint, so a saved theme is applied while the HTML is
// still parsing. Reading it in an effect instead would render the default
// theme first and visibly flash to the chosen one on hydration.
const NO_FLASH_THEME = `
try {
  var t = localStorage.getItem("squared-theme");
  if (t === "light" || t === "dark") {
    document.documentElement.setAttribute("data-theme", t);
  }
} catch (e) {}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import PipelineBoot from "@/components/PipelineBoot";

const heebo = Heebo({ variable: "--font-heebo", subsets: ["hebrew", "latin"] });

export const metadata: Metadata = {
  title: "מחברת שיעורים",
  description: "הקלטה, תמלול, סיכום ומבחנים לכל שיעור — ומחברת אחת לכל קורס",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "מחברת", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body className={`${heebo.variable} font-sans antialiased min-h-dvh`}>
        <PipelineBoot />
        <header className="no-print sticky top-0 z-30 backdrop-blur bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] border-b border-soft">
          <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-extrabold text-lg">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-brand-600 text-white">📓</span>
              מחברת שיעורים
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6 pb-28">{children}</main>
      </body>
    </html>
  );
}

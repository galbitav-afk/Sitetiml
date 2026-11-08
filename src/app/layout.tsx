import type { Metadata, Viewport } from "next";
import { Heebo, Frank_Ruhl_Libre } from "next/font/google";
import "./globals.css";
import Providers from "@/components/providers";
import AppShell from "@/components/app-shell";

const heebo = Heebo({ variable: "--font-heebo", subsets: ["hebrew", "latin"] });
const frank = Frank_Ruhl_Libre({ variable: "--font-frank", subsets: ["hebrew", "latin"], weight: ["500", "700", "900"] });

export const metadata: Metadata = {
  title: { default: "הממלכה של גל", template: "%s · הממלכה של גל" },
  description: "מקליטים שיעור, ומקבלים תמלול, סיכום, מבחן, כרטיסיות ומחברת קורס.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  appleWebApp: { capable: true, title: "הממלכה של גל", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6fb" },
    { media: "(prefers-color-scheme: dark)", color: "#100d17" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body className={`${heebo.variable} ${frank.variable} font-sans antialiased min-h-dvh`}>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

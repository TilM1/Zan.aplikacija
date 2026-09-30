import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa/pwa-register";
import { Inter, Montserrat } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });
const montserrat = Montserrat({ subsets: ["latin", "latin-ext"], variable: "--font-montserrat", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: "CoreMark CRM", template: "%s · CoreMark CRM" },
  description: "CoreMark – interni CRM za svetovanje in prodajo zavarovanj",
  robots: { index: false, follow: false },
  applicationName: "CoreMark CRM",
  appleWebApp: { capable: true, title: "CoreMark", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#161616",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sl" className={`${inter.variable} ${montserrat.variable}`}>
      <body className="font-sans">
        {children}
        <Toaster position="top-right" richColors closeButton />
        <PwaRegister />
      </body>
    </html>
  );
}

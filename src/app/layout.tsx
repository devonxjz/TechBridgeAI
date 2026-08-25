import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin", "vietnamese"],
});

export const metadata: Metadata = {
  title: "PartnerIQ — Company Intelligence Agent",
  description:
    "AI-powered company research and profiling. Automatically discover, analyze, and track Vietnamese businesses.",
  icons: {
    icon: [
      { url: "/logo-icon.png", type: "image/png" },
      { url: "/favicon.ico" },
    ],
    shortcut: "/logo-icon.png",
    apple: "/logo-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}

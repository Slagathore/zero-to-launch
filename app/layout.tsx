import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Zero-to-Launch — Campaign Launch Agent",
  description: "Drop in an affiliate offer, get a launch-ready campaign package: brief, angles, compliant copy, and a live advertorial.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <footer className="mt-auto border-t border-neutral-500/15 px-5 py-4 text-center text-xs text-neutral-400">
          © 2026 Charles Chambers. Demonstration build for evaluation purposes; all rights reserved.
          Not licensed for reproduction.
        </footer>
        <Analytics />
      </body>
    </html>
  );
}

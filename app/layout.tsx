import type { Metadata } from "next";
import "./globals.css";
import {PUBLIC_SITE_ORIGIN} from "../lib/site-security.mjs";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_ORIGIN),
  title: "IncidOSINT — UK & Ireland",
  description: "A non-commercial UK and Ireland aircraft and rescue-vessel map with public tracking feeds, satellite imagery and documented emergency-service bases.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

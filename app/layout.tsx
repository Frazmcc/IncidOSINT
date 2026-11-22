import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Emergency Air & Sea — UK & Ireland",
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

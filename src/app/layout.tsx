import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";

import "@/app/globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans"
});

const serif = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif"
});

export const metadata: Metadata = {
  title: "Odoo Image Library",
  description:
    "Upload a spreadsheet with product names and an image column, match pictures to the right products, and export image links for Odoo.",
  icons: {
    icon: "/odoo-logo.png",
    shortcut: "/odoo-logo.png",
    apple: "/odoo-logo.png"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}

import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Manrope, Playfair_Display } from "next/font/google";

import "@/app/globals.css";

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans"
});

const serif = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif"
});

export const metadata: Metadata = {
  title: "Product Image Automation",
  description:
    "Upload spreadsheets and image libraries, auto-match products, remove backgrounds, and export clean ecommerce-ready image URLs."
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

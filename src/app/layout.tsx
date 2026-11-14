import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { template: "%s · Fatura Desk", default: "Fatura Desk" },
  description: "Billing · Inventory · Accounts",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body className={`${inter.variable} antialiased`}>{children}</body>
    </html>
  );
}

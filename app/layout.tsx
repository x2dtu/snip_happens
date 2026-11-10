import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Snip Happens",
  description: "A cooperative wire-cutting deduction game for 2-5 players.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

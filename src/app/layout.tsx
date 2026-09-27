import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Facturas Muji · File renamer",
  description:
    "A little order for your invoices. Rename a folder of files in one sequence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

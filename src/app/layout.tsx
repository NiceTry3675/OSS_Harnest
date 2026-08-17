import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harnest",
  description: "A blueprint workbench for self-improving AI outputs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

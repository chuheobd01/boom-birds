import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eggoria",
  description:
    "Reserve a mysterious Eggoria egg and begin your journey across five magical lands.",
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

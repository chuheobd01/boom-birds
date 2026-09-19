import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

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
      <head>
        <link rel="preload" href="/assets/landing/egg.png" as="image" type="image/png" />
        <link rel="preload" href="/assets/landing/island.png" as="image" type="image/png" />
        <link rel="preload" href="/assets/landing/button.png" as="image" type="image/png" />
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}

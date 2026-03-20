import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campaign AI",
  description: "B2B Campaign Pipeline",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#08080f] text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}

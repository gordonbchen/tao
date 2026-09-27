import type { Metadata } from "next";
import "@fontsource/libertinus-serif/latin-400.css";
import "@fontsource/libertinus-serif/latin-600.css";
import "@fontsource/libertinus-serif/latin-700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tao - Home",
  description: "Course-aware practice for the things you are learning.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

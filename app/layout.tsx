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
    // Before the first paint, the script applies the stored theme and marks whether the subject chat is open, so the
    // subject page is laid out at its final width. It changes <html>, so hydration warnings are suppressed there.
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `try{const d=document.documentElement.dataset;if(localStorage.getItem("tao-theme")==="dark")d.theme="dark";d.subjectChat=localStorage.getItem("tao-subject-chat")==="true"}catch{}` }} /></head>
      <body>{children}</body>
    </html>
  );
}

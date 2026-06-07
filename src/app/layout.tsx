import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import AmbientBackground from "@/components/AmbientBackground";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "QuizForge — Turn anything into a quiz",
  description:
    "Paste any notes, article, PDF, or YouTube video and get an instant AI-generated quiz — using only your material.",
};

// Explicit viewport so every page renders at device width on mobile (375px and
// up). We deliberately DO NOT set maximumScale/userScalable — blocking zoom is a
// WCAG failure. themeColor matches the app's deepest background (--bg-deep).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#060608",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AmbientBackground />
        {children}
      </body>
    </html>
  );
}

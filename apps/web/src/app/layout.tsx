import "./globals.css";
import type { Metadata } from "next";
import GlobalNav from "./GlobalNav";
import FeedbackWidget from "./components/FeedbackWidget";

export const metadata: Metadata = {
  title: "Other Library",
  description: "You like the books?!",
  openGraph: {
    title: "Other Library",
    description: "You like the books?!",
    siteName: "other-library.com"
  },
  twitter: {
    card: "summary",
    title: "Other Library",
    description: "You like the books?!"
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <GlobalNav />
        <FeedbackWidget />
        {children}
      </body>
    </html>
  );
}

import "./globals.css";
import type { Metadata } from "next";
import GlobalNav from "./GlobalNav";
import FeedbackWidget from "./components/FeedbackWidget";

export const metadata: Metadata = {
  title: "You like the books?!",
  description: "A minimal social book catalog.",
  openGraph: {
    title: "You like the books?!",
    description: "A minimal social book catalog.",
    siteName: "Other Library"
  },
  twitter: {
    card: "summary",
    title: "You like the books?!",
    description: "A minimal social book catalog."
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

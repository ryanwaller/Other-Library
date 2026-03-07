import "./globals.css";
import type { Metadata } from "next";
import GlobalNav from "./GlobalNav";
import FeedbackWidget from "./components/FeedbackWidget";
import { SITE_TITLE } from "../lib/pageTitle";

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: `${SITE_TITLE} – %s`
  },
  description: "You like the books?!",
  openGraph: {
    title: SITE_TITLE,
    description: "You like the books?!",
    siteName: "other-library.com"
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
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

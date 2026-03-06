import "./globals.css";
import GlobalNav from "./GlobalNav";
import FeedbackWidget from "./components/FeedbackWidget";

export const metadata = {
  title: "Other Library",
  description: "A minimal social book catalog."
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

import "./globals.css";
import GlobalNav from "./GlobalNav";

export const metadata = {
  title: "OM Library",
  description: "A minimal social book catalog."
};

export const viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <GlobalNav />
        {children}
      </body>
    </html>
  );
}

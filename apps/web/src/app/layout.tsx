import "./globals.css";
import GlobalNav from "./GlobalNav";
import NextTopLoader from "nextjs-toploader";

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
        <NextTopLoader
          color="#e8e8ea"
          height={2}
          showSpinner={false}
          shadow={false}
          easing="ease"
          speed={200}
        />
        <GlobalNav />
        {children}
      </body>
    </html>
  );
}

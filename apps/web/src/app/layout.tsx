import "./globals.css";

export const metadata = {
  title: "OM Library",
  description: "A minimal social book catalog."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


import type { ReactNode } from "react";

export const metadata = { title: "Tickets" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", margin: "1rem" }}>{children}</body>
    </html>
  );
}

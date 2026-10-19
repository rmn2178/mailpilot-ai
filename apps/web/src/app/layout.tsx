import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MailPilot AI",
  description:
    "AI email generation, review, approval and Gmail delivery platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

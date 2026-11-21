import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name}: WhatsApp alerts for Google Forms`, template: `%s · ${site.name}` },
  description:
    "Get an instant WhatsApp message every time someone submits your Google Form, and optionally auto-reply to the respondent on WhatsApp.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <div className="wrap nav-inner">
            <Link href="/" className="brand">
              <span className="logo" aria-hidden>●</span> {site.name}
            </Link>
            <nav>
              <Link href="/#pricing">Pricing</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <div className="wrap footer-inner">
            <span>© {new Date().getFullYear()} {site.company}</span>
            <span>
              <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link> ·{" "}
              <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}

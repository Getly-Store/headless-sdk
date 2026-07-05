import type { Metadata } from "next";
import { STORE_SLUG } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${STORE_SLUG} — storefront`,
    template: `%s — ${STORE_SLUG}`,
  },
  description: `Digital products by ${STORE_SLUG}, powered by Getly.`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="page">
          {children}
          <footer className="footer">
            <p>
              Powered by{" "}
              <a
                href="https://www.getly.store"
                target="_blank"
                rel="noopener noreferrer"
              >
                Getly
              </a>
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}

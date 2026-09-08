import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { ServiceWorkerRegister } from './sw-register';
import { env } from '@/lib/env';

const inter = Inter({ subsets: ['latin'] });

/**
 * The defaults every page inherits — which, until now, described the wrong product.
 *
 * The old title and description were written for the signed-in dashboard, and
 * because no public page overrides them in full, that dashboard copy is what
 * `/privacy`, `/terms`, `/ai-disclosure`, `/data-processing` and `/login` all
 * served to Google: one identical title across five URLs, describing an
 * internal tool to people who had not signed up. A `template` fixes that at the
 * root rather than asking every future page to remember.
 *
 * `metadataBase` is the load-bearing addition. Without it Next cannot resolve a
 * relative canonical or Open Graph URL, so both are silently dropped in
 * production — which is why the pricing page shipped with neither. It is read
 * from the environment, not typed, so a hostname change moves the canonicals
 * with it instead of leaving them pointing at a host we no longer serve.
 */
export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  title: {
    default: 'Switch & Save — AI customer chat for UK small businesses',
    template: '%s — Switch & Save',
  },
  // No price in here. This description is inherited by every page that does not
  // set its own — including the legal pages — and a figure typed at the root is
  // one nobody remembers to change when the catalogue is repriced. The pages
  // that genuinely need a number (the homepage, /pricing) build their own
  // description from `getPublicPricing()`, which reads the same table Stripe
  // charges from.
  description:
    'AI chat and a shared inbox for UK small businesses. Flat monthly pricing in pounds including VAT — no per-seat fees and no charge per AI answer. Your data is stored in the UK.',
  applicationName: 'Switch & Save',
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    siteName: 'Switch & Save',
    locale: 'en_GB',
    title: 'Switch & Save — AI customer chat for UK small businesses',
    description:
      'AI chat and a shared inbox for UK small businesses. Flat pricing from £19 a month including VAT. Data stored in the UK.',
  },
  twitter: { card: 'summary_large_image' },
  appleWebApp: { capable: true, title: 'Agent Inbox', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Module 22: reconciled to the one brand blue. This is the hex form of
  // `--primary` (214 94% 47%) in globals.css — the browser chrome cannot read
  // a CSS variable here, so it is restated, but it is no longer a fourth blue.
  themeColor: '#0769e9',
};

// `lang` is en-GB, not en: every price on this site is in pounds and the whole
// proposition is UK hosting, so the document should say which English it is
// written in.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

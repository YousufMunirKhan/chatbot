import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { ServiceWorkerRegister } from './sw-register';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Switch & Save AI Assistant',
  description: 'Switch & Save AI assistant dashboard for customer chat, leads, appointments, and business support.',
  appleWebApp: { capable: true, title: 'Agent Inbox', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#045fff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { loadBotByPublicId } from '@/lib/ai/engine';
import { embedVisitorId, verifyIdentity } from '@/lib/embed/identity';
import { getBotEmbedSecret } from '@/lib/embed/secret';
import { EmbedChat } from '@/components/embed/embed-chat';

/**
 * Full-screen chat for a native host app's WebView (the mobile embed kit).
 *
 * Deliberately not inside the (dashboard) group and deliberately not the
 * website widget: no launcher, no bubble, no dashboard chrome, and nothing that
 * assumes a signed-in staff user. The host app supplies the frame — a view
 * controller or an Activity — and this fills it edge to edge.
 *
 * Identity is verified HERE, on the server, before a single byte reaches the
 * browser. A host app can put anything it likes in the query string; only a
 * correctly signed `user_id` becomes a real identity, and everything else is
 * quietly anonymous rather than rejected.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The host app owns the screen; pinch-zooming a chat inside it is never
  // wanted, and `viewport-fit=cover` is what makes env(safe-area-inset-*) real.
  maximumScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  // A chat session inside somebody's app has no business in a search index.
  robots: { index: false, follow: false },
};

interface EmbedSearchParams {
  user_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  locale?: string;
  signature?: string;
  /** `?close=0` hides the close control for hosts with their own nav bar. */
  close?: string;
}

function Unavailable({ message }: { message: string }) {
  return (
    <main className="flex h-[100dvh] flex-col items-center justify-center gap-2 bg-white px-6 text-center">
      <h1 className="text-base font-semibold text-slate-900">Chat is unavailable</h1>
      <p className="max-w-sm text-sm text-slate-600">{message}</p>
    </main>
  );
}

export default async function MobileEmbedPage({
  params,
  searchParams,
}: {
  params: { publicBotId: string };
  searchParams?: EmbedSearchParams;
}) {
  const bot = await loadBotByPublicId(params.publicBotId);
  if (!bot) {
    return <Unavailable message="This chat link is not valid. Check the assistant id in your app's configuration." />;
  }
  if (bot.assistantAudience === 'internal') {
    // Same rule the widget and /api/chat enforce: an internal help-desk
    // assistant is for staff, and must never be reachable from a customer app.
    return <Unavailable message="This assistant is for internal use and cannot be opened from a customer app." />;
  }

  const secret = await getBotEmbedSecret({ botId: bot.id, companyId: bot.companyId });
  const identity = verifyIdentity(
    {
      userId: searchParams?.user_id,
      name: searchParams?.name,
      email: searchParams?.email,
      phone: searchParams?.phone,
      locale: searchParams?.locale,
      signature: searchParams?.signature,
    },
    secret,
  );

  const appearance = bot.appearance ?? {};
  const language = identity.locale ?? (bot.languageDefault === 'ar' ? 'ar' : 'en');

  return (
    <>
      {/* A plain tag, not next/script: this must be a blocking, ordinary
          script in the document so `window.ChatBridge` exists before React
          hydrates and the first `ready` event cannot be dropped. `beforeInteractive`
          is only honoured in the root layout, which this page does not own. */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script src="/sdk/mobile/embed-bridge.js" />
      <EmbedChat
        publicBotId={params.publicBotId}
        title={(appearance.title as string) || bot.name || 'Chat'}
        welcomeMessage={
          (appearance.welcomeMessage as string) ||
          'Hi! Ask me anything — I can help with orders, bookings, and support.'
        }
        primaryColor={(appearance.primaryColor as string) || '#0769e9'}
        agentLabel={(appearance.agentLabel as string) || 'Team'}
        footerNote={
          (appearance.footerBranding as string) ||
          'AI assistant may be inaccurate. We may use messages and contact details to respond to your enquiry.'
        }
        identityStatus={identity.status}
        visitorId={identity.status === 'verified' ? embedVisitorId(identity, '') : null}
        displayName={identity.name}
        direction={language.startsWith('ar') ? 'rtl' : 'ltr'}
        showClose={searchParams?.close !== '0'}
      />
    </>
  );
}

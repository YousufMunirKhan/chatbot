import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 text-[13px]">{children}</code>;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {n}
      </span>
      <span className="text-sm leading-relaxed">{children}</span>
    </li>
  );
}

/**
 * In-dashboard "Connect WhatsApp" guide. Native <details> so it needs no JS.
 * Webhook paths are shown relative — prepend the company's app domain.
 */
export function WhatsAppSetupGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How to connect WhatsApp</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Connect your business WhatsApp number once — then every customer who messages it is answered automatically.
          Pick the path that suits you. (Your webhook base URL is{' '}
          <Code>https://your-app-domain</Code> — replace with your live domain.)
        </p>

        <details className="rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Option A — Meta WhatsApp Cloud API (direct, recommended)
          </summary>
          <ol className="mt-3 space-y-3">
            <Step n={1}>
              Go to <Code>business.facebook.com</Code> → create (or open) a <strong>Meta Business Account</strong>.
            </Step>
            <Step n={2}>
              At <Code>developers.facebook.com</Code> → <strong>Create App</strong> → type <strong>Business</strong> →
              add the <strong>WhatsApp</strong> product.
            </Step>
            <Step n={3}>
              Add a <strong>dedicated phone number</strong> for the bot. ⚠️ It must <strong>not</strong> already be in
              use in the normal WhatsApp / WhatsApp Business phone app.
            </Step>
            <Step n={4}>
              In <strong>WhatsApp → API setup</strong>, copy the <strong>Phone number ID</strong> and a{' '}
              <strong>permanent access token</strong> (System User token with{' '}
              <Code>whatsapp_business_messaging</Code>).
            </Step>
            <Step n={5}>
              In the form on this page: Channel = <strong>WhatsApp</strong>, Provider ={' '}
              <strong>Meta WhatsApp Cloud API</strong>, paste the <strong>Phone number ID</strong> into{' '}
              <em>WhatsApp phone number ID</em> and the token into <em>Access token</em>. Save.
            </Step>
            <Step n={6}>
              In Meta → <strong>WhatsApp → Configuration → Webhook</strong>, set the Callback URL to{' '}
              <Code>https://your-app-domain/api/webhooks/whatsapp</Code> and the Verify token to your{' '}
              <Code>WHATSAPP_VERIFY_TOKEN</Code> env value. Subscribe to the <strong>messages</strong> field.
            </Step>
            <Step n={7}>
              Send a test message to the number — the bot replies. Done.
            </Step>
          </ol>
        </details>

        <details className="rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Option B — Twilio (faster, no Meta verification)
          </summary>
          <ol className="mt-3 space-y-3">
            <Step n={1}>
              Create a <Code>twilio.com</Code> account and open <strong>Messaging → Try it out → WhatsApp</strong> (or a
              purchased WhatsApp sender).
            </Step>
            <Step n={2}>
              Copy your <strong>WhatsApp sender number</strong> (the number customers will message, e.g.{' '}
              <Code>+14155551234</Code>).
            </Step>
            <Step n={3}>
              In the form: Channel = <strong>WhatsApp</strong>, Provider = <strong>Twilio</strong>, paste the number
              into <em>Business WhatsApp number</em>. No token needed for replies. Save.
            </Step>
            <Step n={4}>
              In Twilio, on the WhatsApp Sandbox / sender settings, set <strong>“When a message comes in”</strong> to{' '}
              <Code>https://your-app-domain/api/webhooks/twilio</Code> with method <strong>HTTP POST</strong>.
            </Step>
            <Step n={5}>
              Message the Twilio number — the bot replies inline. Done.
            </Step>
          </ol>
        </details>

        <p className="text-xs text-muted-foreground">
          Note: the bot can freely reply to anyone who messages within 24 hours. To message a customer{' '}
          <strong>first</strong> (campaigns), Meta requires a pre-approved template — see Broadcasts.
        </p>
      </CardContent>
    </Card>
  );
}

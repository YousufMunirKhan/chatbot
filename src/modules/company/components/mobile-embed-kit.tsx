'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { CopyButton } from '@/components/copy-button';
import { FormMessage } from '@/components/ui/form-message';
import {
  TAB_ITEM,
  TAB_ITEM_IDLE,
  TAB_ITEM_SELECTED,
  TAB_LIST,
  TAB_SCROLLER,
} from '@/components/ui/tab-styles';
import {
  regenerateEmbedSecretAction,
  revealEmbedSecretAction,
  type MobileEmbedActionState,
} from '../mobile-embed-actions';
import type { MobileEmbedBot } from '../mobile-embed-data';

/**
 * "Put this chat inside your own app" — the mobile half of the install panel,
 * sitting next to the one-line website snippet it mirrors.
 *
 * The whole integration is a URL, so the URL is the hero. The signing secret is
 * the only dangerous thing on the page, so it stays hidden until asked for and
 * is never rendered into the server response.
 */

const initial: MobileEmbedActionState = {};

const PLATFORMS = [
  { key: 'android', label: 'Android' },
  { key: 'ios', label: 'iOS' },
  { key: 'signing', label: 'Signing the customer id' },
] as const;

type PlatformKey = (typeof PLATFORMS)[number]['key'];

function Snippet({ code, label }: { code: string; label: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function RevealButton({ hasSecret }: { hasSecret: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Working…' : hasSecret ? 'Show signing secret' : 'Create signing secret'}
    </Button>
  );
}

function androidSnippet(embedUrl: string): string {
  return `// build.gradle: no dependency needed — this is the platform WebView.
val webView = findViewById<WebView>(R.id.chatWebView)
webView.settings.javaScriptEnabled = true
webView.settings.domStorageEnabled = true      // the chat keeps its visitor id here
webView.settings.mediaPlaybackRequiresUserGesture = false
webView.addJavascriptInterface(ChatBridge(this), "AndroidChatBridge")
webView.loadUrl("${embedUrl}")`;
}

function iosSnippet(embedUrl: string): string {
  return `let config = WKWebViewConfiguration()
config.userContentController.add(self, name: "chatBridge")   // must be "chatBridge"
config.allowsInlineMediaPlayback = true

let webView = WKWebView(frame: .zero, configuration: config)
webView.load(URLRequest(url: URL(string: "${embedUrl}")!))`;
}

function signingSnippet(embedUrl: string): string {
  return `# On YOUR server — never in the app binary.
# The signature is HMAC-SHA256 of the customer id, keyed with the signing secret.

signature = HMAC_SHA256(key = BOT_SIGNING_SECRET, message = customer_id).hex()

# Then open, in the WebView:
${embedUrl}?user_id=<customer_id>&name=<name>&email=<email>&signature=<signature>

# No signature? The chat still works — the customer is simply anonymous.`;
}

export function MobileEmbedKit({ bots }: { bots: MobileEmbedBot[] }) {
  const [platform, setPlatform] = useState<PlatformKey>('android');
  const [selected, setSelected] = useState(0);
  const [revealState, revealAction] = useFormState(revealEmbedSecretAction, initial);
  const [regenerateState, regenerateAction] = useFormState(regenerateEmbedSecretAction, initial);

  const bot = bots[Math.min(selected, bots.length - 1)];
  if (!bot) return null;
  const secret = regenerateState.secret ?? revealState.secret ?? null;

  return (
    <div className="space-y-4">
      {bots.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {bots.map((candidate, index) => (
            <Button
              key={candidate.botId}
              type="button"
              size="sm"
              variant={index === selected ? 'default' : 'outline'}
              onClick={() => setSelected(index)}
            >
              {candidate.name}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="space-y-2 rounded-md border p-4">
        <p className="text-sm font-medium">Chat address for your app</p>
        <p className="text-xs text-muted-foreground">
          Load this in a WebView (Android) or WKWebView (iOS). It is a full-screen chat with no
          website chrome, sized for a phone and aware of the notch and home indicator.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">
            {bot.embedUrl}
          </code>
          <CopyButton value={bot.embedUrl} label="Copy address" />
          <Button asChild variant="ghost" size="sm">
            <a href={bot.embedUrl} target="_blank" rel="noopener noreferrer">
              Preview
            </a>
          </Button>
        </div>
      </div>

      <div className={TAB_SCROLLER}>
        <div className={TAB_LIST} role="tablist">
          {PLATFORMS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={platform === entry.key}
              onClick={() => setPlatform(entry.key)}
              className={`${TAB_ITEM} ${platform === entry.key ? TAB_ITEM_SELECTED : TAB_ITEM_IDLE}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {platform === 'android' ? (
        <Snippet label="Kotlin — Activity or Fragment" code={androidSnippet(bot.embedUrl)} />
      ) : null}
      {platform === 'ios' ? (
        <Snippet label="Swift — UIViewController" code={iosSnippet(bot.embedUrl)} />
      ) : null}
      {platform === 'signing' ? (
        <div className="space-y-4">
          <Snippet label="Identity handoff" code={signingSnippet(bot.embedUrl)} />

          <div className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Signing secret</p>
                <p className="text-xs text-muted-foreground">
                  {bot.hasSecret
                    ? 'Created. Keep it on your server only — anyone holding it can claim to be any of your customers.'
                    : 'Not created yet. Without one, every customer who opens the chat from your app is anonymous.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <form action={revealAction}>
                  <input type="hidden" name="botId" value={bot.botId} />
                  <RevealButton hasSecret={bot.hasSecret} />
                </form>
                {bot.hasSecret ? (
                  <form action={regenerateAction}>
                    <input type="hidden" name="botId" value={bot.botId} />
                    {/* This was a one-click "Regenerate" whose damage was only
                        described in an alert that appeared afterwards. The
                        button now names the consequence, and ConfirmSubmit
                        arms it first — the same two-step every other
                        irreversible control in the app uses. */}
                    <ConfirmSubmit
                      label="Replace secret — breaks apps already shipped"
                      confirmLabel="Yes, replace it"
                      pendingLabel="Replacing…"
                      question="Every app build signed with the current secret stops being trusted the moment you do this. Those customers keep chatting, but anonymously, until your server is updated with the new secret."
                    />
                  </form>
                ) : null}
              </div>
            </div>

            {secret ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">
                  {secret}
                </code>
                <CopyButton value={secret} label="Copy secret" />
              </div>
            ) : null}

            <FormMessage state={revealState} okText={revealState.okText ?? 'Secret shown above.'} />
            <FormMessage
              state={regenerateState}
              okText={regenerateState.okText ?? 'Secret replaced.'}
            />

            {/* Standing warning, shown while the button is still unclicked —
                it used to appear only in the response to the click it was
                warning about. */}
            {bot.hasSecret && !regenerateState.secret ? (
              <Alert
                tone="warning"
                title="Replacing this secret breaks every app build already shipped"
              >
                Signatures made with the current secret stop verifying the moment it is replaced.
                Customers on app versions that have not been updated keep chatting, but without
                their name attached, until your server sends the new secret.
              </Alert>
            ) : null}

            {regenerateState.secret ? (
              <Alert
                tone="warning"
                title="Done — every app build using the old secret is now anonymous"
              >
                Signatures made with the previous secret no longer verify. Update your server, and
                customers on old app versions will keep chatting — just without their name attached.
              </Alert>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Full copy-and-paste guides — file uploads from the camera, external links, and forwarding
        push notifications through FCM and APNs — are in{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">docs/MOBILE_EMBED.md</code> in the
        codebase. Send it to whoever builds your app.
      </p>
    </div>
  );
}

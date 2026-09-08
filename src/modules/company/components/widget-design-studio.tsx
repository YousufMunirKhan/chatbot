'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useFormState } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { cn } from '@/lib/utils';
import type { BotRow, CompanyProfile } from '../data';
import { updateWidgetDesignAction, type WidgetDesignActionState } from '../widget-design-actions';
import { WidgetEmbedInstructions } from './widget-embed-instructions';
import { CHECKBOX, CHOICE_CARD, CHOICE_GRID, FIELD_GRID, TOGGLE_GRID } from './form-layout';

type PreviewMode = 'desktop' | 'mobile';
type PreviewBg = 'light' | 'dark' | 'brand';

const initial: WidgetDesignActionState = {};

/**
 * Wording for the two preview toggles.
 *
 * Both printed their state value straight onto the button, so the row read
 * "desktop mobile light dark brand". The background names say what kind of
 * website is being mocked behind the widget, which is the question the toggle
 * exists to answer — `brand` in particular is a tinted page, not the company's
 * own brand colour.
 */
const PREVIEW_MODE_LABELS: Record<PreviewMode, string> = {
  desktop: 'On a computer',
  mobile: 'On a phone',
};

const PREVIEW_BG_LABELS: Record<PreviewBg, string> = {
  light: 'Pale website',
  dark: 'Dark website',
  brand: 'Tinted website',
};

const themePresets = [
  { name: 'Switch blue', color: '#045fff', headerText: '#ffffff', dot: '#ef4444', style: 'solid' },
  { name: 'Clean black', color: '#111827', headerText: '#ffffff', dot: '#22c55e', style: 'solid' },
  { name: 'Retail green', color: '#16a34a', headerText: '#ffffff', dot: '#f97316', style: 'solid' },
  {
    name: 'Premium dark',
    color: '#0f172a',
    headerText: '#ffffff',
    dot: '#38bdf8',
    style: 'gradient',
  },
  {
    name: 'Friendly teal',
    color: '#0891b2',
    headerText: '#ffffff',
    dot: '#f43f5e',
    style: 'solid',
  },
] as const;

/**
 * Pre-chat form and out-of-hours wording.
 *
 * These are the one part of this screen that is NOT stored in the assistant's
 * `appearance_json`, so they do not ride along with the design form's save.
 * They belong to the company (one answer to "do we ask strangers for an email",
 * however many assistants there are), they live in `widget_prechat_settings`,
 * and they are read and written through `/api/widget/settings` — the design
 * studio is already one `<form>` from top to bottom and a second one cannot be
 * nested inside it.
 */
type ContactSettings = {
  prechatEnabled: boolean;
  prechatAskName: boolean;
  prechatAskEmail: boolean;
  prechatAskPhone: boolean;
  prechatRequired: boolean;
  prechatAllowSkip: boolean;
  prechatTitle: string;
  prechatIntro: string;
  prechatButtonLabel: string;
  offlineEnabled: boolean;
  offlineMessage: string;
  offlineFormEnabled: boolean;
  offlineButtonLabel: string;
};

const CONTACT_DEFAULTS: ContactSettings = {
  prechatEnabled: false,
  prechatAskName: true,
  prechatAskEmail: true,
  prechatAskPhone: false,
  prechatRequired: true,
  prechatAllowSkip: true,
  prechatTitle: 'Before we start',
  prechatIntro: 'Leave your details and we can pick this up again if we get cut off.',
  prechatButtonLabel: 'Start chat',
  offlineEnabled: true,
  offlineMessage:
    'We are closed at the moment. Leave your details and we will reply as soon as we are back.',
  offlineFormEnabled: true,
  offlineButtonLabel: 'Leave a message',
};

/**
 * The embed tag as the customer will paste it.
 *
 * The page that builds the snippet still emits a plain blocking `<script>`, and
 * a blocking tag holds up the render of every page it is pasted into. Nothing
 * in `widget.js` needs to run before the page has parsed, so the copy button
 * hands out the async form.
 */
function asyncEmbed(embed: string): string {
  if (/<script[^>]*\basync\b/.test(embed)) return embed;
  return embed.replace(/<script\b/, '<script async');
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function initials(text: string): string {
  const parts = text
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9 ]/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'AI';
  const first = parts[0] ?? 'A';
  const second = parts[1] ?? first;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? 'A'}${second[0] ?? 'I'}`.toUpperCase();
}

export function WidgetDesignStudio({
  bot,
  company,
  embed,
}: {
  bot: BotRow;
  company: CompanyProfile;
  embed: string;
}) {
  const [state, formAction] = useFormState(updateWidgetDesignAction, initial);
  const a = bot.appearance ?? {};
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');
  const [previewBg, setPreviewBg] = useState<PreviewBg>('light');
  const [title, setTitle] = useState(readString(a.title, bot.name));
  const [welcomeMessage, setWelcomeMessage] = useState(
    readString(a.welcomeMessage, 'Hi! Ask me anything to test me.'),
  );
  const [proactiveMessage, setProactiveMessage] = useState(
    readString(a.proactiveMessage, 'Need help choosing the right option?'),
  );
  const [agentLabel, setAgentLabel] = useState(readString(a.agentLabel, 'Team'));
  const [agentAvatarUrl, setAgentAvatarUrl] = useState(readString(a.agentAvatarUrl));
  const [avatarMode, setAvatarMode] = useState(readString(a.avatarMode, 'initials'));
  const [launcherIcon, setLauncherIcon] = useState(readString(a.launcherIcon, 'chat'));
  const [launcherImageUrl, setLauncherImageUrl] = useState(readString(a.launcherImageUrl));
  const [launcherLabel, setLauncherLabel] = useState(readString(a.launcherLabel, 'Chat with us'));
  const [launcherDotMode, setLauncherDotMode] = useState(readString(a.launcherDotMode, 'unread'));
  const [launcherDotColor, setLauncherDotColor] = useState(
    readString(a.launcherDotColor, '#ef4444'),
  );
  const [onlineLabel, setOnlineLabel] = useState(
    readString(a.onlineLabel, 'Team is replying - live'),
  );
  const [offlineLabel, setOfflineLabel] = useState(readString(a.offlineLabel, 'Replying soon'));
  const [typingLabel, setTypingLabel] = useState(readString(a.typingLabel, 'Team is typing'));
  const [footerBranding, setFooterBranding] = useState(
    readString(
      a.footerBranding,
      'AI assistant may be inaccurate. We use messages and contact details to respond to your enquiry.',
    ),
  );
  const [primaryColor, setPrimaryColor] = useState(readString(a.primaryColor, '#045fff'));
  const [headerTextColor, setHeaderTextColor] = useState(readString(a.headerTextColor, '#ffffff'));
  const [headerStyle, setHeaderStyle] = useState(readString(a.headerStyle, 'solid'));
  const [launcherStyle, setLauncherStyle] = useState(readString(a.launcherStyle, 'pill'));
  const [launcherSize, setLauncherSize] = useState(readString(a.launcherSize, 'default'));
  const [windowSize, setWindowSize] = useState(readString(a.windowSize, 'default'));
  const [mobileMode, setMobileMode] = useState(readString(a.mobileMode, 'fullscreen'));
  const [position, setPosition] = useState(readString(a.position, 'right'));
  const [autoOpenOnce, setAutoOpenOnce] = useState(readBool(a.autoOpenOnce, true));
  const [autoOpenDesktop, setAutoOpenDesktop] = useState(
    readBool(a.autoOpenDesktop, readBool(a.autoOpen, false)),
  );
  const [autoOpenMobile, setAutoOpenMobile] = useState(
    readBool(a.autoOpenMobile, readBool(a.autoOpen, false)),
  );
  const [autoOpenDelayDesktopSeconds, setAutoOpenDelayDesktopSeconds] = useState(
    String(readNum(a.autoOpenDelayDesktopSeconds, readNum(a.autoOpenDelaySeconds, 2))),
  );
  const [autoOpenDelayMobileSeconds, setAutoOpenDelayMobileSeconds] = useState(
    String(readNum(a.autoOpenDelayMobileSeconds, 60)),
  );
  const [launcherGlow, setLauncherGlow] = useState(readBool(a.launcherGlow, false));
  const [launcherGlowMobileOnly, setLauncherGlowMobileOnly] = useState(
    readBool(a.launcherGlowMobileOnly, true),
  );
  const [showOnMobile, setShowOnMobile] = useState(readBool(a.showOnMobile, true));
  const [showOnDesktop, setShowOnDesktop] = useState(readBool(a.showOnDesktop, true));
  const [bottomOffset, setBottomOffset] = useState(String(readNum(a.bottomOffset, 20)));
  const [sideOffset, setSideOffset] = useState(String(readNum(a.sideOffset, 20)));
  const [csatEnabled, setCsatEnabled] = useState(readBool(a.csatEnabled, false));
  const [csatCommentEnabled, setCsatCommentEnabled] = useState(
    readBool(a.csatCommentEnabled, true),
  );
  const [csatPrompt, setCsatPrompt] = useState(
    readString(a.csatPrompt, 'How would you rate this conversation?'),
  );
  const [csatThanks, setCsatThanks] = useState(
    readString(a.csatThanks, 'Thanks for your feedback!'),
  );

  const [contact, setContact] = useState<ContactSettings>(CONTACT_DEFAULTS);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactState, setContactState] = useState<{ ok?: boolean; error?: string }>({});

  // Fetched rather than passed in: the two pages that render this studio build
  // its props, and neither can be edited from here.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/widget/settings')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load_failed'))))
      .then((data: { settings?: Partial<ContactSettings> }) => {
        if (!cancelled && data.settings) {
          setContact({ ...CONTACT_DEFAULTS, ...data.settings });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContactState({ error: 'Could not load the contact settings. Reload to try again.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function patchContact(next: Partial<ContactSettings>) {
    setContact((current) => ({ ...current, ...next }));
    setContactState({});
  }

  function saveContact() {
    setContactSaving(true);
    setContactState({});
    fetch('/api/widget/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contact),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('save_failed'))))
      .then((data: { settings?: Partial<ContactSettings> }) => {
        if (data.settings) setContact({ ...CONTACT_DEFAULTS, ...data.settings });
        setContactState({ ok: true });
      })
      .catch(() => setContactState({ error: 'Could not save. Please try again.' }))
      .finally(() => setContactSaving(false));
  }

  // These inputs sit inside the design form but are saved by their own button,
  // so Enter must not fire the design form's submit and quietly discard them.
  function blockEnterSubmit(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter') event.preventDefault();
  }

  const headerBackground = useMemo(
    () =>
      headerStyle === 'gradient'
        ? `linear-gradient(135deg, ${primaryColor}, #1d4ed8)`
        : primaryColor,
    [headerStyle, primaryColor],
  );
  const avatarText = initials(title || company.name);
  // Module 22 (semantic colour): these palette values are DELIBERATE and must
  // not be swapped for `--success` / `--info` / `bg-muted` tokens. They are not
  // dashboard chrome — they paint the mock of the *visitor's own website*
  // behind the widget preview, and the light/dark/brand toggle lets the admin
  // check contrast against a pale site, a dark site and a tinted one. Tokens
  // follow the dashboard theme, so tokenising this would make "light" turn dark
  // whenever the admin flipped their own theme, and the preview would stop
  // answering the question it exists to answer. Same reasoning applies to the
  // hardcoded whites, slates and the emerald status dot inside the preview
  // frame below.
  const previewBackground =
    previewBg === 'dark'
      ? 'bg-slate-950'
      : previewBg === 'brand'
        ? 'bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-50'
        : 'bg-slate-50';

  function applyPreset(preset: (typeof themePresets)[number]) {
    setPrimaryColor(preset.color);
    setHeaderTextColor(preset.headerText);
    setLauncherDotColor(preset.dot);
    setHeaderStyle(preset.style);
  }

  function resetToBrand() {
    setTitle(`${company.name} Assistant`);
    setAgentLabel('Team');
    setLauncherLabel('Chat with us');
    setWelcomeMessage(
      `Hi, I can help with ${company.name}. What would you like to sort out today?`,
    );
    setProactiveMessage('Need help choosing the right option?');
    setFooterBranding(
      'AI assistant may be inaccurate. We use messages and contact details to respond to your enquiry.',
    );
    setPrimaryColor('#045fff');
    setHeaderTextColor('#ffffff');
    setHeaderStyle('solid');
    setAvatarMode('initials');
    setLauncherIcon('chat');
    setLauncherStyle('pill');
  }

  const health = [
    {
      label: 'Allowed domain',
      ok: bot.domainAllowlist.length > 0,
      detail: bot.domainAllowlist.length
        ? bot.domainAllowlist.join(', ')
        : 'Add your live domain before launch',
    },
    { label: 'AI replies', ok: bot.aiEnabled, detail: bot.aiEnabled ? 'Enabled' : 'Disabled' },
    {
      label: 'Mobile visibility',
      ok: showOnMobile,
      detail: showOnMobile ? 'Visible on phones' : 'Hidden on phones',
    },
    {
      label: 'Desktop visibility',
      ok: showOnDesktop,
      detail: showOnDesktop ? 'Visible on desktop' : 'Hidden on desktop',
    },
  ];

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="botId" value={bot.id} />

      {/*
        THE SETTINGS RAIL IS ~440px WIDE. EVERY FIELD IN IT WAS `sm:grid-cols-2`.
        ----------------------------------------------------------------------
        `sm:` is a VIEWPORT query and it is fully switched on at 640px; this
        split only exists from `xl:`, i.e. 1280px. So `sm:grid-cols-2` inside
        this column never meant "two columns when there is room" — it meant two
        columns of about 198px, always, on every desktop, holding `<select>`s
        with options like "Pill with label" and hints like "The fixed corner of
        the visitor's browser window. Arabic (right-to-left) chats still open in
        this same corner", which wrapped to six lines under a 198px box.

        Every one of those grids is now `FIELD_GRID`, which resolves against
        THIS column: one field per row at 440px, and two only if the rail ever
        gets wide enough to give each of them 16rem. Same class, correct in both
        cases — which is the property the `sm:` version never had.
      */}
      <div className="grid gap-6 xl:grid-cols-[minmax(360px,440px)_1fr] [&>*]:min-w-0">
        <div className="space-y-4">
          <section className="rounded-md border bg-card p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Design studio</h2>
                <p className="text-sm text-muted-foreground">
                  Changes preview here first, then save to update the live website widget.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={resetToBrand}>
                Use company brand
              </Button>
            </div>

            <div className="grid gap-3">
              {/* Not `FormField`: there is no single control here to label, and
                  a `htmlFor` pointing at a button group would be a broken
                  association rather than a missing one. `fieldset`/`legend` is
                  what names a group of controls — a bare `<Label>` with no
                  `htmlFor` renders a `<label>` that labels nothing at all, so a
                  screen reader announced six unnamed buttons. */}
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium leading-none">Theme presets</legend>
                <div className="flex flex-wrap gap-2">
                  {themePresets.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted"
                    >
                      <span
                        className="me-2 inline-block h-3 w-3 rounded-full"
                        style={{ background: preset.color }}
                      />
                      {preset.name}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className={FIELD_GRID}>
                <FormField label="Widget title" htmlFor="title">
                  <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </FormField>
                <FormField label="Agent label" htmlFor="agentLabel">
                  <Input
                    name="agentLabel"
                    value={agentLabel}
                    onChange={(e) => setAgentLabel(e.target.value)}
                  />
                </FormField>
              </div>
              <FormField label="Welcome message" htmlFor="welcomeMessage">
                <Textarea
                  name="welcomeMessage"
                  rows={2}
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                />
              </FormField>
              <FormField label="Proactive message" htmlFor="proactiveMessage">
                <Input
                  name="proactiveMessage"
                  value={proactiveMessage}
                  onChange={(e) => setProactiveMessage(e.target.value)}
                />
              </FormField>
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Colors and header</h2>
            <div className={FIELD_GRID}>
              {/* These two are composite — a colour swatch plus a hex box, both
                  driving the same value. `FormField` wires exactly one control
                  (it clones its single child), so it would put the id on the
                  wrapping div and point the label at a non-control. Labelled by
                  hand instead, against the swatch that carries the field name. */}
              <div className="space-y-1.5">
                <Label htmlFor="primaryColor">Primary color</Label>
                <div className="flex gap-2">
                  <Input
                    id="primaryColor"
                    name="primaryColor"
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-10 w-16 p-1"
                  />
                  <Input
                    aria-label="Primary color hex value"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="headerTextColor">Header text color</Label>
                <div className="flex gap-2">
                  <Input
                    id="headerTextColor"
                    name="headerTextColor"
                    type="color"
                    value={headerTextColor}
                    onChange={(e) => setHeaderTextColor(e.target.value)}
                    className="h-10 w-16 p-1"
                  />
                  <Input
                    aria-label="Header text color hex value"
                    value={headerTextColor}
                    onChange={(e) => setHeaderTextColor(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
              <FormField label="Header style" htmlFor="headerStyle">
                <Select
                  name="headerStyle"
                  value={headerStyle}
                  onChange={(e) => setHeaderStyle(e.target.value)}
                >
                  <option value="solid">Solid</option>
                  <option value="gradient">Soft gradient</option>
                </Select>
              </FormField>
              {/*
                Only the settings that actually do something on the current
                choice are shown. Everything hidden this way keeps a hidden
                input carrying its current value, because
                `updateWidgetDesignAction` rebuilds the whole appearance blob
                from the submitted form — a field simply removed from the DOM is
                read as empty and would wipe the saved value on the next save.
                `widget.js:903` skips the dot entirely when the mode is hidden,
                so its colour is unreachable then.
              */}
              {launcherDotMode === 'hidden' ? (
                <input type="hidden" name="launcherDotColor" value={launcherDotColor} />
              ) : (
                <FormField
                  label="Alert dot color"
                  htmlFor="launcherDotColor"
                  hint="The small dot on the launcher that says there is something to read."
                >
                  <Input
                    name="launcherDotColor"
                    type="color"
                    value={launcherDotColor}
                    onChange={(e) => setLauncherDotColor(e.target.value)}
                    className="h-10 w-16 p-1"
                  />
                </FormField>
              )}
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Launcher and avatar</h2>
            <div className={FIELD_GRID}>
              <FormField
                label="Launcher label"
                htmlFor="launcherLabel"
                // Not hidden on a circle launcher, because `widget.js:899` still
                // uses this text to work out the initials when the icon is set to
                // Initials. It just says so instead of leaving the owner to type
                // into a box that changes nothing they can see.
                hint={
                  launcherStyle === 'pill'
                    ? 'The words next to the icon on the closed chat button.'
                    : launcherIcon === 'initials'
                      ? 'A circle launcher shows no words — this text is only used to work out the initials.'
                      : 'Not shown while the launcher is a circle. Switch Launcher style to Pill to show it.'
                }
              >
                <Input
                  name="launcherLabel"
                  value={launcherLabel}
                  onChange={(e) => setLauncherLabel(e.target.value)}
                />
              </FormField>
              <FormField label="Launcher icon" htmlFor="launcherIcon">
                <Select
                  name="launcherIcon"
                  value={launcherIcon}
                  onChange={(e) => setLauncherIcon(e.target.value)}
                >
                  <option value="chat">Chat</option>
                  <option value="headset">Headset</option>
                  <option value="spark">Spark</option>
                  <option value="help">Help</option>
                  <option value="question">Question</option>
                  <option value="initials">Initials</option>
                  <option value="custom">Custom image</option>
                </Select>
              </FormField>
              <FormField label="Launcher style" htmlFor="launcherStyle">
                <Select
                  name="launcherStyle"
                  value={launcherStyle}
                  onChange={(e) => setLauncherStyle(e.target.value)}
                >
                  <option value="pill">Pill with label</option>
                  <option value="circle">Circle</option>
                </Select>
              </FormField>
              <FormField label="Launcher size" htmlFor="launcherSize">
                <Select
                  name="launcherSize"
                  value={launcherSize}
                  onChange={(e) => setLauncherSize(e.target.value)}
                >
                  <option value="compact">Compact</option>
                  <option value="default">Default</option>
                  <option value="large">Large</option>
                </Select>
              </FormField>
              <FormField label="Avatar style" htmlFor="avatarMode">
                <Select
                  name="avatarMode"
                  value={avatarMode}
                  onChange={(e) => setAvatarMode(e.target.value)}
                >
                  <option value="initials">Initials</option>
                  <option value="headset">Headset</option>
                  <option value="chat">Chat bubble</option>
                  <option value="spark">Spark</option>
                  <option value="image">Use avatar image</option>
                </Select>
              </FormField>
              {/*
                Three options, two behaviours. `widget.js:903` is the only place
                that reads this and its only test is `=== 'hidden'`, and there
                is no unread tracking anywhere in the widget — grep `unread` in
                public/widget/widget.js and the stored default is the sole hit.
                So "Show" and "Always show" painted exactly the same dot, and an
                owner picking between them was choosing nothing.

                Collapsed to the one real choice. The stored value is untouched:
                a company already on `always` keeps `always` and still reads as
                "Show it", because that is what `always` does.
              */}
              <FormField
                label="Alert dot"
                htmlFor="launcherDotMode"
                hint="The small coloured dot on the closed chat button. It is always on show — the widget does not yet count unread replies, so it cannot appear only when there is one."
              >
                <Select
                  name="launcherDotMode"
                  value={launcherDotMode === 'hidden' ? 'hidden' : launcherDotMode}
                  onChange={(e) => setLauncherDotMode(e.target.value)}
                >
                  {launcherDotMode === 'always' ? (
                    <option value="always">Show it</option>
                  ) : (
                    <option value="unread">Show it</option>
                  )}
                  <option value="hidden">Never show it</option>
                </Select>
              </FormField>
              {/* Both of these were shown whatever the two pickers above said,
                  each carrying a hint admitting it was probably doing nothing.
                  `widget.js:442` and `:896` only ever read them on those exact
                  choices, so they are now shown on those choices and nowhere
                  else. The hidden input preserves an address already saved, so
                  switching away and back does not lose it. */}
              {avatarMode === 'image' ? (
                <FormField
                  label="Avatar image address"
                  htmlFor="agentAvatarUrl"
                  hint="A direct link to a square image, e.g. https://example.com/team.png. It appears next to every reply."
                >
                  <Input
                    name="agentAvatarUrl"
                    type="url"
                    placeholder="https://example.com/team.png"
                    value={agentAvatarUrl}
                    onChange={(e) => setAgentAvatarUrl(e.target.value)}
                  />
                </FormField>
              ) : (
                <input type="hidden" name="agentAvatarUrl" value={agentAvatarUrl} />
              )}
              {launcherIcon === 'custom' ? (
                <FormField
                  label="Launcher image address"
                  htmlFor="launcherImageUrl"
                  hint="A direct link to the image to use instead of an icon, e.g. https://example.com/logo.png."
                >
                  <Input
                    name="launcherImageUrl"
                    type="url"
                    placeholder="https://example.com/logo.png"
                    value={launcherImageUrl}
                    onChange={(e) => setLauncherImageUrl(e.target.value)}
                  />
                </FormField>
              ) : (
                <input type="hidden" name="launcherImageUrl" value={launcherImageUrl} />
              )}
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Behavior and layout</h2>
            <div className={FIELD_GRID}>
              <FormField label="Window size" htmlFor="windowSize">
                <Select
                  name="windowSize"
                  value={windowSize}
                  onChange={(e) => setWindowSize(e.target.value)}
                >
                  <option value="compact">Compact</option>
                  <option value="default">Default</option>
                  <option value="large">Large</option>
                </Select>
              </FormField>
              <FormField label="Mobile mode" htmlFor="mobileMode">
                <Select
                  name="mobileMode"
                  value={mobileMode}
                  onChange={(e) => setMobileMode(e.target.value)}
                >
                  <option value="fullscreen">Fullscreen</option>
                  <option value="bottom_sheet">Bottom sheet</option>
                </Select>
              </FormField>
              {/*
                Module 21 (RTL): this setting is deliberately PHYSICAL, not logical.
                `public/widget/widget.js` pins the launcher and window with
                `style.left` / `style.right`, so an Arabic (RTL) widget still lands in
                the same physical corner of the page. Under an RTL dashboard the bare
                words "left"/"right" would read to the admin as start/end and invert
                their mental model, so the copy names the visitor's screen explicitly
                and the hint states that reading direction does not move it.
                The submitted field name stays `position` with values right/left.
              */}
              {/*
                The label says "left or right" out loud. It used to be "Launcher
                corner" alone, which is more precise and which nobody could find:
                an owner looking for this setting searches the page for the words
                left and right, and a heading that avoids both reads as a
                different setting entirely.

                It does not reintroduce the RTL ambiguity the comment above is
                about, because the two options still name the visitor's screen
                explicitly and the hint still says reading direction does not
                move it. The words are in the label to be findable; the meaning
                is still carried by the options.
              */}
              <FormField
                label="Launcher corner — left or right"
                htmlFor="position"
                hint="The fixed corner of the visitor's browser window. Arabic (right-to-left) chats still open in this same corner."
              >
                <Select
                  name="position"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                >
                  <option value="right">Bottom right of the visitor&apos;s screen</option>
                  <option value="left">Bottom left of the visitor&apos;s screen</option>
                </Select>
              </FormField>
              {/* `widget.js:1246` only reads the delay for a device whose
                  auto-open is switched on, so each delay follows its own switch
                  rather than sitting there asking for a number that will never
                  be counted. The switches themselves are just below. */}
              {autoOpenDesktop ? (
                <FormField
                  label="Desktop auto-open delay"
                  htmlFor="autoOpenDelayDesktopSeconds"
                  hint="Seconds after the page loads before the chat opens itself on a laptop or desktop. 0 opens it straight away."
                >
                  <Input
                    name="autoOpenDelayDesktopSeconds"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={120}
                    value={autoOpenDelayDesktopSeconds}
                    onChange={(e) => setAutoOpenDelayDesktopSeconds(e.target.value)}
                  />
                </FormField>
              ) : (
                <input
                  type="hidden"
                  name="autoOpenDelayDesktopSeconds"
                  value={autoOpenDelayDesktopSeconds}
                />
              )}
              {autoOpenMobile ? (
                <FormField
                  label="Mobile auto-open delay"
                  htmlFor="autoOpenDelayMobileSeconds"
                  hint="Seconds before the chat opens itself on a phone. Longer than the desktop one is usual — 60 gives someone time to read the page first."
                >
                  <Input
                    name="autoOpenDelayMobileSeconds"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={600}
                    value={autoOpenDelayMobileSeconds}
                    onChange={(e) => setAutoOpenDelayMobileSeconds(e.target.value)}
                  />
                </FormField>
              ) : (
                <input
                  type="hidden"
                  name="autoOpenDelayMobileSeconds"
                  value={autoOpenDelayMobileSeconds}
                />
              )}
              {/* These two are pixels and said so nowhere, so "20" could have
                  meant anything. The unit goes in the hint, matching how the
                  two auto-open delays above spell out their seconds. */}
              <FormField
                label="Bottom spacing"
                htmlFor="bottomOffset"
                hint="Pixels between the launcher and the bottom of the visitor's screen."
              >
                <Input
                  name="bottomOffset"
                  type="number"
                  min={0}
                  max={120}
                  value={bottomOffset}
                  onChange={(e) => setBottomOffset(e.target.value)}
                />
              </FormField>
              <FormField
                label="Side spacing"
                htmlFor="sideOffset"
                hint="Pixels between the launcher and the side of the visitor's screen."
              >
                <Input
                  name="sideOffset"
                  type="number"
                  min={0}
                  max={120}
                  value={sideOffset}
                  onChange={(e) => setSideOffset(e.target.value)}
                />
              </FormField>
            </div>
            <div className={cn(CHOICE_GRID, 'mt-3')}>
              <label className={CHOICE_CARD}>
                <input
                  type="checkbox"
                  name="autoOpenDesktop"
                  checked={autoOpenDesktop}
                  onChange={(e) => setAutoOpenDesktop(e.target.checked)}
                  className={CHECKBOX}
                />
                Auto-open on desktop
              </label>
              <label className={CHOICE_CARD}>
                <input
                  type="checkbox"
                  name="autoOpenMobile"
                  checked={autoOpenMobile}
                  onChange={(e) => setAutoOpenMobile(e.target.checked)}
                  className={CHECKBOX}
                />
                Auto-open on mobile
              </label>
              {/* "Once per visitor" qualifies the two switches above it: with
                  neither on, nothing ever opens itself and this decides
                  nothing. Same for the glow sub-option below. Both keep a hidden
                  input so the setting survives being switched off and on. */}
              {autoOpenDesktop || autoOpenMobile ? (
                <label className={CHOICE_CARD}>
                  <input
                    type="checkbox"
                    name="autoOpenOnce"
                    checked={autoOpenOnce}
                    onChange={(e) => setAutoOpenOnce(e.target.checked)}
                    className={CHECKBOX}
                  />
                  Open by itself only the first time someone visits
                </label>
              ) : (
                <input type="hidden" name="autoOpenOnce" value={autoOpenOnce ? 'on' : ''} />
              )}
              <label className={CHOICE_CARD}>
                <input
                  type="checkbox"
                  name="launcherGlow"
                  checked={launcherGlow}
                  onChange={(e) => setLauncherGlow(e.target.checked)}
                  className={CHECKBOX}
                />
                Make the chat button glow until it is opened
              </label>
              {launcherGlow ? (
                <label className={CHOICE_CARD}>
                  <input
                    type="checkbox"
                    name="launcherGlowMobileOnly"
                    checked={launcherGlowMobileOnly}
                    onChange={(e) => setLauncherGlowMobileOnly(e.target.checked)}
                    className={CHECKBOX}
                  />
                  Only glow on phones
                </label>
              ) : (
                <input
                  type="hidden"
                  name="launcherGlowMobileOnly"
                  value={launcherGlowMobileOnly ? 'on' : ''}
                />
              )}
              <label className={CHOICE_CARD}>
                <input
                  type="checkbox"
                  name="showOnMobile"
                  checked={showOnMobile}
                  onChange={(e) => setShowOnMobile(e.target.checked)}
                  className={CHECKBOX}
                />
                Show on mobile
              </label>
              <label className={CHOICE_CARD}>
                <input
                  type="checkbox"
                  name="showOnDesktop"
                  checked={showOnDesktop}
                  onChange={(e) => setShowOnDesktop(e.target.checked)}
                  className={CHECKBOX}
                />
                Show on desktop
              </label>
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Status labels and footer</h2>
            <div className="grid gap-3">
              <FormField
                label="Status line under the title"
                htmlFor="onlineLabel"
                hint="Shown at the top of the chat the whole time it is open."
              >
                <Input
                  name="onlineLabel"
                  value={onlineLabel}
                  onChange={(e) => setOnlineLabel(e.target.value)}
                />
              </FormField>
              {/*
                "Offline label" is stored, sent to the browser and assigned to
                the widget's state — and then never rendered. `onlineLabel` is
                the only status text `widget.js` ever writes into the header
                (`:343` and `:586`); `state.offlineLabel` is set at `:546` and
                read nowhere. The widget has no offline state to show it in.

                It is left editable rather than deleted, because the value is
                real and the widget would only need one line to use it — but the
                label no longer implies it is on screen anywhere, which is what
                sent owners hunting for the state that would reveal it.
              */}
              <FormField
                label="Out-of-hours status line — not shown yet"
                htmlFor="offlineLabel"
                hint="Saved, but the chat does not currently have an out-of-hours state to show it in: the line above is displayed at all times. Nothing you type here reaches a visitor today."
              >
                <Input
                  name="offlineLabel"
                  value={offlineLabel}
                  onChange={(e) => setOfflineLabel(e.target.value)}
                />
              </FormField>
              <FormField
                label="What it says while a reply is being written"
                htmlFor="typingLabel"
              >
                <Input
                  name="typingLabel"
                  value={typingLabel}
                  onChange={(e) => setTypingLabel(e.target.value)}
                />
              </FormField>
              <FormField
                label="Small print at the bottom of the chat"
                htmlFor="footerBranding"
                hint="Where the AI disclaimer and your data-protection note go. Visitors see it under the message box."
              >
                <Textarea
                  name="footerBranding"
                  rows={2}
                  value={footerBranding}
                  onChange={(e) => setFooterBranding(e.target.value)}
                />
              </FormField>
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-1 text-base font-semibold">Customer satisfaction (CSAT)</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Ask visitors to rate the conversation (1–5 stars) when they finish or close the chat.
              Scores show in the Inbox and Analytics.
            </p>
            <div className="grid gap-3">
              <label className={CHOICE_CARD}>
                <input
                  type="checkbox"
                  name="csatEnabled"
                  checked={csatEnabled}
                  onChange={(e) => setCsatEnabled(e.target.checked)}
                  className={CHECKBOX}
                />
                Ask for a rating after the conversation
              </label>
              {/* The comment switch and the two pieces of wording are only ever
                  reached once ratings are on (`widget.js:1370`), so with the box
                  above unticked all three were asking the owner to write text no
                  visitor would read. */}
              {csatEnabled ? (
                <>
                  <label className={CHOICE_CARD}>
                    <input
                      type="checkbox"
                      name="csatCommentEnabled"
                      checked={csatCommentEnabled}
                      onChange={(e) => setCsatCommentEnabled(e.target.checked)}
                      className={CHECKBOX}
                    />
                    Let them add a comment as well as the stars
                  </label>
                  <FormField
                    label="What to ask them"
                    htmlFor="csatPrompt"
                    hint="Shown above the five stars when the chat ends."
                  >
                    <Input
                      name="csatPrompt"
                      value={csatPrompt}
                      onChange={(e) => setCsatPrompt(e.target.value)}
                    />
                  </FormField>
                  <FormField
                    label="What to say afterwards"
                    htmlFor="csatThanks"
                    hint="Shown in the chat the moment they have rated it."
                  >
                    <Input
                      name="csatThanks"
                      value={csatThanks}
                      onChange={(e) => setCsatThanks(e.target.value)}
                    />
                  </FormField>
                </>
              ) : (
                <>
                  <input
                    type="hidden"
                    name="csatCommentEnabled"
                    value={csatCommentEnabled ? 'on' : ''}
                  />
                  <input type="hidden" name="csatPrompt" value={csatPrompt} />
                  <input type="hidden" name="csatThanks" value={csatThanks} />
                </>
              )}
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-1 text-base font-semibold">Getting contact details</h2>
            <p className="mb-1 text-sm text-muted-foreground">
              Ask visitors who they are before they start, and say something useful when you are
              closed instead of leaving the chat looking staffed.
            </p>
            {/* Saved separately, and it says so, because everything else on this
                screen belongs to one assistant and these two belong to the whole
                company — the same answer whichever assistant is on the page. */}
            <p className="mb-4 text-xs text-muted-foreground">
              These apply to every assistant in your company and save with their own button below.
            </p>

            <div className="grid gap-3">
              <label className={CHOICE_CARD}>
                <input
                  type="checkbox"
                  checked={contact.prechatEnabled}
                  onChange={(e) => patchContact({ prechatEnabled: e.target.checked })}
                  className={CHECKBOX}
                />
                Ask for contact details before the conversation starts
              </label>

              {contact.prechatEnabled ? (
                <>
                  <div className={TOGGLE_GRID}>
                    <label className={CHOICE_CARD}>
                      <input
                        type="checkbox"
                        checked={contact.prechatAskName}
                        onChange={(e) => patchContact({ prechatAskName: e.target.checked })}
                        className={CHECKBOX}
                      />
                      Name
                    </label>
                    <label className={CHOICE_CARD}>
                      <input
                        type="checkbox"
                        checked={contact.prechatAskEmail}
                        onChange={(e) => patchContact({ prechatAskEmail: e.target.checked })}
                        className={CHECKBOX}
                      />
                      Email
                    </label>
                    <label className={CHOICE_CARD}>
                      <input
                        type="checkbox"
                        checked={contact.prechatAskPhone}
                        onChange={(e) => patchContact({ prechatAskPhone: e.target.checked })}
                        className={CHECKBOX}
                      />
                      Phone
                    </label>
                  </div>
                  <label className={CHOICE_CARD}>
                    <input
                      type="checkbox"
                      checked={contact.prechatRequired}
                      onChange={(e) => patchContact({ prechatRequired: e.target.checked })}
                      className={CHECKBOX}
                    />
                    They must fill it in before they can type
                  </label>
                  <label className={CHOICE_CARD}>
                    <input
                      type="checkbox"
                      checked={contact.prechatAllowSkip}
                      onChange={(e) => patchContact({ prechatAllowSkip: e.target.checked })}
                      className={CHECKBOX}
                    />
                    Show a Skip link as well
                  </label>
                  <FormField
                    label="Heading on the form"
                    htmlFor="prechatTitle"
                    hint="Shown at the top of the card, above the boxes."
                  >
                    <Input
                      value={contact.prechatTitle}
                      onChange={(e) => patchContact({ prechatTitle: e.target.value })}
                      onKeyDown={blockEnterSubmit}
                    />
                  </FormField>
                  <FormField
                    label="Why you are asking"
                    htmlFor="prechatIntro"
                    hint="One line. Visitors give more when they know what it is for."
                  >
                    <Textarea
                      rows={2}
                      value={contact.prechatIntro}
                      onChange={(e) => patchContact({ prechatIntro: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Button wording" htmlFor="prechatButtonLabel">
                    <Input
                      value={contact.prechatButtonLabel}
                      onChange={(e) => patchContact({ prechatButtonLabel: e.target.value })}
                      onKeyDown={blockEnterSubmit}
                    />
                  </FormField>
                </>
              ) : null}

              <label className={CHOICE_CARD}>
                <input
                  type="checkbox"
                  checked={contact.offlineEnabled}
                  onChange={(e) => patchContact({ offlineEnabled: e.target.checked })}
                  className={CHECKBOX}
                />
                Say you are closed outside your opening hours
              </label>
              {/* The hours themselves are not edited here — they are the ones in
                  Business details, the same ones the SLA clock runs on. With
                  none saved the widget behaves exactly as it does today. */}
              <p className="-mt-1 text-xs text-muted-foreground">
                Uses the opening hours from your business details. With no hours saved, the chat
                behaves as normal at all times.
              </p>

              {contact.offlineEnabled ? (
                <>
                  <FormField
                    label="What it says when you are closed"
                    htmlFor="offlineMessage"
                    hint="Shown as a note in the chat as soon as the visitor opens it."
                  >
                    <Textarea
                      rows={2}
                      value={contact.offlineMessage}
                      onChange={(e) => patchContact({ offlineMessage: e.target.value })}
                    />
                  </FormField>
                  <label className={CHOICE_CARD}>
                    <input
                      type="checkbox"
                      checked={contact.offlineFormEnabled}
                      onChange={(e) => patchContact({ offlineFormEnabled: e.target.checked })}
                      className={CHECKBOX}
                    />
                    Offer to take a message
                  </label>
                  {contact.offlineFormEnabled ? (
                    <FormField label="Wording on that button" htmlFor="offlineButtonLabel">
                      <Input
                        value={contact.offlineButtonLabel}
                        onChange={(e) => patchContact({ offlineButtonLabel: e.target.value })}
                        onKeyDown={blockEnterSubmit}
                      />
                    </FormField>
                  ) : null}
                </>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" size="sm" onClick={saveContact} disabled={contactSaving}>
                  {contactSaving ? 'Saving…' : 'Save contact settings'}
                </Button>
                <FormMessage state={contactState} okText="Saved. Live widget updated." />
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="rounded-md border bg-card p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Live design preview</h2>
                <p className="text-sm text-muted-foreground">
                  Colors and labels update instantly. Save to push them to the embedded website
                  widget. Nothing in the preview is clickable — send real questions from Test your
                  assistant above.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['desktop', 'mobile'] as PreviewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPreviewMode(mode)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${previewMode === mode ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                  >
                    {PREVIEW_MODE_LABELS[mode]}
                  </button>
                ))}
                {(['light', 'dark', 'brand'] as PreviewBg[]).map((bg) => (
                  <button
                    key={bg}
                    type="button"
                    onClick={() => setPreviewBg(bg)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${previewBg === bg ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                  >
                    {PREVIEW_BG_LABELS[bg]}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`relative min-h-[560px] overflow-hidden rounded-md border ${previewBackground}`}
            >
              <div className="p-6">
                <div className="h-3 w-3/4 rounded bg-slate-200" />
                <div className="mt-3 h-3 w-1/2 rounded bg-slate-200" />
                <div className="mt-3 h-3 w-2/3 rounded bg-slate-200" />
              </div>

              {/* Module 21 (RTL): `left-*`/`right-*` are intentionally physical here and
                  must NOT become `start-*`/`end-*`. This is a mock of the visitor's page,
                  and the real widget pins itself with physical style.left/style.right — so
                  the preview has to stay put when the dashboard shell flips to RTL. */}
              <div
                className={`absolute ${position === 'left' ? 'left-5' : 'right-5'} bottom-5 overflow-hidden rounded-[22px] bg-white shadow-2xl ring-1 ring-slate-200 ${
                  // `w-[380px]` flat. Stacked on a phone this preview panel is
                  // about 343px wide, so the mock was 37px wider than the frame
                  // it sits in — and the frame is `overflow-hidden`, so the
                  // right-hand edge of the widget (including its close button)
                  // was simply cut off on every phone. `min()` keeps the design
                  // size wherever there is room and falls back to whatever the
                  // frame can give, minus the 20px inset it is pinned at.
                  previewMode === 'mobile'
                    ? 'h-[500px] w-[min(300px,calc(100%-2.5rem))]'
                    : 'h-[440px] w-[min(380px,calc(100%-2.5rem))]'
                }`}
              >
                <div
                  className="flex h-[76px] items-center justify-between px-4"
                  style={{ background: headerBackground, color: headerTextColor }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-xs font-extrabold">
                      {avatarMode === 'image' && agentAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={agentAvatarUrl}
                          alt=""
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : avatarMode === 'headset' ? (
                        'HS'
                      ) : avatarMode === 'spark' ? (
                        'AI'
                      ) : (
                        avatarText
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-extrabold leading-tight">
                        {title || 'Website Assistant'}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 truncate text-xs font-bold">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        {onlineLabel || 'Team is replying - live'}
                      </p>
                    </div>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl leading-none">
                    ×
                  </div>
                </div>

                <div className="flex h-[calc(100%-156px)] flex-col gap-3 overflow-hidden bg-slate-100 p-4">
                  <div className="flex items-start gap-2">
                    <div
                      className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                      style={{ background: primaryColor }}
                    >
                      {avatarText}
                    </div>
                    <div className="max-w-[82%] rounded-2xl rounded-bl-md border bg-white p-3 text-sm leading-6 text-slate-800 shadow-sm">
                      <p>{welcomeMessage || 'Hi! Ask me anything to test me.'}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['Get pricing', 'Book a demo', 'Talk to the team'].map((label) => (
                      <span
                        key={label}
                        className="rounded-full border bg-white px-3 py-2 text-xs font-bold"
                        style={{ color: primaryColor }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="border-t bg-white p-3">
                  <div className="flex gap-2">
                    {/* Static mock, not an input — the label must not invite typing. */}
                    <div
                      className="flex h-12 flex-1 items-center rounded-xl border px-3 text-sm text-slate-400"
                      style={{ borderColor: primaryColor }}
                    >
                      Message box (preview)
                    </div>
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-xl text-xl font-black text-white"
                      style={{ background: primaryColor }}
                    >
                      &gt;
                    </div>
                  </div>
                  <p className="mt-2 text-center text-[10px] leading-tight text-slate-500">
                    {footerBranding}
                  </p>
                </div>
              </div>

              <div
                className={`absolute ${position === 'left' ? 'left-7' : 'right-7'} bottom-5 flex items-center justify-center rounded-full text-white shadow-xl ${
                  launcherStyle === 'pill' ? 'h-14 gap-2 px-4 text-sm font-bold' : 'h-14 w-14'
                }`}
                style={{ background: primaryColor }}
              >
                {launcherGlow && (!launcherGlowMobileOnly || previewMode === 'mobile') ? (
                  <span
                    className="absolute inset-0 animate-ping rounded-full opacity-60"
                    style={{ background: primaryColor }}
                    aria-hidden
                  />
                ) : null}
                <span className="relative">
                  {launcherIcon === 'initials'
                    ? initials(launcherLabel || title)
                    : launcherIcon === 'headset'
                      ? '◔'
                      : '●'}
                </span>
                {launcherStyle === 'pill' ? (
                  <span className="relative">{launcherLabel || 'Chat with us'}</span>
                ) : null}
                {/* Physical on purpose: the shipped widget draws this dot at `right:2px`. */}
                {launcherDotMode !== 'hidden' ? (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full border-[3px] border-white"
                    style={{ background: launcherDotColor }}
                  />
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-3 text-base font-semibold">Widget health</h2>
            <div className="grid gap-2">
              {health.map((item) => (
                <div
                  key={item.label}
                  className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  {/* Dashboard chrome, not preview: these two DO tokenise.
                      `Badge` adds a border and runs `px-2.5 py-0.5
                      font-medium` against the old `px-2 py-1 font-semibold`. */}
                  <Badge variant={item.ok ? 'success' : 'warning'}>
                    {item.ok ? 'Ready' : 'Check'}
                  </Badge>
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Saving…">Save and update live widget</SubmitButton>
            <FormMessage state={state} okText="Saved. Live widget config updated." />
          </div>
        </div>
      </div>

      <section className="rounded-md border bg-card p-4">
        <WidgetEmbedInstructions
          embed={asyncEmbed(embed)}
          domainAllowlist={bot.domainAllowlist}
          settingsHref={`/company/bots/${bot.id}/settings`}
        />
      </section>
    </form>
  );
}

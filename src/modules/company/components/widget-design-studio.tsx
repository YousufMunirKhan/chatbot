'use client';

import { useMemo, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { BotRow, CompanyProfile } from '../data';
import {
  updateWidgetDesignAction,
  type WidgetDesignActionState,
} from '../widget-design-actions';
import { WidgetEmbedInstructions } from './widget-embed-instructions';

type PreviewMode = 'desktop' | 'mobile';
type PreviewBg = 'light' | 'dark' | 'brand';

const initial: WidgetDesignActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const themePresets = [
  { name: 'Switch blue', color: '#045fff', headerText: '#ffffff', dot: '#ef4444', style: 'solid' },
  { name: 'Clean black', color: '#111827', headerText: '#ffffff', dot: '#22c55e', style: 'solid' },
  { name: 'Retail green', color: '#16a34a', headerText: '#ffffff', dot: '#f97316', style: 'solid' },
  { name: 'Premium dark', color: '#0f172a', headerText: '#ffffff', dot: '#38bdf8', style: 'gradient' },
  { name: 'Friendly teal', color: '#0891b2', headerText: '#ffffff', dot: '#f43f5e', style: 'solid' },
] as const;

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
  const parts = text.replace(/&/g, ' ').replace(/[^a-z0-9 ]/gi, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'AI';
  const first = parts[0] ?? 'A';
  const second = parts[1] ?? first;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? 'A'}${second[0] ?? 'I'}`.toUpperCase();
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save and update live widget'}</Button>;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
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
  const [launcherDotColor, setLauncherDotColor] = useState(readString(a.launcherDotColor, '#ef4444'));
  const [onlineLabel, setOnlineLabel] = useState(readString(a.onlineLabel, 'Team is replying - live'));
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
  const [autoOpenDesktop, setAutoOpenDesktop] = useState(readBool(a.autoOpenDesktop, readBool(a.autoOpen, false)));
  const [autoOpenMobile, setAutoOpenMobile] = useState(readBool(a.autoOpenMobile, readBool(a.autoOpen, false)));
  const [autoOpenDelayDesktopSeconds, setAutoOpenDelayDesktopSeconds] = useState(
    String(readNum(a.autoOpenDelayDesktopSeconds, readNum(a.autoOpenDelaySeconds, 2))),
  );
  const [autoOpenDelayMobileSeconds, setAutoOpenDelayMobileSeconds] = useState(
    String(readNum(a.autoOpenDelayMobileSeconds, 60)),
  );
  const [launcherGlow, setLauncherGlow] = useState(readBool(a.launcherGlow, false));
  const [launcherGlowMobileOnly, setLauncherGlowMobileOnly] = useState(readBool(a.launcherGlowMobileOnly, true));
  const [showOnMobile, setShowOnMobile] = useState(readBool(a.showOnMobile, true));
  const [showOnDesktop, setShowOnDesktop] = useState(readBool(a.showOnDesktop, true));
  const [bottomOffset, setBottomOffset] = useState(String(readNum(a.bottomOffset, 20)));
  const [sideOffset, setSideOffset] = useState(String(readNum(a.sideOffset, 20)));

  const headerBackground = useMemo(
    () => (headerStyle === 'gradient' ? `linear-gradient(135deg, ${primaryColor}, #1d4ed8)` : primaryColor),
    [headerStyle, primaryColor],
  );
  const avatarText = initials(title || company.name);
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
    setWelcomeMessage(`Hi, I can help with ${company.name}. What would you like to sort out today?`);
    setProactiveMessage('Need help choosing the right option?');
    setFooterBranding('AI assistant may be inaccurate. We use messages and contact details to respond to your enquiry.');
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
      detail: bot.domainAllowlist.length ? bot.domainAllowlist.join(', ') : 'Add your live domain before launch',
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

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,440px)_1fr]">
        <div className="space-y-4">
          <section className="rounded-md border bg-card p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Design studio</h2>
                <p className="text-sm text-muted-foreground">Changes preview here first, then save to update the live website widget.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={resetToBrand}>
                Use company brand
              </Button>
            </div>

            <div className="grid gap-3">
              <Field label="Theme presets">
                <div className="flex flex-wrap gap-2">
                  {themePresets.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted"
                    >
                      <span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ background: preset.color }} />
                      {preset.name}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Widget title">
                  <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                <Field label="Agent label">
                  <Input name="agentLabel" value={agentLabel} onChange={(e) => setAgentLabel(e.target.value)} />
                </Field>
              </div>
              <Field label="Welcome message">
                <Textarea name="welcomeMessage" rows={2} value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} />
              </Field>
              <Field label="Proactive message">
                <Input name="proactiveMessage" value={proactiveMessage} onChange={(e) => setProactiveMessage(e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Colors and header</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Primary color">
                <div className="flex gap-2">
                  <Input name="primaryColor" type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 w-16 p-1" />
                  <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="font-mono" />
                </div>
              </Field>
              <Field label="Header text color">
                <div className="flex gap-2">
                  <Input name="headerTextColor" type="color" value={headerTextColor} onChange={(e) => setHeaderTextColor(e.target.value)} className="h-10 w-16 p-1" />
                  <Input value={headerTextColor} onChange={(e) => setHeaderTextColor(e.target.value)} className="font-mono" />
                </div>
              </Field>
              <Field label="Header style">
                <select name="headerStyle" className={selectCls} value={headerStyle} onChange={(e) => setHeaderStyle(e.target.value)}>
                  <option value="solid">Solid</option>
                  <option value="gradient">Soft gradient</option>
                </select>
              </Field>
              <Field label="Alert dot color">
                <Input name="launcherDotColor" type="color" value={launcherDotColor} onChange={(e) => setLauncherDotColor(e.target.value)} className="h-10 w-16 p-1" />
              </Field>
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Launcher and avatar</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Launcher label">
                <Input name="launcherLabel" value={launcherLabel} onChange={(e) => setLauncherLabel(e.target.value)} />
              </Field>
              <Field label="Launcher icon">
                <select name="launcherIcon" className={selectCls} value={launcherIcon} onChange={(e) => setLauncherIcon(e.target.value)}>
                  <option value="chat">Chat</option>
                  <option value="headset">Headset</option>
                  <option value="spark">Spark</option>
                  <option value="help">Help</option>
                  <option value="question">Question</option>
                  <option value="initials">Initials</option>
                  <option value="custom">Custom image</option>
                </select>
              </Field>
              <Field label="Launcher style">
                <select name="launcherStyle" className={selectCls} value={launcherStyle} onChange={(e) => setLauncherStyle(e.target.value)}>
                  <option value="pill">Pill with label</option>
                  <option value="circle">Circle</option>
                </select>
              </Field>
              <Field label="Launcher size">
                <select name="launcherSize" className={selectCls} value={launcherSize} onChange={(e) => setLauncherSize(e.target.value)}>
                  <option value="compact">Compact</option>
                  <option value="default">Default</option>
                  <option value="large">Large</option>
                </select>
              </Field>
              <Field label="Avatar style">
                <select name="avatarMode" className={selectCls} value={avatarMode} onChange={(e) => setAvatarMode(e.target.value)}>
                  <option value="initials">Initials</option>
                  <option value="headset">Headset</option>
                  <option value="chat">Chat bubble</option>
                  <option value="spark">Spark</option>
                  <option value="image">Use avatar image</option>
                </select>
              </Field>
              <Field label="Alert dot">
                <select name="launcherDotMode" className={selectCls} value={launcherDotMode} onChange={(e) => setLauncherDotMode(e.target.value)}>
                  <option value="unread">Show</option>
                  <option value="always">Always show</option>
                  <option value="hidden">Hide</option>
                </select>
              </Field>
              <Field label="Avatar image URL" hint="Only used when avatar style is image.">
                <Input name="agentAvatarUrl" value={agentAvatarUrl} onChange={(e) => setAgentAvatarUrl(e.target.value)} />
              </Field>
              <Field label="Launcher image URL" hint="Only used when launcher icon is custom image.">
                <Input name="launcherImageUrl" value={launcherImageUrl} onChange={(e) => setLauncherImageUrl(e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Behavior and layout</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Window size">
                <select name="windowSize" className={selectCls} value={windowSize} onChange={(e) => setWindowSize(e.target.value)}>
                  <option value="compact">Compact</option>
                  <option value="default">Default</option>
                  <option value="large">Large</option>
                </select>
              </Field>
              <Field label="Mobile mode">
                <select name="mobileMode" className={selectCls} value={mobileMode} onChange={(e) => setMobileMode(e.target.value)}>
                  <option value="fullscreen">Fullscreen</option>
                  <option value="bottom_sheet">Bottom sheet</option>
                </select>
              </Field>
              <Field label="Position">
                <select name="position" className={selectCls} value={position} onChange={(e) => setPosition(e.target.value)}>
                  <option value="right">Bottom right</option>
                  <option value="left">Bottom left</option>
                </select>
              </Field>
              <Field label="Desktop auto-open delay" hint="Seconds before the chat opens on laptops/desktops.">
                <Input name="autoOpenDelayDesktopSeconds" type="number" min={0} max={120} value={autoOpenDelayDesktopSeconds} onChange={(e) => setAutoOpenDelayDesktopSeconds(e.target.value)} />
              </Field>
              <Field label="Mobile auto-open delay" hint="Seconds before the chat opens on phones (e.g. 60).">
                <Input name="autoOpenDelayMobileSeconds" type="number" min={0} max={600} value={autoOpenDelayMobileSeconds} onChange={(e) => setAutoOpenDelayMobileSeconds(e.target.value)} />
              </Field>
              <Field label="Bottom spacing">
                <Input name="bottomOffset" type="number" min={0} max={120} value={bottomOffset} onChange={(e) => setBottomOffset(e.target.value)} />
              </Field>
              <Field label="Side spacing">
                <Input name="sideOffset" type="number" min={0} max={120} value={sideOffset} onChange={(e) => setSideOffset(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
                <input type="checkbox" name="autoOpenDesktop" checked={autoOpenDesktop} onChange={(e) => setAutoOpenDesktop(e.target.checked)} className="h-4 w-4" />
                Auto-open on desktop
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
                <input type="checkbox" name="autoOpenMobile" checked={autoOpenMobile} onChange={(e) => setAutoOpenMobile(e.target.checked)} className="h-4 w-4" />
                Auto-open on mobile
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
                <input type="checkbox" name="autoOpenOnce" checked={autoOpenOnce} onChange={(e) => setAutoOpenOnce(e.target.checked)} className="h-4 w-4" />
                Auto-open once per visitor
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
                <input type="checkbox" name="launcherGlow" checked={launcherGlow} onChange={(e) => setLauncherGlow(e.target.checked)} className="h-4 w-4" />
                Glowing launcher
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
                <input type="checkbox" name="launcherGlowMobileOnly" checked={launcherGlowMobileOnly} onChange={(e) => setLauncherGlowMobileOnly(e.target.checked)} className="h-4 w-4" />
                Glow on mobile only
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
                <input type="checkbox" name="showOnMobile" checked={showOnMobile} onChange={(e) => setShowOnMobile(e.target.checked)} className="h-4 w-4" />
                Show on mobile
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
                <input type="checkbox" name="showOnDesktop" checked={showOnDesktop} onChange={(e) => setShowOnDesktop(e.target.checked)} className="h-4 w-4" />
                Show on desktop
              </label>
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Status labels and footer</h2>
            <div className="grid gap-3">
              <Field label="Online label">
                <Input name="onlineLabel" value={onlineLabel} onChange={(e) => setOnlineLabel(e.target.value)} />
              </Field>
              <Field label="Offline label">
                <Input name="offlineLabel" value={offlineLabel} onChange={(e) => setOfflineLabel(e.target.value)} />
              </Field>
              <Field label="Typing label">
                <Input name="typingLabel" value={typingLabel} onChange={(e) => setTypingLabel(e.target.value)} />
              </Field>
              <Field label="Footer text">
                <Textarea name="footerBranding" rows={2} value={footerBranding} onChange={(e) => setFooterBranding(e.target.value)} />
              </Field>
            </div>
          </section>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="rounded-md border bg-card p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Live design preview</h2>
                <p className="text-sm text-muted-foreground">This preview updates instantly. Save to push it to the embedded website widget.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['desktop', 'mobile'] as PreviewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPreviewMode(mode)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${previewMode === mode ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                  >
                    {mode}
                  </button>
                ))}
                {(['light', 'dark', 'brand'] as PreviewBg[]).map((bg) => (
                  <button
                    key={bg}
                    type="button"
                    onClick={() => setPreviewBg(bg)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${previewBg === bg ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                  >
                    {bg}
                  </button>
                ))}
              </div>
            </div>

            <div className={`relative min-h-[560px] overflow-hidden rounded-md border ${previewBackground}`}>
              <div className="p-6">
                <div className="h-3 w-3/4 rounded bg-slate-200" />
                <div className="mt-3 h-3 w-1/2 rounded bg-slate-200" />
                <div className="mt-3 h-3 w-2/3 rounded bg-slate-200" />
              </div>

              <div
                className={`absolute ${position === 'left' ? 'left-5' : 'right-5'} bottom-5 overflow-hidden rounded-[22px] bg-white shadow-2xl ring-1 ring-slate-200 ${
                  previewMode === 'mobile' ? 'h-[500px] w-[300px]' : 'h-[440px] w-[380px]'
                }`}
              >
                <div className="flex h-[76px] items-center justify-between px-4" style={{ background: headerBackground, color: headerTextColor }}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-xs font-extrabold">
                      {avatarMode === 'image' && agentAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={agentAvatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                      ) : avatarMode === 'headset' ? (
                        'HS'
                      ) : avatarMode === 'spark' ? (
                        'AI'
                      ) : (
                        avatarText
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-extrabold leading-tight">{title || 'Website Assistant'}</p>
                      <p className="mt-1 flex items-center gap-1.5 truncate text-xs font-bold">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        {onlineLabel || 'Team is replying - live'}
                      </p>
                    </div>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl leading-none">×</div>
                </div>

                <div className="flex h-[calc(100%-156px)] flex-col gap-3 overflow-hidden bg-slate-100 p-4">
                  <div className="flex items-start gap-2">
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white" style={{ background: primaryColor }}>
                      {avatarText}
                    </div>
                    <div className="max-w-[82%] rounded-2xl rounded-bl-md border bg-white p-3 text-sm leading-6 text-slate-800 shadow-sm">
                      <p>{welcomeMessage || 'Hi! Ask me anything to test me.'}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['Get pricing', 'Book a demo', 'Talk to the team'].map((label) => (
                      <span key={label} className="rounded-full border bg-white px-3 py-2 text-xs font-bold" style={{ color: primaryColor }}>
                        {label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="border-t bg-white p-3">
                  <div className="flex gap-2">
                    <div className="flex h-12 flex-1 items-center rounded-xl border px-3 text-sm text-slate-400" style={{ borderColor: primaryColor }}>
                      Type your message...
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl text-xl font-black text-white" style={{ background: primaryColor }}>
                      &gt;
                    </div>
                  </div>
                  <p className="mt-2 text-center text-[10px] leading-tight text-slate-500">{footerBranding}</p>
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
                <span className="relative">{launcherIcon === 'initials' ? initials(launcherLabel || title) : launcherIcon === 'headset' ? '◔' : '●'}</span>
                {launcherStyle === 'pill' ? <span className="relative">{launcherLabel || 'Chat with us'}</span> : null}
                {launcherDotMode !== 'hidden' ? <span className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full border-[3px] border-white" style={{ background: launcherDotColor }} /> : null}
              </div>
            </div>
          </section>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-3 text-base font-semibold">Widget health</h2>
            <div className="grid gap-2">
              {health.map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                    {item.ok ? 'Ready' : 'Check'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton />
            {state.error ? <span className="text-sm text-destructive">{state.error}</span> : null}
            {state.ok ? <span className="text-sm text-emerald-600">Saved. Live widget config updated.</span> : null}
          </div>
        </div>
      </div>

      <section className="rounded-md border bg-card p-4">
        <WidgetEmbedInstructions
          embed={embed}
          domainAllowlist={bot.domainAllowlist}
          settingsHref={`/company/bots/${bot.id}/settings`}
        />
      </section>
    </form>
  );
}

import net from 'node:net';
import tls from 'node:tls';
import { getPlatformEmailSettings } from '@/lib/platform-settings';
import { logger } from '@/lib/logger';

/**
 * Email sender (Module 24). Uses Resend if RESEND_API_KEY is set; otherwise it
 * no-ops (logs) so the rest of the system works without an email provider.
 */
export async function sendEmail(params: {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | null;
  subject: string;
  html: string;
}): Promise<{ sent: boolean }> {
  const settings = await getPlatformEmailSettings();
  if (!settings.enabled || !settings.fromEmail) {
    logger.info('Email skipped (no provider configured)', { module: 'email' });
    return { sent: false };
  }

  if (settings.provider === 'smtp' && settings.smtpHost && settings.smtpPort) {
    return sendSmtpEmail({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpSecure,
      username: settings.smtpUsername,
      password: settings.smtpPassword,
      from: formatFrom(settings.fromEmail, settings.fromName),
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      replyTo: params.replyTo ?? settings.replyTo,
      subject: params.subject,
      html: params.html,
    });
  }

  if (!settings.resendApiKey) {
    logger.info('Email skipped (Resend key missing)', { module: 'email' });
    return { sent: false };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: formatFrom(settings.fromEmail, settings.fromName),
        to: params.to,
        cc: normalizeAddresses(params.cc),
        bcc: normalizeAddresses(params.bcc),
        subject: params.subject,
        html: params.html,
        reply_to: params.replyTo ?? settings.replyTo ?? undefined,
      }),
    });
    if (!res.ok) {
      logger.warn('Email send failed', { status: res.status });
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    logger.warn('Email send error', { error: err instanceof Error ? err.message : String(err) });
    return { sent: false };
  }
}

function formatFrom(email: string, name?: string | null): string {
  return name ? `${name} <${email}>` : email;
}

function normalizeAddresses(value?: string | string[] | null): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
}

function encodeBase64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function readLine(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const onData = (chunk: Buffer) => {
      data += chunk.toString('utf8');
      if (/\r?\n/.test(data) && !/^\d{3}-/m.test(data.split(/\r?\n/).slice(-2, -1)[0] ?? '')) {
        cleanup();
        resolve(data);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function expect(socket: net.Socket, codes: string[]): Promise<string> {
  const line = await readLine(socket);
  if (!codes.some((c) => line.startsWith(c))) throw new Error(`SMTP error: ${line.trim()}`);
  return line;
}

async function write(socket: net.Socket, cmd: string, codes: string[]): Promise<void> {
  socket.write(`${cmd}\r\n`);
  await expect(socket, codes);
}

function escapeHeader(s: string): string {
  return s.replace(/[\r\n]/g, ' ').trim();
}

export async function sendSmtpEmail(params: {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string | null;
  from: string;
  to: string | string[];
  cc?: string | string[] | null;
  bcc?: string | string[] | null;
  replyTo?: string | null;
  subject: string;
  html: string;
}): Promise<{ sent: boolean }> {
  let socket: net.Socket = params.secure
    ? tls.connect(params.port, params.host)
    : net.connect(params.port, params.host);
  try {
    await expect(socket, ['220']);
    await write(socket, 'EHLO localhost', ['250']);
    if (!params.secure) {
      socket.write('STARTTLS\r\n');
      const res = await expect(socket, ['220', '454', '500', '502']);
      if (res.startsWith('220')) {
        socket = tls.connect({ socket, servername: params.host });
        await write(socket, 'EHLO localhost', ['250']);
      }
    }
    if (params.username && params.password) {
      await write(socket, 'AUTH LOGIN', ['334']);
      await write(socket, encodeBase64(params.username), ['334']);
      await write(socket, encodeBase64(params.password), ['235']);
    }
    const fromEmail = params.from.match(/<([^>]+)>/)?.[1] ?? params.from;
    const toList = normalizeAddresses(params.to);
    const ccList = normalizeAddresses(params.cc);
    const bccList = normalizeAddresses(params.bcc);
    const recipients = [...toList, ...ccList, ...bccList];
    if (!recipients.length) throw new Error('SMTP error: no recipients');
    await write(socket, `MAIL FROM:<${fromEmail}>`, ['250']);
    for (const recipient of recipients) {
      await write(socket, `RCPT TO:<${recipient}>`, ['250', '251']);
    }
    await write(socket, 'DATA', ['354']);
    const headers = [
      `From: ${escapeHeader(params.from)}`,
      `To: ${escapeHeader(toList.join(', '))}`,
      ccList.length ? `Cc: ${escapeHeader(ccList.join(', '))}` : '',
      `Subject: ${escapeHeader(params.subject)}`,
      params.replyTo ? `Reply-To: ${escapeHeader(params.replyTo)}` : '',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
    ].filter(Boolean);
    socket.write(`${headers.join('\r\n')}\r\n\r\n${params.html}\r\n.\r\n`);
    await expect(socket, ['250']);
    socket.write('QUIT\r\n');
    return { sent: true };
  } catch (err) {
    logger.warn('SMTP send failed', { error: err instanceof Error ? err.message : String(err) });
    return { sent: false };
  } finally {
    socket.end();
  }
}

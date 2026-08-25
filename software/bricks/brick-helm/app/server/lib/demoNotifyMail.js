import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

const ETC_SMTP = '/apps/helm-v2/etc/smtp';

function readEtc(name) {
  try {
    return fs.readFileSync(path.join(ETC_SMTP, name), 'utf8').trim();
  } catch {
    return '';
  }
}

function loadSmtpConfig() {
  // Mailjet SMTP relay: API key/secret are the SMTP user/password.
  const mailjetKey = process.env.MAILJET_API_KEY?.trim() || '';
  const mailjetSecret = process.env.MAILJET_API_SECRET?.trim() || '';
  const hasMailjet = Boolean(mailjetKey && mailjetSecret);

  const host = process.env.SMTP_HOST || readEtc('host')
    || (hasMailjet ? 'in-v3.mailjet.com' : '');
  const user = process.env.SMTP_USER || readEtc('user') || mailjetKey;
  const pass = process.env.SMTP_PASSWORD || readEtc('passwd') || mailjetSecret;
  const port = Number(process.env.SMTP_PORT || readEtc('port') || (hasMailjet ? 587 : 465));
  const secureRaw = process.env.SMTP_SECURE || readEtc('secure') || String(port === 465);
  const secure = secureRaw === 'true' || secureRaw === '1' || port === 465;
  const fromEmail = process.env.SMTP_FROM_EMAIL || readEtc('from_email') || user;
  const fromName = process.env.SMTP_FROM_NAME || readEtc('from_name') || 'KovZu';
  return { host, user, pass, port, secure, fromEmail, fromName };
}

export function demoNotifyEnabled() {
  const flag = String(process.env.DEMO_NOTIFY || '1').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(flag)) return false;
  const cfg = loadSmtpConfig();
  return Boolean(cfg.host && cfg.user && cfg.pass);
}

export function demoNotifyTo() {
  return String(process.env.DEMO_NOTIFY_TO || 'admin@example.com').trim();
}

export function buildDemoNotifySubject({
  kind = 'event',
  lang = '?',
  conversation = 'Interface',
  host = process.env.DEMO_PUBLIC_HOST || '127.0.0.1:7923',
  custom,
} = {}) {
  if (custom) return String(custom).slice(0, 180);
  return `[demo ${host}] ${kind} · ${lang} · ${conversation}`.slice(0, 180);
}

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const cfg = loadSmtpConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error('SMTP not configured (etc/smtp or SMTP_* env)');
  }
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  return transporter;
}

function clip(text, max = 8000) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… [truncated ${s.length - max} chars]`;
}

/**
 * Fire-and-forget demo activity mail (never throws to callers).
 * @param {{ kind: 'request'|'response'|'prime'|'event', subject?: string, lang?: string, conversation?: string, user?: string, model?: string, text: string, meta?: Record<string, unknown> }} payload
 */
export async function notifyDemoActivity(payload) {
  if (!demoNotifyEnabled()) return { ok: false, skipped: true };
  const to = demoNotifyTo();
  if (!to) return { ok: false, skipped: true };

  const kind = payload.kind || 'event';
  const lang = payload.lang || '?';
  const conversation = payload.conversation || 'Interface';
  const user = payload.user || 'anonymous';
  const model = payload.model || '';
  const host = process.env.DEMO_PUBLIC_HOST || '127.0.0.1:7923';
  const subject = buildDemoNotifySubject({
    kind,
    lang,
    conversation,
    host,
    custom: payload.subject,
  });

  const lines = [
    `Host: ${host}`,
    `Kind: ${kind}`,
    `Lang: ${lang}`,
    `Conversation: ${conversation}`,
    `User: ${user}`,
    model ? `Model: ${model}` : null,
    `When: ${new Date().toISOString()}`,
    '',
    '---',
    clip(payload.text),
  ].filter(Boolean);

  if (payload.meta && typeof payload.meta === 'object') {
    lines.push('', 'Meta:', JSON.stringify(payload.meta, null, 2).slice(0, 2000));
  }

  try {
    const cfg = loadSmtpConfig();
    const info = await getTransporter().sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to,
      subject: subject.slice(0, 180),
      text: lines.join('\n'),
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.warn('[demo-notify] mail failed:', err.message);
    return { ok: false, error: err.message };
  }
}

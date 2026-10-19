/**
 * Outbound email for leads.
 *
 * Reuses whatever the instance already sends magic links with: the SMTP server
 * in EMAIL_SERVER when set, otherwise Resend's HTTP API. Nothing here is
 * provider-specific to Instagram, and no sponsor or product text is appended —
 * the campaign owner writes every word the recipient sees.
 */

import nodemailer from "nodemailer";

export interface OutboundEmail {
  to: string;
  subject: string;
  /** Display name to show as the sender; the address always stays EMAIL_FROM's. */
  fromName?: string | null;
  /** Plain-text version; derived from `html` when omitted. */
  text?: string;
  /** Body HTML (from the rich-text editor); rendered from `text` when omitted. */
  html?: string;
}

export class EmailTransportError extends Error {}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A plain-text body rendered as minimal HTML: paragraphs on blank lines, line
 * breaks within them, and bare URLs made clickable. Kept deliberately simple so
 * what the author typed is what the reader gets.
 */
export function textToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) =>
      escapeHtml(paragraph)
        .replace(
          /(https?:\/\/[^\s<]+)/g,
          (url) => `<a href="${url}">${url}</a>`
        )
        .replace(/\n/g, "<br>")
    )
    .filter((paragraph) => paragraph.trim() !== "")
    .map((paragraph) => `<p>${paragraph}</p>`);
  return wrapHtml(paragraphs.join(""));
}

/** True when a stored body was written with the rich-text editor. */
export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(value);
}

/** Plain-text rendering of editor HTML, for the text/plain part. */
export function htmlToText(html: string): string {
  return html
    .replace(/\r?\n/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(ul|ol)>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) =>
      label.trim() && label.trim() !== href ? `${label} (${href})` : href
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapHtml(body: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#111">${body}</body></html>`;
}

export function getEmailFrom(): string {
  return process.env.EMAIL_FROM ?? "OpenReply <login@example.com>";
}

/** EMAIL_FROM with its display name replaced, e.g. "Oliur" <noreply@x.com>. */
export function formatFrom(fromName?: string | null): string {
  const base = getEmailFrom();
  const name = fromName?.trim().replace(/[\r\n"<>]/g, "");
  if (!name) return base;
  const address = /<([^>]+)>/.exec(base)?.[1] ?? base.trim();
  return `"${name}" <${address}>`;
}

export function hasEmailTransport(): boolean {
  return Boolean(process.env.EMAIL_SERVER || process.env.RESEND_API_KEY);
}

export async function sendEmail(email: OutboundEmail): Promise<void> {
  const from = formatFrom(email.fromName);
  const text = email.text ?? (email.html ? htmlToText(email.html) : "");
  const html = email.html ? wrapHtml(email.html) : textToHtml(text);

  if (process.env.EMAIL_SERVER) {
    const transport = nodemailer.createTransport(process.env.EMAIL_SERVER);
    await transport.sendMail({
      from,
      to: email.to,
      subject: email.subject,
      text,
      html,
    });
    return;
  }

  if (process.env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text,
        html,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new EmailTransportError(
        `Resend rejected the email (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`
      );
    }
    return;
  }

  throw new EmailTransportError(
    "No email transport configured: set EMAIL_SERVER or RESEND_API_KEY"
  );
}

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
  text: string;
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
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#111">${paragraphs.join("")}</body></html>`;
}

export function getEmailFrom(): string {
  return process.env.EMAIL_FROM ?? "OpenReply <login@example.com>";
}

export function hasEmailTransport(): boolean {
  return Boolean(process.env.EMAIL_SERVER || process.env.RESEND_API_KEY);
}

export async function sendEmail(email: OutboundEmail): Promise<void> {
  const from = getEmailFrom();
  const html = textToHtml(email.text);

  if (process.env.EMAIL_SERVER) {
    const transport = nodemailer.createTransport(process.env.EMAIL_SERVER);
    await transport.sendMail({
      from,
      to: email.to,
      subject: email.subject,
      text: email.text,
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
        text: email.text,
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

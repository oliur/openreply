/**
 * Email capture.
 *
 * A campaign with `emailCaptureEnabled` ends its reveal message with a prompt
 * asking the person to reply with their email. Delivering that reveal records
 * an EmailCaptureRequest for the person; the next inbound DM from them is
 * checked for an address before the normal keyword matching runs. A valid
 * address becomes a Lead, is acknowledged with a DM, and is answered by email
 * through the instance's own mail transport (see lib/email/send.ts).
 *
 * Everything stays inside Instagram's rules: the confirmation DM is a reply to
 * a message the person just sent, so it is always inside the 24-hour window,
 * and nothing is sent to anyone who did not reply.
 */

import type { Job } from "bullmq";
import { prisma } from "@/lib/db/client";
import {
  createInstagramContext,
  hasInstagramCredentials,
  sendDirectMessage,
  type InstagramContext,
} from "@/lib/instagram/provider";
import { renderMessageWithoutLink } from "@/lib/tracking/message";
import { htmlToText, looksLikeHtml, sendEmail } from "@/lib/email/send";
import {
  getDMQueue,
  LEAD_EMAIL_JOB_NAME,
  LEAD_MAILROOM_JOB_NAME,
  type SendLeadEmailJob,
  type SyncLeadToMailroomJob,
} from "./client";
import { upsertContact } from "@/lib/mailroom/client";
import { getMailroomConnection } from "@/lib/mailroom/connection";

/** How long a prompt stays "open" for a reply. */
export const EMAIL_CAPTURE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The prompt itself plus at most one re-ask after an unusable reply. */
export const EMAIL_CAPTURE_MAX_PROMPTS = 2;

// Conservative on purpose: a DM is free text, so this only accepts a plain
// local@domain.tld with a real-looking TLD and no stray punctuation glued on.
const EMAIL_PATTERN =
  /(?<![\w.+-])([A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24})(?![\w-])/;

/** The first email address in a message, lower-cased, or null. */
export function extractEmail(text: string): string | null {
  const match = EMAIL_PATTERN.exec(text);
  if (!match) return null;
  const email = match[1].replace(/\.+$/, "").toLowerCase();
  // ".." inside the local part is never valid; a trailing dot was trimmed above.
  if (email.includes("..")) return null;
  return email;
}

export type EmailCaptureAutomation = {
  id: string;
  instagramAccountId: string;
  emailCaptureEnabled: boolean;
  emailPromptMessage: string | null;
};

export function isEmailCaptureActive(
  automation: Pick<EmailCaptureAutomation, "emailCaptureEnabled" | "emailPromptMessage">
): boolean {
  return automation.emailCaptureEnabled && Boolean(automation.emailPromptMessage?.trim());
}

/**
 * The reveal text with the email prompt appended. Appending (rather than a
 * second DM) keeps the comment path inside Meta's single private reply per
 * comment, and reads naturally: "here's your link — reply with your email and
 * I'll send the guide".
 */
export function appendEmailPrompt({
  automation,
  text,
  commenterName,
}: {
  automation: Pick<EmailCaptureAutomation, "emailCaptureEnabled" | "emailPromptMessage">;
  text: string;
  commenterName: string | null | undefined;
}): string {
  if (!isEmailCaptureActive(automation)) return text;
  const prompt = renderMessageWithoutLink({
    message: automation.emailPromptMessage as string,
    commenterName,
  });
  if (!prompt) return text;
  const base = text.trim();
  return base ? `${base}\n\n${prompt}` : prompt;
}

/** Remember that this person was just asked for their email. */
export async function registerEmailCapture({
  automation,
  userId,
  username,
}: {
  automation: EmailCaptureAutomation;
  userId: string;
  username: string | null | undefined;
}): Promise<void> {
  if (!isEmailCaptureActive(automation)) return;
  const expiresAt = new Date(Date.now() + EMAIL_CAPTURE_TTL_MS);
  await prisma.emailCaptureRequest.upsert({
    where: {
      instagramAccountId_igUserId: {
        instagramAccountId: automation.instagramAccountId,
        igUserId: userId,
      },
    },
    create: {
      instagramAccountId: automation.instagramAccountId,
      automationId: automation.id,
      igUserId: userId,
      username: username ?? null,
      promptCount: 1,
      expiresAt,
    },
    update: {
      automationId: automation.id,
      username: username ?? undefined,
      promptCount: 1,
      expiresAt,
    },
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A request that is already gone (a concurrent reply, a deleted campaign) is
// the outcome wanted, not an error.
async function forgetRequest(id: string): Promise<void> {
  try {
    await prisma.emailCaptureRequest.delete({ where: { id } });
  } catch {
    /* already removed */
  }
}

/**
 * Look at an inbound DM before keyword matching. Returns true when the message
 * was consumed by email capture (an address was stored, or the person was
 * re-asked), so the caller must not also run its keyword reply on it.
 */
export async function handleEmailCaptureReply({
  instagramAccountId,
  accountConnectionId,
  senderId,
  messageText,
  messageId,
  operationId,
}: {
  /** The account's Instagram id, as carried on the webhook. */
  instagramAccountId: string;
  /** Our InstagramAccount row id when the job carries it. */
  accountConnectionId?: string;
  senderId: string;
  messageText: string;
  messageId: string;
  operationId: string;
}): Promise<boolean> {
  const account = await prisma.instagramAccount.findFirst({
    where: {
      instagramId: instagramAccountId,
      ...(accountConnectionId ? { id: accountConnectionId } : {}),
    },
  });
  if (!account) return false;

  const request = await prisma.emailCaptureRequest.findUnique({
    where: {
      instagramAccountId_igUserId: {
        instagramAccountId: account.id,
        igUserId: senderId,
      },
    },
    include: { automation: true },
  });
  if (!request) return false;

  const expired = request.expiresAt.getTime() < Date.now();
  const automation = request.automation;
  if (expired || !automation.isActive || !isEmailCaptureActive(automation)) {
    await forgetRequest(request.id);
    return false;
  }

  const email = extractEmail(messageText);
  const username = request.username ?? null;
  const dedupeId = `dm:${messageId}`;

  if (!email) {
    // One re-ask at most, and only when the campaign has a message for it.
    const retry = automation.emailRetryMessage?.trim();
    if (request.promptCount >= EMAIL_CAPTURE_MAX_PROMPTS || !retry) return false;
    if (!hasInstagramCredentials(account)) return false;

    let context: InstagramContext;
    try {
      context = await createInstagramContext(account, operationId);
    } catch {
      return false;
    }
    await prisma.emailCaptureRequest.update({
      where: { id: request.id },
      data: { promptCount: { increment: 1 } },
    });
    try {
      await sendDirectMessage({
        context,
        instagramAccountId: account.instagramId,
        userId: senderId,
        message: renderMessageWithoutLink({ message: retry, commenterName: username }),
      });
    } catch (error) {
      console.log("[Email capture] Re-prompt failed:", formatError(error));
    }
    return true;
  }

  const lead = await prisma.lead.upsert({
    where: { automationId_igUserId: { automationId: automation.id, igUserId: senderId } },
    create: {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: account.id,
      igUserId: senderId,
      username,
      email,
    },
    update: {
      email,
      username: username ?? undefined,
      capturedAt: new Date(),
      // A new address is a new send; the job below is keyed on this timestamp
      // so an unchanged address never gets emailed twice.
      emailSentAt: null,
      emailError: null,
      emailAttempts: 0,
      mailroomSyncedAt: null,
      mailroomError: null,
    },
  });
  await forgetRequest(request.id);

  const queueJob: SendLeadEmailJob = { leadId: lead.id };
  await getDMQueue().add(LEAD_EMAIL_JOB_NAME, queueJob, {
    jobId: `leademail_${lead.id}_${lead.capturedAt.getTime()}`,
  });
  if (automation.mailroomBrand && automation.mailroomListId) {
    const syncJob: SyncLeadToMailroomJob = { leadId: lead.id, mailroom: true };
    await getDMQueue().add(LEAD_MAILROOM_JOB_NAME, syncJob, {
      jobId: `leadmailroom_${lead.id}_${lead.capturedAt.getTime()}`,
    });
  }

  const logBase = {
    workspaceId: automation.workspaceId,
    automationId: automation.id,
    instagramAccountId: account.id,
    commenterId: senderId,
    commenterName: username,
    commentText: messageText,
    commentId: dedupeId,
    matchedKeyword: "email",
  };

  const confirm = automation.emailConfirmMessage?.trim();
  if (!confirm) {
    await prisma.dmLog.upsert({
      where: { automationId_commentId: { automationId: automation.id, commentId: dedupeId } },
      create: { ...logBase, status: "SENT", dmSentAt: new Date() },
      update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });
    return true;
  }

  if (!hasInstagramCredentials(account)) {
    await prisma.dmLog.upsert({
      where: { automationId_commentId: { automationId: automation.id, commentId: dedupeId } },
      create: { ...logBase, status: "FAILED", errorMessage: "No Instagram access token available" },
      update: { status: "FAILED", errorMessage: "No Instagram access token available" },
    });
    return true;
  }

  try {
    const context = await createInstagramContext(account, operationId);
    await sendDirectMessage({
      context,
      instagramAccountId: account.instagramId,
      userId: senderId,
      message: renderMessageWithoutLink({ message: confirm, commenterName: username }).replace(
        /\{email\}/gi,
        email
      ),
    });
    await prisma.dmLog.upsert({
      where: { automationId_commentId: { automationId: automation.id, commentId: dedupeId } },
      create: { ...logBase, status: "SENT", dmSentAt: new Date() },
      update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });
  } catch (error) {
    // The lead and its email are already safe; only the thank-you DM failed.
    await prisma.dmLog.upsert({
      where: { automationId_commentId: { automationId: automation.id, commentId: dedupeId } },
      create: { ...logBase, status: "FAILED", errorMessage: formatError(error) },
      update: { status: "FAILED", errorMessage: formatError(error) },
    });
  }
  return true;
}

/** Render the campaign's email for one lead. */
export function renderLeadEmail({
  subject,
  body,
  username,
  email,
}: {
  subject: string;
  body: string;
  username: string | null;
  email: string;
}): { subject: string; text: string; html?: string } {
  const fill = (text: string) =>
    text.replace(/\{username\}/gi, username ?? "there").replace(/\{email\}/gi, email);
  const filledSubject = fill(subject).trim();
  if (looksLikeHtml(body)) {
    const html = fill(body).trim();
    return { subject: filledSubject, text: htmlToText(html), html };
  }
  return { subject: filledSubject, text: fill(body).trim() };
}

/** Queue handler: send the campaign's email to a lead, once. */
export async function processLeadEmail(job: Job<SendLeadEmailJob>): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: job.data.leadId },
    include: { automation: true },
  });
  if (!lead || lead.emailSentAt) return;

  const subject = lead.automation.emailSubject?.trim();
  const body = lead.automation.emailBody?.trim();
  if (!subject || !body) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { emailError: "Campaign has no email subject or body" },
    });
    return;
  }

  const rendered = renderLeadEmail({ subject, body, username: lead.username, email: lead.email });
  try {
    await sendEmail({ to: lead.email, fromName: lead.automation.emailFromName, ...rendered });
  } catch (error) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { emailError: formatError(error), emailAttempts: { increment: 1 } },
    });
    throw error;
  }
  await prisma.lead.update({
    where: { id: lead.id },
    data: { emailSentAt: new Date(), emailError: null, emailAttempts: { increment: 1 } },
  });
}

/** Queue handler: add a lead to the campaign's Mailroom list, once. */
export async function processLeadMailroomSync(
  job: Job<SyncLeadToMailroomJob>
): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: job.data.leadId },
    include: { automation: true },
  });
  if (!lead || lead.mailroomSyncedAt) return;
  const { mailroomBrand, mailroomListId } = lead.automation;
  if (!mailroomBrand || !mailroomListId) return;

  const connection = await getMailroomConnection(lead.workspaceId);
  if (!connection) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { mailroomError: "Mailroom is not connected in Settings" },
    });
    return;
  }

  try {
    const contact = await upsertContact(connection, mailroomBrand, {
      email: lead.email,
      firstName: lead.username,
      listIds: [mailroomListId],
      tags: ["openreply"],
      source: "openreply",
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { mailroomContactId: contact?.id ?? null, mailroomSyncedAt: new Date(), mailroomError: null },
    });
  } catch (error) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { mailroomError: formatError(error) },
    });
    throw error;
  }
}

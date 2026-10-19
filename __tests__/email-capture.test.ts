import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockSendDirectMessage,
  mockQueueAdd,
  mockSendEmail,
  mockCreateContext,
  mockUpsertContact,
  mockGetMailroomConnection,
} = vi.hoisted(() => ({
    mockPrisma: {
      instagramAccount: { findFirst: vi.fn() },
      emailCaptureRequest: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      lead: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      dmLog: { upsert: vi.fn() },
    },
    mockSendDirectMessage: vi.fn(),
    mockQueueAdd: vi.fn(),
    mockSendEmail: vi.fn(),
    mockCreateContext: vi.fn(),
    mockUpsertContact: vi.fn(),
    mockGetMailroomConnection: vi.fn(),
  }));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/instagram/provider", () => ({
  createInstagramContext: mockCreateContext,
  hasInstagramCredentials: (account: { accessToken?: string }) => Boolean(account.accessToken),
  sendDirectMessage: mockSendDirectMessage,
}));
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  sendEmail: mockSendEmail,
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mockQueueAdd }),
  LEAD_EMAIL_JOB_NAME: "send-lead-email",
  LEAD_MAILROOM_JOB_NAME: "sync-lead-mailroom",
}));
vi.mock("@/lib/mailroom/client", () => ({ upsertContact: mockUpsertContact }));
vi.mock("@/lib/mailroom/connection", () => ({ getMailroomConnection: mockGetMailroomConnection }));

import {
  appendEmailPrompt,
  extractEmail,
  handleEmailCaptureReply,
  processLeadEmail,
  processLeadMailroomSync,
  registerEmailCapture,
  renderLeadEmail,
} from "@/lib/queue/email-capture";
import type { Job } from "bullmq";

const account = {
  id: "acct_1",
  instagramId: "17841400000",
  accessToken: "token",
  provider: "META",
  zernioAccountId: null,
  workspaceId: "ws_1",
};

const automation = {
  id: "auto_1",
  workspaceId: "ws_1",
  instagramAccountId: "acct_1",
  isActive: true,
  emailCaptureEnabled: true,
  emailPromptMessage: "Reply with your email, {username}!",
  emailConfirmMessage: "Got it {username}, check {email} soon",
  emailRetryMessage: "Just your email please",
  emailSubject: "Your guide, {username}",
  emailBody: "Hey {username}, here it is.",
  mailroomBrand: null as string | null,
  mailroomListId: null as string | null,
};

function pendingRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "req_1",
    instagramAccountId: "acct_1",
    automationId: "auto_1",
    igUserId: "user_9",
    username: "alex",
    promptCount: 1,
    expiresAt: new Date(Date.now() + 60_000),
    automation,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.findFirst.mockResolvedValue(account);
  mockCreateContext.mockResolvedValue({ provider: "META", accessToken: "token" });
  mockPrisma.lead.upsert.mockImplementation(async ({ create }) => ({
    id: "lead_1",
    capturedAt: new Date("2026-10-19T10:00:00Z"),
    ...create,
  }));
});

describe("extractEmail", () => {
  it("finds a plain address inside chatty text", () => {
    expect(extractEmail("sure! it's Alex.Smith+ig@Example.co.uk thanks")).toBe(
      "alex.smith+ig@example.co.uk"
    );
    expect(extractEmail("my email: me@mail.io.")).toBe("me@mail.io");
  });

  it("rejects text without a real address", () => {
    expect(extractEmail("LINK")).toBeNull();
    expect(extractEmail("@someone on insta")).toBeNull();
    expect(extractEmail("hi@localhost")).toBeNull();
    expect(extractEmail("a..b@example.com")).toBeNull();
  });
});

describe("appendEmailPrompt", () => {
  it("adds the rendered prompt after the reveal text", () => {
    expect(
      appendEmailPrompt({ automation, text: "Here's your link", commenterName: "alex" })
    ).toBe("Here's your link\n\nReply with your email, alex!");
  });

  it("leaves the text alone when capture is off or the prompt is blank", () => {
    expect(
      appendEmailPrompt({
        automation: { ...automation, emailCaptureEnabled: false },
        text: "Hi",
        commenterName: null,
      })
    ).toBe("Hi");
    expect(
      appendEmailPrompt({
        automation: { ...automation, emailPromptMessage: "  " },
        text: "Hi",
        commenterName: null,
      })
    ).toBe("Hi");
  });
});

describe("registerEmailCapture", () => {
  it("records a pending request keyed on account and user", async () => {
    await registerEmailCapture({ automation, userId: "user_9", username: "alex" });
    expect(mockPrisma.emailCaptureRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { instagramAccountId_igUserId: { instagramAccountId: "acct_1", igUserId: "user_9" } },
        create: expect.objectContaining({ automationId: "auto_1", username: "alex", promptCount: 1 }),
      })
    );
  });

  it("does nothing when capture is off", async () => {
    await registerEmailCapture({
      automation: { ...automation, emailCaptureEnabled: false },
      userId: "user_9",
      username: null,
    });
    expect(mockPrisma.emailCaptureRequest.upsert).not.toHaveBeenCalled();
  });
});

describe("handleEmailCaptureReply", () => {
  const base = {
    instagramAccountId: "17841400000",
    senderId: "user_9",
    messageId: "mid_1",
    operationId: "op",
  };

  it("ignores a DM from someone who was never asked", async () => {
    mockPrisma.emailCaptureRequest.findUnique.mockResolvedValue(null);
    await expect(
      handleEmailCaptureReply({ ...base, messageText: "me@example.com" })
    ).resolves.toBe(false);
    expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
  });

  it("stores the lead, confirms by DM and queues the email", async () => {
    mockPrisma.emailCaptureRequest.findUnique.mockResolvedValue(pendingRequest());
    await expect(
      handleEmailCaptureReply({ ...base, messageText: "it's Me@Example.com" })
    ).resolves.toBe(true);

    expect(mockPrisma.lead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { automationId_igUserId: { automationId: "auto_1", igUserId: "user_9" } },
        create: expect.objectContaining({ email: "me@example.com", username: "alex" }),
      })
    );
    expect(mockPrisma.emailCaptureRequest.delete).toHaveBeenCalledWith({ where: { id: "req_1" } });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "send-lead-email",
      { leadId: "lead_1" },
      expect.objectContaining({ jobId: expect.stringMatching(/^leademail_lead_1_\d+$/) })
    );
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_9",
        message: "Got it alex, check me@example.com soon",
      })
    );
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "SENT", commentId: "dm:mid_1", matchedKeyword: "email" }),
      })
    );
  });

  it("re-asks once when the reply has no address, then gives up", async () => {
    mockPrisma.emailCaptureRequest.findUnique.mockResolvedValue(pendingRequest());
    await expect(handleEmailCaptureReply({ ...base, messageText: "what?" })).resolves.toBe(true);
    expect(mockPrisma.emailCaptureRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { promptCount: { increment: 1 } } })
    );
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Just your email please" })
    );

    vi.clearAllMocks();
    mockPrisma.instagramAccount.findFirst.mockResolvedValue(account);
    mockPrisma.emailCaptureRequest.findUnique.mockResolvedValue(pendingRequest({ promptCount: 2 }));
    await expect(handleEmailCaptureReply({ ...base, messageText: "LINK" })).resolves.toBe(false);
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("drops an expired request and lets the DM fall through", async () => {
    mockPrisma.emailCaptureRequest.findUnique.mockResolvedValue(
      pendingRequest({ expiresAt: new Date(Date.now() - 1000) })
    );
    await expect(
      handleEmailCaptureReply({ ...base, messageText: "me@example.com" })
    ).resolves.toBe(false);
    expect(mockPrisma.emailCaptureRequest.delete).toHaveBeenCalled();
    expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
  });

  it("keeps the lead even when the confirmation DM fails", async () => {
    mockPrisma.emailCaptureRequest.findUnique.mockResolvedValue(pendingRequest());
    mockSendDirectMessage.mockRejectedValue(new Error("window closed"));
    await expect(
      handleEmailCaptureReply({ ...base, messageText: "me@example.com" })
    ).resolves.toBe(true);
    expect(mockPrisma.lead.upsert).toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "FAILED", errorMessage: "window closed" }),
      })
    );
  });
});

describe("lead email", () => {
  it("renders placeholders in subject and body", () => {
    expect(
      renderLeadEmail({
        subject: "Hi {username}",
        body: "Sent to {email}\n\nbye",
        username: null,
        email: "me@example.com",
      })
    ).toEqual({ subject: "Hi there", text: "Sent to me@example.com\n\nbye" });
  });

  it("keeps editor HTML and derives the plain-text part", () => {
    const rendered = renderLeadEmail({
      subject: "Guide",
      body: '<p>Hey <strong>{username}</strong></p><p>Grab it: <a href="https://x.io/g">the guide</a></p><ul><li>one</li><li>two</li></ul>',
      username: "alex",
      email: "me@example.com",
    });
    expect(rendered.html).toContain("<strong>alex</strong>");
    expect(rendered.text).toBe("Hey alex\nGrab it: the guide (https://x.io/g)\n- one\n- two");
  });

  it("sends once and records the result", async () => {
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: "lead_1",
      email: "me@example.com",
      username: "alex",
      emailSentAt: null,
      automation,
    });
    await processLeadEmail({ data: { leadId: "lead_1" } } as Job<{ leadId: string }>);
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: "me@example.com",
      subject: "Your guide, alex",
      text: "Hey alex, here it is.",
    });
    expect(mockPrisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailSentAt: expect.any(Date) }) })
    );

    vi.clearAllMocks();
    mockPrisma.lead.findUnique.mockResolvedValue({ id: "lead_1", emailSentAt: new Date(), automation });
    await processLeadEmail({ data: { leadId: "lead_1" } } as Job<{ leadId: string }>);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("records the error and rethrows so the queue retries", async () => {
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: "lead_1",
      email: "me@example.com",
      username: null,
      emailSentAt: null,
      automation,
    });
    mockSendEmail.mockRejectedValue(new Error("smtp down"));
    await expect(
      processLeadEmail({ data: { leadId: "lead_1" } } as Job<{ leadId: string }>)
    ).rejects.toThrow("smtp down");
    expect(mockPrisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailError: "smtp down" }) })
    );
  });
});

describe("Mailroom sync", () => {
  const withList = { ...automation, mailroomBrand: "oliur", mailroomListId: "list_1" };

  it("queues a sync only when the campaign has a list", async () => {
    mockPrisma.emailCaptureRequest.findUnique.mockResolvedValue(pendingRequest());
    await handleEmailCaptureReply({
      instagramAccountId: "17841400000",
      senderId: "user_9",
      messageId: "mid_2",
      operationId: "op",
      messageText: "me@example.com",
    });
    expect(mockQueueAdd).not.toHaveBeenCalledWith("sync-lead-mailroom", expect.anything(), expect.anything());

    vi.clearAllMocks();
    mockPrisma.instagramAccount.findFirst.mockResolvedValue(account);
    mockPrisma.lead.upsert.mockResolvedValue({ id: "lead_1", capturedAt: new Date(0) });
    mockPrisma.emailCaptureRequest.findUnique.mockResolvedValue(pendingRequest({ automation: withList }));
    await handleEmailCaptureReply({
      instagramAccountId: "17841400000",
      senderId: "user_9",
      messageId: "mid_3",
      operationId: "op",
      messageText: "me@example.com",
    });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "sync-lead-mailroom",
      { leadId: "lead_1", mailroom: true },
      expect.objectContaining({ jobId: "leadmailroom_lead_1_0" })
    );
  });

  it("upserts the contact into the list and records the sync", async () => {
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: "lead_1",
      workspaceId: "ws_1",
      email: "me@example.com",
      username: "alex",
      mailroomSyncedAt: null,
      automation: withList,
    });
    mockGetMailroomConnection.mockResolvedValue({ baseUrl: "https://mail.example", apiKey: "mr_x" });
    mockUpsertContact.mockResolvedValue({ id: "contact_1", email: "me@example.com", status: "subscribed" });
    await processLeadMailroomSync({ data: { leadId: "lead_1", mailroom: true } } as Job<{ leadId: string; mailroom: true }>);
    expect(mockUpsertContact).toHaveBeenCalledWith(
      { baseUrl: "https://mail.example", apiKey: "mr_x" },
      "oliur",
      expect.objectContaining({ email: "me@example.com", firstName: "alex", listIds: ["list_1"] })
    );
    expect(mockPrisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mailroomContactId: "contact_1", mailroomSyncedAt: expect.any(Date) }),
      })
    );
  });

  it("records a missing connection without retrying, and a Mailroom error with a retry", async () => {
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: "lead_1",
      workspaceId: "ws_1",
      email: "me@example.com",
      username: null,
      mailroomSyncedAt: null,
      automation: withList,
    });
    mockGetMailroomConnection.mockResolvedValue(null);
    await processLeadMailroomSync({ data: { leadId: "lead_1", mailroom: true } } as Job<{ leadId: string; mailroom: true }>);
    expect(mockUpsertContact).not.toHaveBeenCalled();
    expect(mockPrisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mailroomError: "Mailroom is not connected in Settings" } })
    );

    mockGetMailroomConnection.mockResolvedValue({ baseUrl: "https://mail.example", apiKey: "mr_x" });
    mockUpsertContact.mockRejectedValue(new Error("Mailroom: list not found"));
    await expect(
      processLeadMailroomSync({ data: { leadId: "lead_1", mailroom: true } } as Job<{ leadId: string; mailroom: true }>)
    ).rejects.toThrow("list not found");
    expect(mockPrisma.lead.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { mailroomError: "Mailroom: list not found" } })
    );
  });
});

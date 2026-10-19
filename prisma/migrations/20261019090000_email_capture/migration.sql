-- Email capture: campaigns can ask commenters for an email and answer by email.
ALTER TABLE "Automation"
  ADD COLUMN "emailCaptureEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailPromptMessage" TEXT,
  ADD COLUMN "emailConfirmMessage" TEXT,
  ADD COLUMN "emailRetryMessage" TEXT,
  ADD COLUMN "emailSubject" TEXT,
  ADD COLUMN "emailBody" TEXT;

CREATE TABLE "Lead" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "igUserId" TEXT NOT NULL,
  "username" TEXT,
  "email" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailSentAt" TIMESTAMP(3),
  "emailError" TEXT,
  "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Lead_automationId_igUserId_key" ON "Lead"("automationId", "igUserId");
CREATE INDEX "Lead_workspaceId_capturedAt_idx" ON "Lead"("workspaceId", "capturedAt");
CREATE INDEX "Lead_automationId_idx" ON "Lead"("automationId");
CREATE INDEX "Lead_instagramAccountId_idx" ON "Lead"("instagramAccountId");
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmailCaptureRequest" (
  "id" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "igUserId" TEXT NOT NULL,
  "username" TEXT,
  "promptCount" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailCaptureRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailCaptureRequest_instagramAccountId_igUserId_key" ON "EmailCaptureRequest"("instagramAccountId", "igUserId");
CREATE INDEX "EmailCaptureRequest_expiresAt_idx" ON "EmailCaptureRequest"("expiresAt");

ALTER TABLE "EmailCaptureRequest" ADD CONSTRAINT "EmailCaptureRequest_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailCaptureRequest" ADD CONSTRAINT "EmailCaptureRequest_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

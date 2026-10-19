-- Mailroom: per-workspace API connection, per-campaign list destination, per-lead sync state.
ALTER TABLE "Automation"
  ADD COLUMN "mailroomBrand" TEXT,
  ADD COLUMN "mailroomBrandName" TEXT,
  ADD COLUMN "mailroomListId" TEXT,
  ADD COLUMN "mailroomListName" TEXT;

ALTER TABLE "Lead"
  ADD COLUMN "mailroomContactId" TEXT,
  ADD COLUMN "mailroomSyncedAt" TIMESTAMP(3),
  ADD COLUMN "mailroomError" TEXT;

CREATE TABLE "MailroomConnection" (
  "workspaceId" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "apiKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MailroomConnection_pkey" PRIMARY KEY ("workspaceId")
);

ALTER TABLE "MailroomConnection" ADD CONSTRAINT "MailroomConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

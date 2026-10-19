import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import type { MailroomConnectionInput } from "./client";

/** The workspace's decrypted Mailroom credentials, or null when not connected. */
export async function getMailroomConnection(
  workspaceId: string
): Promise<MailroomConnectionInput | null> {
  const saved = await prisma.mailroomConnection.findUnique({ where: { workspaceId } });
  if (!saved) return null;
  return { baseUrl: saved.baseUrl, apiKey: decryptToken(saved.apiKey) };
}

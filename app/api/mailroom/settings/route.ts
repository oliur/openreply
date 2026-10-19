import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { encryptToken } from "@/lib/meta/oauth";
import { listBrands, normalizeBaseUrl } from "@/lib/mailroom/client";
import { getMailroomConnection } from "@/lib/mailroom/connection";
import { withMailroom } from "@/lib/mailroom/route-handler";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  baseUrl: z.string().trim().min(3).max(300),
  apiKey: z.string().trim().min(10).max(512),
});

/** Connection state plus the brands the key can see. Readable by every member
 * so the campaign builder can offer the brand and list pickers. */
export const GET = withMailroom(
  async ({ workspaceId }) => {
    const connection = await getMailroomConnection(workspaceId);
    if (!connection)
      return NextResponse.json({ success: true, data: { configured: false, brands: [] } });
    let brands: Awaited<ReturnType<typeof listBrands>> = [];
    let error: string | null = null;
    try {
      brands = await listBrands(connection);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not load Mailroom brands.";
    }
    return NextResponse.json({
      success: true,
      data: { configured: true, baseUrl: connection.baseUrl, brands, error },
    });
  },
  { manage: false }
);

export const POST = withMailroom(async ({ workspaceId }, request) => {
  const body = saveSchema.parse(await request.json().catch(() => null));
  const baseUrl = normalizeBaseUrl(body.baseUrl);
  // Prove the key works before storing it, so a typo surfaces now.
  const brands = await listBrands({ baseUrl, apiKey: body.apiKey });
  await prisma.mailroomConnection.upsert({
    where: { workspaceId },
    create: { workspaceId, baseUrl, apiKey: encryptToken(body.apiKey) },
    update: { baseUrl, apiKey: encryptToken(body.apiKey) },
  });
  return NextResponse.json({ success: true, data: { configured: true, baseUrl, brands } });
});

export const DELETE = withMailroom(async ({ workspaceId }) => {
  await prisma.mailroomConnection.deleteMany({ where: { workspaceId } });
  // Campaigns keep their list choice but stop syncing; clearing it would lose
  // the team's configuration if the key is re-added a minute later.
  return NextResponse.json({ success: true });
});

import { NextResponse } from "next/server";
import { listLists } from "@/lib/mailroom/client";
import { getMailroomConnection } from "@/lib/mailroom/connection";
import { MailroomRouteError, withMailroom } from "@/lib/mailroom/route-handler";

export const dynamic = "force-dynamic";

/** Lists of one brand, for the campaign builder's picker. */
export const GET = withMailroom(
  async ({ workspaceId }, request) => {
    const brand = new URL(request.url).searchParams.get("brand")?.trim();
    if (!brand) throw new MailroomRouteError("Choose a brand first.");
    const connection = await getMailroomConnection(workspaceId);
    if (!connection) throw new MailroomRouteError("Connect Mailroom in Settings first.", 404);
    const lists = await listLists(connection, brand);
    return NextResponse.json({ success: true, data: { lists } });
  },
  { manage: false }
);

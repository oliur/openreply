import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

// Read-your-writes: a lead captured a second ago must show up.
export const dynamic = "force-dynamic";

function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  // A leading =, +, - or @ would be executed as a formula by spreadsheets.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const automationId = searchParams.get("automationId");
  const instagramAccountId = searchParams.get("instagramAccountId");
  const format = searchParams.get("format");

  const where = {
    workspaceId,
    ...(automationId && automationId !== "all" ? { automationId } : {}),
    ...(instagramAccountId && instagramAccountId !== "all"
      ? { instagramAccountId }
      : {}),
  };

  const include = {
    automation: { select: { id: true, name: true } },
    instagramAccount: { select: { username: true } },
  };

  if (format === "csv") {
    const leads = await prisma.lead.findMany({
      where,
      orderBy: { capturedAt: "desc" },
      include,
    });
    const header = [
      "email",
      "instagram_username",
      "campaign",
      "captured_at",
      "email_sent_at",
      "email_error",
    ];
    const rows = leads.map((lead) =>
      [
        lead.email,
        lead.username,
        lead.automation.name,
        lead.capturedAt.toISOString(),
        lead.emailSentAt?.toISOString() ?? "",
        lead.emailError,
      ]
        .map(csvCell)
        .join(",")
    );
    const body = [header.join(","), ...rows].join("\r\n") + "\r\n";
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="openreply-leads-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? "25", 10))
  );
  const skip = (page - 1) * limit;

  const [leads, total, campaigns] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { capturedAt: "desc" },
      skip,
      take: limit,
      include,
    }),
    prisma.lead.count({ where }),
    prisma.automation.findMany({
      where: { workspaceId, emailCaptureEnabled: true },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      leads,
      campaigns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
}

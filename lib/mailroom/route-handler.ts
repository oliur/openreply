import { NextResponse } from "next/server";
import { z } from "zod";
import { MailroomApiError } from "@/lib/mailroom/client";
import { isTrustedOrigin } from "@/lib/zernio/route-handler";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
  type WorkspaceContext,
} from "@/lib/workspace-access";

export class MailroomRouteError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

/**
 * Wraps a Mailroom route: signed-in, workspace member (owner/admin for
 * anything but GET), same-origin for mutations, and Mailroom errors turned
 * into readable JSON instead of a 500.
 */
export function withMailroom(
  handler: (context: WorkspaceContext, request: Request) => Promise<Response>,
  { manage = true }: { manage?: boolean } = {}
) {
  return async (request: Request) => {
    try {
      const context = await getCurrentWorkspaceContext();
      if (!context) throw new MailroomRouteError("Sign in to manage your connection.", 401);
      if (manage && !canManageWorkspace(context.role))
        throw new MailroomRouteError(
          "Only workspace owners and admins can manage the Mailroom connection.",
          403
        );
      if (request.method !== "GET") {
        const origin = request.headers.get("origin");
        if (origin && !isTrustedOrigin(request, origin))
          throw new MailroomRouteError("Invalid request origin.", 403);
      }
      return await handler(context, request);
    } catch (error) {
      if (error instanceof MailroomRouteError)
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      if (error instanceof z.ZodError)
        return NextResponse.json(
          { success: false, error: error.issues.map((i) => i.message).join("; ") },
          { status: 400 }
        );
      if (error instanceof MailroomApiError) {
        const message =
          error.status === 401
            ? "Mailroom rejected the API key."
            : error.status === 403
              ? "This Mailroom key cannot read brands. Use a full key with the editor or admin role."
              : error.message;
        return NextResponse.json({ success: false, error: message }, { status: 502 });
      }
      if (error instanceof Error && /Mailroom URL/.test(error.message))
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      return NextResponse.json(
        { success: false, error: "Could not reach Mailroom. Please retry." },
        { status: 502 }
      );
    }
  };
}

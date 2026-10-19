/**
 * Mailroom API client.
 *
 * Mailroom is a self-hosted email platform with a REST API under /api/v1,
 * authenticated with a workspace API key (`Authorization: Bearer mr_…`). Only
 * the three calls OpenReply needs live here: list brands, list a brand's lists,
 * and upsert a contact into a list.
 */

export class MailroomApiError extends Error {
  constructor(
    public status: number,
    message?: string
  ) {
    super(message ?? `Mailroom request failed (HTTP ${status})`);
  }
}

export interface MailroomBrand {
  id: string;
  name: string;
  slug: string;
}

export interface MailroomList {
  id: string;
  name: string;
  counts?: { active?: number; subscribed?: number };
}

export interface MailroomContact {
  id: string;
  email: string;
  status: string;
}

export interface MailroomConnectionInput {
  baseUrl: string;
  apiKey: string;
}

/** Accepts "email.example.com", "https://email.example.com/" or a full /api/v1 URL. */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new Error("Mailroom URL must use https");
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

export async function mailroomRequest<T>({
  connection,
  path,
  method = "GET",
  body,
}: {
  connection: MailroomConnectionInput;
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Invalid Mailroom API path");
  const response = await fetch(`${connection.baseUrl}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${connection.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new MailroomApiError(502, "Could not reach Mailroom");
  });
  if (!response.ok) {
    let detail = "";
    try {
      const parsed = (await response.json()) as { error?: { message?: string } | string };
      detail =
        typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? "";
    } catch {
      /* no JSON body */
    }
    throw new MailroomApiError(
      response.status,
      detail ? `Mailroom: ${detail}` : undefined
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json().catch(() => {
    throw new MailroomApiError(502, "Mailroom returned an unreadable response");
  }) as Promise<T>;
}

export async function listBrands(
  connection: MailroomConnectionInput
): Promise<MailroomBrand[]> {
  const result = await mailroomRequest<{ data: MailroomBrand[] }>({
    connection,
    path: "/brands",
  });
  return (result.data ?? []).map(({ id, name, slug }) => ({ id, name, slug }));
}

export async function listLists(
  connection: MailroomConnectionInput,
  brand: string
): Promise<MailroomList[]> {
  const result = await mailroomRequest<{ data: MailroomList[] }>({
    connection,
    path: `/brands/${encodeURIComponent(brand)}/lists`,
  });
  return (result.data ?? []).map(({ id, name, counts }) => ({ id, name, counts }));
}

/** Upsert by email; an existing contact is added to the list, never re-subscribed. */
export async function upsertContact(
  connection: MailroomConnectionInput,
  brand: string,
  input: {
    email: string;
    firstName?: string | null;
    listIds: string[];
    tags?: string[];
    source?: string;
  }
): Promise<MailroomContact> {
  const result = await mailroomRequest<{ data: MailroomContact }>({
    connection,
    path: `/brands/${encodeURIComponent(brand)}/contacts`,
    method: "POST",
    body: {
      email: input.email,
      ...(input.firstName ? { firstName: input.firstName } : {}),
      listIds: input.listIds,
      ...(input.tags?.length ? { tags: input.tags } : {}),
      source: input.source ?? "openreply",
    },
  });
  return result.data;
}

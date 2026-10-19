"use client";

/**
 * Leads
 *
 * Email addresses captured by campaigns with email capture turned on, with the
 * delivery state of the reply email, filterable by campaign and exportable as
 * CSV.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";

interface Lead {
  id: string;
  email: string;
  username: string | null;
  igUserId: string;
  capturedAt: string;
  emailSentAt: string | null;
  emailError: string | null;
  mailroomSyncedAt: string | null;
  mailroomError: string | null;
  automation: { id: string; name: string; mailroomListName?: string | null };
  instagramAccount: { username: string };
}

interface CampaignOption {
  id: string;
  name: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function LeadsPage() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [selectedCampaignId, setSelectedCampaignId] = useState(
    searchParams.get("automationId") ?? "all"
  );
  const [page, setPage] = useState(1);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedCampaignId !== "all") params.set("automationId", selectedCampaignId);
    if (selectedAccountId !== "all") params.set("instagramAccountId", selectedAccountId);
    return params;
  }, [selectedCampaignId, selectedAccountId]);

  const fetchLeads = useCallback(async () => {
    try {
      const params = buildParams();
      params.set("page", String(page));
      params.set("limit", "25");
      const res = await fetch(`/api/leads?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setLeads(data.data.leads);
        setCampaigns(data.data.campaigns);
        setPagination(data.data.pagination);
      }
    } catch (err) {
      console.error("Failed to fetch leads:", err);
    } finally {
      setLoading(false);
    }
  }, [buildParams, page]);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchLeads();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchLeads]);

  const exportParams = buildParams();
  exportParams.set("format", "csv");

  const formatDate = (value: string) =>
    new Date(value).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted">{t("Campaign")}</label>
            <select
              value={selectedCampaignId}
              onChange={(e) => {
                setLoading(true);
                setSelectedCampaignId(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none"
            >
              <option value="all">{t("All campaigns")}</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts}
              value={selectedAccountId}
              onChange={(accountId) => {
                setLoading(true);
                setSelectedAccountId(accountId);
                setPage(1);
              }}
            />
          )}
        </div>
        <a
          href={`/api/leads?${exportParams}`}
          className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:border-border-hover"
        >
          {t("Export CSV")}
        </a>
      </div>

      {loading ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-sm text-muted">
            {t("No leads yet. Turn on email capture in a campaign to start collecting addresses.")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t("Email")}</th>
                <th className="px-4 py-3 font-medium">{t("Instagram")}</th>
                <th className="px-4 py-3 font-medium">{t("Campaign")}</th>
                <th className="px-4 py-3 font-medium">{t("Captured")}</th>
                <th className="px-4 py-3 font-medium">{t("Email reply")}</th>
                <th className="px-4 py-3 font-medium">Mailroom</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <a href={`mailto:${lead.email}`} className="text-foreground hover:underline">
                      {lead.email}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {lead.username ? `@${lead.username}` : lead.igUserId}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/campaigns/${lead.automation.id}`} className="text-foreground hover:underline">
                      {lead.automation.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDate(lead.capturedAt)}</td>
                  <td className="px-4 py-3">
                    {lead.emailSentAt ? (
                      <span className="text-emerald-500">
                        {t("Sent {when}", { when: formatDate(lead.emailSentAt) })}
                      </span>
                    ) : lead.emailError ? (
                      <span className="text-red-500" title={lead.emailError}>
                        {t("Failed")}
                      </span>
                    ) : (
                      <span className="text-muted">{t("Sending...")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {lead.mailroomSyncedAt ? (
                      <span className="text-emerald-500">
                        {lead.automation.mailroomListName ?? t("Added")}
                      </span>
                    ) : lead.mailroomError ? (
                      <span className="text-red-500" title={lead.mailroomError}>
                        {t("Failed")}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            {t("Page {page} of {total}", { page: pagination.page, total: pagination.totalPages })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
            >
              {t("Previous")}
            </button>
            <button
              type="button"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
            >
              {t("Next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

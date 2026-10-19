"use client";

/**
 * Settings card for the workspace's Mailroom connection. Mailroom is the
 * team's own email platform; with a key saved here, campaigns that capture
 * emails can add each lead to a Mailroom list of their choosing.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useCallback, useEffect, useState } from "react";

type ConnectionData = {
  configured: boolean;
  baseUrl?: string;
  brands: { id: string; name: string; slug: string }[];
  error?: string | null;
};

export function MailroomConnection({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<ConnectionData | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/mailroom/settings", { cache: "no-store" });
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    setData(result.data);
    if (result.data.baseUrl) setBaseUrl(result.data.baseUrl);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((e) =>
        setError(e instanceof Error ? e.message : t("Could not load connection."))
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh, t]);

  async function act(method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mailroom/settings", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      setApiKey("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not update connection."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel rounded p-4 sm:p-6" aria-labelledby="mailroom-heading">
      <h2 id="mailroom-heading" className="text-base font-semibold text-foreground">
        Mailroom
      </h2>
      <p className="mt-1 text-sm text-muted">
        {t("Add captured emails to a list in your own Mailroom. Each campaign picks its brand and list.")}
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded border border-error/30 p-3 text-sm text-error">
          {error}
        </p>
      )}
      {!data ? (
        <p className="mt-4 text-sm text-muted">{t("Loading…")}</p>
      ) : data.configured ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-foreground">
            {t("Connected to {url}", { url: data.baseUrl ?? "" })}
            {" · "}
            {t("{count} brands", { count: data.brands.length })}
          </p>
          {data.error && <p className="text-sm text-error">{data.error}</p>}
          {canManage && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm(t("Remove the Mailroom connection? Campaigns stop adding leads to lists until a key is saved again.")))
                  void act("DELETE");
              }}
              className="text-xs text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
            >
              {t("Remove Mailroom connection")}
            </button>
          )}
        </div>
      ) : !canManage ? (
        <p className="mt-4 text-sm text-muted">{t("Ask your workspace owner or admin to connect Mailroom.")}</p>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act("POST", { baseUrl, apiKey });
          }}
        >
          <div className="space-y-1">
            <label className="block text-sm font-medium text-foreground" htmlFor="mailroom-url">
              {t("Mailroom URL")}
            </label>
            <input
              id="mailroom-url"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://email.example.com"
              required
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-foreground" htmlFor="mailroom-key">
              {t("Mailroom API key")}
            </label>
            <input
              id="mailroom-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none"
            />
            <p className="text-xs text-muted">
              {t("Create a full key with the editor role under Workspace settings, API keys in Mailroom. It is encrypted and never shown again.")}
            </p>
          </div>
          <button
            type="submit"
            disabled={busy || !apiKey || !baseUrl}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t("Saving…") : t("Connect Mailroom")}
          </button>
        </form>
      )}
    </section>
  );
}

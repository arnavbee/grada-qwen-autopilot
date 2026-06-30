"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { apiRequest } from "@/src/lib/api-client";
import { getBrandProfile, listCartonRules } from "@/src/lib/settings";

interface TotalResponse {
  total: number;
}

interface DashboardStats {
  catalogReady: number;
  catalogNeedsReview: number;
  poDrafts: number;
  poAnalyzing: number;
  poReady: number;
  receivedUploaded: number;
  receivedParsed: number;
  receivedConfirmed: number;
  cartonRules: number;
  brandProfileCompletion: number;
}

interface AttentionItem {
  title: string;
  detail: string;
  href: string;
  badge: string;
}

const EMPTY_STATS: DashboardStats = {
  catalogReady: 0,
  catalogNeedsReview: 0,
  poDrafts: 0,
  poAnalyzing: 0,
  poReady: 0,
  receivedUploaded: 0,
  receivedParsed: 0,
  receivedConfirmed: 0,
  cartonRules: 0,
  brandProfileCompletion: 0,
};

function getCompletionPercent(profile: Awaited<ReturnType<typeof getBrandProfile>>): number {
  const fields = [
    profile.supplier_name,
    profile.address,
    profile.gst_number,
    profile.pan_number,
    profile.bill_to_address,
    profile.ship_to_address,
    profile.invoice_prefix,
  ];
  const completed = fields.filter((value) => value.trim().length > 0).length;
  return Math.round((completed / fields.length) * 100);
}

async function fetchTotal(path: string): Promise<number> {
  const response = await apiRequest<TotalResponse>(path, { method: "GET" });
  return response.total ?? 0;
}

export function DashboardView(): JSX.Element {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadDashboard(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const [
          catalogReady,
          catalogNeedsReview,
          poDrafts,
          poAnalyzing,
          poReady,
          receivedUploaded,
          receivedParsed,
          receivedConfirmed,
          cartonRules,
          brandProfile,
        ] = await Promise.all([
          fetchTotal("/catalog/products?status=ready&limit=1"),
          fetchTotal("/catalog/products?status=needs_review&limit=1"),
          fetchTotal("/po-requests?status=draft&limit=1"),
          fetchTotal("/po-requests?status=analyzing&limit=1"),
          fetchTotal("/po-requests?status=ready&limit=1"),
          fetchTotal("/received-pos?status=uploaded&limit=1"),
          fetchTotal("/received-pos?status=parsed&limit=1"),
          fetchTotal("/received-pos?status=confirmed&limit=1"),
          listCartonRules().then((rules) => rules.length),
          getBrandProfile(),
        ]);

        if (!mounted) {
          return;
        }

        setStats({
          catalogReady,
          catalogNeedsReview,
          poDrafts,
          poAnalyzing,
          poReady,
          receivedUploaded,
          receivedParsed,
          receivedConfirmed,
          cartonRules,
          brandProfileCompletion: getCompletionPercent(brandProfile),
        });
      } catch (loadError) {
        if (!mounted) {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load dashboard metrics.",
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      mounted = false;
    };
  }, []);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    if (stats.receivedParsed > 0) {
      items.push({
        title: "Received POs awaiting confirmation",
        detail: `${stats.receivedParsed} parsed PO${stats.receivedParsed === 1 ? "" : "s"} ready for review and document generation.`,
        href: "/dashboard/received-pos",
        badge: "Action Required",
      });
    }
    if (stats.catalogNeedsReview > 0) {
      items.push({
        title: "Catalog styles need review",
        detail: `${stats.catalogNeedsReview} product${stats.catalogNeedsReview === 1 ? "" : "s"} need data verification.`,
        href: "/dashboard/catalog",
        badge: "Review",
      });
    }
    if (stats.poAnalyzing > 0) {
      items.push({
        title: "PO Builders in AI review",
        detail: `${stats.poAnalyzing} workbook${stats.poAnalyzing === 1 ? "" : "s"} processing attribute extraction.`,
        href: "/dashboard/po-builder",
        badge: "In Progress",
      });
    }
    return items;
  }, [stats]);

  return (
    <DashboardShell
      subtitle="Your central hub for catalog management, PO workbook creation, and automated document generation."
      title="Dashboard"
    >
      <div className="space-y-8 pb-16">
        {error ? (
          <Card className="border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </Card>
        ) : null}

        {/* HERO HERO SECTION */}
        <Card className="relative overflow-hidden rounded-[32px] border border-kira-warmgray/30 bg-gradient-to-br from-[#f9f5f0] via-white to-[#f2eae1] p-6 shadow-sm dark:border-white/10 dark:from-[#181a20] dark:via-[#12141a] dark:to-[#1e1a17] md:p-8">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="max-w-2xl space-y-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-kira-brown/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-kira-brown dark:bg-amber-500/20 dark:text-amber-300">
                ✨ Operations Hub
              </span>
              <h1 className="text-3xl font-bold tracking-tight text-kira-black dark:text-white md:text-4xl">
                What would you like to build today?
              </h1>
              <p className="text-sm text-kira-darkgray dark:text-gray-300">
                Manage product catalogs, construct structured PO export workbooks, or turn
                marketplace POs into barcodes, invoices, and packing sheets.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Link href="/dashboard/received-pos">
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-semibold shadow-md">
                  <span>⚡ Upload Received PO</span>
                </Button>
              </Link>
              <Link href="/dashboard/po-builder/new">
                <Button variant="secondary" className="font-semibold">
                  <span>➕ New PO Workbook</span>
                </Button>
              </Link>
            </div>
          </div>
        </Card>

        {/* ATTENTION QUEUE / NOTIFICATIONS */}
        {attentionItems.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-kira-midgray dark:text-gray-400">
              Needs Attention
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
              {attentionItems.map((item) => (
                <Link key={item.title} href={item.href} className="group block">
                  <Card className="h-full rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-500/50 hover:shadow-md dark:border-amber-500/20 dark:bg-amber-500/10">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800 dark:bg-amber-500/30 dark:text-amber-200">
                        {item.badge}
                      </span>
                      <span className="text-xs font-semibold text-kira-brown group-hover:underline dark:text-amber-400">
                        Resolve →
                      </span>
                    </div>
                    <p className="mt-2.5 font-bold text-kira-black dark:text-white">{item.title}</p>
                    <p className="mt-1 text-xs text-kira-darkgray dark:text-gray-300">
                      {item.detail}
                    </p>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {/* CORE PILLARS 2x2 GRID */}
        <div className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-kira-midgray dark:text-gray-400">
            Core Modules
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            {/* CATALOG MODULE */}
            <Card className="flex flex-col justify-between rounded-[28px] border border-kira-warmgray/40 bg-white p-6 shadow-sm transition-all hover:border-kira-brown/40 dark:border-white/10 dark:bg-[#15171e]">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-2xl">
                    📦
                  </span>
                  <div className="flex gap-2">
                    <span className="rounded-full bg-kira-warmgray/20 px-3 py-1 text-xs font-semibold text-kira-darkgray dark:bg-white/10 dark:text-gray-300">
                      {loading ? "..." : stats.catalogReady} Ready
                    </span>
                    {stats.catalogNeedsReview > 0 ? (
                      <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/30 dark:text-amber-200">
                        {stats.catalogNeedsReview} Review
                      </span>
                    ) : null}
                  </div>
                </div>
                <h3 className="mt-4 text-xl font-bold text-kira-black dark:text-white">
                  Catalog Library
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-kira-darkgray dark:text-gray-400">
                  Manage styles, colorways, ratios, and attributes. Approved styles power all
                  downstream PO builders.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-kira-warmgray/15 dark:border-white/5 flex justify-end">
                <Link href="/dashboard/catalog">
                  <Button variant="secondary" className="text-xs font-semibold">
                    Explore Catalog →
                  </Button>
                </Link>
              </div>
            </Card>

            {/* PO BUILDER MODULE */}
            <Card className="flex flex-col justify-between rounded-[28px] border border-kira-warmgray/40 bg-white p-6 shadow-sm transition-all hover:border-kira-brown/40 dark:border-white/10 dark:bg-[#15171e]">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-500/10 text-2xl">
                    🛠️
                  </span>
                  <div className="flex gap-2">
                    <span className="rounded-full bg-kira-warmgray/20 px-3 py-1 text-xs font-semibold text-kira-darkgray dark:bg-white/10 dark:text-gray-300">
                      {loading ? "..." : stats.poDrafts} Drafts
                    </span>
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                      {loading ? "..." : stats.poReady} Exports
                    </span>
                  </div>
                </div>
                <h3 className="mt-4 text-xl font-bold text-kira-black dark:text-white">
                  PO Workbook Builder
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-kira-darkgray dark:text-gray-400">
                  Assemble size distributions, apply packing rules, and generate factory-ready Excel
                  workbooks.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-kira-warmgray/15 dark:border-white/5 flex justify-end">
                <Link href="/dashboard/po-builder">
                  <Button variant="secondary" className="text-xs font-semibold">
                    Open Builder →
                  </Button>
                </Link>
              </div>
            </Card>

            {/* RECEIVED POS MODULE */}
            <Card className="flex flex-col justify-between rounded-[28px] border border-kira-warmgray/40 bg-white p-6 shadow-sm transition-all hover:border-kira-brown/40 dark:border-white/10 dark:bg-[#15171e]">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-2xl">
                    📑
                  </span>
                  <div className="flex gap-2">
                    <span className="rounded-full bg-kira-warmgray/20 px-3 py-1 text-xs font-semibold text-kira-darkgray dark:bg-white/10 dark:text-gray-300">
                      {loading
                        ? "..."
                        : stats.receivedUploaded +
                          stats.receivedParsed +
                          stats.receivedConfirmed}{" "}
                      Total POs
                    </span>
                  </div>
                </div>
                <h3 className="mt-4 text-xl font-bold text-kira-black dark:text-white">
                  Received POs & Documents
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-kira-darkgray dark:text-gray-400">
                  Upload marketplace PDFs or images, verify extracted line items, and auto-generate
                  Barcode sheets, Commercial Invoices, and Packing lists.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-kira-warmgray/15 dark:border-white/5 flex justify-end">
                <Link href="/dashboard/received-pos">
                  <Button className="bg-kira-brown hover:bg-kira-brown/90 text-white text-xs font-semibold">
                    Review POs →
                  </Button>
                </Link>
              </div>
            </Card>

            {/* SETTINGS MODULE */}
            <Card className="flex flex-col justify-between rounded-[28px] border border-kira-warmgray/40 bg-white p-6 shadow-sm transition-all hover:border-kira-brown/40 dark:border-white/10 dark:bg-[#15171e]">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-500/10 text-2xl">
                    ⚙️
                  </span>
                  <div className="flex gap-2">
                    <span className="rounded-full bg-kira-warmgray/20 px-3 py-1 text-xs font-semibold text-kira-darkgray dark:bg-white/10 dark:text-gray-300">
                      {loading ? "..." : `${stats.brandProfileCompletion}%`} Profile
                    </span>
                    <span className="rounded-full bg-kira-warmgray/20 px-3 py-1 text-xs font-semibold text-kira-darkgray dark:bg-white/10 dark:text-gray-300">
                      {loading ? "..." : stats.cartonRules} Carton Rules
                    </span>
                  </div>
                </div>
                <h3 className="mt-4 text-xl font-bold text-kira-black dark:text-white">
                  Operational Settings
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-kira-darkgray dark:text-gray-400">
                  Configure supplier identity, tax details, invoice prefixes, barcode templates, and
                  standard carton measurement rules.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-kira-warmgray/15 dark:border-white/5 flex justify-end">
                <Link href="/dashboard/settings">
                  <Button variant="secondary" className="text-xs font-semibold">
                    Manage Settings →
                  </Button>
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

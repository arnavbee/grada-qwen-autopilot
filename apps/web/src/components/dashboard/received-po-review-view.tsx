"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Clock3, FileWarning, RotateCw, UserCheck } from "lucide-react";

import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { LineItemsTable } from "@/src/components/received-po/LineItemsTable";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import {
  type ReceivedPOAgentEvent,
  type ReceivedPOExceptionsResponse,
  type ReceivedPO,
  type ReceivedPOHeaderInput,
  type ReceivedPOLineItemInput,
  confirmReceivedPO,
  getReceivedPO,
  listReceivedPOAgentEvents,
  listReceivedPOExceptions,
  resolveReceivedPOException,
  resolveReceivedPOExceptionsBulk,
  runReceivedPOExceptions,
  updateReceivedPOHeader,
  updateReceivedPOItems,
} from "@/src/lib/received-po";
import { getTotalQuantity, toEditableLineItems, toHeaderDraft } from "@/src/lib/received-po-ui";

interface ReceivedPOReviewViewProps {
  receivedPoId: string;
}

interface ExceptionEditDraft {
  size: string;
  color: string;
  knitted_woven: string;
  quantity: string;
  po_price: string;
}

type ExceptionFilter = "all" | "needs_review" | "low_risk" | "no_suggestion";

function formatEventTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Just now";
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getAgentEventTone(event: ReceivedPOAgentEvent): string {
  if (event.status === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200";
  }
  if (event.status === "needs_review") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-100";
  }
  if (event.status === "queued" || event.status === "running") {
    return "border-kira-warmgray/35 bg-kira-warmgray/20 text-kira-darkgray dark:border-white/10 dark:bg-white/10 dark:text-gray-200";
  }
  if (event.actor_type === "human") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-300/25 dark:bg-emerald-300/10 dark:text-emerald-100";
  }
  return "border-kira-brown/20 bg-kira-brown/10 text-kira-darkgray dark:border-kira-brown/30 dark:bg-kira-brown/15 dark:text-kira-offwhite";
}

function AgentEventIcon({ event }: { event: ReceivedPOAgentEvent }): JSX.Element {
  const className = "h-4 w-4";
  if (event.status === "failed") {
    return <FileWarning aria-hidden="true" className={className} />;
  }
  if (event.status === "queued" || event.status === "running") {
    return <Clock3 aria-hidden="true" className={className} />;
  }
  if (event.actor_type === "human") {
    return <UserCheck aria-hidden="true" className={className} />;
  }
  return <Bot aria-hidden="true" className={className} />;
}

interface AutopilotTimelineProps {
  events: ReceivedPOAgentEvent[];
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}

function AutopilotTimeline({
  events,
  error,
  loading,
  onRetry,
}: AutopilotTimelineProps): JSX.Element {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-kira-warmgray/20 px-5 py-4 dark:border-white/10">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-kira-midgray">
            Autopilot timeline
          </p>
          <h2 className="mt-2 text-xl font-semibold text-kira-black dark:text-white">
            Qwen agent run
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-kira-darkgray dark:text-gray-300">
            Tracks extraction, tool calls, review gates, and generated outputs for this PO.
          </p>
        </div>
        <Button
          aria-label="Refresh autopilot timeline"
          className="min-h-10 gap-2"
          disabled={loading}
          onClick={onRetry}
          variant="secondary"
        >
          <RotateCw aria-hidden="true" className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading autopilot timeline">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                className="h-16 rounded-md border border-kira-warmgray/20 bg-kira-warmgray/15 dark:border-white/10 dark:bg-white/5"
                key={index}
              />
            ))}
          </div>
        ) : null}

        {!loading && error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-100">
            <p className="font-semibold">Could not load the agent timeline.</p>
            <p className="mt-1">{error}</p>
            <Button className="mt-3" onClick={onRetry} variant="secondary">
              Try again
            </Button>
          </div>
        ) : null}

        {!loading && !error && events.length === 0 ? (
          <div className="rounded-md border border-dashed border-kira-warmgray/35 p-5 text-sm text-kira-darkgray dark:border-white/15 dark:text-gray-300">
            No agent events yet. Upload or reprocess a PO to start the autopilot trail.
          </div>
        ) : null}

        {!loading && !error && events.length > 0 ? (
          <ol className="space-y-3">
            {events.map((event) => (
              <li
                className="grid gap-3 rounded-md border border-kira-warmgray/20 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5 sm:grid-cols-[minmax(0,1fr)_auto]"
                key={event.id}
              >
                <div className="flex min-w-0 gap-3">
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${getAgentEventTone(
                      event,
                    )}`}
                  >
                    <AgentEventIcon event={event} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-kira-black dark:text-white">
                        {event.title}
                      </p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${getAgentEventTone(
                          event,
                        )}`}
                      >
                        {event.actor_type === "human" ? "Human" : "Agent"}
                      </span>
                    </div>
                    {event.summary ? (
                      <p className="mt-1 text-sm leading-6 text-kira-darkgray dark:text-gray-300">
                        {event.summary}
                      </p>
                    ) : null}
                    {event.tool_name ? (
                      <p className="mt-1 text-xs text-kira-midgray">Tool: {event.tool_name}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs text-kira-midgray sm:block sm:text-right">
                  <span>{formatEventTime(event.created_at)}</span>
                  {event.status === "completed" ? (
                    <CheckCircle2
                      aria-label="Completed"
                      className="mt-0.5 inline h-4 w-4 text-emerald-700 dark:text-emerald-300"
                    />
                  ) : (
                    <span className="block capitalize">{event.status.replace("_", " ")}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </Card>
  );
}

function getKnittedWovenValue(item: ReceivedPOExceptionsResponse["items"][number]): string {
  const value = (item as { knitted_woven?: string | null; woven_knits?: string | null })
    .knitted_woven;
  const fallback = (item as { knitted_woven?: string | null; woven_knits?: string | null })
    .woven_knits;
  return value ?? fallback ?? "";
}

export function ReceivedPOReviewView({ receivedPoId }: ReceivedPOReviewViewProps): JSX.Element {
  const [record, setRecord] = useState<ReceivedPO | null>(null);
  const [agentEvents, setAgentEvents] = useState<ReceivedPOAgentEvent[]>([]);
  const [headerDraft, setHeaderDraft] = useState<ReceivedPOHeaderInput>({});
  const [itemDrafts, setItemDrafts] = useState<ReceivedPOLineItemInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentEventsLoading, setAgentEventsLoading] = useState(true);
  const [agentEventsError, setAgentEventsError] = useState<string | null>(null);
  const [exceptionsLoading, setExceptionsLoading] = useState(true);
  const [exceptionsRefreshing, setExceptionsRefreshing] = useState(false);
  const [bulkResolving, setBulkResolving] = useState(false);
  const [exceptionsState, setExceptionsState] = useState<ReceivedPOExceptionsResponse | null>(null);
  const [resolvingLineItemId, setResolvingLineItemId] = useState<string | null>(null);
  const [editingExceptionId, setEditingExceptionId] = useState<string | null>(null);
  const [selectedExceptionId, setSelectedExceptionId] = useState<string | null>(null);
  const [expandedReasonId, setExpandedReasonId] = useState<string | null>(null);
  const [exceptionFilter, setExceptionFilter] = useState<ExceptionFilter>("all");
  const [exceptionEditDrafts, setExceptionEditDrafts] = useState<
    Record<string, ExceptionEditDraft>
  >({});
  const [savingHeader, setSavingHeader] = useState(false);
  const [savingItems, setSavingItems] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshAgentEvents = useCallback(async (): Promise<void> => {
    try {
      setAgentEventsLoading(true);
      setAgentEventsError(null);
      const response = await listReceivedPOAgentEvents(receivedPoId);
      setAgentEvents(response.items);
    } catch (timelineError) {
      setAgentEventsError(
        timelineError instanceof Error
          ? timelineError.message
          : "Failed to load autopilot timeline.",
      );
    } finally {
      setAgentEventsLoading(false);
    }
  }, [receivedPoId]);

  useEffect(() => {
    let active = true;
    getReceivedPO(receivedPoId)
      .then((response) => {
        if (!active) {
          return;
        }
        setRecord(response);
        setHeaderDraft(toHeaderDraft(response));
        setItemDrafts(toEditableLineItems(response));
        listReceivedPOAgentEvents(receivedPoId)
          .then((timelineResponse) => {
            if (!active) {
              return;
            }
            setAgentEvents(timelineResponse.items);
            setAgentEventsError(null);
          })
          .catch((timelineError) => {
            if (!active) {
              return;
            }
            setAgentEventsError(
              timelineError instanceof Error
                ? timelineError.message
                : "Failed to load autopilot timeline.",
            );
          })
          .finally(() => {
            if (active) {
              setAgentEventsLoading(false);
            }
          });
        listReceivedPOExceptions(receivedPoId)
          .then((exceptionsResponse) => {
            if (!active) {
              return;
            }
            setExceptionsState(exceptionsResponse);
          })
          .catch(() => {
            if (!active) {
              return;
            }
            setExceptionsState(null);
          })
          .finally(() => {
            if (active) {
              setExceptionsLoading(false);
            }
          });
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load received PO.");
        setAgentEventsLoading(false);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [receivedPoId]);

  const totalQuantity = useMemo(() => getTotalQuantity(itemDrafts), [itemDrafts]);
  const editable = record?.status !== "confirmed";
  const exceptionItems = useMemo(() => exceptionsState?.items ?? [], [exceptionsState?.items]);
  const confidenceBand = (confidence: number | null | undefined): "high" | "medium" | "low" => {
    const value = Number(confidence ?? 0);
    if (value >= 0.9) {
      return "high";
    }
    if (value >= 0.7) {
      return "medium";
    }
    return "low";
  };
  const filteredExceptionItems = useMemo(() => {
    if (exceptionFilter === "all") {
      return exceptionItems;
    }
    if (exceptionFilter === "needs_review") {
      return exceptionItems.filter((item) => item.resolution_status === "needs_review");
    }
    if (exceptionFilter === "low_risk") {
      return exceptionItems.filter((item) => confidenceBand(item.confidence_score) === "high");
    }
    return exceptionItems.filter(
      (item) => !item.suggested_fix || Object.keys(item.suggested_fix).length === 0,
    );
  }, [exceptionFilter, exceptionItems]);
  const selectedException =
    filteredExceptionItems.find((item) => item.id === selectedExceptionId) ??
    filteredExceptionItems[0] ??
    null;

  useEffect(() => {
    if (filteredExceptionItems.length === 0) {
      setSelectedExceptionId(null);
      return;
    }
    if (
      !selectedExceptionId ||
      !filteredExceptionItems.some((item) => item.id === selectedExceptionId)
    ) {
      const firstItem = filteredExceptionItems[0];
      if (firstItem) {
        setSelectedExceptionId(firstItem.id);
      }
    }
  }, [filteredExceptionItems, selectedExceptionId]);

  const handleSaveHeader = async (): Promise<void> => {
    try {
      setSavingHeader(true);
      setError(null);
      setMessage(null);
      const updated = await updateReceivedPOHeader(receivedPoId, headerDraft);
      setRecord(updated);
      setMessage("PO header saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save PO header.");
    } finally {
      setSavingHeader(false);
    }
  };

  const handleSaveItems = async (): Promise<void> => {
    try {
      setSavingItems(true);
      setError(null);
      setMessage(null);
      const updated = await updateReceivedPOItems(receivedPoId, itemDrafts);
      setRecord(updated);
      setItemDrafts(toEditableLineItems(updated));
      setMessage("Line items saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save line items.");
    } finally {
      setSavingItems(false);
    }
  };

  const handleConfirm = async (): Promise<void> => {
    try {
      setConfirming(true);
      setError(null);
      setMessage(null);
      await confirmReceivedPO(receivedPoId);
      const refreshed = await getReceivedPO(receivedPoId);
      setRecord(refreshed);
      setHeaderDraft(toHeaderDraft(refreshed));
      await refreshAgentEvents();
      setMessage("Received PO confirmed. Fields are now locked.");
    } catch (confirmError) {
      setError(
        confirmError instanceof Error ? confirmError.message : "Failed to confirm received PO.",
      );
    } finally {
      setConfirming(false);
    }
  };

  const handleRunExceptions = async (): Promise<void> => {
    try {
      setExceptionsRefreshing(true);
      setError(null);
      const response = await runReceivedPOExceptions(receivedPoId);
      setExceptionsState(response);
      await refreshAgentEvents();
      setMessage("Exception scan completed.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to run exception scan.");
    } finally {
      setExceptionsRefreshing(false);
    }
  };

  const handleResolveException = async (
    lineItemId: string,
    action: "accept" | "reject",
    payload?: Partial<ExceptionEditDraft>,
  ): Promise<void> => {
    try {
      setResolvingLineItemId(lineItemId);
      setError(null);
      const quantityValue =
        payload?.quantity && payload.quantity.trim().length > 0
          ? Number(payload.quantity)
          : undefined;
      const poPriceValue =
        payload?.po_price && payload.po_price.trim().length > 0
          ? Number(payload.po_price)
          : undefined;

      const response = await resolveReceivedPOException(receivedPoId, lineItemId, {
        action,
        size: payload?.size?.trim() ? payload.size.trim() : undefined,
        color: payload?.color?.trim() ? payload.color.trim() : undefined,
        knitted_woven: payload?.knitted_woven?.trim() ? payload.knitted_woven.trim() : undefined,
        quantity:
          typeof quantityValue === "number" && Number.isFinite(quantityValue)
            ? quantityValue
            : undefined,
        po_price:
          typeof poPriceValue === "number" && Number.isFinite(poPriceValue)
            ? poPriceValue
            : undefined,
      });
      setExceptionsState(response);
      setEditingExceptionId(null);
      const refreshed = await getReceivedPO(receivedPoId);
      setRecord(refreshed);
      setItemDrafts(toEditableLineItems(refreshed));
      await refreshAgentEvents();
      setMessage(action === "accept" ? "Suggested fix accepted." : "Suggestion rejected.");
    } catch (resolveError) {
      setError(
        resolveError instanceof Error ? resolveError.message : "Failed to resolve exception.",
      );
    } finally {
      setResolvingLineItemId(null);
    }
  };

  const handleBulkResolveLowRisk = async (): Promise<void> => {
    try {
      setBulkResolving(true);
      setError(null);
      const response = await resolveReceivedPOExceptionsBulk(receivedPoId, {
        min_confidence: 0.9,
        only_with_suggestions: true,
      });
      setExceptionsState({
        received_po_id: response.received_po_id,
        status: record?.status ?? "parsed",
        summary: response.summary,
        items: response.items,
      });
      const refreshed = await getReceivedPO(receivedPoId);
      setRecord(refreshed);
      setItemDrafts(toEditableLineItems(refreshed));
      await refreshAgentEvents();
      setMessage(`Approved ${response.processed_count} low-risk exception(s).`);
    } catch (bulkError) {
      setError(
        bulkError instanceof Error ? bulkError.message : "Failed to approve low-risk exceptions.",
      );
    } finally {
      setBulkResolving(false);
    }
  };

  const startEditingException = (item: ReceivedPOExceptionsResponse["items"][number]): void => {
    const suggestedFix = item.suggested_fix ?? {};
    setEditingExceptionId(item.id);
    setExceptionEditDrafts((current) => ({
      ...current,
      [item.id]: {
        size: String(suggestedFix.size ?? item.size ?? ""),
        color: String(suggestedFix.color ?? item.color ?? ""),
        knitted_woven: String(suggestedFix.knitted_woven ?? getKnittedWovenValue(item)),
        quantity: String(suggestedFix.quantity ?? item.quantity ?? ""),
        po_price: String(suggestedFix.po_price ?? item.po_price ?? ""),
      },
    }));
  };

  const updateExceptionDraft = (
    lineItemId: string,
    field: keyof ExceptionEditDraft,
    value: string,
  ): void => {
    setExceptionEditDrafts((current) => ({
      ...current,
      [lineItemId]: {
        ...(current[lineItemId] ?? {
          size: "",
          color: "",
          knitted_woven: "",
          quantity: "",
          po_price: "",
        }),
        [field]: value,
      },
    }));
  };

  const handleNavigateSelectedException = (direction: "next" | "prev"): void => {
    if (filteredExceptionItems.length === 0 || !selectedExceptionId) {
      return;
    }
    const currentIndex = filteredExceptionItems.findIndex(
      (item) => item.id === selectedExceptionId,
    );
    if (currentIndex < 0) {
      const firstItem = filteredExceptionItems[0];
      if (firstItem) {
        setSelectedExceptionId(firstItem.id);
      }
      return;
    }
    const nextIndex =
      direction === "next"
        ? (currentIndex + 1) % filteredExceptionItems.length
        : (currentIndex - 1 + filteredExceptionItems.length) % filteredExceptionItems.length;
    const nextItem = filteredExceptionItems[nextIndex];
    if (nextItem) {
      setSelectedExceptionId(nextItem.id);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !editable ||
        filteredExceptionItems.length === 0 ||
        !selectedExceptionId ||
        resolvingLineItemId
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase() ?? "";
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target?.isContentEditable
      ) {
        return;
      }

      const selectedItem = filteredExceptionItems.find((item) => item.id === selectedExceptionId);
      if (!selectedItem) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        const draft =
          editingExceptionId === selectedItem.id ? exceptionEditDrafts[selectedItem.id] : undefined;
        void handleResolveException(selectedItem.id, "accept", draft);
      } else if (key === "r") {
        event.preventDefault();
        void handleResolveException(selectedItem.id, "reject");
      } else if (key === "e") {
        event.preventDefault();
        if (editingExceptionId === selectedItem.id) {
          setEditingExceptionId(null);
        } else {
          startEditingException(selectedItem);
        }
      } else if (key === "j") {
        event.preventDefault();
        handleNavigateSelectedException("next");
      } else if (key === "k") {
        event.preventDefault();
        handleNavigateSelectedException("prev");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editable,
    filteredExceptionItems,
    selectedExceptionId,
    resolvingLineItemId,
    editingExceptionId,
    exceptionEditDrafts,
  ]);

  const explainExceptionReason = (reason: string | null | undefined): string => {
    const normalized = String(reason ?? "")
      .trim()
      .toLowerCase();
    if (!normalized) {
      return "The system could not confidently normalize this row, so it requires manual review.";
    }
    if (normalized.includes("size_normalized")) {
      return "Size appears to contain variant spelling or formatting and was normalized using known size dictionaries.";
    }
    if (normalized.includes("color_normalized")) {
      return "Color formatting was standardized to keep downstream barcode and invoice outputs consistent.";
    }
    if (normalized.includes("construction_normalized")) {
      return "Knitted/Woven value matched a known alias and was normalized.";
    }
    if (normalized.includes("po_price_missing_or_zero")) {
      return "PO price is missing or zero, which can break invoice totals and must be confirmed manually.";
    }
    if (normalized.includes("quantity_missing_or_zero")) {
      return "Quantity is missing or zero, which can break carton and dispatch calculations.";
    }
    if (normalized.includes("sku_missing")) {
      return "SKU is required for traceability and barcode generation, so this row needs operator review.";
    }
    if (normalized.includes("bulk_accepted_suggested_fix")) {
      return "This row was auto-approved in bulk because it was low-risk and had a concrete suggestion.";
    }
    if (normalized.includes("accepted_suggested_fix")) {
      return "A human accepted the suggestion. The action is tracked for auditability.";
    }
    if (normalized.includes("rejected_suggested_fix")) {
      return "A human rejected the suggestion. The action is tracked for auditability.";
    }
    return "This row has rule-based risk signals and requires human confirmation before final documents.";
  };

  return (
    <DashboardShell
      subtitle="Review parsed PO fields, make corrections, and lock the PO before document generation."
      title="Review Received PO"
    >
      <div className="space-y-6 pb-28">
        {loading ? (
          <Card className="p-5 text-sm text-kira-darkgray">Loading PO review...</Card>
        ) : null}
        {error ? <Card className="p-4 text-sm text-kira-warmgray">{error}</Card> : null}
        {message ? <Card className="p-4 text-sm text-kira-darkgray">{message}</Card> : null}

        {record ? (
          <>
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-kira-midgray">PO header</p>
                  <h2 className="mt-2 text-xl font-semibold text-kira-black">
                    {record.po_number || "Untitled PO"}
                  </h2>
                </div>
                {editable ? (
                  <Button disabled={savingHeader} onClick={handleSaveHeader} variant="secondary">
                    {savingHeader ? "Saving..." : "Save header"}
                  </Button>
                ) : (
                  <Link href={`/dashboard/received-pos/${receivedPoId}/documents`}>
                    <Button>Open documents</Button>
                  </Link>
                )}
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-kira-darkgray">PO number</span>
                  <input
                    className="kira-focus-ring w-full rounded-md border border-kira-warmgray/35 bg-transparent px-3 py-2"
                    disabled={!editable}
                    onChange={(event) =>
                      setHeaderDraft((current) => ({ ...current, po_number: event.target.value }))
                    }
                    value={headerDraft.po_number ?? ""}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-kira-darkgray">PO date</span>
                  <input
                    className="kira-focus-ring w-full rounded-md border border-kira-warmgray/35 bg-transparent px-3 py-2"
                    disabled={!editable}
                    onChange={(event) =>
                      setHeaderDraft((current) => ({ ...current, po_date: event.target.value }))
                    }
                    type="date"
                    value={headerDraft.po_date ?? ""}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-kira-darkgray">Distributor</span>
                  <input
                    className="kira-focus-ring w-full rounded-md border border-kira-warmgray/35 bg-transparent px-3 py-2"
                    disabled={!editable}
                    onChange={(event) =>
                      setHeaderDraft((current) => ({ ...current, distributor: event.target.value }))
                    }
                    value={headerDraft.distributor ?? ""}
                  />
                </label>
              </div>
            </Card>

            <AutopilotTimeline
              error={agentEventsError}
              events={agentEvents}
              loading={agentEventsLoading}
              onRetry={() => {
                void refreshAgentEvents();
              }}
            />

            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-kira-midgray">
                    Line items
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-kira-black">
                    {itemDrafts.length} extracted rows
                  </h2>
                </div>
                {editable ? (
                  <Button disabled={savingItems} onClick={handleSaveItems} variant="secondary">
                    {savingItems ? "Saving..." : "Save line items"}
                  </Button>
                ) : null}
              </div>
              <div className="mt-5">
                <LineItemsTable editable={editable} items={itemDrafts} onChange={setItemDrafts} />
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-kira-midgray">
                    Exception inbox
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-kira-black">
                    {exceptionsState?.summary.needs_review ?? 0} needs review
                  </h2>
                </div>
                {editable ? (
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={exceptionsRefreshing || exceptionsLoading}
                      onClick={handleRunExceptions}
                      variant="secondary"
                    >
                      {exceptionsRefreshing ? "Refreshing..." : "Run exception scan"}
                    </Button>
                    <Button
                      disabled={
                        bulkResolving ||
                        exceptionsLoading ||
                        (exceptionsState?.summary.needs_review ?? 0) === 0
                      }
                      onClick={handleBulkResolveLowRisk}
                      variant="secondary"
                    >
                      {bulkResolving ? "Approving..." : "Approve low-risk"}
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <div className="rounded-md border border-kira-warmgray/25 px-3 py-2 text-sm">
                  <p className="text-xs uppercase text-kira-midgray">Total rows</p>
                  <p className="mt-1 font-semibold">{exceptionsState?.summary.total ?? 0}</p>
                </div>
                <div className="rounded-md border border-kira-warmgray/25 px-3 py-2 text-sm">
                  <p className="text-xs uppercase text-kira-midgray">Auto-resolved</p>
                  <p className="mt-1 font-semibold">
                    {exceptionsState?.summary.auto_resolved ?? 0}
                  </p>
                </div>
                <div className="rounded-md border border-kira-warmgray/25 px-3 py-2 text-sm">
                  <p className="text-xs uppercase text-kira-midgray">Needs review</p>
                  <p className="mt-1 font-semibold">{exceptionsState?.summary.needs_review ?? 0}</p>
                </div>
                <div className="rounded-md border border-kira-warmgray/25 px-3 py-2 text-sm">
                  <p className="text-xs uppercase text-kira-midgray">Auto-resolve rate</p>
                  <p className="mt-1 font-semibold">
                    {Math.round(exceptionsState?.summary.auto_resolve_rate ?? 0)}%
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {editable && filteredExceptionItems.length > 0 ? (
                  <p className="text-xs text-kira-midgray">
                    Shortcuts: <kbd>A</kbd> accept, <kbd>E</kbd> edit, <kbd>R</kbd> reject,{" "}
                    <kbd>J</kbd>/<kbd>K</kbd> navigate
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => setExceptionFilter("all")}
                    className="px-3 py-1 text-xs"
                    variant={exceptionFilter === "all" ? "primary" : "secondary"}
                  >
                    All ({exceptionItems.length})
                  </Button>
                  <Button
                    onClick={() => setExceptionFilter("needs_review")}
                    className="px-3 py-1 text-xs"
                    variant={exceptionFilter === "needs_review" ? "primary" : "secondary"}
                  >
                    Needs Review
                  </Button>
                  <Button
                    onClick={() => setExceptionFilter("low_risk")}
                    className="px-3 py-1 text-xs"
                    variant={exceptionFilter === "low_risk" ? "primary" : "secondary"}
                  >
                    Low-Risk
                  </Button>
                  <Button
                    onClick={() => setExceptionFilter("no_suggestion")}
                    className="px-3 py-1 text-xs"
                    variant={exceptionFilter === "no_suggestion" ? "primary" : "secondary"}
                  >
                    No Suggestion
                  </Button>
                </div>
                {exceptionsLoading ? (
                  <p className="text-sm text-kira-darkgray">Loading exceptions...</p>
                ) : null}
                {!exceptionsLoading && filteredExceptionItems.length === 0 ? (
                  <p className="text-sm text-kira-darkgray">
                    No exceptions match this filter. Try another filter or rerun scan.
                  </p>
                ) : null}
                {filteredExceptionItems.length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-[320px_1fr]">
                    <div className="max-h-[540px] space-y-2 overflow-auto rounded-lg border border-kira-warmgray/25 p-2">
                      {filteredExceptionItems.map((item, index) => (
                        <button
                          className={`w-full rounded-md border p-3 text-left ${
                            selectedException?.id === item.id
                              ? "border-kira-brown/60 bg-kira-brown/10"
                              : "border-kira-warmgray/25 bg-white/70"
                          }`}
                          key={item.id}
                          onClick={() => setSelectedExceptionId(item.id)}
                          type="button"
                        >
                          <p className="text-xs text-kira-midgray">#{index + 1}</p>
                          <p className="mt-1 text-sm font-semibold text-kira-black">
                            {item.brand_style_code}
                          </p>
                          <p className="truncate text-xs text-kira-midgray">{item.sku_id}</p>
                          <div className="mt-2 flex items-center justify-between text-xs">
                            <span className="rounded-full bg-kira-warmgray/30 px-2 py-1 text-kira-darkgray">
                              {item.confidence_score
                                ? `${Math.round(item.confidence_score * 100)}%`
                                : "N/A"}
                            </span>
                            <span
                              className={`rounded-full px-2 py-1 ${
                                confidenceBand(item.confidence_score) === "high"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : confidenceBand(item.confidence_score) === "medium"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-rose-100 text-rose-700"
                              }`}
                            >
                              {confidenceBand(item.confidence_score)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                    {selectedException ? (
                      <div className="rounded-lg border border-kira-warmgray/25 bg-kira-offwhite/70 p-4">
                        {(() => {
                          const item = selectedException;
                          const isEditing = editingExceptionId === item.id;
                          const draft = exceptionEditDrafts[item.id];
                          const suggestedFix = item.suggested_fix ?? {};
                          return (
                            <>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-kira-black">
                                    {item.brand_style_code} · {item.sku_id}
                                  </p>
                                  <p className="mt-1 text-xs text-kira-midgray">
                                    Reason: {item.exception_reason ?? "Requires review"}
                                  </p>
                                </div>
                                <span className="rounded-full bg-kira-warmgray/25 px-3 py-1 text-xs uppercase tracking-wide text-kira-darkgray">
                                  {item.confidence_score
                                    ? `${Math.round(item.confidence_score * 100)}%`
                                    : "N/A"}
                                </span>
                              </div>
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <div className="rounded-md border border-kira-warmgray/25 bg-white/80 p-3">
                                  <p className="text-xs uppercase text-kira-midgray">Current</p>
                                  <p className="mt-1 text-xs text-kira-darkgray">
                                    Size: {item.size || "-"}
                                  </p>
                                  <p className="text-xs text-kira-darkgray">
                                    Color: {item.color || "-"}
                                  </p>
                                  <p className="text-xs text-kira-darkgray">
                                    Knit/Woven: {getKnittedWovenValue(item) || "-"}
                                  </p>
                                  <p className="text-xs text-kira-darkgray">Qty: {item.quantity}</p>
                                  <p className="text-xs text-kira-darkgray">
                                    PO Price: {item.po_price ?? "-"}
                                  </p>
                                </div>
                                <div className="rounded-md border border-kira-warmgray/25 bg-white/80 p-3">
                                  <p className="text-xs uppercase text-kira-midgray">Suggested</p>
                                  <p className="mt-1 text-xs text-kira-darkgray">
                                    Size: {String(suggestedFix.size ?? "-")}
                                  </p>
                                  <p className="text-xs text-kira-darkgray">
                                    Color: {String(suggestedFix.color ?? "-")}
                                  </p>
                                  <p className="text-xs text-kira-darkgray">
                                    Knit/Woven: {String(suggestedFix.knitted_woven ?? "-")}
                                  </p>
                                  <p className="text-xs text-kira-darkgray">
                                    Qty: {String(suggestedFix.quantity ?? "-")}
                                  </p>
                                  <p className="text-xs text-kira-darkgray">
                                    PO Price: {String(suggestedFix.po_price ?? "-")}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-2">
                                <Button
                                  onClick={() =>
                                    setExpandedReasonId((current) =>
                                      current === item.id ? null : item.id,
                                    )
                                  }
                                  className="px-2 py-1 text-xs"
                                  variant="text"
                                >
                                  {expandedReasonId === item.id ? "Hide why" : "Why this?"}
                                </Button>
                              </div>
                              {expandedReasonId === item.id ? (
                                <div className="mt-2 rounded-md border border-kira-warmgray/30 bg-white/70 p-3 text-xs text-kira-darkgray">
                                  {explainExceptionReason(item.exception_reason)}
                                </div>
                              ) : null}
                              {isEditing ? (
                                <div className="mt-3 grid gap-3 md:grid-cols-5">
                                  <label className="text-xs text-kira-darkgray">
                                    Size
                                    <input
                                      className="kira-focus-ring mt-1 w-full rounded-md border border-kira-warmgray/35 bg-transparent px-2 py-1 text-sm"
                                      onChange={(event) =>
                                        updateExceptionDraft(item.id, "size", event.target.value)
                                      }
                                      value={draft?.size ?? ""}
                                    />
                                  </label>
                                  <label className="text-xs text-kira-darkgray">
                                    Color
                                    <input
                                      className="kira-focus-ring mt-1 w-full rounded-md border border-kira-warmgray/35 bg-transparent px-2 py-1 text-sm"
                                      onChange={(event) =>
                                        updateExceptionDraft(item.id, "color", event.target.value)
                                      }
                                      value={draft?.color ?? ""}
                                    />
                                  </label>
                                  <label className="text-xs text-kira-darkgray">
                                    Knit/Woven
                                    <input
                                      className="kira-focus-ring mt-1 w-full rounded-md border border-kira-warmgray/35 bg-transparent px-2 py-1 text-sm"
                                      onChange={(event) =>
                                        updateExceptionDraft(
                                          item.id,
                                          "knitted_woven",
                                          event.target.value,
                                        )
                                      }
                                      value={draft?.knitted_woven ?? ""}
                                    />
                                  </label>
                                  <label className="text-xs text-kira-darkgray">
                                    Quantity
                                    <input
                                      className="kira-focus-ring mt-1 w-full rounded-md border border-kira-warmgray/35 bg-transparent px-2 py-1 text-sm"
                                      min={0}
                                      onChange={(event) =>
                                        updateExceptionDraft(
                                          item.id,
                                          "quantity",
                                          event.target.value,
                                        )
                                      }
                                      type="number"
                                      value={draft?.quantity ?? ""}
                                    />
                                  </label>
                                  <label className="text-xs text-kira-darkgray">
                                    PO Price
                                    <input
                                      className="kira-focus-ring mt-1 w-full rounded-md border border-kira-warmgray/35 bg-transparent px-2 py-1 text-sm"
                                      min={0}
                                      onChange={(event) =>
                                        updateExceptionDraft(
                                          item.id,
                                          "po_price",
                                          event.target.value,
                                        )
                                      }
                                      step="0.01"
                                      type="number"
                                      value={draft?.po_price ?? ""}
                                    />
                                  </label>
                                </div>
                              ) : null}
                              {editable ? (
                                <div className="mt-3 flex items-center gap-2">
                                  <Button
                                    disabled={resolvingLineItemId === item.id}
                                    onClick={() =>
                                      handleResolveException(
                                        item.id,
                                        "accept",
                                        isEditing ? draft : undefined,
                                      )
                                    }
                                    className="px-3 py-1.5 text-sm"
                                  >
                                    {isEditing ? "Accept edited values" : "Accept suggestion"}
                                  </Button>
                                  {!isEditing ? (
                                    <Button
                                      disabled={resolvingLineItemId === item.id}
                                      onClick={() => startEditingException(item)}
                                      className="px-3 py-1.5 text-sm"
                                      variant="secondary"
                                    >
                                      Edit before accept
                                    </Button>
                                  ) : (
                                    <Button
                                      disabled={resolvingLineItemId === item.id}
                                      onClick={() => setEditingExceptionId(null)}
                                      className="px-3 py-1.5 text-sm"
                                      variant="secondary"
                                    >
                                      Cancel edit
                                    </Button>
                                  )}
                                  <Button
                                    disabled={resolvingLineItemId === item.id}
                                    onClick={() => handleResolveException(item.id, "reject")}
                                    className="px-3 py-1.5 text-sm"
                                    variant="secondary"
                                  >
                                    Reject
                                  </Button>
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Card>
          </>
        ) : null}
      </div>

      {record ? (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-kira-warmgray/35 bg-kira-offwhite/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
            <div className="text-sm text-kira-darkgray">
              {itemDrafts.length} line items · {totalQuantity} pieces total
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {record.status === "confirmed" ? (
                <Link href={`/dashboard/received-pos/${receivedPoId}/documents`}>
                  <Button>Confirmed. Open documents</Button>
                </Link>
              ) : (
                <Button disabled={confirming || itemDrafts.length === 0} onClick={handleConfirm}>
                  {confirming ? "Confirming..." : "Confirm PO data"}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}

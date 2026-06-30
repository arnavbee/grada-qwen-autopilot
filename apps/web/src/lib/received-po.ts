import { apiRequest } from "@/src/lib/api-client";
import { resolveAssetUrl } from "@/src/lib/asset-url";
import { getResolvedApiOriginUrl } from "@/src/lib/api-url";
import type { StickerTemplateKind } from "@/src/lib/sticker-templates";

export type ReceivedPOStatus = "uploaded" | "parsing" | "parsed" | "confirmed" | "failed";
export type ReceivedPOExceptionStatus = "auto_resolved" | "needs_review" | "human_corrected";
export type BarcodeJobStatus = "pending" | "generating" | "done" | "failed";
export type InvoiceStatus = "draft" | "final" | "failed";
export type PackingListStatus = "draft" | "final" | "failed";
export type ExportMode = "Air" | "Sea" | "Road";
export type InvoiceTaxMode = "interstate" | "intrastate";
export type ReceivedPOAgentEventStatus =
  | "queued"
  | "running"
  | "needs_review"
  | "completed"
  | "failed";
export type ReceivedPOAgentActorType = "agent" | "human" | "system";

export interface ReceivedPOAgentEvent {
  id: string;
  received_po_id: string;
  event_type: string;
  title: string;
  summary: string | null;
  status: ReceivedPOAgentEventStatus;
  actor_type: ReceivedPOAgentActorType;
  tool_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ReceivedPOAgentTimelineResponse {
  received_po_id: string;
  items: ReceivedPOAgentEvent[];
}

export interface InvoiceDetails {
  marketplace_name: string;
  supplier_name: string;
  address: string;
  gst_number: string;
  pan_number: string;
  fbs_name: string;
  vendor_company_name: string;
  supplier_city: string;
  supplier_state: string;
  supplier_pincode: string;
  delivery_from_name: string;
  delivery_from_address: string;
  delivery_from_city: string;
  delivery_from_pincode: string;
  origin_country: string;
  origin_state: string;
  origin_district: string;
  bill_to_name: string;
  bill_to_address: string;
  bill_to_gst: string;
  bill_to_pan: string;
  ship_to_name: string;
  ship_to_address: string;
  ship_to_gst: string;
  stamp_image_url: string;
}

export interface ReceivedPOLineItem {
  id: string;
  received_po_id: string;
  brand_style_code: string;
  styli_style_id: string | null;
  model_number: string | null;
  option_id: string | null;
  sku_id: string;
  color: string | null;
  knitted_woven?: string | null;
  size: string | null;
  quantity: number;
  po_price: number | null;
  confidence_score?: number | null;
  resolution_status?: ReceivedPOExceptionStatus;
  exception_reason?: string | null;
  suggested_fix?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ReceivedPO {
  id: string;
  company_id: string;
  file_url: string;
  po_number: string | null;
  po_date: string | null;
  distributor: string;
  status: ReceivedPOStatus;
  auto_resolve_rate?: number | null;
  exception_count?: number;
  review_required_count?: number;
  raw_extracted: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  items: ReceivedPOLineItem[];
}

export interface ReceivedPOExceptionsSummary {
  total: number;
  auto_resolved: number;
  needs_review: number;
  human_corrected: number;
  auto_resolve_rate: number;
}

export interface ReceivedPOExceptionsResponse {
  received_po_id: string;
  status: ReceivedPOStatus;
  summary: ReceivedPOExceptionsSummary;
  items: ReceivedPOLineItem[];
}

export interface ReceivedPOBulkResolveResponse {
  received_po_id: string;
  processed_count: number;
  summary: ReceivedPOExceptionsSummary;
  items: ReceivedPOLineItem[];
}

export interface ReceivedPOListItem {
  id: string;
  po_number: string | null;
  po_date: string | null;
  distributor: string;
  status: ReceivedPOStatus;
  line_item_count: number;
  created_at: string;
}

interface ReceivedPOListResponse {
  items: ReceivedPOListItem[];
  total: number;
}

export interface BarcodeJob {
  id: string;
  received_po_id: string;
  status: BarcodeJobStatus;
  template_kind: StickerTemplateKind;
  template_id: string | null;
  marketplace_template_id: string | null;
  marketplace_template_name: string | null;
  file_url: string | null;
  total_stickers: number;
  total_pages: number;
  created_at: string;
}

interface BarcodeJobCreateResponse {
  job_id: string;
  status: BarcodeJobStatus;
  marketplace_template_id: string | null;
  marketplace_template_name: string | null;
}

export interface Invoice {
  id: string;
  received_po_id: string;
  company_id: string;
  invoice_number: string;
  invoice_date: string;
  number_of_cartons: number;
  export_mode: ExportMode;
  gross_weight: number | null;
  total_quantity: number;
  subtotal: number;
  igst_rate: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  tax_mode: InvoiceTaxMode;
  total_amount: number;
  total_amount_words: string | null;
  status: InvoiceStatus;
  file_url: string | null;
  created_at: string;
  updated_at: string;
  buyer_template_id: string | null;
  buyer_template_name: string | null;
  layout_key: string;
  details: InvoiceDetails;
}

interface InvoiceGeneratePdfResponse {
  invoice_id: string;
  status: InvoiceStatus;
  file_url: string | null;
}

export interface PackingListCartonItem {
  id: string;
  carton_id: string;
  line_item_id: string;
  pieces_in_carton: number;
  created_at: string;
}

export interface PackingListCarton {
  id: string;
  packing_list_id: string;
  carton_number: number;
  gross_weight: number | null;
  net_weight: number | null;
  dimensions: string | null;
  total_pieces: number;
  created_at: string;
  updated_at: string;
  items: PackingListCartonItem[];
}

export interface PackingList {
  id: string;
  received_po_id: string;
  company_id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  template_id: string | null;
  template_name: string | null;
  layout_key: string;
  status: PackingListStatus;
  file_url: string | null;
  created_at: string;
  cartons: PackingListCarton[];
}

export interface PackingListCreateInput {
  template_id?: string | null;
}

export interface PackingListCreateResponse {
  packing_list_id: string;
  total_cartons: number;
  total_pieces: number;
  template_id: string | null;
  template_name: string | null;
  layout_key: string;
}

export interface PackingListGeneratePdfInput {
  template_id?: string | null;
}

interface PackingListGeneratePdfResponse {
  packing_list_id: string;
  status: PackingListStatus;
  file_url: string | null;
  template_id: string | null;
  template_name: string | null;
  layout_key: string;
}

interface ReceivedPOUploadResponse {
  received_po_id: string;
  status: ReceivedPOStatus;
}

interface ReceivedPOConfirmResponse {
  id: string;
  status: ReceivedPOStatus;
}

export interface ReceivedPOHeaderInput {
  po_number?: string | null;
  po_date?: string | null;
  distributor?: string | null;
}

export interface ReceivedPOLineItemInput {
  id: string;
  brand_style_code: string;
  styli_style_id: string | null;
  model_number: string | null;
  option_id: string | null;
  sku_id: string;
  color: string | null;
  size: string | null;
  quantity: number;
  po_price: number | null;
  resolution_status?: string;
  exception_reason?: string | null;
}

export interface PackingListCartonInput {
  gross_weight?: number | null;
  net_weight?: number | null;
  dimensions?: string | null;
}

export interface ResolveReceivedPOExceptionInput {
  action: "accept" | "reject";
  size?: string | null;
  color?: string | null;
  knitted_woven?: string | null;
  quantity?: number | null;
  po_price?: number | null;
}

export async function listReceivedPOs(limit = 50, offset = 0): Promise<ReceivedPOListResponse> {
  return apiRequest<ReceivedPOListResponse>(`/received-pos?limit=${limit}&offset=${offset}`);
}

export async function uploadReceivedPO(file: File): Promise<ReceivedPOUploadResponse> {
  const body = new FormData();
  body.append("file", file);
  return apiRequest<ReceivedPOUploadResponse>("/received-pos/upload", {
    method: "POST",
    body,
  });
}

export async function getReceivedPO(receivedPoId: string): Promise<ReceivedPO> {
  return apiRequest<ReceivedPO>(`/received-pos/${receivedPoId}`);
}

export async function listReceivedPOAgentEvents(
  receivedPoId: string,
): Promise<ReceivedPOAgentTimelineResponse> {
  return apiRequest<ReceivedPOAgentTimelineResponse>(`/received-pos/${receivedPoId}/agent-events`);
}

export async function updateReceivedPOHeader(
  receivedPoId: string,
  payload: ReceivedPOHeaderInput,
): Promise<ReceivedPO> {
  const nextPayload: Record<string, unknown> = { ...payload };
  if (typeof payload.po_date === "string" && payload.po_date) {
    nextPayload.po_date = new Date(payload.po_date).toISOString();
  }
  return apiRequest<ReceivedPO>(`/received-pos/${receivedPoId}`, {
    method: "PATCH",
    body: JSON.stringify(nextPayload),
  });
}

export async function updateReceivedPOItems(
  receivedPoId: string,
  items: ReceivedPOLineItemInput[],
): Promise<ReceivedPO> {
  return apiRequest<ReceivedPO>(`/received-pos/${receivedPoId}/items`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export async function confirmReceivedPO(receivedPoId: string): Promise<ReceivedPOConfirmResponse> {
  return apiRequest<ReceivedPOConfirmResponse>(`/received-pos/${receivedPoId}/confirm`, {
    method: "POST",
  });
}

export async function runReceivedPOExceptions(
  receivedPoId: string,
): Promise<ReceivedPOExceptionsResponse> {
  return apiRequest<ReceivedPOExceptionsResponse>(`/received-pos/${receivedPoId}/exceptions/run`, {
    method: "POST",
  });
}

export async function listReceivedPOExceptions(
  receivedPoId: string,
  includeResolved = false,
): Promise<ReceivedPOExceptionsResponse> {
  return apiRequest<ReceivedPOExceptionsResponse>(
    `/received-pos/${receivedPoId}/exceptions?include_resolved=${String(includeResolved)}`,
  );
}

export async function resolveReceivedPOException(
  receivedPoId: string,
  lineItemId: string,
  payload: ResolveReceivedPOExceptionInput,
): Promise<ReceivedPOExceptionsResponse> {
  return apiRequest<ReceivedPOExceptionsResponse>(
    `/received-pos/${receivedPoId}/exceptions/${lineItemId}/resolve`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function resolveReceivedPOExceptionsBulk(
  receivedPoId: string,
  payload: {
    min_confidence?: number;
    only_with_suggestions?: boolean;
  } = {},
): Promise<ReceivedPOBulkResolveResponse> {
  return apiRequest<ReceivedPOBulkResolveResponse>(
    `/received-pos/${receivedPoId}/exceptions/resolve-bulk`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function createBarcodeJob(
  receivedPoId: string,
  payload?: {
    template_kind?: StickerTemplateKind;
    template_id?: string | null;
    marketplace_template_id?: string | null;
  },
): Promise<BarcodeJobCreateResponse> {
  return apiRequest<BarcodeJobCreateResponse>(`/received-pos/${receivedPoId}/barcode`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export async function getBarcodeJobStatus(receivedPoId: string): Promise<BarcodeJob> {
  return apiRequest<BarcodeJob>(`/received-pos/${receivedPoId}/barcode/status`);
}

export async function getBarcodeJob(receivedPoId: string, jobId: string): Promise<BarcodeJob> {
  return apiRequest<BarcodeJob>(`/received-pos/${receivedPoId}/barcode/jobs/${jobId}`);
}

export async function getInvoice(receivedPoId: string): Promise<Invoice> {
  return apiRequest<Invoice>(`/received-pos/${receivedPoId}/invoice`);
}

export async function createInvoiceDraft(
  receivedPoId: string,
  payload?: {
    number_of_cartons?: number;
    export_mode?: ExportMode;
    buyer_template_id?: string | null;
    details?: InvoiceDetails;
  },
): Promise<Invoice> {
  return apiRequest<Invoice>(`/received-pos/${receivedPoId}/invoice`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export async function updateInvoice(
  receivedPoId: string,
  payload: {
    gross_weight?: number | null;
    number_of_cartons?: number | null;
    export_mode?: ExportMode | null;
    buyer_template_id?: string | null;
    details?: InvoiceDetails;
  },
): Promise<Invoice> {
  return apiRequest<Invoice>(`/received-pos/${receivedPoId}/invoice`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function generateInvoicePdf(
  receivedPoId: string,
): Promise<InvoiceGeneratePdfResponse> {
  return apiRequest<InvoiceGeneratePdfResponse>(
    `/received-pos/${receivedPoId}/invoice/generate-pdf`,
    {
      method: "POST",
    },
  );
}

export async function getPackingList(receivedPoId: string): Promise<PackingList> {
  return apiRequest<PackingList>(`/received-pos/${receivedPoId}/packing-list`);
}

export async function createPackingList(
  receivedPoId: string,
  payload: PackingListCreateInput = {},
): Promise<PackingListCreateResponse> {
  return apiRequest<PackingListCreateResponse>(`/received-pos/${receivedPoId}/packing-list`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updatePackingListCarton(
  receivedPoId: string,
  cartonId: string,
  payload: PackingListCartonInput,
): Promise<PackingListCarton> {
  return apiRequest<PackingListCarton>(
    `/received-pos/${receivedPoId}/packing-list/cartons/${cartonId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export async function generatePackingListPdf(
  receivedPoId: string,
  payload: PackingListGeneratePdfInput = {},
): Promise<PackingListGeneratePdfResponse> {
  return apiRequest<PackingListGeneratePdfResponse>(
    `/received-pos/${receivedPoId}/packing-list/generate-pdf`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function resolveFileUrl(fileUrl: string | null | undefined): string | null {
  const resolved = resolveAssetUrl(fileUrl);
  if (resolved) {
    return resolved;
  }
  if (!fileUrl) {
    return null;
  }
  const raw = String(fileUrl).trim();
  if (!raw) {
    return null;
  }
  const apiOrigin = getResolvedApiOriginUrl().replace(/\/+$/, "");
  return `${apiOrigin}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

export async function getOptionalInvoice(receivedPoId: string): Promise<Invoice | null> {
  try {
    return await getInvoice(receivedPoId);
  } catch (error) {
    if (error instanceof Error && error.message === "Invoice not found.") {
      return null;
    }
    throw error;
  }
}

export async function getOptionalPackingList(receivedPoId: string): Promise<PackingList | null> {
  try {
    return await getPackingList(receivedPoId);
  } catch (error) {
    if (error instanceof Error && error.message === "Packing list not found.") {
      return null;
    }
    throw error;
  }
}

export async function getOptionalBarcodeJob(
  receivedPoId: string,
  jobId?: string | null,
): Promise<BarcodeJob | null> {
  try {
    return jobId
      ? await getBarcodeJob(receivedPoId, jobId)
      : await getBarcodeJobStatus(receivedPoId);
  } catch (error) {
    if (error instanceof Error && error.message === "Barcode job not found.") {
      return null;
    }
    throw error;
  }
}

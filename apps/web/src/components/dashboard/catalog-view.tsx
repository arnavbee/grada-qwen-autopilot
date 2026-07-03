"use client";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { Button } from "@/src/components/ui/button";
import { apiRequest } from "@/src/lib/api-client";
import { resolveAssetUrl } from "@/src/lib/asset-url";
import { getResolvedApiOriginUrl } from "@/src/lib/api-url";
import { cn } from "@/src/lib/cn";
import {
  createMarketplaceDocumentTemplate,
  deleteMarketplaceDocumentTemplate,
  listMarketplaceDocumentTemplates,
  parseMarketplaceTemplateSample,
  type MarketplaceDocumentTemplate,
  type MarketplaceDocumentTemplateParseResponse,
} from "@/src/lib/marketplace-document-templates";

type CatalogStatus = "draft" | "processing" | "needs_review" | "ready" | "archived";
type UploadStatus = "queued" | "uploading" | "completed" | "completed_local" | "failed";
type UploadAnalysisMode = "manual" | "ai";
type ExportFormat = "csv" | "xlsx";
type ExportStatus = "queued" | "processing" | "completed" | "failed";
type AiFieldKey = "category" | "styleName" | "color" | "fabric" | "composition" | "wovenKnits";
type FeedbackType = "accept" | "reject";
type BatchActionKind =
  | ""
  | "update_fabric"
  | "duplicate"
  | "export_selected"
  | "delete_selected"
  | "find_replace"
  | "adjust_price";
type BatchFindReplaceField = "styleName" | "category" | "color" | "fabric";
type PriceAdjustMode = "percent_up" | "percent_down" | "add_fixed" | "set_exact";
type TemplateConstrainedField =
  | "category"
  | "styleName"
  | "color"
  | "fabric"
  | "composition"
  | "wovenKnits";

interface OutOfBoundsPromptState {
  id: string;
  field: TemplateConstrainedField;
  value: string;
  source: "user_input" | "ai_suggestion";
  onConfirm: (addToTemplate: boolean) => void;
  onCancel: () => void;
}

const MAX_BULK_FILES_PER_BATCH = 20;
const MAX_BULK_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_ITEM_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const CATEGORY_OPTIONS = ["DRESSES", "CORD SETS"] as const;
const STYLE_NAME_OPTIONS = ["Maxi Dress", "Midi Dress", "Knee Length", "Knot Cord Set"] as const;
const COLOR_OPTIONS = [
  "Beige",
  "Black",
  "Blue",
  "Bottle Green",
  "Brown",
  "Green",
  "Grey",
  "Lilac",
  "Maroon",
  "Mustard",
  "Navy",
  "Pink",
  "Purple",
  "Silver",
  "White",
  "Wine",
] as const;
const FABRIC_OPTIONS = [
  "Cotton Poplin",
  "Pleated Knitted Fabric",
  "Poly Georgette",
  "Poly Weightless Ggt",
  "Polymoss",
  "polycrepe",
] as const;
const COMPOSITION_OPTIONS = ["100% Cotton", "100% Polyester"] as const;
const WOVEN_KNITS_OPTIONS = ["Knits", "Woven"] as const;
const TOTAL_UNITS_OPTIONS = ["24", "26"] as const;
const PO_PRICE_OPTIONS = ["550", "575", "600", "625", "650", "675", "700", "750"] as const;
const OSP_OPTIONS = ["90", "95", "100", "120", "125", "130"] as const;
const STATUS_OPTIONS: CatalogStatus[] = [
  "draft",
  "processing",
  "needs_review",
  "ready",
  "archived",
];
const MARKETPLACE_OPTIONS = [
  "Generic",
  "Myntra",
  "Ajio",
  "Amazon IN",
  "Flipkart",
  "Nykaa",
] as const;
const MARKETPLACE_KEY_BY_LABEL: Record<(typeof MARKETPLACE_OPTIONS)[number], string> = {
  Generic: "generic",
  Myntra: "myntra",
  Ajio: "ajio",
  "Amazon IN": "amazon_in",
  Flipkart: "flipkart",
  Nykaa: "nykaa",
};
const EXPORT_STATUS_OPTIONS: Array<"all" | ExportStatus> = [
  "all",
  "queued",
  "processing",
  "completed",
  "failed",
];
const AI_FIELD_LABELS: Record<AiFieldKey, string> = {
  category: "Category",
  styleName: "Style Name",
  color: "Color",
  fabric: "Fabric",
  composition: "Composition",
  wovenKnits: "Woven Knits",
};
const AI_FIELD_API_KEYS: Record<AiFieldKey, string> = {
  category: "category",
  styleName: "style_name",
  color: "color",
  fabric: "fabric",
  composition: "composition",
  wovenKnits: "woven_knits",
};
const CORRECTION_REASON_OPTIONS = [
  { value: "image_quality", label: "Image quality issue" },
  { value: "lighting", label: "Lighting/color cast" },
  { value: "ambiguous_style", label: "Style ambiguity" },
  { value: "fabric_texture", label: "Fabric/texture confusion" },
  { value: "other", label: "Other" },
] as const;
const BATCH_FIND_REPLACE_FIELD_LABELS: Record<BatchFindReplaceField, string> = {
  styleName: "Style Name",
  category: "Category",
  color: "Color",
  fabric: "Fabric",
};
const TEMPLATE_FIELD_LABELS: Record<TemplateConstrainedField, string> = {
  category: "Category",
  styleName: "Style Name",
  color: "Color",
  fabric: "Fabric",
  composition: "Composition",
  wovenKnits: "Woven / Knits",
};
const TEMPLATE_LABEL_TO_API_MAP: Record<
  TemplateConstrainedField,
  | "allowed_categories"
  | "allowed_style_names"
  | "allowed_colors"
  | "allowed_fabrics"
  | "allowed_compositions"
  | "allowed_woven_knits"
> = {
  category: "allowed_categories",
  styleName: "allowed_style_names",
  color: "allowed_colors",
  fabric: "allowed_fabrics",
  composition: "allowed_compositions",
  wovenKnits: "allowed_woven_knits",
};
const CATALOG_EXPORT_SOURCE_FIELDS = [
  "serial_no",
  "sku",
  "title",
  "brand",
  "category",
  "color",
  "size",
  "mrp",
  "description",
  "fabric",
  "composition",
  "woven_knits",
  "units",
  "po_price",
  "osp",
  "status",
  "image_preview",
  "image_url",
] as const;

interface CatalogProduct {
  id: string;
  sku: string;
  title: string;
  category: string | null;
  color?: string | null;
  primary_image_url?: string | null;
  ai_attributes?: Record<string, unknown>;
  status: CatalogStatus;
}

interface CatalogListResponse {
  items: CatalogProduct[];
}

interface ProductResponse {
  id: string;
  company_id: string;
  sku: string;
  title: string;
  description?: string;
  brand?: string;
  category?: string;
  color?: string;
  size?: string;
  status: string;
  primary_image_url?: string;
  ai_attributes?: Record<string, unknown>;
}

interface CatalogRow {
  id: string;
  primary_image_url?: string;
  styleNo: string;
  name: string;
  category: string;
  color: string;
  fabric: string;
  composition: string;
  wovenKnits: string;
  units: string;
  poPrice: string;
  price: string;
  status: CatalogStatus;
  persisted: boolean;
  imageName?: string;
}

interface UploadAnalysis {
  styleNo: string;
  styleName: string;
  category: string;
  color: string;
  fabric: string;
  composition: string;
  wovenKnits: string;
  units: string;
  poPrice: string;
  ospSar: string;
  confidence: number;
  needsReview: boolean;
  mode: UploadAnalysisMode;
}

interface UploadItem {
  id: string;
  name: string;
  type: string;
  size: number;
  progress: number;
  status: UploadStatus;
  file?: File;
  error?: string;
  previewUrl?: string;
  analysis?: UploadAnalysis;
  approved?: boolean;
  analyzeWithAi?: boolean;
}

interface ProductImageResponse {
  id: string;
  file_name: string;
  file_url: string;
  processing_status: string;
}

interface MarketplaceExportRecord {
  id: string;
  company_id: string;
  requested_by_user_id?: string | null;
  marketplace: string;
  template_id?: string | null;
  template_name?: string | null;
  export_format: ExportFormat;
  status: ExportStatus;
  filters: Record<string, unknown>;
  file_url?: string | null;
  error_message?: string | null;
  row_count: number;
  created_at: string;
  completed_at?: string | null;
}

interface MarketplaceExportListResponse {
  items: MarketplaceExportRecord[];
  total: number;
}

interface AiFieldContext {
  source?: string;
  basedOn?: string;
  learnedFrom?: string;
}

interface AiSuggestionsState {
  values: Partial<Record<AiFieldKey, string>>;
  confidence: Partial<Record<AiFieldKey, number>>;
  context: Partial<Record<AiFieldKey, AiFieldContext>>;
  imageHash?: string;
}

interface AnalyzeImageApiField {
  value?: string;
  confidence?: number;
  source?: string;
  based_on?: string;
  learned_from?: string;
}

interface AnalyzeImageApiResult {
  category?: AnalyzeImageApiField;
  style_name?: AnalyzeImageApiField;
  color?: AnalyzeImageApiField;
  fabric?: AnalyzeImageApiField;
  composition?: AnalyzeImageApiField;
  woven_knits?: AnalyzeImageApiField;
  image_hash?: string;
}

interface AnalyzeImageRequestPayload {
  image_url: string;
  template_allowed?: {
    allowed_categories: string[];
    allowed_style_names: string[];
    allowed_colors: string[];
    allowed_fabrics: string[];
    allowed_compositions: string[];
    allowed_woven_knits: string[];
  };
}

interface ImageLabelRecord {
  id: string;
  company_id: string;
  image_url: string;
  ai_category?: string | null;
  ai_style?: string | null;
  human_category?: string | null;
  human_style?: string | null;
  corrected: boolean;
  created_at: string;
}

interface LogCorrectionRequest {
  product_id?: string;
  image_hash?: string;
  field_name: string;
  feedback_type: FeedbackType;
  suggested_value?: string;
  corrected_value?: string;
  reason_code?: string;
  notes?: string;
  source?: string;
  based_on?: string;
  learned_from?: string;
  confidence_score?: number;
}

interface LearningFieldAccuracy {
  field_name: string;
  accepted_count: number;
  rejected_count: number;
  total_feedback: number;
  accuracy_percent: number;
}

interface LearningStatsResponse {
  items_processed: number;
  corrections_received: number;
  time_saved_minutes: number;
  pending_retraining: number;
  field_accuracy: LearningFieldAccuracy[];
  insights: string[];
}

interface CatalogTemplateRecord {
  id: string;
  company_id: string;
  name: string;
  description?: string | null;
  defaults: Record<string, string>;
  allowed_categories: string[];
  allowed_style_names: string[];
  allowed_colors: string[];
  allowed_fabrics: string[];
  allowed_compositions: string[];
  allowed_woven_knits: string[];
  style_code_pattern?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface CatalogTemplateListResponse {
  items: CatalogTemplateRecord[];
  total: number;
}

const defaultCatalogTemplateDraft: {
  name: string;
  description: string;
  defaults: Record<string, string>;
  allowed_categories: string[];
  allowed_style_names: string[];
  allowed_colors: string[];
  allowed_fabrics: string[];
  allowed_compositions: string[];
  allowed_woven_knits: string[];
  style_code_pattern: string;
  is_active: boolean;
} = {
  name: "Winter 2026",
  description: "Default template for winter collection",
  defaults: {
    category: "DRESSES",
    styleName: "Midi Dress",
    composition: "100% Polyester",
    wovenKnits: "Woven",
    poPrice: "600",
    ospSar: "95",
    units: "24",
    color: "Black",
    fabric: "Poly Georgette",
  },
  allowed_categories: ["DRESSES", "CORD SETS"],
  allowed_style_names: ["Maxi Dress", "Midi Dress", "Knee Length", "Knot Cord Set"],
  allowed_colors: ["Black", "Bottle Green", "Brown", "Navy"],
  allowed_fabrics: ["Poly Georgette", "Polymoss", "polycrepe"],
  allowed_compositions: ["100% Cotton", "100% Polyester"],
  allowed_woven_knits: ["Knits", "Woven"],
  style_code_pattern: "",
  is_active: true,
};

function hasAccessToken(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const hasNonEmptyCookie = (name: string): boolean => {
    const prefix = `${name}=`;
    const cookieEntries = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith(prefix));
    for (let idx = cookieEntries.length - 1; idx >= 0; idx -= 1) {
      const entry = cookieEntries[idx];
      if (!entry) continue;
      const value = entry.slice(prefix.length).trim();
      if (value) return true;
    }
    return false;
  };

  return hasNonEmptyCookie("kira_access_token") || hasNonEmptyCookie("kira_refresh_token");
}

function getImageUrl(imageUrl: string | null | undefined): string | null {
  return resolveAssetUrl(imageUrl);
}

interface UploadedImageAsset {
  url: string;
  filename: string;
}

async function uploadCatalogImage(file: File): Promise<UploadedImageAsset> {
  const formData = new FormData();
  formData.append("file", file);

  const uploadData = await apiRequest<{ url: string; filename: string }>("/uploads", {
    method: "POST",
    body: formData,
  });

  return {
    // Keep `/static/...` as canonical to avoid hardcoding a web-domain URL in DB records.
    url: uploadData.url,
    filename: uploadData.filename,
  };
}

function normalizeCategory(value: string | null | undefined): (typeof CATEGORY_OPTIONS)[number] {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (normalized === "DRESSES") return "DRESSES";
  if (normalized === "CORD SETS" || normalized === "CORD-SET" || normalized === "CORDSETS")
    return "CORD SETS";
  if (normalized.includes("CORD")) return "CORD SETS";
  return "DRESSES";
}

function deriveStyleNameFromFileName(fileName: string): string {
  const stem = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return stem || "Bulk Item";
}

function formatStatusLabel(status: CatalogStatus): string {
  if (status === "needs_review") return "Needs Review";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatExportStatusLabel(status: "all" | ExportStatus): string {
  if (status === "all") return "All";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function colorDot(color: string): string {
  const token = color.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  if (token === "beige") return "#D6C1A3";
  if (token === "black") return "#18181B";
  if (token === "blue") return "#1D4ED8";
  if (token === "bottle green") return "#166534";
  if (token === "brown") return "#8B5E3C";
  if (token === "green") return "#16A34A";
  if (token === "grey") return "#6B7280";
  if (token === "lilac") return "#C4A2D3";
  if (token === "maroon") return "#7F1D1D";
  if (token === "mustard") return "#D4A017";
  if (token === "navy") return "#1E3A8A";
  if (token === "pink") return "#EC4899";
  if (token === "purple") return "#7C3AED";
  if (token === "silver") return "#B8C2CC";
  if (token === "white") return "#F8FAFC";
  if (token === "wine") return "#6B2136";
  return "#7A7C88";
}

function colorDotBorder(color: string): string {
  const token = color.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (token === "white" || token === "silver" || token === "beige") {
    return "#9CA3AF";
  }
  return "transparent";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSarPrice(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSarPrice(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  const rendered = Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(2).replace(/\.?0+$/, "");
  return `SAR ${rendered}`;
}

function parseCommaSeparatedTokens(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter(
      (item, index, list) =>
        list.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index,
    );
}

function includesToken(list: string[], value: string): boolean {
  return list.some((item) => item.toLowerCase() === value.toLowerCase());
}

function withCurrentOption(options: string[], currentValue: string): string[] {
  const normalized = currentValue.trim();
  if (!normalized || includesToken(options, normalized)) return options;
  return [normalized, ...options];
}

function buildAiAttributesFromRow(
  row: CatalogRow,
  overrides: Partial<
    Pick<CatalogRow, "fabric" | "composition" | "wovenKnits" | "units" | "poPrice" | "price">
  > = {},
): Record<string, string> {
  const nextPrice = overrides.price ?? row.price;
  return {
    fabric: overrides.fabric ?? row.fabric,
    composition: overrides.composition ?? row.composition,
    woven_knits: overrides.wovenKnits ?? row.wovenKnits,
    units: overrides.units ?? row.units,
    po_price: overrides.poPrice ?? row.poPrice,
    osp: String(parseSarPrice(nextPrice)),
  };
}

function mapProductResponseToCatalogRow(
  product: ProductResponse,
  fallback: CatalogRow,
  options: {
    imageUrl?: string;
    imageName?: string;
  } = {},
): CatalogRow {
  const attributes = product.ai_attributes ?? {};
  const attrFabric = typeof attributes.fabric === "string" ? attributes.fabric : fallback.fabric;
  const attrComposition =
    typeof attributes.composition === "string" ? attributes.composition : fallback.composition;
  const attrWovenKnitsRaw =
    typeof attributes.woven_knits === "string"
      ? attributes.woven_knits
      : typeof attributes.wovenKnits === "string"
        ? attributes.wovenKnits
        : fallback.wovenKnits;
  const attrUnits = attributes.units;
  const attrPoPrice = attributes.po_price ?? attributes.poPrice;
  const attrOsp = attributes.osp ?? attributes.osp_sar ?? attributes.ospSar;

  return {
    ...fallback,
    id: product.id,
    primary_image_url: options.imageUrl ?? product.primary_image_url ?? fallback.primary_image_url,
    styleNo: product.sku,
    name: product.title || fallback.name,
    category: normalizeCategory(product.category ?? fallback.category),
    color: product.color ?? fallback.color,
    fabric:
      typeof attrFabric === "string" && attrFabric.trim() ? attrFabric.trim() : fallback.fabric,
    composition:
      typeof attrComposition === "string" && attrComposition.trim()
        ? attrComposition.trim()
        : fallback.composition,
    wovenKnits:
      typeof attrWovenKnitsRaw === "string" && attrWovenKnitsRaw.trim()
        ? attrWovenKnitsRaw.trim()
        : fallback.wovenKnits,
    units:
      typeof attrUnits === "number"
        ? String(attrUnits)
        : typeof attrUnits === "string" && attrUnits.trim()
          ? attrUnits.trim()
          : fallback.units,
    poPrice:
      typeof attrPoPrice === "number"
        ? String(attrPoPrice)
        : typeof attrPoPrice === "string" && attrPoPrice.trim()
          ? attrPoPrice.trim()
          : fallback.poPrice,
    price:
      typeof attrOsp === "number"
        ? formatSarPrice(attrOsp)
        : typeof attrOsp === "string" && attrOsp.trim()
          ? formatSarPrice(parseSarPrice(attrOsp))
          : fallback.price,
    status: product.status as CatalogStatus,
    persisted: true,
    imageName: options.imageName ?? fallback.imageName,
  };
}

function buildDuplicateStyleNo(baseStyleNo: string, existingStyleNos: Set<string>): string {
  const normalizedBase =
    baseStyleNo
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "STYLE";
  let suffix = 1;
  let candidate = `${normalizedBase}-COPY`;
  while (existingStyleNos.has(candidate)) {
    suffix += 1;
    candidate = `${normalizedBase}-COPY-${String(suffix).padStart(2, "0")}`;
  }
  return candidate;
}

function parseAiContext(rawField: unknown): AiFieldContext | undefined {
  if (!rawField || typeof rawField !== "object") return undefined;
  const record = rawField as Record<string, unknown>;
  const source = typeof record.source === "string" ? record.source : undefined;
  const basedOnRaw = record.based_on ?? record.basedOn;
  const learnedFromRaw = record.learned_from ?? record.learnedFrom;
  const basedOn = typeof basedOnRaw === "string" ? basedOnRaw : undefined;
  const learnedFrom = typeof learnedFromRaw === "string" ? learnedFromRaw : undefined;

  if (!source && !basedOn && !learnedFrom) {
    return undefined;
  }
  return { source, basedOn, learnedFrom };
}

function normalizeAiValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim();
  if (!cleaned) return undefined;

  const token = cleaned.toLowerCase();
  if (
    token === "unknown" ||
    token === "n/a" ||
    token === "na" ||
    token === "none" ||
    token === "null" ||
    token.includes("unable to determine") ||
    token.includes("cannot determine") ||
    token.includes("can't determine") ||
    token.includes("not sure")
  ) {
    return undefined;
  }
  return cleaned;
}

function canonicalizeToken(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function pickOptionValue<T extends readonly string[]>(
  rawValue: string | null | undefined,
  options: T,
): T[number] | undefined {
  const normalized = normalizeAiValue(rawValue);
  if (!normalized) return undefined;
  const normalizedToken = canonicalizeToken(normalized);
  const match = options.find((option) => canonicalizeToken(option) === normalizedToken);
  return match as T[number] | undefined;
}

function UploadIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M12 16V4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path
        d="M7.5 8.5L12 4L16.5 8.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <path d="M5 20H19" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function PlusIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M12 5V19" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M5 12H19" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function DownloadIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M12 4V15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path
        d="M8 11.5L12 15.5L16 11.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <path d="M5 20H19" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function PencilIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M4 20L8.5 19L19 8.5L14.5 4L4 14.5L4 20Z" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M5 7H19" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M9 7V5H15V7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M8 7L9 19H15L16 7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M11 10V16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M13 10V16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M6 6L18 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function BrainIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M9.2 6.4A2.8 2.8 0 1 0 6.4 9.2V15A2.8 2.8 0 1 0 9.2 17.8H14.8A2.8 2.8 0 1 0 17.6 15V9.2A2.8 2.8 0 1 0 14.8 6.4H9.2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M9.2 9.2H14.8M12 9.2V15M9.2 15H14.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function FieldLabel({
  children,
  confidence,
  context,
}: {
  children: string;
  confidence?: number;
  context?: AiFieldContext;
}): JSX.Element {
  let badgeColor = "border-[#C7CFCA] bg-[#EEF1EF] text-[#4B5563]";
  if (confidence !== undefined) {
    if (confidence >= 85) badgeColor = "border-[#9EDAB7] bg-[#DDF4E7] text-[#1E7145]";
    else if (confidence >= 60) badgeColor = "border-[#E6D7A7] bg-[#FAF2D8] text-[#7A641A]";
    else badgeColor = "border-[#E4BABA] bg-[#FCE7E7] text-[#9F3A3A]";
  }
  const tooltip = [
    `AI Confidence: ${confidence ?? "--"}%`,
    `Source: ${context?.source ?? "vision_model"}`,
    `Based on: ${context?.basedOn ?? "Image texture, silhouette, and color cues"}`,
    `Learned from: ${context?.learnedFrom ?? "Catalog priors and historical apparel patterns"}`,
  ].join("\n");

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm uppercase tracking-[0.08em] text-kira-midgray">{children}</label>
      {confidence !== undefined && (
        <span
          title={tooltip}
          className={cn(
            "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold cursor-help",
            badgeColor,
          )}
        >
          <svg aria-hidden="true" className="h-2.5 w-2.5" fill="none" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M6 3.5V8.5M3.5 6H8.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.2"
            />
          </svg>
          {confidence}%
        </span>
      )}
    </div>
  );
}

function AiSuggestionRow({
  fieldKey,
  label,
  value,
  confidence,
  onFeedback,
  isSubmitting,
  isFeedbackLocked,
}: {
  fieldKey: AiFieldKey;
  label: string;
  value: string | undefined;
  confidence?: number;
  onFeedback: (fieldKey: AiFieldKey, feedbackType: FeedbackType) => void;
  isSubmitting: boolean;
  isFeedbackLocked: boolean;
}): JSX.Element | null {
  if (!value) return null;
  let badgeColor = "border-[#C7CFCA] bg-[#EEF1EF] text-[#4B5563]";
  if (confidence !== undefined) {
    if (confidence >= 85) badgeColor = "border-[#9EDAB7] bg-[#DDF4E7] text-[#1E7145]";
    else if (confidence >= 60) badgeColor = "border-[#E6D7A7] bg-[#FAF2D8] text-[#7A641A]";
    else badgeColor = "border-[#E4BABA] bg-[#FCE7E7] text-[#9F3A3A]";
  }

  return (
    <div className="grid w-full grid-cols-[84px_minmax(0,1fr)] items-center gap-x-2 border-b border-[#CFE0D6] py-1 text-[12px] last:border-b-0">
      <p className="text-[#59625E]">{label}</p>
      <div
        className={cn(
          "group/ai-answer relative flex min-w-0 items-center justify-end gap-1",
          !isFeedbackLocked && "pr-0 transition-[padding-right] duration-150 hover:pr-14",
        )}
      >
        <p className="min-w-0 max-w-full whitespace-nowrap text-right font-medium leading-none text-black">
          {value}
        </p>
        {confidence !== undefined && (
          <span
            className={cn(
              "inline-flex min-w-[36px] items-center justify-center rounded-sm border px-1 py-0.5 text-[9px] font-bold",
              badgeColor,
            )}
          >
            {confidence}%
          </span>
        )}
        {!isFeedbackLocked ? (
          <div className="pointer-events-none absolute right-0 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover/ai-answer:pointer-events-auto group-hover/ai-answer:opacity-100">
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#CFE8D8] bg-[#F4FBF7] text-[#1E7145] transition-all hover:-translate-y-0.5 hover:border-[#8BD0A9] hover:bg-[#E3F6ED] hover:shadow-[0_2px_8px_rgba(30,113,69,0.2)] disabled:opacity-50 disabled:transform-none disabled:shadow-none"
              disabled={isSubmitting}
              onClick={() => onFeedback(fieldKey, "accept")}
              title="Mark this suggestion as correct"
              aria-label="Mark suggestion as correct"
            >
              <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 20 20">
                <path
                  d="M4 10.5L8 14.5L16 6.5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </button>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#F0D2D2] bg-[#FFF6F6] text-[#9F3A3A] transition-all hover:-translate-y-0.5 hover:border-[#E7A8A8] hover:bg-[#FDECEC] hover:shadow-[0_2px_8px_rgba(159,58,58,0.2)] disabled:opacity-50 disabled:transform-none disabled:shadow-none"
              disabled={isSubmitting}
              onClick={() => onFeedback(fieldKey, "reject")}
              title="Report this suggestion as incorrect"
              aria-label="Mark suggestion as incorrect"
            >
              <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 20 20">
                <path
                  d="M6 6L14 14M14 6L6 14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CatalogView(): JSX.Element {
  const [catalogRows, setCatalogRows] = useState<CatalogRow[]>([]);
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [companyBrand, setCompanyBrand] = useState("GEN");

  const [searchValue, setSearchValue] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All Categories");
  const [colorFilter, setColorFilter] = useState("All Colors");
  const [statusFilter, setStatusFilter] = useState("All Statuses");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<CatalogStatus | "">("");
  const [bulkUnitsValue, setBulkUnitsValue] = useState("");
  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [batchAction, setBatchAction] = useState<BatchActionKind>("");
  const [batchFabricValue, setBatchFabricValue] = useState<string>(FABRIC_OPTIONS[0]);
  const [isBatchActionApplying, setIsBatchActionApplying] = useState(false);
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [findReplaceField, setFindReplaceField] = useState<BatchFindReplaceField>("styleName");
  const [findReplaceQuery, setFindReplaceQuery] = useState("");
  const [findReplaceReplacement, setFindReplaceReplacement] = useState("");
  const [isPriceAdjustOpen, setIsPriceAdjustOpen] = useState(false);
  const [priceAdjustMode, setPriceAdjustMode] = useState<PriceAdjustMode>("percent_up");
  const [priceAdjustValue, setPriceAdjustValue] = useState("");

  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [selectedUploadProductId, setSelectedUploadProductId] = useState("");
  const [isUploadProcessing, setIsUploadProcessing] = useState(false);
  const [isBulkAnalyzing, setIsBulkAnalyzing] = useState(false);
  const [isBulkReviewOpen, setIsBulkReviewOpen] = useState(false);
  const [bulkAnalyzeAllEnabled, setBulkAnalyzeAllEnabled] = useState(true);
  const [bulkReviewFilter, setBulkReviewFilter] = useState<
    "all" | "ready" | "needs_review" | "approved" | "failed"
  >("all");
  const [bulkReviewQuery, setBulkReviewQuery] = useState("");
  const [isSavingReviewedItems, setIsSavingReviewedItems] = useState(false);
  const [bulkComposition, setBulkComposition] = useState("100% Polyester");
  const [bulkWovenKnits, setBulkWovenKnits] = useState("Woven");
  const [bulkPoPrice, setBulkPoPrice] = useState("600");
  const [bulkOspSar, setBulkOspSar] = useState("95");
  const [exportHistory, setExportHistory] = useState<MarketplaceExportRecord[]>([]);
  const [isExportHistoryLoading, setIsExportHistoryLoading] = useState(false);
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false);
  const [selectedExportFormat, setSelectedExportFormat] = useState<ExportFormat>("csv");
  const [exportMarketplaces, setExportMarketplaces] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportHistoryItems, setExportHistoryItems] = useState<MarketplaceExportRecord[]>([]);

  // Out-of-bounds Prompt State
  const [outOfBoundsPrompt, setOutOfBoundsPrompt] = useState<OutOfBoundsPromptState | null>(null);

  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMarketplace, setExportMarketplace] = useState<string>(MARKETPLACE_OPTIONS[0]);
  const [marketplaceTemplates, setMarketplaceTemplates] = useState<MarketplaceDocumentTemplate[]>(
    [],
  );
  const [selectedExportTemplateId, setSelectedExportTemplateId] = useState<string>("");
  const [isMarketplaceTemplatePanelOpen, setIsMarketplaceTemplatePanelOpen] = useState(false);
  const [marketplaceTemplateName, setMarketplaceTemplateName] = useState("");
  const [marketplaceTemplateMarketplace, setMarketplaceTemplateMarketplace] = useState<string>(
    MARKETPLACE_OPTIONS[0],
  );
  const [marketplaceTemplateFile, setMarketplaceTemplateFile] = useState<File | null>(null);
  const [parsedMarketplaceTemplate, setParsedMarketplaceTemplate] =
    useState<MarketplaceDocumentTemplateParseResponse | null>(null);
  const [marketplaceTemplateError, setMarketplaceTemplateError] = useState<string | null>(null);
  const [isParsingMarketplaceTemplate, setIsParsingMarketplaceTemplate] = useState(false);
  const [isSavingMarketplaceTemplate, setIsSavingMarketplaceTemplate] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [exportStatusFilter, setExportStatusFilter] = useState<"all" | ExportStatus>("all");
  const [isLearningPanelOpen, setIsLearningPanelOpen] = useState(false);
  const [isTemplatePanelOpen, setIsTemplatePanelOpen] = useState(false);
  const [activeExportTab, setActiveExportTab] = useState<"generate" | "history">("generate");
  const [isCreatingExport, setIsCreatingExport] = useState(false);

  const [catalogTemplates, setCatalogTemplates] = useState<CatalogTemplateRecord[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isTemplateSaving, setIsTemplateSaving] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState(defaultCatalogTemplateDraft.name);
  const [templateDescription, setTemplateDescription] = useState(
    defaultCatalogTemplateDraft.description,
  );
  const [templateDefaultCategory, setTemplateDefaultCategory] = useState(
    defaultCatalogTemplateDraft.defaults.category,
  );
  const [templateDefaultStyleName, setTemplateDefaultStyleName] = useState(
    defaultCatalogTemplateDraft.defaults.styleName,
  );
  const [templateDefaultColor, setTemplateDefaultColor] = useState(
    defaultCatalogTemplateDraft.defaults.color,
  );
  const [templateDefaultFabric, setTemplateDefaultFabric] = useState(
    defaultCatalogTemplateDraft.defaults.fabric,
  );
  const [templateDefaultComposition, setTemplateDefaultComposition] = useState(
    defaultCatalogTemplateDraft.defaults.composition,
  );
  const [templateDefaultWovenKnits, setTemplateDefaultWovenKnits] = useState(
    defaultCatalogTemplateDraft.defaults.wovenKnits,
  );
  const [templateDefaultUnits, setTemplateDefaultUnits] = useState(
    defaultCatalogTemplateDraft.defaults.units,
  );
  const [templateDefaultPoPrice, setTemplateDefaultPoPrice] = useState(
    defaultCatalogTemplateDraft.defaults.poPrice,
  );
  const [templateDefaultOspSar, setTemplateDefaultOspSar] = useState(
    defaultCatalogTemplateDraft.defaults.ospSar,
  );
  const [templateAllowedCategories, setTemplateAllowedCategories] = useState(
    defaultCatalogTemplateDraft.allowed_categories.join(", "),
  );
  const [templateAllowedStyleNames, setTemplateAllowedStyleNames] = useState(
    defaultCatalogTemplateDraft.allowed_style_names.join(", "),
  );
  const [templateAllowedColors, setTemplateAllowedColors] = useState(
    defaultCatalogTemplateDraft.allowed_colors.join(", "),
  );
  const [templateAllowedFabrics, setTemplateAllowedFabrics] = useState(
    defaultCatalogTemplateDraft.allowed_fabrics.join(", "),
  );
  const [templateAllowedCompositions, setTemplateAllowedCompositions] = useState(
    defaultCatalogTemplateDraft.allowed_compositions.join(", "),
  );
  const [templateAllowedWovenKnits, setTemplateAllowedWovenKnits] = useState(
    defaultCatalogTemplateDraft.allowed_woven_knits.join(", "),
  );
  const [templateStylePattern, setTemplateStylePattern] = useState(
    defaultCatalogTemplateDraft.style_code_pattern,
  );

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [pendingAnalyzeProductId, setPendingAnalyzeProductId] = useState<string | null>(null);
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [addItemError, setAddItemError] = useState<string | null>(null);

  const [itemStyleNo, setItemStyleNo] = useState("");
  const [itemCategory, setItemCategory] = useState<string>(CATEGORY_OPTIONS[0]);
  const [itemStyleName, setItemStyleName] = useState<string>(STYLE_NAME_OPTIONS[0]);
  const [itemColor, setItemColor] = useState<string>(COLOR_OPTIONS[1]);
  const [itemFabric, setItemFabric] = useState<string>(FABRIC_OPTIONS[0]);
  const [itemComposition, setItemComposition] = useState<string>(COMPOSITION_OPTIONS[1]);
  const [itemWovenKnits, setItemWovenKnits] = useState<string>(WOVEN_KNITS_OPTIONS[1]);
  const [itemTotalUnits, setItemTotalUnits] = useState<string>(TOTAL_UNITS_OPTIONS[0]);
  const [itemPoPrice, setItemPoPrice] = useState<string>(PO_PRICE_OPTIONS[2]);
  const [itemOspSar, setItemOspSar] = useState<string>(OSP_OPTIONS[1]);
  const [itemImageName, setItemImageName] = useState("");
  const [itemImageError, setItemImageError] = useState<string | null>(null);
  const [isItemDropActive, setIsItemDropActive] = useState(false);
  const [rememberLastValues, setRememberLastValues] = useState<boolean>(false);
  const [fieldConfidence, setFieldConfidence] = useState<Partial<Record<AiFieldKey, number>>>({});
  const [fieldContext, setFieldContext] = useState<Partial<Record<AiFieldKey, AiFieldContext>>>({});

  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestionsState | null>(null);
  const [isAiSuggestionsVisible, setIsAiSuggestionsVisible] = useState(false);
  const [overallConfidence, setOverallConfidence] = useState<number | null>(null);
  const [analysisStage, setAnalysisStage] = useState<string | null>(null);
  const [lastAnalyzedImageHash, setLastAnalyzedImageHash] = useState<string | null>(null);
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState(false);
  const [feedbackCompletedFields, setFeedbackCompletedFields] = useState<
    Partial<Record<AiFieldKey, true>>
  >({});
  const [activeImageLabelId, setActiveImageLabelId] = useState<string | null>(null);
  const [aiLabelCategory, setAiLabelCategory] = useState("");
  const [aiLabelStyle, setAiLabelStyle] = useState("");
  const [imageLabelCorrected, setImageLabelCorrected] = useState(false);
  const [learningStats, setLearningStats] = useState<LearningStatsResponse | null>(null);
  const [isLearningStatsLoading, setIsLearningStatsLoading] = useState(false);
  const [learningStatsError, setLearningStatsError] = useState<string | null>(null);
  const [isCorrectionModalOpen, setIsCorrectionModalOpen] = useState(false);
  const [correctionFieldKey, setCorrectionFieldKey] = useState<AiFieldKey | null>(null);
  const [correctionReasonCode, setCorrectionReasonCode] = useState<string>(
    CORRECTION_REASON_OPTIONS[0].value,
  );
  const [correctionNotes, setCorrectionNotes] = useState("");
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionValueError, setCorrectionValueError] = useState<string | null>(null);

  // Initialize from LocalStorage
  useEffect(() => {
    const stored = localStorage.getItem("kira_remember_last_values");
    if (stored === "true") {
      setRememberLastValues(true);
    }
  }, []);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queueRef = useRef<UploadItem[]>([]);
  const queueRunningRef = useRef(false);
  const selectedUploadProductIdRef = useRef("");
  const persistedProductsRef = useRef<CatalogRow[]>([]);
  const catalogTemplatesRef = useRef<CatalogTemplateRecord[]>([]);
  const addItemImageInputRef = useRef<HTMLInputElement | null>(null);
  const selectedImageFileRef = useRef<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    catalogTemplatesRef.current = catalogTemplates;
  }, [catalogTemplates]);

  useEffect(() => {
    let mounted = true;
    apiRequest<{ company_name?: string | null }>("/auth/me")
      .then((profile) => {
        if (mounted && profile.company_name?.trim()) {
          setCompanyBrand(profile.company_name.trim());
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCatalog(): Promise<void> {
      if (!hasAccessToken()) {
        setCatalogNotice("Sign in to load live catalog records.");
        setCatalogRows([]);
        if (mounted) setIsCatalogLoading(false);
        return;
      }

      setIsCatalogLoading(true);
      setCatalogRows([]);
      try {
        const response = await apiRequest<CatalogListResponse>("/catalog/products?limit=50");
        if (!mounted) return;

        if (response.items.length === 0) {
          setCatalogNotice("No catalog records yet.");
          setCatalogRows([]);
          return;
        }

        const mappedRows: CatalogRow[] = response.items.map((item) => {
          const attributes = item.ai_attributes ?? {};
          const attrFabric = typeof attributes.fabric === "string" ? attributes.fabric : undefined;
          const attrComposition =
            typeof attributes.composition === "string" ? attributes.composition : undefined;
          const attrWovenKnitsRaw =
            typeof attributes.woven_knits === "string"
              ? attributes.woven_knits
              : typeof attributes.wovenKnits === "string"
                ? attributes.wovenKnits
                : undefined;
          const attrUnits = attributes.units;
          const attrPoPrice = attributes.po_price ?? attributes.poPrice;
          const attrOsp = attributes.osp ?? attributes.osp_sar ?? attributes.ospSar;

          const mappedColor = pickOptionValue(item.color, COLOR_OPTIONS) ?? "Blue";
          const mappedFabric = pickOptionValue(attrFabric, FABRIC_OPTIONS) ?? "Poly Georgette";
          const mappedComposition =
            pickOptionValue(attrComposition, COMPOSITION_OPTIONS) ?? "100% Polyester";
          const mappedWovenKnits =
            pickOptionValue(attrWovenKnitsRaw, WOVEN_KNITS_OPTIONS) ?? "Woven";
          const mappedUnits =
            typeof attrUnits === "number"
              ? String(attrUnits)
              : typeof attrUnits === "string" && attrUnits.trim()
                ? attrUnits.trim()
                : "24";
          const mappedPoPrice =
            typeof attrPoPrice === "number"
              ? String(attrPoPrice)
              : typeof attrPoPrice === "string" && attrPoPrice.trim()
                ? attrPoPrice.trim()
                : "600";
          const mappedPrice =
            typeof attrOsp === "number"
              ? `SAR ${attrOsp}`
              : typeof attrOsp === "string" && attrOsp.trim()
                ? attrOsp.trim()
                : "SAR 95";

          return {
            id: item.id,
            primary_image_url: getImageUrl(item.primary_image_url) ?? undefined,
            styleNo: item.sku,
            name: item.title,
            category: normalizeCategory(item.category),
            color: mappedColor,
            fabric: mappedFabric,
            composition: mappedComposition,
            wovenKnits: mappedWovenKnits,
            units: mappedUnits,
            poPrice: mappedPoPrice,
            price: mappedPrice,
            status: item.status,
            persisted: true,
          };
        });
        setCatalogRows(mappedRows);
        setCatalogNotice(null);
      } catch (error) {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Catalog could not be loaded.";
        setCatalogNotice(message);
        setCatalogRows([]);
      } finally {
        if (mounted) setIsCatalogLoading(false);
      }
    }

    void loadCatalog();
    return () => {
      mounted = false;
    };
  }, []);

  const persistedProducts = useMemo(
    () => catalogRows.filter((row) => row.persisted),
    [catalogRows],
  );

  useEffect(() => {
    persistedProductsRef.current = persistedProducts;
  }, [persistedProducts]);

  useEffect(() => {
    selectedUploadProductIdRef.current = selectedUploadProductId;
  }, [selectedUploadProductId]);

  useEffect(() => {
    if (!selectedUploadProductId && persistedProducts.length > 0) {
      const first = persistedProducts[0];
      if (first) setSelectedUploadProductId(first.id);
    }
  }, [selectedUploadProductId, persistedProducts]);

  const loadExportHistory = useCallback(
    async (statusOverride: "all" | ExportStatus): Promise<void> => {
      if (!hasAccessToken()) {
        setExportHistory([]);
        return;
      }

      setIsExportHistoryLoading(true);
      setExportError(null);
      try {
        const queryParams = new URLSearchParams({ limit: "20" });
        if (statusOverride !== "all") {
          queryParams.set("status", statusOverride);
        }
        const response = await apiRequest<MarketplaceExportListResponse>(
          `/catalog/exports?${queryParams.toString()}`,
        );
        setExportHistory(response.items);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load export history.";
        setExportError(message);
      } finally {
        setIsExportHistoryLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadExportHistory(exportStatusFilter);
  }, [exportStatusFilter, loadExportHistory]);

  const loadMarketplaceTemplates = useCallback(async (): Promise<void> => {
    if (!hasAccessToken()) {
      setMarketplaceTemplates([]);
      setSelectedExportTemplateId("");
      return;
    }
    try {
      const items = await listMarketplaceDocumentTemplates("catalog");
      setMarketplaceTemplates(items);
      setSelectedExportTemplateId((current) => {
        if (current && items.some((item) => item.id === current)) {
          return current;
        }
        return "";
      });
    } catch (error) {
      setMarketplaceTemplateError(
        error instanceof Error ? error.message : "Unable to load marketplace templates.",
      );
    }
  }, []);

  useEffect(() => {
    void loadMarketplaceTemplates();
  }, [loadMarketplaceTemplates]);

  useEffect(() => {
    if (!selectedExportTemplateId) {
      return;
    }
    const matchedTemplate = marketplaceTemplates.find(
      (item) => item.id === selectedExportTemplateId,
    );
    if (!matchedTemplate) {
      return;
    }
    const label = MARKETPLACE_OPTIONS.find(
      (option) => MARKETPLACE_KEY_BY_LABEL[option] === matchedTemplate.marketplace_key,
    );
    if (label) {
      setExportMarketplace(label);
    }
  }, [marketplaceTemplates, selectedExportTemplateId]);

  const loadLearningStats = useCallback(async (): Promise<void> => {
    if (!hasAccessToken()) {
      setLearningStats(null);
      setLearningStatsError(null);
      return;
    }
    setIsLearningStatsLoading(true);
    setLearningStatsError(null);
    try {
      const response = await apiRequest<LearningStatsResponse>("/catalog/learning-stats");
      setLearningStats(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load learning stats.";
      setLearningStatsError(message);
    } finally {
      setIsLearningStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLearningPanelOpen) return;
    void loadLearningStats();
  }, [isLearningPanelOpen, loadLearningStats]);

  const loadCatalogTemplates = useCallback(async (): Promise<void> => {
    if (!hasAccessToken()) {
      const localTemplate: CatalogTemplateRecord = {
        id: "local-default-template",
        company_id: "local",
        name: defaultCatalogTemplateDraft.name,
        description: defaultCatalogTemplateDraft.description,
        defaults: { ...defaultCatalogTemplateDraft.defaults },
        allowed_categories: [...defaultCatalogTemplateDraft.allowed_categories],
        allowed_style_names: [...defaultCatalogTemplateDraft.allowed_style_names],
        allowed_colors: [...defaultCatalogTemplateDraft.allowed_colors],
        allowed_fabrics: [...defaultCatalogTemplateDraft.allowed_fabrics],
        allowed_compositions: [...defaultCatalogTemplateDraft.allowed_compositions],
        allowed_woven_knits: [...defaultCatalogTemplateDraft.allowed_woven_knits],
        style_code_pattern: defaultCatalogTemplateDraft.style_code_pattern,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setCatalogTemplates([localTemplate]);
      setSelectedTemplateId(localTemplate.id);
      return;
    }

    try {
      const response = await apiRequest<CatalogTemplateListResponse>(
        "/catalog/templates?limit=100",
      );
      if (response.items.length === 0) {
        setCatalogTemplates([]);
        setSelectedTemplateId("");
        return;
      }
      setCatalogTemplates(response.items);
      setSelectedTemplateId((current) => {
        if (current && response.items.some((item) => item.id === current)) return current;
        const active = response.items.find((item) => item.is_active);
        return active?.id ?? response.items[0]?.id ?? "";
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load templates.";
      setTemplateNotice(message);
    }
  }, []);

  useEffect(() => {
    void loadCatalogTemplates();
  }, [loadCatalogTemplates]);

  async function handleDownloadExport(record: MarketplaceExportRecord): Promise<void> {
    if (!record.file_url) return;

    const baseUrl = getResolvedApiOriginUrl();
    const fileUrl = record.file_url.startsWith("http")
      ? record.file_url
      : `${baseUrl}${record.file_url.startsWith("/") ? "" : "/"}${record.file_url}`;

    try {
      const response = await fetch(fileUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}.`);
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${record.marketplace.toLowerCase().replace(/\s+/g, "-")}-export-${record.id}.${record.export_format}`;
      link.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to download export.";
      setExportError(message);
    }
  }

  async function handleCreateMarketplaceExport(
    overrideFilters?: Record<string, unknown>,
  ): Promise<MarketplaceExportRecord | null> {
    if (!hasAccessToken()) {
      setExportError("Sign in to generate marketplace exports.");
      return null;
    }

    const exportFilters: Record<string, unknown> = overrideFilters ?? {};
    if (!overrideFilters) {
      if (statusFilter !== "All Statuses") {
        exportFilters.status = statusFilter;
      }
      if (searchValue.trim()) {
        exportFilters.search = searchValue.trim();
      }
    }

    setIsCreatingExport(true);
    setExportError(null);
    try {
      const created = await apiRequest<MarketplaceExportRecord>("/catalog/exports", {
        method: "POST",
        body: JSON.stringify({
          marketplace: selectedExportTemplateId ? undefined : exportMarketplace,
          template_id: selectedExportTemplateId || undefined,
          export_format: exportFormat,
          filters: exportFilters,
        }),
      });
      setExportHistory((items) => [created, ...items].slice(0, 20));

      if (created.status === "completed" && created.file_url) {
        await handleDownloadExport(created);
      }
      if (created.status === "failed") {
        setExportError(created.error_message ?? "Export validation failed.");
      }
      return created;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create export.";
      setExportError(message);
      return null;
    } finally {
      setIsCreatingExport(false);
      await loadExportHistory(exportStatusFilter);
    }
  }

  async function handleParseMarketplaceTemplateSample(): Promise<void> {
    if (!marketplaceTemplateFile) {
      setMarketplaceTemplateError("Choose a CSV or XLSX sample first.");
      return;
    }
    setIsParsingMarketplaceTemplate(true);
    setMarketplaceTemplateError(null);
    try {
      const parsed = await parseMarketplaceTemplateSample(marketplaceTemplateFile, "catalog");
      setParsedMarketplaceTemplate(parsed);
      setMarketplaceTemplateName((current) =>
        current.trim() ? current : `${marketplaceTemplateMarketplace} catalog export`,
      );
    } catch (error) {
      setMarketplaceTemplateError(
        error instanceof Error ? error.message : "Failed to parse marketplace sample.",
      );
    } finally {
      setIsParsingMarketplaceTemplate(false);
    }
  }

  function handleMarketplaceTemplateColumnChange(
    index: number,
    patch: Partial<MarketplaceDocumentTemplateParseResponse["columns"][number]>,
  ): void {
    setParsedMarketplaceTemplate((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        columns: current.columns.map((column, columnIndex) =>
          columnIndex === index ? { ...column, ...patch } : column,
        ),
      };
    });
  }

  async function handleSaveMarketplaceTemplate(): Promise<void> {
    if (!parsedMarketplaceTemplate) {
      setMarketplaceTemplateError("Upload and parse a marketplace sample first.");
      return;
    }
    if (!marketplaceTemplateName.trim()) {
      setMarketplaceTemplateError("Template name is required.");
      return;
    }
    setIsSavingMarketplaceTemplate(true);
    setMarketplaceTemplateError(null);
    try {
      const saved = await createMarketplaceDocumentTemplate({
        name: marketplaceTemplateName.trim(),
        marketplace_key:
          MARKETPLACE_KEY_BY_LABEL[
            marketplaceTemplateMarketplace as keyof typeof MARKETPLACE_KEY_BY_LABEL
          ] ?? "generic",
        document_type: "catalog",
        template_kind: parsedMarketplaceTemplate.template_kind,
        file_format: parsedMarketplaceTemplate.file_format,
        sample_file_url: parsedMarketplaceTemplate.sample_file_url,
        sheet_name: parsedMarketplaceTemplate.sheet_name,
        header_row_index: parsedMarketplaceTemplate.header_row_index,
        columns: parsedMarketplaceTemplate.columns,
        layout: parsedMarketplaceTemplate.layout,
        is_default: marketplaceTemplates.length === 0,
        is_active: true,
      });
      await loadMarketplaceTemplates();
      setSelectedExportTemplateId(saved.id);
      setMarketplaceTemplateName("");
      setMarketplaceTemplateFile(null);
      setParsedMarketplaceTemplate(null);
      setIsMarketplaceTemplatePanelOpen(false);
    } catch (error) {
      setMarketplaceTemplateError(
        error instanceof Error ? error.message : "Failed to save marketplace template.",
      );
    } finally {
      setIsSavingMarketplaceTemplate(false);
    }
  }

  async function handleDeleteMarketplaceTemplate(templateId: string): Promise<void> {
    if (typeof window !== "undefined" && !window.confirm("Delete this marketplace template?")) {
      return;
    }
    setMarketplaceTemplateError(null);
    try {
      await deleteMarketplaceDocumentTemplate(templateId);
      if (selectedExportTemplateId === templateId) {
        setSelectedExportTemplateId("");
      }
      await loadMarketplaceTemplates();
    } catch (error) {
      setMarketplaceTemplateError(
        error instanceof Error ? error.message : "Failed to delete marketplace template.",
      );
    }
  }

  const categoryOptions = useMemo(() => ["All Categories", ...CATEGORY_OPTIONS], []);

  const activeTemplate = useMemo(
    () => catalogTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [catalogTemplates, selectedTemplateId],
  );

  const getTemplateAllowedList = useCallback(
    (field: TemplateConstrainedField): string[] => {
      if (!activeTemplate) return [];
      const mappedKey = TEMPLATE_LABEL_TO_API_MAP[field];
      return activeTemplate[mappedKey] || [];
    },
    [activeTemplate],
  );

  const checkAndPromptOutOfBounds = useCallback(
    (
      id: string,
      field: TemplateConstrainedField,
      value: string,
      source: "user_input" | "ai_suggestion",
      proceedFn: () => void,
    ) => {
      // Allow empty values immediately
      if (!value || value.trim() === "") {
        proceedFn();
        return;
      }

      // If no active template, or value is in the allowed list, proceed immediately
      const allowedList = getTemplateAllowedList(field);
      if (!activeTemplate || allowedList.length === 0 || includesToken(allowedList, value)) {
        proceedFn();
        return;
      }

      // If value is unknown/unrecognized and we have a template in place, prompt the user
      setOutOfBoundsPrompt({
        id,
        field,
        value,
        source,
        onConfirm: async (addToTemplate: boolean) => {
          if (addToTemplate && activeTemplate && activeTemplate.id !== "local-default-template") {
            const listKey = TEMPLATE_LABEL_TO_API_MAP[field];
            const currentList = activeTemplate[listKey];
            const patchData = { [listKey]: [...currentList, value] };
            try {
              const res = await apiRequest<CatalogTemplateRecord>(
                `/catalog/templates/${activeTemplate.id}`,
                {
                  method: "PATCH",
                  body: JSON.stringify(patchData),
                },
              );
              setCatalogTemplates((prev) => prev.map((t) => (t.id === res.id ? res : t)));
            } catch (err) {
              console.error("Failed to update template list", err);
            }
          }
          proceedFn();
          setOutOfBoundsPrompt(null);
        },
        onCancel: () => {
          setOutOfBoundsPrompt(null);
        },
      });
    },
    [activeTemplate, getTemplateAllowedList],
  );

  const templateColorOptions = useMemo(() => {
    const draftValues = parseCommaSeparatedTokens(templateAllowedColors);
    if (draftValues.length > 0) return draftValues;
    if (!activeTemplate || activeTemplate.allowed_colors.length === 0) return [...COLOR_OPTIONS];
    return activeTemplate.allowed_colors;
  }, [activeTemplate, templateAllowedColors]);

  const templateCategoryOptions = useMemo(() => {
    const draftValues = parseCommaSeparatedTokens(templateAllowedCategories);
    if (draftValues.length > 0) return draftValues;
    if (!activeTemplate || activeTemplate.allowed_categories.length === 0)
      return [...CATEGORY_OPTIONS];
    return activeTemplate.allowed_categories;
  }, [activeTemplate, templateAllowedCategories]);

  const templateStyleNameOptions = useMemo(() => {
    const draftValues = parseCommaSeparatedTokens(templateAllowedStyleNames);
    if (draftValues.length > 0) return draftValues;
    if (!activeTemplate || activeTemplate.allowed_style_names.length === 0)
      return [...STYLE_NAME_OPTIONS];
    return activeTemplate.allowed_style_names;
  }, [activeTemplate, templateAllowedStyleNames]);

  const templateCompositionOptions = useMemo(() => {
    const draftValues = parseCommaSeparatedTokens(templateAllowedCompositions);
    if (draftValues.length > 0) return draftValues;
    if (!activeTemplate || activeTemplate.allowed_compositions.length === 0)
      return [...COMPOSITION_OPTIONS];
    return activeTemplate.allowed_compositions;
  }, [activeTemplate, templateAllowedCompositions]);

  const templateWovenKnitsOptions = useMemo(() => {
    const draftValues = parseCommaSeparatedTokens(templateAllowedWovenKnits);
    if (draftValues.length > 0) return draftValues;
    if (!activeTemplate || activeTemplate.allowed_woven_knits.length === 0)
      return [...WOVEN_KNITS_OPTIONS];
    return activeTemplate.allowed_woven_knits;
  }, [activeTemplate, templateAllowedWovenKnits]);

  const getAllowedTemplateValues = useCallback(
    (field: TemplateConstrainedField): string[] => {
      if (field === "category") {
        const draftValues = parseCommaSeparatedTokens(templateAllowedCategories);
        if (draftValues.length > 0) return draftValues;
        return activeTemplate?.allowed_categories ?? [];
      }
      if (field === "styleName") {
        const draftValues = parseCommaSeparatedTokens(templateAllowedStyleNames);
        if (draftValues.length > 0) return draftValues;
        return activeTemplate?.allowed_style_names ?? [];
      }
      if (field === "color") {
        const draftValues = parseCommaSeparatedTokens(templateAllowedColors);
        if (draftValues.length > 0) return draftValues;
        return activeTemplate?.allowed_colors ?? [];
      }
      if (field === "fabric") {
        const draftValues = parseCommaSeparatedTokens(templateAllowedFabrics);
        if (draftValues.length > 0) return draftValues;
        return activeTemplate?.allowed_fabrics ?? [];
      }
      if (field === "composition") {
        const draftValues = parseCommaSeparatedTokens(templateAllowedCompositions);
        if (draftValues.length > 0) return draftValues;
        return activeTemplate?.allowed_compositions ?? [];
      }

      const draftValues = parseCommaSeparatedTokens(templateAllowedWovenKnits);
      if (draftValues.length > 0) return draftValues;
      return activeTemplate?.allowed_woven_knits ?? [];
    },
    [
      activeTemplate,
      templateAllowedCategories,
      templateAllowedStyleNames,
      templateAllowedColors,
      templateAllowedFabrics,
      templateAllowedCompositions,
      templateAllowedWovenKnits,
    ],
  );

  const buildAnalyzeImageRequestPayload = useCallback(
    (imageUrl: string): AnalyzeImageRequestPayload => {
      const normalizeValues = (values: string[]): string[] =>
        values
          .map((value) => value.trim())
          .filter(Boolean)
          .filter(
            (value, index, list) =>
              list.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) ===
              index,
          )
          .slice(0, 40);

      const allowedCategories = normalizeValues(getAllowedTemplateValues("category"));
      const allowedStyleNames = normalizeValues(getAllowedTemplateValues("styleName"));
      const allowedColors = normalizeValues(getAllowedTemplateValues("color"));
      const allowedFabrics = normalizeValues(getAllowedTemplateValues("fabric"));
      const allowedCompositions = normalizeValues(getAllowedTemplateValues("composition"));
      const allowedWovenKnits = normalizeValues(getAllowedTemplateValues("wovenKnits"));
      const hasAnyAllowedValues =
        allowedCategories.length +
          allowedStyleNames.length +
          allowedColors.length +
          allowedFabrics.length +
          allowedCompositions.length +
          allowedWovenKnits.length >
        0;

      return {
        image_url: imageUrl,
        template_allowed: hasAnyAllowedValues
          ? {
              allowed_categories: allowedCategories,
              allowed_style_names: allowedStyleNames,
              allowed_colors: allowedColors,
              allowed_fabrics: allowedFabrics,
              allowed_compositions: allowedCompositions,
              allowed_woven_knits: allowedWovenKnits,
            }
          : undefined,
      };
    },
    [getAllowedTemplateValues],
  );

  async function appendAllowedTemplateValue(
    field: TemplateConstrainedField,
    value: string,
  ): Promise<void> {
    const normalized = value.trim();
    if (!normalized) return;

    const mergeToken = (list: string[]) =>
      includesToken(list, normalized) ? list : [...list, normalized];
    const targetTemplateId = selectedTemplateId || activeTemplate?.id;
    if (!targetTemplateId) {
      if (field === "category") {
        setTemplateAllowedCategories((previous) =>
          mergeToken(parseCommaSeparatedTokens(previous)).join(", "),
        );
      } else if (field === "styleName") {
        setTemplateAllowedStyleNames((previous) =>
          mergeToken(parseCommaSeparatedTokens(previous)).join(", "),
        );
      } else if (field === "color") {
        setTemplateAllowedColors((previous) =>
          mergeToken(parseCommaSeparatedTokens(previous)).join(", "),
        );
      } else if (field === "fabric") {
        setTemplateAllowedFabrics((previous) =>
          mergeToken(parseCommaSeparatedTokens(previous)).join(", "),
        );
      } else if (field === "composition") {
        setTemplateAllowedCompositions((previous) =>
          mergeToken(parseCommaSeparatedTokens(previous)).join(", "),
        );
      } else {
        setTemplateAllowedWovenKnits((previous) =>
          mergeToken(parseCommaSeparatedTokens(previous)).join(", "),
        );
      }
      return;
    }

    const currentTemplate =
      catalogTemplatesRef.current.find((template) => template.id === targetTemplateId) ??
      activeTemplate;
    if (!currentTemplate) return;

    const nextAllowedCategories =
      field === "category"
        ? mergeToken(currentTemplate.allowed_categories)
        : currentTemplate.allowed_categories;
    const nextAllowedStyleNames =
      field === "styleName"
        ? mergeToken(currentTemplate.allowed_style_names)
        : currentTemplate.allowed_style_names;
    const nextAllowedColors =
      field === "color"
        ? mergeToken(currentTemplate.allowed_colors)
        : currentTemplate.allowed_colors;
    const nextAllowedFabrics =
      field === "fabric"
        ? mergeToken(currentTemplate.allowed_fabrics)
        : currentTemplate.allowed_fabrics;
    const nextAllowedCompositions =
      field === "composition"
        ? mergeToken(currentTemplate.allowed_compositions)
        : currentTemplate.allowed_compositions;
    const nextAllowedWovenKnits =
      field === "wovenKnits"
        ? mergeToken(currentTemplate.allowed_woven_knits)
        : currentTemplate.allowed_woven_knits;
    const nextTemplates = catalogTemplatesRef.current.map((template) =>
      template.id === targetTemplateId
        ? {
            ...template,
            allowed_categories: nextAllowedCategories,
            allowed_style_names: nextAllowedStyleNames,
            allowed_colors: nextAllowedColors,
            allowed_fabrics: nextAllowedFabrics,
            allowed_compositions: nextAllowedCompositions,
            allowed_woven_knits: nextAllowedWovenKnits,
          }
        : template,
    );
    catalogTemplatesRef.current = nextTemplates;
    setCatalogTemplates(nextTemplates);

    setTemplateAllowedCategories(nextAllowedCategories.join(", "));
    setTemplateAllowedStyleNames(nextAllowedStyleNames.join(", "));
    setTemplateAllowedColors(nextAllowedColors.join(", "));
    setTemplateAllowedFabrics(nextAllowedFabrics.join(", "));
    setTemplateAllowedCompositions(nextAllowedCompositions.join(", "));
    setTemplateAllowedWovenKnits(nextAllowedWovenKnits.join(", "));

    if (!hasAccessToken() || targetTemplateId.startsWith("local-")) {
      return;
    }

    try {
      const saved = await apiRequest<CatalogTemplateRecord>(
        `/catalog/templates/${targetTemplateId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            allowed_categories: nextAllowedCategories,
            allowed_style_names: nextAllowedStyleNames,
            allowed_colors: nextAllowedColors,
            allowed_fabrics: nextAllowedFabrics,
            allowed_compositions: nextAllowedCompositions,
            allowed_woven_knits: nextAllowedWovenKnits,
          }),
        },
      );
      setCatalogTemplates((items) => {
        const nextItems = items.map((item) => (item.id === saved.id ? saved : item));
        catalogTemplatesRef.current = nextItems;
        return nextItems;
      });
    } catch {
      setTemplateNotice("Could not persist updated allowed list. Changes remain local.");
    }
  }

  async function ensureTemplateValueAllowed(
    field: TemplateConstrainedField,
    value: string | undefined,
    approvalCache?: Map<string, boolean>,
  ): Promise<boolean> {
    const candidate = value?.trim();
    if (!candidate) return true;

    const allowedList = getAllowedTemplateValues(field);
    if (allowedList.length === 0 || includesToken(allowedList, candidate)) {
      return true;
    }

    const cacheKey = `${field}:${candidate.toLowerCase()}`;
    if (approvalCache?.has(cacheKey)) {
      return approvalCache.get(cacheKey) ?? false;
    }

    if (typeof window === "undefined") {
      approvalCache?.set(cacheKey, true);
      return true;
    }

    const includeValue = window.confirm(
      `"${candidate}" is outside allowed ${TEMPLATE_FIELD_LABELS[field]} list. Include it in allowed ${TEMPLATE_FIELD_LABELS[field]} list?`,
    );
    if (includeValue) {
      await appendAllowedTemplateValue(field, candidate);
      approvalCache?.set(cacheKey, true);
      return true;
    }

    approvalCache?.set(cacheKey, false);
    return false;
  }

  async function promptAddOutOfBoundsSuggestedValues(
    values: Partial<Record<TemplateConstrainedField, string>>,
  ): Promise<void> {
    if (!activeTemplate) return;

    const entries = Object.entries(values) as Array<[TemplateConstrainedField, string | undefined]>;
    for (const [field, rawValue] of entries) {
      const candidate = rawValue?.trim();
      if (!candidate) continue;
      const allowedList = getAllowedTemplateValues(field);
      if (allowedList.length === 0 || includesToken(allowedList, candidate)) continue;
      if (typeof window === "undefined") continue;

      const includeValue = window.confirm(
        `AI suggested "${candidate}" for ${TEMPLATE_FIELD_LABELS[field]}, which is outside allowed list. Add it to this template?`,
      );
      if (includeValue) {
        await appendAllowedTemplateValue(field, candidate);
      }
    }
  }

  const templateFabricOptions = useMemo(() => {
    const draftValues = parseCommaSeparatedTokens(templateAllowedFabrics);
    if (draftValues.length > 0) return draftValues;
    if (!activeTemplate || activeTemplate.allowed_fabrics.length === 0) return [...FABRIC_OPTIONS];
    return activeTemplate.allowed_fabrics;
  }, [activeTemplate, templateAllowedFabrics]);

  const addItemCategoryOptions = useMemo(
    () => withCurrentOption(templateCategoryOptions, itemCategory),
    [templateCategoryOptions, itemCategory],
  );
  const addItemStyleNameOptions = useMemo(
    () => withCurrentOption(templateStyleNameOptions, itemStyleName),
    [templateStyleNameOptions, itemStyleName],
  );
  const addItemColorOptions = useMemo(
    () => withCurrentOption(templateColorOptions, itemColor),
    [templateColorOptions, itemColor],
  );
  const addItemFabricOptions = useMemo(
    () => withCurrentOption(templateFabricOptions, itemFabric),
    [templateFabricOptions, itemFabric],
  );
  const addItemCompositionOptions = useMemo(
    () => withCurrentOption(templateCompositionOptions, itemComposition),
    [templateCompositionOptions, itemComposition],
  );
  const addItemWovenKnitsOptions = useMemo(
    () => withCurrentOption(templateWovenKnitsOptions, itemWovenKnits),
    [templateWovenKnitsOptions, itemWovenKnits],
  );

  const colorOptions = useMemo(() => {
    const colors = Array.from(new Set(catalogRows.map((row) => row.color))).sort();
    return ["All Colors", ...colors];
  }, [catalogRows]);

  const filteredCatalogRows = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    return catalogRows.filter((row) => {
      const matchesSearch =
        query.length === 0 ||
        [row.styleNo, row.name, normalizeCategory(row.category), row.color, row.fabric]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesCategory =
        categoryFilter === "All Categories" || normalizeCategory(row.category) === categoryFilter;
      const matchesColor = colorFilter === "All Colors" || row.color === colorFilter;
      const matchesStatus = statusFilter === "All Statuses" || row.status === statusFilter;
      return matchesSearch && matchesCategory && matchesColor && matchesStatus;
    });
  }, [catalogRows, searchValue, categoryFilter, colorFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = catalogRows.length;
    const dresses = catalogRows.filter(
      (row) => normalizeCategory(row.category) === "DRESSES",
    ).length;
    const cordSets = catalogRows.filter(
      (row) => normalizeCategory(row.category) === "CORD SETS",
    ).length;
    return { total, dresses, cordSets };
  }, [catalogRows]);

  useEffect(() => {
    if (!activeTemplate) return;
    const defaults = activeTemplate.defaults ?? {};
    if (typeof defaults.composition === "string" && defaults.composition.trim()) {
      setBulkComposition(defaults.composition);
    }
    if (typeof defaults.wovenKnits === "string" && defaults.wovenKnits.trim()) {
      setBulkWovenKnits(defaults.wovenKnits);
    }
    if (typeof defaults.poPrice === "string" && defaults.poPrice.trim()) {
      setBulkPoPrice(defaults.poPrice);
    }
    if (typeof defaults.ospSar === "string" && defaults.ospSar.trim()) {
      setBulkOspSar(defaults.ospSar);
    }
  }, [activeTemplate]);

  const lowConfidenceFields = useMemo(
    () =>
      Object.entries(aiSuggestions?.confidence ?? {})
        .filter(([, confidence]) => typeof confidence === "number" && confidence < 70)
        .map(([field]) => field as AiFieldKey),
    [aiSuggestions],
  );

  const similarItems = useMemo(() => {
    if (!aiSuggestions || lowConfidenceFields.length === 0) return [];
    const categorySuggestion = aiSuggestions.values.category;
    const colorSuggestion = aiSuggestions.values.color;
    const fabricSuggestion = aiSuggestions.values.fabric;
    const compositionSuggestion = aiSuggestions.values.composition;

    return catalogRows
      .filter((row) => !editingRowId || row.id !== editingRowId)
      .map((row) => {
        let score = 0;
        if (
          categorySuggestion &&
          normalizeCategory(row.category) === normalizeCategory(categorySuggestion)
        )
          score += 2;
        if (colorSuggestion && row.color.toLowerCase() === colorSuggestion.toLowerCase())
          score += 2;
        if (fabricSuggestion && row.fabric.toLowerCase() === fabricSuggestion.toLowerCase())
          score += 2;
        if (
          compositionSuggestion &&
          row.composition.toLowerCase() === compositionSuggestion.toLowerCase()
        )
          score += 1;
        return { row, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => item.row);
  }, [aiSuggestions, catalogRows, editingRowId, lowConfidenceFields.length]);

  const seasonalRecommendation = useMemo(() => {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) {
      return {
        season: "Spring",
        color: "Pink",
        fabric: "Cotton Poplin",
        composition: "100% Cotton",
      };
    }
    if (month >= 6 && month <= 8) {
      return {
        season: "Summer",
        color: "White",
        fabric: "Cotton Poplin",
        composition: "100% Cotton",
      };
    }
    if (month >= 9 && month <= 11) {
      return {
        season: "Fall",
        color: "Maroon",
        fabric: "Poly Georgette",
        composition: "100% Polyester",
      };
    }
    return {
      season: "Winter",
      color: "Bottle Green",
      fabric: "Pleated Knitted Fabric",
      composition: "100% Polyester",
    };
  }, []);

  useEffect(() => {
    setSelectedRowIds((ids) => ids.filter((id) => catalogRows.some((row) => row.id === id)));
  }, [catalogRows]);

  const selectedIdSet = useMemo(() => new Set(selectedRowIds), [selectedRowIds]);
  const selectedRows = useMemo(
    () => catalogRows.filter((row) => selectedIdSet.has(row.id)),
    [catalogRows, selectedIdSet],
  );
  const selectedVisibleCount = useMemo(
    () => filteredCatalogRows.filter((row) => selectedIdSet.has(row.id)).length,
    [filteredCatalogRows, selectedIdSet],
  );
  const allVisibleSelected =
    filteredCatalogRows.length > 0 && selectedVisibleCount === filteredCatalogRows.length;
  const bulkReviewRows = useMemo(() => {
    const query = bulkReviewQuery.trim().toLowerCase();
    return uploadItems.filter((item) => {
      if (bulkReviewFilter === "failed" && item.status !== "failed") return false;
      if (bulkReviewFilter === "approved" && item.approved !== true) return false;
      if (bulkReviewFilter === "ready" && (!item.analysis || item.analysis.needsReview))
        return false;
      if (bulkReviewFilter === "needs_review" && (!item.analysis || !item.analysis.needsReview))
        return false;
      if (query.length === 0) return true;
      const haystack = [
        item.name,
        item.analysis?.styleNo,
        item.analysis?.styleName,
        item.analysis?.category,
        item.analysis?.color,
        item.analysis?.fabric,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [uploadItems, bulkReviewFilter, bulkReviewQuery]);

  const bulkReviewStats = useMemo(() => {
    const prepared = uploadItems.filter((item) => Boolean(item.analysis));
    const ready = prepared.filter((item) => item.analysis && !item.analysis.needsReview).length;
    const needsReview = prepared.filter((item) => item.analysis?.needsReview).length;
    const approved = prepared.filter((item) => item.approved).length;
    const failed = uploadItems.filter((item) => item.status === "failed").length;
    return { prepared: prepared.length, ready, needsReview, approved, failed };
  }, [uploadItems]);

  const isEditMode = editingRowId !== null;

  function updateUploadItem(itemId: string, updater: (item: UploadItem) => UploadItem): void {
    setUploadItems((items) => items.map((item) => (item.id === itemId ? updater(item) : item)));
  }

  function updateUploadAnalysisField(
    itemId: string,
    field: keyof UploadAnalysis,
    value: string | number | boolean,
  ): void {
    setUploadItems((items) =>
      items.map((item) => {
        if (item.id !== itemId || !item.analysis) return item;
        const nextAnalysis = { ...item.analysis, [field]: value } as UploadAnalysis;
        if (field === "confidence") {
          nextAnalysis.needsReview = Number(nextAnalysis.confidence) < 82;
        }
        if (field !== "needsReview" && field !== "confidence") {
          const nextNeedsReview = Number(nextAnalysis.confidence) < 82;
          nextAnalysis.needsReview = nextNeedsReview;
        }
        return { ...item, analysis: nextAnalysis };
      }),
    );
  }

  function toggleUploadAnalyzeWithAi(itemId: string): void {
    setUploadItems((items) =>
      items.map((item) =>
        item.id === itemId ? { ...item, analyzeWithAi: !(item.analyzeWithAi ?? true) } : item,
      ),
    );
  }

  async function generateBulkStyleCode(category: string): Promise<string> {
    if (!hasAccessToken()) {
      return `TEMP${Date.now().toString().slice(-6)}`;
    }

    try {
      const styleRes = await apiRequest<{ style_code: string }>("/catalog/generate-style-code", {
        method: "POST",
        body: JSON.stringify({
          brand: companyBrand,
          category,
          pattern: activeTemplate?.style_code_pattern ?? undefined,
        }),
      });
      return styleRes.style_code;
    } catch {
      return `TEMP${Date.now().toString().slice(-6)}`;
    }
  }

  function buildUploadAnalysisDraft(
    item: UploadItem,
    styleNo: string,
    mode: UploadAnalysisMode,
    overrides?: Partial<UploadAnalysis>,
  ): UploadAnalysis {
    const defaultCategory = normalizeCategory(activeTemplate?.defaults?.category);
    const defaultStyleName =
      activeTemplate?.defaults?.styleName || deriveStyleNameFromFileName(item.name);
    const defaultColor = activeTemplate?.defaults?.color || seasonalRecommendation.color;
    const defaultFabric = activeTemplate?.defaults?.fabric || seasonalRecommendation.fabric;
    const defaultComposition = activeTemplate?.defaults?.composition || bulkComposition;
    const defaultWovenKnits = activeTemplate?.defaults?.wovenKnits || bulkWovenKnits;
    const defaultUnits = activeTemplate?.defaults?.units || TOTAL_UNITS_OPTIONS[0];
    const defaultPoPrice = activeTemplate?.defaults?.poPrice || bulkPoPrice;
    const defaultOspSar = activeTemplate?.defaults?.ospSar || bulkOspSar;

    return {
      styleNo,
      styleName: defaultStyleName,
      category: defaultCategory,
      color: defaultColor,
      fabric: defaultFabric,
      composition: defaultComposition,
      wovenKnits: defaultWovenKnits,
      units: defaultUnits,
      poPrice: defaultPoPrice,
      ospSar: defaultOspSar,
      confidence: mode === "ai" ? 0 : 100,
      needsReview: mode === "ai",
      mode,
      ...overrides,
    };
  }

  async function ensureManualDraftForItem(itemId: string): Promise<void> {
    const item =
      queueRef.current.find((entry) => entry.id === itemId) ??
      uploadItems.find((entry) => entry.id === itemId);
    if (!item || item.analysis || item.status === "failed" || item.status === "completed") return;
    const category = normalizeCategory(activeTemplate?.defaults?.category);
    const styleNo = await generateBulkStyleCode(category);
    updateUploadItem(itemId, (current) => ({
      ...current,
      status: current.status === "completed" ? "completed" : "completed_local",
      progress: current.progress > 0 ? current.progress : 100,
      analysis: buildUploadAnalysisDraft(current, styleNo, "manual", {
        needsReview: false,
        confidence: 100,
      }),
      approved: current.approved ?? false,
      error: undefined,
    }));
  }

  function ensureUniqueUploadSkus(): void {
    const seen = new Set<string>(catalogRows.map((r) => r.styleNo.trim().toUpperCase()));
    setUploadItems((items) =>
      items.map((item) => {
        if (!item.analysis) return item;
        let candidate = item.analysis.styleNo.trim().toUpperCase() || "STYLE";
        if (!seen.has(candidate)) {
          seen.add(candidate);
          return item;
        }
        const match = candidate.match(/^(.+?)(\d+)$/);
        if (match) {
          const prefix = match[1];
          let num = parseInt(match[2], 10) + 1;
          const padLen = match[2].length;
          while (true) {
            const nextCandidate = `${prefix}${String(num).padStart(padLen, "0")}`;
            if (!seen.has(nextCandidate)) {
              seen.add(nextCandidate);
              return { ...item, analysis: { ...item.analysis, styleNo: nextCandidate } };
            }
            num++;
          }
        }
        let suffix = 1;
        while (true) {
          const nextCandidate = `${candidate}-${String(suffix).padStart(2, "0")}`;
          if (!seen.has(nextCandidate)) {
            seen.add(nextCandidate);
            return { ...item, analysis: { ...item.analysis, styleNo: nextCandidate } };
          }
          suffix++;
        }
      }),
    );
  }

  async function prepareItemsForReview(): Promise<void> {
    const pendingItems = uploadItems.filter(
      (item) => !item.analysis && item.status !== "failed" && item.status !== "completed",
    );
    for (const item of pendingItems) {
      await ensureManualDraftForItem(item.id);
    }
    ensureUniqueUploadSkus();
  }

  async function handleAnalyzeItemWithAi(itemId: string): Promise<void> {
    const item = uploadItems.find((entry) => entry.id === itemId);
    if (!item || !item.file || isBulkAnalyzing) return;
    if (!hasAccessToken()) {
      setUploadMessage("Sign in to analyze and save bulk items.");
      return;
    }

    updateUploadItem(itemId, (current) => ({
      ...current,
      status: "uploading",
      progress: 25,
      error: undefined,
      analyzeWithAi: true,
    }));

    try {
      const uploadedImage = await uploadCatalogImage(item.file);
      const analysisRes = await apiRequest<AnalyzeImageApiResult>("/catalog/analyze-image", {
        method: "POST",
        body: JSON.stringify(buildAnalyzeImageRequestPayload(uploadedImage.url)),
      });

      const resolvedCategory = normalizeCategory(normalizeAiValue(analysisRes.category?.value));
      const resolvedStyleName =
        pickOptionValue(analysisRes.style_name?.value, STYLE_NAME_OPTIONS) ??
        normalizeAiValue(analysisRes.style_name?.value) ??
        deriveStyleNameFromFileName(item.name);
      const resolvedColor =
        pickOptionValue(analysisRes.color?.value, COLOR_OPTIONS) ??
        normalizeAiValue(analysisRes.color?.value) ??
        seasonalRecommendation.color;
      const resolvedFabric =
        pickOptionValue(analysisRes.fabric?.value, FABRIC_OPTIONS) ??
        normalizeAiValue(analysisRes.fabric?.value) ??
        seasonalRecommendation.fabric;
      const resolvedComposition =
        pickOptionValue(analysisRes.composition?.value, COMPOSITION_OPTIONS) ??
        normalizeAiValue(analysisRes.composition?.value) ??
        bulkComposition;
      const resolvedWovenKnits =
        pickOptionValue(analysisRes.woven_knits?.value, WOVEN_KNITS_OPTIONS) ??
        normalizeAiValue(analysisRes.woven_knits?.value) ??
        bulkWovenKnits;
      const styleNo = await generateBulkStyleCode(resolvedCategory);

      const confidenceValues = [
        analysisRes.category?.confidence,
        analysisRes.style_name?.confidence,
        analysisRes.color?.confidence,
        analysisRes.fabric?.confidence,
        analysisRes.composition?.confidence,
        analysisRes.woven_knits?.confidence,
      ].filter((value): value is number => typeof value === "number");
      const avgConfidence =
        confidenceValues.length > 0
          ? Math.round(
              confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length,
            )
          : 0;

      const analysisPayload = buildUploadAnalysisDraft(item, styleNo, "ai", {
        styleName: resolvedStyleName,
        category: resolvedCategory,
        color: resolvedColor,
        fabric: resolvedFabric,
        composition: resolvedComposition,
        wovenKnits: resolvedWovenKnits,
        units: activeTemplate?.defaults?.units ?? TOTAL_UNITS_OPTIONS[0],
        poPrice: bulkPoPrice,
        ospSar: bulkOspSar,
        confidence: avgConfidence,
        needsReview: avgConfidence < 82,
      });

      updateUploadItem(itemId, (current) => ({
        ...current,
        status: "completed_local",
        progress: 100,
        analysis: analysisPayload,
        approved: analysisPayload.needsReview ? false : (current.approved ?? true),
        error: undefined,
      }));
    } catch (error) {
      updateUploadItem(itemId, (current) => ({
        ...current,
        status: "failed",
        error: error instanceof Error ? error.message : "Analysis failed",
        progress: 100,
      }));
      throw error;
    }
  }

  function toggleUploadApproval(itemId: string): void {
    setUploadItems((items) =>
      items.map((item) => {
        if (item.id !== itemId) return item;
        if (!item.analysis) return item;
        return { ...item, approved: !item.approved };
      }),
    );
  }

  function approveAllReadyUploads(): void {
    setUploadItems((items) =>
      items.map((item) => {
        if (!item.analysis || item.analysis.needsReview) return item;
        return { ...item, approved: true };
      }),
    );
  }

  async function runSingleUpload(item: UploadItem): Promise<void> {
    updateUploadItem(item.id, (current) => ({
      ...current,
      status: "uploading",
      progress: 10,
      error: undefined,
    }));
    let progress = 10;
    while (progress < 92) {
      await wait(120);
      progress = Math.min(92, progress + Math.floor(Math.random() * 14) + 6);
      updateUploadItem(item.id, (current) => ({ ...current, progress }));
    }
    // Queue stage only: mark file ready for bulk AI/save flow.
    updateUploadItem(item.id, (current) => ({
      ...current,
      status: "completed_local",
      progress: 100,
    }));
  }

  async function drainQueue(): Promise<void> {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;
    setIsUploadProcessing(true);
    try {
      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift();
        if (!next) break;
        await runSingleUpload(next);
      }
    } finally {
      queueRunningRef.current = false;
      setIsUploadProcessing(false);
    }
  }

  async function handleAnalyzeAll(): Promise<boolean> {
    if (uploadItems.length === 0 || isBulkAnalyzing) return true;
    if (!hasAccessToken()) {
      setUploadMessage("Sign in to analyze and save bulk items.");
      return false;
    }
    setIsBulkAnalyzing(true);
    let hasFailures = false;

    try {
      const pendingItems = uploadItems.filter(
        (item) =>
          item.status !== "completed" &&
          item.status !== "uploading" &&
          item.analyzeWithAi !== false,
      );
      if (pendingItems.length === 0) {
        setUploadMessage("No items are selected for AI analysis.");
        return true;
      }
      for (const item of pendingItems) {
        try {
          await handleAnalyzeItemWithAi(item.id);
        } catch (error) {
          hasFailures = true;
        }
      }

      setUploadMessage(
        hasFailures
          ? "Analysis finished with some failures. Review failed rows and retry."
          : "Analysis complete. Review items before saving to catalog.",
      );
      return !hasFailures;
    } finally {
      setIsBulkAnalyzing(false);
    }
  }

  async function handleSaveAllToCatalog(): Promise<void> {
    if (uploadItems.length === 0 || isBulkAnalyzing) return;
    await prepareItemsForReview();
    setIsBulkReviewOpen(true);
  }

  async function handleSaveReviewedItems(saveOnlyApproved: boolean): Promise<void> {
    if (isSavingReviewedItems) return;
    if (!hasAccessToken()) {
      setUploadMessage("Sign in to save analyzed items.");
      return;
    }

    await prepareItemsForReview();

    const candidates = uploadItems.filter((item) => {
      if (!item.analysis) return false;
      if (item.status === "completed") return false;
      if (saveOnlyApproved) return item.approved === true;
      return true;
    });

    if (candidates.length === 0) {
      setUploadMessage(
        saveOnlyApproved ? "No approved items to save." : "No analyzed items to save.",
      );
      return;
    }

    setIsSavingReviewedItems(true);
    let successCount = 0;
    let failedCount = 0;
    const approvalCache = new Map<string, boolean>();
    const seenBatchSkus = new Set<string>(catalogRows.map((r) => r.styleNo.trim().toUpperCase()));

    try {
      for (const item of candidates) {
        if (!item.file || !item.analysis) continue;
        const allowedCategory = await ensureTemplateValueAllowed(
          "category",
          item.analysis.category,
          approvalCache,
        );
        const allowedStyleName = await ensureTemplateValueAllowed(
          "styleName",
          item.analysis.styleName,
          approvalCache,
        );
        const allowedColor = await ensureTemplateValueAllowed(
          "color",
          item.analysis.color,
          approvalCache,
        );
        const allowedFabric = await ensureTemplateValueAllowed(
          "fabric",
          item.analysis.fabric,
          approvalCache,
        );
        const allowedComposition = await ensureTemplateValueAllowed(
          "composition",
          item.analysis.composition,
          approvalCache,
        );
        const allowedWovenKnits = await ensureTemplateValueAllowed(
          "wovenKnits",
          item.analysis.wovenKnits,
          approvalCache,
        );
        if (
          !allowedCategory ||
          !allowedStyleName ||
          !allowedColor ||
          !allowedFabric ||
          !allowedComposition ||
          !allowedWovenKnits
        ) {
          failedCount += 1;
          updateUploadItem(item.id, (current) => ({
            ...current,
            status: "failed",
            error: "Skipped: one or more values were not approved from allowed template options.",
            progress: 100,
          }));
          continue;
        }
        try {
          let candidateSku = item.analysis.styleNo.trim().toUpperCase() || "STYLE";
          if (seenBatchSkus.has(candidateSku)) {
            const match = candidateSku.match(/^(.+?)(\d+)$/);
            if (match) {
              const prefix = match[1];
              let num = parseInt(match[2], 10) + 1;
              const padLen = match[2].length;
              while (true) {
                const next = `${prefix}${String(num).padStart(padLen, "0")}`;
                if (!seenBatchSkus.has(next)) {
                  candidateSku = next;
                  break;
                }
                num++;
              }
            } else {
              let suffix = 1;
              while (true) {
                const next = `${candidateSku}-${String(suffix).padStart(2, "0")}`;
                if (!seenBatchSkus.has(next)) {
                  candidateSku = next;
                  break;
                }
                suffix++;
              }
            }
          }
          seenBatchSkus.add(candidateSku);

          updateUploadItem(item.id, (current) => ({
            ...current,
            status: "uploading",
            progress: 30,
            error: undefined,
            analysis: current.analysis ? { ...current.analysis, styleNo: candidateSku } : undefined,
          }));

          const uploadedImage = await uploadCatalogImage(item.file);
          const uploadedUrl = uploadedImage.url;

          const created = await apiRequest<ProductResponse>("/catalog/products", {
            method: "POST",
            body: JSON.stringify({
              sku: candidateSku,
              title: item.analysis.styleName,
              category: item.analysis.category,
              color: item.analysis.color,
              status: item.analysis.needsReview ? "needs_review" : "draft",
              ai_attributes: {
                fabric: item.analysis.fabric,
                composition: item.analysis.composition,
                woven_knits: item.analysis.wovenKnits,
                units: item.analysis.units,
                po_price: item.analysis.poPrice,
                osp: `SAR ${item.analysis.ospSar}`,
              },
            }),
          });

          await apiRequest(`/catalog/products/${created.id}/images`, {
            method: "POST",
            body: JSON.stringify({
              file_name: uploadedImage.filename,
              file_url: uploadedUrl,
              mime_type: item.type,
              file_size_bytes: item.size,
              processing_status: "uploaded",
            }),
          });

          const newRow: CatalogRow = {
            id: created.id,
            primary_image_url: uploadedUrl,
            styleNo: created.sku,
            name: created.title || item.analysis.styleName,
            category: normalizeCategory(created.category ?? item.analysis.category),
            color: created.color ?? item.analysis.color,
            fabric: item.analysis.fabric,
            composition: item.analysis.composition,
            wovenKnits: item.analysis.wovenKnits,
            units: item.analysis.units,
            poPrice: item.analysis.poPrice,
            price: formatSarPrice(Number.parseFloat(item.analysis.ospSar)),
            status: created.status as CatalogStatus,
            persisted: true,
            imageName: item.name,
          };

          setCatalogRows((prev) => [newRow, ...prev]);
          persistedProductsRef.current = [newRow, ...persistedProductsRef.current];
          updateUploadItem(item.id, (current) => ({
            ...current,
            status: "completed",
            progress: 100,
            approved: true,
          }));
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          updateUploadItem(item.id, (current) => ({
            ...current,
            status: "failed",
            error: error instanceof Error ? error.message : "Save failed",
            progress: 100,
          }));
        }
      }

      if (failedCount > 0) {
        setUploadMessage(`Saved ${successCount} item(s). ${failedCount} item(s) failed.`);
      } else {
        setUploadMessage(`Saved ${successCount} item(s) to catalog.`);
      }

      if (successCount === 0 && failedCount > 0) {
        setBulkReviewFilter("failed");
      }
    } finally {
      setIsSavingReviewedItems(false);
    }
  }

  function enqueueUploads(files: File[]): void {
    if (files.length === 0) return;

    const limited = files.slice(0, MAX_BULK_FILES_PER_BATCH);
    const errors: string[] = [];
    if (files.length > MAX_BULK_FILES_PER_BATCH) {
      errors.push(`Only first ${MAX_BULK_FILES_PER_BATCH} files were queued.`);
    }

    const accepted: UploadItem[] = [];
    for (const file of limited) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        errors.push(`${file.name}: unsupported format`);
        continue;
      }
      if (file.size > MAX_BULK_FILE_SIZE_BYTES) {
        errors.push(`${file.name}: exceeds ${formatBytes(MAX_BULK_FILE_SIZE_BYTES)} limit`);
        continue;
      }
      accepted.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        type: file.type,
        size: file.size,
        progress: 0,
        status: "queued",
        file,
        previewUrl: URL.createObjectURL(file),
        analyzeWithAi: bulkAnalyzeAllEnabled,
      });
    }

    if (accepted.length > 0) {
      setUploadItems((items) => [...accepted, ...items]);
      queueRef.current = [...queueRef.current, ...accepted];
      void drainQueue();
      setUploadMessage("Files queued for upload.");
    }

    if (errors.length > 0) setUploadMessage(errors.join(" • "));
  }

  function handleBulkFileInput(event: ChangeEvent<HTMLInputElement>): void {
    const files = event.target.files ? Array.from(event.target.files) : [];
    enqueueUploads(files);
    event.currentTarget.value = "";
  }

  function handleBulkDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDropActive(false);
    enqueueUploads(Array.from(event.dataTransfer.files));
  }

  function clearFinishedUploads(): void {
    setUploadItems((items) =>
      items.filter((item) => item.status === "queued" || item.status === "uploading"),
    );
  }

  async function handleManualReviewItem(itemId: string): Promise<void> {
    await ensureManualDraftForItem(itemId);
    const item = uploadItems.find((entry) => entry.id === itemId);
    setBulkReviewFilter("all");
    setBulkReviewQuery(item?.name ?? "");
    setIsBulkReviewOpen(true);
  }

  async function handleEditRow(row: CatalogRow): Promise<void> {
    setAddItemError(null);
    setItemImageError(null);
    setFieldConfidence({});
    setFieldContext({});
    setAiSuggestions(null);
    setIsAiSuggestionsVisible(false);
    setFeedbackCompletedFields({});
    setOverallConfidence(null);
    setAnalysisStage(null);
    setLastAnalyzedImageHash(null);
    setIsCorrectionModalOpen(false);
    setCorrectionFieldKey(null);
    selectedImageFileRef.current = null;
    if (addItemImageInputRef.current) {
      addItemImageInputRef.current.value = "";
    }

    // If the row is persisted, fetch the latest product data to get the most up-to-date image
    if (row.persisted && hasAccessToken()) {
      try {
        const response = await apiRequest<ProductResponse>(`/catalog/products/${row.id}`);
        setImagePreviewUrl(getImageUrl(response.primary_image_url));
      } catch (error) {
        // Fallback to row data if fetch fails
        setImagePreviewUrl(getImageUrl(row.primary_image_url));
      }
    } else {
      setImagePreviewUrl(getImageUrl(row.primary_image_url));
    }

    setEditingRowId(row.id);
    setItemStyleNo(row.styleNo);
    setItemCategory(normalizeCategory(row.category));
    setItemStyleName(row.name || STYLE_NAME_OPTIONS[0]);
    setItemColor(row.color || COLOR_OPTIONS[0]);
    setItemFabric(row.fabric || FABRIC_OPTIONS[0]);
    setItemComposition(row.composition || COMPOSITION_OPTIONS[0]);
    setItemWovenKnits(row.wovenKnits || WOVEN_KNITS_OPTIONS[0]);
    setItemTotalUnits(row.units || TOTAL_UNITS_OPTIONS[0]);
    setItemPoPrice(row.poPrice || PO_PRICE_OPTIONS[0]);
    setItemOspSar(row.price ? row.price.replace("SAR", "").trim() : OSP_OPTIONS[0]);
    setItemImageName(row.imageName ?? row.name);
    setIsAddModalOpen(true);
  }

  async function handleDeleteRow(row: CatalogRow): Promise<void> {
    if (!row.persisted) {
      setCatalogRows((rows) => rows.filter((item) => item.id !== row.id));
      return;
    }

    // For persisted items, delete via API
    if (!hasAccessToken()) {
      setCatalogNotice("You must be signed in to delete items.");
      return;
    }

    try {
      await apiRequest(`/catalog/products/${row.id}`, {
        method: "DELETE",
      });

      // Remove from local state after successful deletion
      setCatalogRows((rows) => rows.filter((item) => item.id !== row.id));
      setCatalogNotice("Item deleted successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete item.";
      setCatalogNotice(`Error: ${message}`);
    }
  }

  function toggleRowSelection(rowId: string): void {
    setSelectedRowIds((ids) =>
      ids.includes(rowId) ? ids.filter((id) => id !== rowId) : [...ids, rowId],
    );
  }

  function toggleSelectAllVisible(): void {
    const visibleIds = filteredCatalogRows.map((row) => row.id);
    if (visibleIds.length === 0) return;
    const visibleSet = new Set(visibleIds);
    setSelectedRowIds((ids) => {
      const allSelected = visibleIds.every((id) => ids.includes(id));
      if (allSelected) return ids.filter((id) => !visibleSet.has(id));
      const merged = new Set(ids);
      visibleIds.forEach((id) => merged.add(id));
      return Array.from(merged);
    });
  }

  function handleInlineUnitsChange(rowId: string, value: string): void {
    const normalized = value.replace(/[^0-9]/g, "");
    setCatalogRows((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, units: normalized } : row)),
    );
  }

  function handleInlinePriceChange(rowId: string, value: string): void {
    const normalized = value.replace(/[^0-9.]/g, "").trim();
    const formatted = normalized.length > 0 ? `SAR ${normalized}` : "SAR 0";
    setCatalogRows((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, price: formatted } : row)),
    );
  }

  async function handleRowStatusTransition(
    row: CatalogRow,
    nextStatus: CatalogStatus,
  ): Promise<void> {
    if (row.status === nextStatus) return;

    if (row.persisted) {
      if (!hasAccessToken()) {
        setCatalogNotice("Sign in to update product status on the API.");
        return;
      }
      try {
        await apiRequest<ProductResponse>(`/catalog/products/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to update status.";
        setCatalogNotice(`Error: ${message}`);
        return;
      }
    }

    setCatalogRows((rows) =>
      rows.map((item) => (item.id === row.id ? { ...item, status: nextStatus } : item)),
    );
    setCatalogNotice(`Status updated to ${formatStatusLabel(nextStatus)}.`);
  }

  async function handleApplyBulkEdit(): Promise<void> {
    if (selectedRowIds.length === 0) return;

    const trimmedUnits = bulkUnitsValue.trim();
    const nextBulkStatus: CatalogStatus | null = bulkStatus === "" ? null : bulkStatus;
    const shouldApplyUnits = trimmedUnits.length > 0;
    const shouldApplyStatus = nextBulkStatus !== null;
    if (!shouldApplyUnits && !shouldApplyStatus) {
      setCatalogNotice("Select at least one bulk edit value.");
      return;
    }

    setIsBulkApplying(true);
    try {
      const selectedSet = new Set(selectedRowIds);
      const canPersistStatus = hasAccessToken();
      let successfulPersistedStatusIds = new Set<string>();
      let failedPersistedStatusCount = 0;

      if (shouldApplyStatus) {
        const targetedPersistedRows = catalogRows.filter(
          (row) => selectedSet.has(row.id) && row.persisted,
        );
        if (targetedPersistedRows.length > 0) {
          if (!canPersistStatus) {
            setCatalogNotice("Sign in to apply status changes to persisted rows.");
          } else {
            const statusResults = await Promise.allSettled(
              targetedPersistedRows.map((row) =>
                apiRequest<ProductResponse>(`/catalog/products/${row.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ status: nextBulkStatus }),
                }),
              ),
            );
            successfulPersistedStatusIds = new Set(
              statusResults
                .map((result, index) =>
                  result.status === "fulfilled" ? (targetedPersistedRows[index]?.id ?? null) : null,
                )
                .filter((id): id is string => id !== null),
            );
            failedPersistedStatusCount = statusResults.filter(
              (result) => result.status === "rejected",
            ).length;
          }
        }
      }

      setCatalogRows((rows) =>
        rows.map((row) => {
          if (!selectedSet.has(row.id)) return row;
          let nextRow = row;
          if (shouldApplyUnits) {
            const unitsOnly = trimmedUnits.replace(/[^0-9]/g, "");
            nextRow = { ...nextRow, units: unitsOnly };
          }
          if (shouldApplyStatus) {
            if (!row.persisted || (canPersistStatus && successfulPersistedStatusIds.has(row.id))) {
              nextRow = { ...nextRow, status: nextBulkStatus as CatalogStatus };
            }
          }
          return nextRow;
        }),
      );

      if (shouldApplyStatus && failedPersistedStatusCount > 0) {
        setCatalogNotice(
          `Bulk edit applied with ${failedPersistedStatusCount} persisted status updates failing. Check API availability.`,
        );
      } else {
        setCatalogNotice(`Bulk edit applied to ${selectedRowIds.length} row(s).`);
      }
      setBulkUnitsValue("");
    } finally {
      setIsBulkApplying(false);
    }
  }

  async function handleBatchUpdateFabric(): Promise<void> {
    if (selectedRows.length === 0) return;
    const nextFabric = batchFabricValue.trim();
    if (!nextFabric) {
      setCatalogNotice("Select a fabric value to apply.");
      return;
    }

    const selectedSet = new Set(selectedRowIds);
    const persistedTargets = selectedRows.filter((row) => row.persisted);
    let failedPersisted = 0;

    if (persistedTargets.length > 0) {
      if (!hasAccessToken()) {
        setCatalogNotice("Sign in to persist fabric updates. Applied locally for now.");
      } else {
        const results = await Promise.allSettled(
          persistedTargets.map((row) =>
            apiRequest<ProductResponse>(`/catalog/products/${row.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                ai_attributes: buildAiAttributesFromRow(row, { fabric: nextFabric }),
              }),
            }),
          ),
        );
        failedPersisted = results.filter((result) => result.status === "rejected").length;
      }
    }

    setCatalogRows((rows) =>
      rows.map((row) => (selectedSet.has(row.id) ? { ...row, fabric: nextFabric } : row)),
    );
    setCatalogNotice(
      failedPersisted > 0
        ? `Fabric updated, but ${failedPersisted} persisted row(s) failed to sync.`
        : `Fabric updated for ${selectedRows.length} row(s).`,
    );
  }

  async function handleDuplicateSelectedRows(): Promise<void> {
    if (selectedRows.length === 0) return;

    const existingStyleNos = new Set(catalogRows.map((row) => row.styleNo.toUpperCase()));
    const duplicates: CatalogRow[] = [];
    let persistedCreated = 0;
    let localCreated = 0;
    let persistedFailures = 0;

    for (const [index, row] of selectedRows.entries()) {
      const duplicateStyleNo = buildDuplicateStyleNo(row.styleNo, existingStyleNos);
      existingStyleNos.add(duplicateStyleNo);

      if (row.persisted && hasAccessToken()) {
        try {
          const created = await apiRequest<ProductResponse>("/catalog/products", {
            method: "POST",
            body: JSON.stringify({
              sku: duplicateStyleNo,
              title: row.name,
              category: normalizeCategory(row.category),
              color: row.color,
              status: row.status,
              ai_attributes: buildAiAttributesFromRow(row),
            }),
          });

          const resolvedImageUrl = row.primary_image_url
            ? (getImageUrl(row.primary_image_url) ?? row.primary_image_url)
            : null;
          if (resolvedImageUrl) {
            try {
              await apiRequest<ProductImageResponse>(`/catalog/products/${created.id}/images`, {
                method: "POST",
                body: JSON.stringify({
                  file_name: row.imageName ?? `${duplicateStyleNo}.jpg`,
                  file_url: resolvedImageUrl,
                  processing_status: "uploaded",
                }),
              });
            } catch {
              // Duplicate should still succeed even if image cloning fails.
            }
          }

          duplicates.push({
            ...row,
            id: created.id,
            styleNo: created.sku,
            name: created.title,
            category: normalizeCategory(created.category ?? row.category),
            color: created.color ?? row.color,
            persisted: true,
          });
          persistedCreated += 1;
          continue;
        } catch {
          persistedFailures += 1;
        }
      }

      duplicates.push({
        ...row,
        id: `local-copy-${Date.now()}-${index}`,
        styleNo: duplicateStyleNo,
        persisted: false,
      });
      localCreated += 1;
    }

    if (duplicates.length === 0) {
      setCatalogNotice("No rows duplicated.");
      return;
    }

    setCatalogRows((rows) => [...duplicates, ...rows]);
    setSelectedRowIds(duplicates.map((row) => row.id));
    setCatalogNotice(
      `Duplicated ${duplicates.length} row(s) (${persistedCreated} saved, ${localCreated} local).${persistedFailures > 0 ? ` ${persistedFailures} fallback(s) created locally due to API errors.` : ""}`,
    );
  }

  async function handleExportSelectedRows(): Promise<void> {
    if (!hasAccessToken()) {
      setCatalogNotice("Sign in to export selected rows.");
      return;
    }
    const selectedPersistedIds = selectedRows.filter((row) => row.persisted).map((row) => row.id);
    if (selectedPersistedIds.length === 0) {
      setCatalogNotice("Only saved catalog items can be exported.");
      return;
    }

    const created = await handleCreateMarketplaceExport({ product_ids: selectedPersistedIds });
    if (created) {
      setCatalogNotice(`Export generated for ${selectedPersistedIds.length} selected item(s).`);
      setIsExportPanelOpen(true);
      setActiveExportTab("history");
    }
  }

  async function handleDeleteSelectedRows(): Promise<void> {
    if (selectedRows.length === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${selectedRows.length} selected item(s)?`)
    ) {
      return;
    }

    const removableIds = new Set<string>();
    const localTargets = selectedRows.filter((row) => !row.persisted);
    localTargets.forEach((row) => removableIds.add(row.id));

    const persistedTargets = selectedRows.filter((row) => row.persisted);
    let failedPersisted = 0;
    if (persistedTargets.length > 0) {
      if (!hasAccessToken()) {
        setCatalogNotice("Sign in to delete persisted rows. Local rows were removed.");
      } else {
        const results = await Promise.allSettled(
          persistedTargets.map((row) =>
            apiRequest(`/catalog/products/${row.id}`, {
              method: "DELETE",
            }),
          ),
        );
        results.forEach((result, index) => {
          const row = persistedTargets[index];
          if (!row) return;
          if (result.status === "fulfilled") removableIds.add(row.id);
          else failedPersisted += 1;
        });
      }
    }

    if (removableIds.size === 0) {
      setCatalogNotice("No selected rows were deleted.");
      return;
    }

    setCatalogRows((rows) => rows.filter((row) => !removableIds.has(row.id)));
    setSelectedRowIds((ids) => ids.filter((id) => !removableIds.has(id)));
    setCatalogNotice(
      failedPersisted > 0
        ? `Deleted ${removableIds.size} row(s); ${failedPersisted} persisted delete(s) failed.`
        : `Deleted ${removableIds.size} selected row(s).`,
    );
  }

  async function handleRunBatchAction(): Promise<void> {
    if (selectedRows.length === 0) {
      setCatalogNotice("Select at least one row first.");
      return;
    }
    if (!batchAction) {
      setCatalogNotice("Choose a batch action.");
      return;
    }
    if (batchAction === "find_replace") {
      setIsFindReplaceOpen(true);
      return;
    }
    if (batchAction === "adjust_price") {
      setIsPriceAdjustOpen(true);
      return;
    }

    setIsBatchActionApplying(true);
    try {
      if (batchAction === "update_fabric") {
        await handleBatchUpdateFabric();
      } else if (batchAction === "duplicate") {
        await handleDuplicateSelectedRows();
      } else if (batchAction === "export_selected") {
        await handleExportSelectedRows();
      } else if (batchAction === "delete_selected") {
        await handleDeleteSelectedRows();
      }
    } finally {
      setIsBatchActionApplying(false);
    }
  }

  async function handleApplyFindReplace(): Promise<void> {
    if (selectedRows.length === 0) return;
    const query = findReplaceQuery.trim();
    if (!query) {
      setCatalogNotice("Enter text to find.");
      return;
    }

    const regex = new RegExp(escapeRegExp(query), "gi");
    const changedRows = new Map<string, CatalogRow>();

    selectedRows.forEach((row) => {
      const sourceValue =
        findReplaceField === "styleName"
          ? row.name
          : findReplaceField === "category"
            ? row.category
            : findReplaceField === "color"
              ? row.color
              : row.fabric;

      const replacedValue = sourceValue.replace(regex, findReplaceReplacement).trim();
      if (!replacedValue || replacedValue === sourceValue) return;

      if (findReplaceField === "styleName") {
        changedRows.set(row.id, { ...row, name: replacedValue });
      } else if (findReplaceField === "category") {
        changedRows.set(row.id, { ...row, category: normalizeCategory(replacedValue) });
      } else if (findReplaceField === "color") {
        changedRows.set(row.id, { ...row, color: replacedValue });
      } else {
        changedRows.set(row.id, { ...row, fabric: replacedValue });
      }
    });

    if (changedRows.size === 0) {
      setCatalogNotice("No matching values found in selected rows.");
      return;
    }

    let failedPersisted = 0;
    const changedPersistedRows = Array.from(changedRows.values()).filter((row) => row.persisted);
    if (changedPersistedRows.length > 0) {
      if (!hasAccessToken()) {
        setCatalogNotice("Sign in to persist find/replace updates. Applied locally for now.");
      } else {
        const results = await Promise.allSettled(
          changedPersistedRows.map((row) => {
            if (findReplaceField === "styleName") {
              return apiRequest<ProductResponse>(`/catalog/products/${row.id}`, {
                method: "PATCH",
                body: JSON.stringify({ title: row.name }),
              });
            }
            if (findReplaceField === "category") {
              return apiRequest<ProductResponse>(`/catalog/products/${row.id}`, {
                method: "PATCH",
                body: JSON.stringify({ category: row.category }),
              });
            }
            if (findReplaceField === "color") {
              return apiRequest<ProductResponse>(`/catalog/products/${row.id}`, {
                method: "PATCH",
                body: JSON.stringify({ color: row.color }),
              });
            }
            return apiRequest<ProductResponse>(`/catalog/products/${row.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                ai_attributes: buildAiAttributesFromRow(row),
              }),
            });
          }),
        );
        failedPersisted = results.filter((result) => result.status === "rejected").length;
      }
    }

    setCatalogRows((rows) => rows.map((row) => changedRows.get(row.id) ?? row));
    setCatalogNotice(
      failedPersisted > 0
        ? `Find & replace applied to ${changedRows.size} row(s), but ${failedPersisted} persisted update(s) failed.`
        : `Find & replace applied to ${changedRows.size} row(s).`,
    );
    setIsFindReplaceOpen(false);
  }

  async function handleApplyPriceAdjustment(): Promise<void> {
    if (selectedRows.length === 0) return;
    const rawAmount = Number.parseFloat(priceAdjustValue);
    if (!Number.isFinite(rawAmount) || rawAmount < 0) {
      setCatalogNotice("Enter a valid adjustment value.");
      return;
    }

    const changedRows = new Map<string, CatalogRow>();
    selectedRows.forEach((row) => {
      const currentPrice = parseSarPrice(row.price);
      let nextPrice = currentPrice;
      if (priceAdjustMode === "percent_up") nextPrice = currentPrice * (1 + rawAmount / 100);
      if (priceAdjustMode === "percent_down") nextPrice = currentPrice * (1 - rawAmount / 100);
      if (priceAdjustMode === "add_fixed") nextPrice = currentPrice + rawAmount;
      if (priceAdjustMode === "set_exact") nextPrice = rawAmount;
      nextPrice = Math.max(0, nextPrice);

      if (Math.abs(nextPrice - currentPrice) < 0.0001) return;
      changedRows.set(row.id, { ...row, price: formatSarPrice(nextPrice) });
    });

    if (changedRows.size === 0) {
      setCatalogNotice("No price changes were applied.");
      return;
    }

    let failedPersisted = 0;
    const changedPersistedRows = Array.from(changedRows.values()).filter((row) => row.persisted);
    if (changedPersistedRows.length > 0) {
      if (!hasAccessToken()) {
        setCatalogNotice("Sign in to persist price adjustments. Applied locally for now.");
      } else {
        const results = await Promise.allSettled(
          changedPersistedRows.map((row) =>
            apiRequest<ProductResponse>(`/catalog/products/${row.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                ai_attributes: buildAiAttributesFromRow(row),
              }),
            }),
          ),
        );
        failedPersisted = results.filter((result) => result.status === "rejected").length;
      }
    }

    setCatalogRows((rows) => rows.map((row) => changedRows.get(row.id) ?? row));
    setCatalogNotice(
      failedPersisted > 0
        ? `Adjusted prices for ${changedRows.size} row(s), but ${failedPersisted} persisted update(s) failed.`
        : `Adjusted prices for ${changedRows.size} row(s).`,
    );
    setIsPriceAdjustOpen(false);
  }

  function hydrateTemplateEditor(template: CatalogTemplateRecord | null): void {
    if (!template) {
      setTemplateName(defaultCatalogTemplateDraft.name);
      setTemplateDescription(defaultCatalogTemplateDraft.description);
      setTemplateDefaultCategory(defaultCatalogTemplateDraft.defaults.category);
      setTemplateDefaultStyleName(defaultCatalogTemplateDraft.defaults.styleName);
      setTemplateDefaultColor(defaultCatalogTemplateDraft.defaults.color);
      setTemplateDefaultFabric(defaultCatalogTemplateDraft.defaults.fabric);
      setTemplateDefaultComposition(defaultCatalogTemplateDraft.defaults.composition);
      setTemplateDefaultWovenKnits(defaultCatalogTemplateDraft.defaults.wovenKnits);
      setTemplateDefaultUnits(defaultCatalogTemplateDraft.defaults.units);
      setTemplateDefaultPoPrice(defaultCatalogTemplateDraft.defaults.poPrice);
      setTemplateDefaultOspSar(defaultCatalogTemplateDraft.defaults.ospSar);
      setTemplateAllowedCategories(defaultCatalogTemplateDraft.allowed_categories.join(", "));
      setTemplateAllowedStyleNames(defaultCatalogTemplateDraft.allowed_style_names.join(", "));
      setTemplateAllowedColors(defaultCatalogTemplateDraft.allowed_colors.join(", "));
      setTemplateAllowedFabrics(defaultCatalogTemplateDraft.allowed_fabrics.join(", "));
      setTemplateAllowedCompositions(defaultCatalogTemplateDraft.allowed_compositions.join(", "));
      setTemplateAllowedWovenKnits(defaultCatalogTemplateDraft.allowed_woven_knits.join(", "));
      setTemplateStylePattern(defaultCatalogTemplateDraft.style_code_pattern);
      return;
    }

    setTemplateName(template.name);
    setTemplateDescription(template.description ?? "");
    setTemplateDefaultCategory(template.defaults.category ?? CATEGORY_OPTIONS[0]);
    setTemplateDefaultStyleName(template.defaults.styleName ?? STYLE_NAME_OPTIONS[0]);
    setTemplateDefaultColor(template.defaults.color ?? COLOR_OPTIONS[1]);
    setTemplateDefaultFabric(template.defaults.fabric ?? FABRIC_OPTIONS[0]);
    setTemplateDefaultComposition(template.defaults.composition ?? COMPOSITION_OPTIONS[1]);
    setTemplateDefaultWovenKnits(template.defaults.wovenKnits ?? WOVEN_KNITS_OPTIONS[1]);
    setTemplateDefaultUnits(template.defaults.units ?? TOTAL_UNITS_OPTIONS[0]);
    setTemplateDefaultPoPrice(template.defaults.poPrice ?? PO_PRICE_OPTIONS[2]);
    setTemplateDefaultOspSar(template.defaults.ospSar ?? OSP_OPTIONS[1]);
    setTemplateAllowedCategories(template.allowed_categories.join(", "));
    setTemplateAllowedStyleNames(template.allowed_style_names.join(", "));
    setTemplateAllowedColors(template.allowed_colors.join(", "));
    setTemplateAllowedFabrics(template.allowed_fabrics.join(", "));
    setTemplateAllowedCompositions(template.allowed_compositions.join(", "));
    setTemplateAllowedWovenKnits(template.allowed_woven_knits.join(", "));
    setTemplateStylePattern(template.style_code_pattern ?? "");
  }

  useEffect(() => {
    hydrateTemplateEditor(activeTemplate);
  }, [activeTemplate]);

  function startNewTemplateDraft(): void {
    setSelectedTemplateId("");
    hydrateTemplateEditor(null);
    setTemplateNotice("New template draft.");
  }

  async function handleSaveTemplate(mode: "existing" | "new" | "auto" = "auto"): Promise<void> {
    const defaultsPayload: Record<string, string> = {
      category: templateDefaultCategory || CATEGORY_OPTIONS[0],
      styleName: templateDefaultStyleName || STYLE_NAME_OPTIONS[0],
      color: templateDefaultColor || COLOR_OPTIONS[1],
      fabric: templateDefaultFabric || FABRIC_OPTIONS[0],
      composition: templateDefaultComposition || COMPOSITION_OPTIONS[1],
      wovenKnits: templateDefaultWovenKnits || WOVEN_KNITS_OPTIONS[1],
      units: templateDefaultUnits || TOTAL_UNITS_OPTIONS[0],
      poPrice: templateDefaultPoPrice || PO_PRICE_OPTIONS[2],
      ospSar: templateDefaultOspSar || OSP_OPTIONS[1],
    };

    const payload = {
      name: templateName.trim(),
      description: templateDescription.trim() || undefined,
      defaults: defaultsPayload,
      allowed_categories: parseCommaSeparatedTokens(templateAllowedCategories),
      allowed_style_names: parseCommaSeparatedTokens(templateAllowedStyleNames),
      allowed_colors: parseCommaSeparatedTokens(templateAllowedColors),
      allowed_fabrics: parseCommaSeparatedTokens(templateAllowedFabrics),
      allowed_compositions: parseCommaSeparatedTokens(templateAllowedCompositions),
      allowed_woven_knits: parseCommaSeparatedTokens(templateAllowedWovenKnits),
      style_code_pattern: templateStylePattern.trim() || undefined,
      is_active: true,
    };

    if (!payload.name) {
      setTemplateNotice("Template name is required.");
      return;
    }

    if (!hasAccessToken()) {
      const localTemplate: CatalogTemplateRecord = {
        id: `local-template-${Date.now()}`,
        company_id: "local",
        name: payload.name,
        description: payload.description ?? null,
        defaults: payload.defaults,
        allowed_categories: payload.allowed_categories,
        allowed_style_names: payload.allowed_style_names,
        allowed_colors: payload.allowed_colors,
        allowed_fabrics: payload.allowed_fabrics,
        allowed_compositions: payload.allowed_compositions,
        allowed_woven_knits: payload.allowed_woven_knits,
        style_code_pattern: payload.style_code_pattern ?? null,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setCatalogTemplates((items) => [localTemplate, ...items]);
      setSelectedTemplateId(localTemplate.id);
      setTemplateNotice("Saved local template (sign in to persist).");
      return;
    }

    setIsTemplateSaving(true);
    setTemplateNotice(null);
    try {
      if (mode === "existing" && !selectedTemplateId) {
        setTemplateNotice("Select a template first, or use Save As New.");
        return;
      }

      const shouldCreateNew = mode === "new" || (mode === "auto" && !selectedTemplateId);
      const saved = shouldCreateNew
        ? await apiRequest<CatalogTemplateRecord>("/catalog/templates", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : await apiRequest<CatalogTemplateRecord>(`/catalog/templates/${selectedTemplateId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          });

      setCatalogTemplates((items) => {
        const exists = items.some((item) => item.id === saved.id);
        if (exists) return items.map((item) => (item.id === saved.id ? saved : item));
        return [saved, ...items];
      });
      setSelectedTemplateId(saved.id);
      setTemplateNotice(shouldCreateNew ? "Template saved as new." : "Template updated.");
    } catch (error) {
      setTemplateNotice(error instanceof Error ? error.message : "Failed to save template.");
    } finally {
      setIsTemplateSaving(false);
    }
  }

  async function handleDuplicateTemplate(): Promise<void> {
    const source = activeTemplate;
    if (!source) return;
    setTemplateName(`${source.name} Copy`);
    setSelectedTemplateId("");
    setTemplateNotice("Duplicating template. Click Save to create.");
  }

  async function handleDeleteTemplate(): Promise<void> {
    if (!selectedTemplateId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this template?")) return;

    if (
      !hasAccessToken() ||
      selectedTemplateId.startsWith("local-template") ||
      selectedTemplateId === "local-default-template"
    ) {
      setCatalogTemplates((items) => items.filter((item) => item.id !== selectedTemplateId));
      setSelectedTemplateId("");
      setTemplateNotice("Template removed.");
      return;
    }

    setIsTemplateSaving(true);
    setTemplateNotice(null);
    try {
      await apiRequest(`/catalog/templates/${selectedTemplateId}`, { method: "DELETE" });
      setCatalogTemplates((items) => items.filter((item) => item.id !== selectedTemplateId));
      setSelectedTemplateId("");
      setTemplateNotice("Template deleted.");
    } catch (error) {
      setTemplateNotice(error instanceof Error ? error.message : "Failed to delete template.");
    } finally {
      setIsTemplateSaving(false);
    }
  }

  function openAddModal(): void {
    setEditingRowId(null);
    resetImageLabelTracking();
    setItemStyleNo("");
    setItemImageName("");
    setAddItemError(null);
    setImagePreviewUrl(null);
    setPendingAnalyzeProductId(null);
    setFieldConfidence({});
    setFieldContext({});
    setAiSuggestions(null);
    setIsAiSuggestionsVisible(false);
    setFeedbackCompletedFields({});
    setOverallConfidence(null);
    setAnalysisStage(null);
    setLastAnalyzedImageHash(null);
    setIsCorrectionModalOpen(false);
    setCorrectionFieldKey(null);
    setCorrectionReasonCode(CORRECTION_REASON_OPTIONS[0].value);
    setCorrectionNotes("");
    selectedImageFileRef.current = null;
    if (addItemImageInputRef.current) {
      addItemImageInputRef.current.value = "";
    }

    if (rememberLastValues) {
      const stored = localStorage.getItem("kira_last_item_values");
      if (stored) {
        try {
          const values = JSON.parse(stored);
          setItemCategory(values.category || CATEGORY_OPTIONS[0]);
          setItemStyleName(values.styleName || STYLE_NAME_OPTIONS[0]);
          setItemColor(values.color || COLOR_OPTIONS[1]);
          setItemFabric(values.fabric || FABRIC_OPTIONS[0]);
          setItemComposition(values.composition || COMPOSITION_OPTIONS[1]);
          setItemWovenKnits(values.wovenKnits || WOVEN_KNITS_OPTIONS[1]);
          setItemTotalUnits(values.totalUnits || TOTAL_UNITS_OPTIONS[0]);
          setItemPoPrice(values.poPrice || PO_PRICE_OPTIONS[2]);
          setItemOspSar(values.ospSar || OSP_OPTIONS[1]);
        } catch (e) {
          // ignore parse errors
        }
      }
    } else {
      const defaults = activeTemplate?.defaults ?? {};
      setItemCategory(
        typeof defaults.category === "string" && defaults.category
          ? defaults.category
          : CATEGORY_OPTIONS[0],
      );
      setItemStyleName(
        typeof defaults.styleName === "string" && defaults.styleName
          ? defaults.styleName
          : STYLE_NAME_OPTIONS[0],
      );
      setItemColor(
        typeof defaults.color === "string" && defaults.color ? defaults.color : COLOR_OPTIONS[1],
      );
      setItemFabric(
        typeof defaults.fabric === "string" && defaults.fabric
          ? defaults.fabric
          : FABRIC_OPTIONS[0],
      );
      setItemComposition(
        typeof defaults.composition === "string" && defaults.composition
          ? defaults.composition
          : COMPOSITION_OPTIONS[1],
      );
      setItemWovenKnits(
        typeof defaults.wovenKnits === "string" && defaults.wovenKnits
          ? defaults.wovenKnits
          : WOVEN_KNITS_OPTIONS[1],
      );
      setItemTotalUnits(
        typeof defaults.units === "string" && defaults.units
          ? defaults.units
          : TOTAL_UNITS_OPTIONS[0],
      );
      setItemPoPrice(
        typeof defaults.poPrice === "string" && defaults.poPrice
          ? defaults.poPrice
          : PO_PRICE_OPTIONS[2],
      );
      setItemOspSar(
        typeof defaults.ospSar === "string" && defaults.ospSar ? defaults.ospSar : OSP_OPTIONS[1],
      );
    }

    const targetCategory =
      rememberLastValues && localStorage.getItem("kira_last_item_values")
        ? (() => {
            try {
              return (
                JSON.parse(localStorage.getItem("kira_last_item_values") || "{}").category ||
                CATEGORY_OPTIONS[0]
              );
            } catch {
              return CATEGORY_OPTIONS[0];
            }
          })()
        : typeof activeTemplate?.defaults?.category === "string" && activeTemplate.defaults.category
          ? activeTemplate.defaults.category
          : CATEGORY_OPTIONS[0];
    generateBulkStyleCode(targetCategory).then((code) => {
      setItemStyleNo(code);
    });

    setIsAddModalOpen(true);
  }

  function closeAddModal(): void {
    setIsAddModalOpen(false);
    setEditingRowId(null);
    resetImageLabelTracking();
    setPendingAnalyzeProductId(null);
    setAddItemError(null);
    setItemImageError(null);
    setAnalysisStage(null);
    setIsCorrectionModalOpen(false);
    setCorrectionFieldKey(null);
    selectedImageFileRef.current = null;
    if (addItemImageInputRef.current) {
      addItemImageInputRef.current.value = "";
    }
  }

  function handleAddItemImage(file: File | null): void {
    setItemImageError(null);
    resetImageLabelTracking();
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setItemImageError("Only PNG, JPG, and WEBP files are allowed.");
      return;
    }
    if (file.size > MAX_ITEM_IMAGE_SIZE_BYTES) {
      setItemImageError(`Image exceeds ${formatBytes(MAX_ITEM_IMAGE_SIZE_BYTES)}.`);
      return;
    }
    setItemImageName(file.name);
    selectedImageFileRef.current = file;
    setAiSuggestions(null);
    setIsAiSuggestionsVisible(false);
    setFeedbackCompletedFields({});
    setOverallConfidence(null);
    setFieldConfidence({});
    setFieldContext({});
    setLastAnalyzedImageHash(null);

    // Create preview URL
    const objectUrl = URL.createObjectURL(file);
    setImagePreviewUrl(objectUrl);
    setAnalysisStage(null);
  }

  function currentFieldValue(fieldKey: AiFieldKey): string {
    if (fieldKey === "category") return itemCategory;
    if (fieldKey === "styleName") return itemStyleName;
    if (fieldKey === "color") return itemColor;
    if (fieldKey === "fabric") return itemFabric;
    if (fieldKey === "composition") return itemComposition;
    return itemWovenKnits;
  }

  function setCurrentFieldValue(fieldKey: AiFieldKey, value: string): void {
    if (fieldKey === "category") {
      setItemCategory(value);
      return;
    }
    if (fieldKey === "styleName") {
      setItemStyleName(value);
      return;
    }
    if (fieldKey === "color") {
      setItemColor(value);
      return;
    }
    if (fieldKey === "fabric") {
      setItemFabric(value);
      return;
    }
    if (fieldKey === "composition") {
      setItemComposition(value);
      return;
    }
    setItemWovenKnits(value);
  }

  function resetImageLabelTracking(): void {
    setActiveImageLabelId(null);
    setAiLabelCategory("");
    setAiLabelStyle("");
    setImageLabelCorrected(false);
  }

  function valuesDiffer(left: string, right: string): boolean {
    return left.trim().toLowerCase() !== right.trim().toLowerCase();
  }

  async function createImageLabelRecord(
    imageUrl: string,
    aiCategoryRaw: string | undefined,
    aiStyleRaw: string | undefined,
  ): Promise<void> {
    if (!hasAccessToken()) return;
    const aiCategory = aiCategoryRaw?.trim() ?? "";
    const aiStyle = aiStyleRaw?.trim() ?? "";
    if (!aiCategory && !aiStyle) return;

    try {
      const sourceUrl = imageUrl.trim();
      const created = await apiRequest<ImageLabelRecord>("/catalog/image-labels", {
        method: "POST",
        body: JSON.stringify({
          image_url: sourceUrl || `image-hash:${lastAnalyzedImageHash ?? Date.now()}`,
          ai_category: aiCategory || undefined,
          ai_style: aiStyle || undefined,
          human_category: aiCategory || undefined,
          human_style: aiStyle || undefined,
          corrected: false,
        }),
      });
      setActiveImageLabelId(created.id);
      setAiLabelCategory(created.ai_category?.trim() || aiCategory);
      setAiLabelStyle(created.ai_style?.trim() || aiStyle);
      setImageLabelCorrected(Boolean(created.corrected));
    } catch (error) {
      console.warn("Unable to create image label record:", error);
    }
  }

  async function syncImageLabelRecord(overrides?: {
    humanCategory?: string;
    humanStyle?: string;
    forceCorrected?: boolean;
  }): Promise<void> {
    if (!activeImageLabelId || !hasAccessToken()) return;
    const nextHumanCategory = (overrides?.humanCategory ?? itemCategory).trim();
    const nextHumanStyle = (overrides?.humanStyle ?? itemStyleName).trim();
    const baselineCategory = aiLabelCategory.trim();
    const baselineStyle = aiLabelStyle.trim();
    const corrected =
      Boolean(overrides?.forceCorrected) ||
      imageLabelCorrected ||
      (baselineCategory.length > 0 &&
        nextHumanCategory.length > 0 &&
        valuesDiffer(baselineCategory, nextHumanCategory)) ||
      (baselineStyle.length > 0 &&
        nextHumanStyle.length > 0 &&
        valuesDiffer(baselineStyle, nextHumanStyle));

    try {
      await apiRequest<ImageLabelRecord>(`/catalog/image-labels/${activeImageLabelId}`, {
        method: "PATCH",
        body: JSON.stringify({
          human_category: nextHumanCategory || baselineCategory || undefined,
          human_style: nextHumanStyle || baselineStyle || undefined,
          corrected,
        }),
      });
      if (corrected) {
        setImageLabelCorrected(true);
      }
    } catch (error) {
      console.warn("Unable to sync image label record:", error);
    }
  }

  async function submitFeedback(
    fieldKey: AiFieldKey,
    feedbackType: FeedbackType,
    reasonCode?: string,
    notes?: string,
    correctedValueOverride?: string,
  ): Promise<void> {
    if (!aiSuggestions) return;
    const suggestedValue = aiSuggestions.values[fieldKey];
    if (!suggestedValue) return;
    const correctedValue = correctedValueOverride?.trim() || currentFieldValue(fieldKey);

    const payload: LogCorrectionRequest = {
      product_id: pendingAnalyzeProductId ?? editingRowId ?? undefined,
      image_hash: aiSuggestions.imageHash ?? lastAnalyzedImageHash ?? undefined,
      field_name: AI_FIELD_API_KEYS[fieldKey],
      feedback_type: feedbackType,
      suggested_value: suggestedValue,
      corrected_value: correctedValue,
      reason_code: reasonCode,
      notes: notes && notes.trim().length > 0 ? notes.trim() : undefined,
      source: aiSuggestions.context[fieldKey]?.source,
      based_on: aiSuggestions.context[fieldKey]?.basedOn,
      learned_from: aiSuggestions.context[fieldKey]?.learnedFrom,
      confidence_score: aiSuggestions.confidence[fieldKey],
    };

    setIsFeedbackSubmitting(true);
    try {
      await apiRequest("/catalog/log-correction", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setFeedbackCompletedFields((prev) => ({ ...prev, [fieldKey]: true }));
      setCatalogNotice(
        feedbackType === "accept"
          ? `${AI_FIELD_LABELS[fieldKey]} marked as correct.`
          : `${AI_FIELD_LABELS[fieldKey]} correction logged for AI learning.`,
      );
      await loadLearningStats();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to log AI feedback.";
      setCatalogNotice(`Feedback error: ${message}`);
    } finally {
      setIsFeedbackSubmitting(false);
    }
  }

  function handleSuggestionFeedback(fieldKey: AiFieldKey, feedbackType: FeedbackType): void {
    if (feedbackType === "reject") {
      setCorrectionFieldKey(fieldKey);
      setCorrectionReasonCode(CORRECTION_REASON_OPTIONS[0].value);
      setCorrectionNotes("");
      setCorrectionValue(currentFieldValue(fieldKey) || aiSuggestions?.values[fieldKey] || "");
      setCorrectionValueError(null);
      setIsCorrectionModalOpen(true);
      return;
    }
    void submitFeedback(fieldKey, "accept");
  }

  async function handleSubmitCorrectionModal(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!correctionFieldKey) return;
    const nextValue = correctionValue.trim();
    if (!nextValue) {
      setCorrectionValueError("Enter a corrected value.");
      return;
    }
    setCorrectionValueError(null);

    setCurrentFieldValue(correctionFieldKey, nextValue);
    setAiSuggestions((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        values: {
          ...previous.values,
          [correctionFieldKey]: nextValue,
        },
      };
    });
    await appendAllowedTemplateValue(correctionFieldKey, nextValue);
    const nextHumanCategory = correctionFieldKey === "category" ? nextValue : itemCategory;
    const nextHumanStyle = correctionFieldKey === "styleName" ? nextValue : itemStyleName;
    await syncImageLabelRecord({
      humanCategory: nextHumanCategory,
      humanStyle: nextHumanStyle,
      forceCorrected: true,
    });
    await submitFeedback(
      correctionFieldKey,
      "reject",
      correctionReasonCode,
      correctionNotes,
      nextValue,
    );
    setIsCorrectionModalOpen(false);
    setCorrectionFieldKey(null);
    setCorrectionNotes("");
    setCorrectionValue("");
    setCorrectionValueError(null);
  }

  async function handleAnalyzeImage(): Promise<void> {
    if (isAnalyzing) {
      return;
    }
    const selectedFile = selectedImageFileRef.current;
    const existingImageSource = imagePreviewUrl
      ? (getImageUrl(imagePreviewUrl) ?? imagePreviewUrl)
      : null;
    if (!selectedFile && !existingImageSource) {
      setItemImageError("Please select an image first.");
      return;
    }

    setIsAnalyzing(true);
    setAddItemError(null);
    setItemImageError(null);
    resetImageLabelTracking();

    try {
      if (!hasAccessToken()) {
        throw new Error("You must be signed in to use AI analysis.");
      }

      let analysisImageInput: string;
      let imageSourceForLabel = existingImageSource ?? "";
      if (selectedFile) {
        // 1a. New file selected: upload and analyze that file.
        setAnalysisStage("Uploading image...");
        try {
          const uploadedImage = await uploadCatalogImage(selectedFile);
          imageSourceForLabel = uploadedImage.url;
          analysisImageInput = uploadedImage.url;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Image upload failed.";
          throw new Error(`Failed to upload image before analysis: ${message}`);
        }
        setAnalysisStage("Running AI vision analysis...");
      } else {
        // 1b. Edit mode existing image: analyze currently displayed image.
        setAnalysisStage("Preparing existing image...");
        analysisImageInput = existingImageSource as string;
        setAnalysisStage("Running AI vision analysis...");
      }

      // 3. Call synchronous analyze-image endpoint
      const result = await apiRequest<AnalyzeImageApiResult>("/catalog/analyze-image", {
        method: "POST",
        body: JSON.stringify(buildAnalyzeImageRequestPayload(analysisImageInput)),
      });

      // 3. Populate form fields and confidence
      setAnalysisStage("Applying AI suggestions...");
      const suggestions: Partial<Record<AiFieldKey, string>> = {};
      const newConfidence: Partial<Record<AiFieldKey, number>> = {};
      const newContext: Partial<Record<AiFieldKey, AiFieldContext>> = {};
      let totalConf = 0;
      let confCount = 0;

      const categoryContext = parseAiContext(result.category);
      if (categoryContext) newContext.category = categoryContext;

      if (result.category?.value) {
        suggestions.category = normalizeCategory(result.category.value);
        if (typeof result.category.confidence === "number") {
          newConfidence.category = result.category.confidence;
          totalConf += result.category.confidence;
          confCount++;
        }
      }
      const colorContext = parseAiContext(result.color);
      if (colorContext) newContext.color = colorContext;
      const colorField = result.color;
      const colorValue = normalizeAiValue(colorField?.value);
      if (colorValue) {
        suggestions.color = colorValue;
        if (typeof colorField?.confidence === "number") {
          newConfidence.color = colorField.confidence;
          totalConf += colorField.confidence;
          confCount++;
        }
      }
      const styleContext = parseAiContext(result.style_name);
      if (styleContext) newContext.styleName = styleContext;
      const styleNameField = result.style_name;
      if (styleNameField?.value) {
        const matchingStyle =
          pickOptionValue(styleNameField.value, STYLE_NAME_OPTIONS) ??
          normalizeAiValue(styleNameField.value);
        if (matchingStyle) {
          suggestions.styleName = matchingStyle;
          if (typeof styleNameField.confidence === "number") {
            newConfidence.styleName = styleNameField.confidence;
            totalConf += styleNameField.confidence;
            confCount++;
          }
        }
      }
      const fabricContext = parseAiContext(result.fabric);
      if (fabricContext) newContext.fabric = fabricContext;
      const fabricField = result.fabric;
      if (fabricField?.value) {
        const normalizedFabric = normalizeAiValue(String(fabricField.value));
        if (normalizedFabric) {
          suggestions.fabric = normalizedFabric;
          if (typeof fabricField.confidence === "number") {
            newConfidence.fabric = fabricField.confidence;
            totalConf += fabricField.confidence;
            confCount++;
          }
        }
      }
      const compositionContext = parseAiContext(result.composition);
      if (compositionContext) newContext.composition = compositionContext;
      const compositionField = result.composition;
      if (compositionField?.value) {
        const normalizedComposition = normalizeAiValue(String(compositionField.value));
        if (normalizedComposition) {
          suggestions.composition = normalizedComposition;
          if (typeof compositionField.confidence === "number") {
            newConfidence.composition = compositionField.confidence;
            totalConf += compositionField.confidence;
            confCount++;
          }
        }
      }
      const wovenKnitsContext = parseAiContext(result.woven_knits);
      if (wovenKnitsContext) newContext.wovenKnits = wovenKnitsContext;
      const wovenKnitsField = result.woven_knits;
      if (wovenKnitsField?.value) {
        const normalizedWovenKnits = normalizeAiValue(String(wovenKnitsField.value));
        if (normalizedWovenKnits) {
          suggestions.wovenKnits = normalizedWovenKnits;
          if (typeof wovenKnitsField.confidence === "number") {
            newConfidence.wovenKnits = wovenKnitsField.confidence;
            totalConf += wovenKnitsField.confidence;
            confCount++;
          }
        }
      }

      const analyzedImageHash =
        typeof result.image_hash === "string" ? result.image_hash : undefined;
      if (Object.keys(suggestions).length === 0) {
        setAiSuggestions(null);
        setIsAiSuggestionsVisible(false);
        setOverallConfidence(null);
        throw new Error(
          "AI could not extract attributes from this image. Try another image or re-run analysis.",
        );
      }
      setAiSuggestions({
        values: suggestions,
        confidence: newConfidence,
        context: newContext,
        imageHash: analyzedImageHash,
      });
      setIsAiSuggestionsVisible(true);
      setFeedbackCompletedFields({});
      setLastAnalyzedImageHash(analyzedImageHash ?? null);
      await promptAddOutOfBoundsSuggestedValues({
        category: suggestions.category,
        styleName: suggestions.styleName,
        color: suggestions.color,
        fabric: suggestions.fabric,
        composition: suggestions.composition,
        wovenKnits: suggestions.wovenKnits,
      });
      await createImageLabelRecord(
        imageSourceForLabel,
        suggestions.category,
        suggestions.styleName,
      );
      if (confCount > 0) {
        setOverallConfidence(Math.round(totalConf / confCount));
      }

      setCatalogNotice("AI analysis complete. Please review suggestions.");
    } catch (e: any) {
      setAddItemError(e.message || "Analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
      setAnalysisStage(null);
    }
  }

  async function handleAcceptAllAI(): Promise<void> {
    if (!aiSuggestions) return;

    let nextCategoryForLabel = itemCategory;
    let nextStyleForLabel = itemStyleName;
    const orderedFields: AiFieldKey[] = [
      "category",
      "color",
      "styleName",
      "fabric",
      "composition",
      "wovenKnits",
    ];
    for (const fieldKey of orderedFields) {
      const nextValue = aiSuggestions.values[fieldKey];
      if (!nextValue) continue;
      const isAllowed = await ensureTemplateValueAllowed(fieldKey, nextValue);
      if (!isAllowed) continue;
      setCurrentFieldValue(fieldKey, nextValue);
      if (fieldKey === "category") {
        nextCategoryForLabel = nextValue;
      } else if (fieldKey === "styleName") {
        nextStyleForLabel = nextValue;
      }
    }
    await syncImageLabelRecord({
      humanCategory: nextCategoryForLabel,
      humanStyle: nextStyleForLabel,
    });

    // Set field confidence so the badges appear on the inputs
    setFieldConfidence(aiSuggestions.confidence);
    setFieldContext(aiSuggestions.context);

    setIsAiSuggestionsVisible(false);
    setCatalogNotice("AI suggestions reviewed and applied.");
  }

  function applySimilarItemDefaults(row: CatalogRow): void {
    setItemCategory(normalizeCategory(row.category));
    setItemStyleName(
      STYLE_NAME_OPTIONS.includes(row.name as (typeof STYLE_NAME_OPTIONS)[number])
        ? row.name
        : STYLE_NAME_OPTIONS[0],
    );
    setItemColor(row.color);
    setItemFabric(row.fabric);
    setItemComposition(row.composition);
    setItemWovenKnits(row.wovenKnits);
    setCatalogNotice(`Inherited values from ${row.styleNo}.`);
  }

  function applySeasonalDefaults(): void {
    setItemColor(seasonalRecommendation.color);
    setItemFabric(seasonalRecommendation.fabric);
    setItemComposition(seasonalRecommendation.composition);
    setCatalogNotice(`${seasonalRecommendation.season} defaults applied.`);
  }

  function handleAddItemImageInput(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    handleAddItemImage(file);
    event.currentTarget.value = "";
  }

  function handleAddItemDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setIsItemDropActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    handleAddItemImage(file);
  }

  async function handleSaveNewItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAddItemError(null);

    const normalizedStyleNo = itemStyleNo.trim().toUpperCase();
    if (!normalizedStyleNo) {
      setAddItemError("Style No is required.");
      return;
    }

    const approvalCache = new Map<string, boolean>();
    const constrainedValues: Array<[TemplateConstrainedField, string]> = [
      ["category", itemCategory],
      ["styleName", itemStyleName],
      ["color", itemColor],
      ["fabric", itemFabric],
      ["composition", itemComposition],
      ["wovenKnits", itemWovenKnits],
    ];
    for (const [field, value] of constrainedValues) {
      const allowed = await ensureTemplateValueAllowed(field, value, approvalCache);
      if (!allowed) {
        setAddItemError(`"${value}" is outside allowed ${TEMPLATE_FIELD_LABELS[field]} list.`);
        return;
      }
    }
    await syncImageLabelRecord({ humanCategory: itemCategory, humanStyle: itemStyleName });

    if (rememberLastValues) {
      localStorage.setItem(
        "kira_last_item_values",
        JSON.stringify({
          category: itemCategory,
          styleName: itemStyleName,
          color: itemColor,
          fabric: itemFabric,
          composition: itemComposition,
          wovenKnits: itemWovenKnits,
          totalUnits: itemTotalUnits,
          poPrice: itemPoPrice,
          ospSar: itemOspSar,
        }),
      );
    }

    const modalRowPayload = {
      styleNo: normalizedStyleNo,
      name: itemStyleName,
      category: itemCategory,
      color: itemColor,
      fabric: itemFabric,
      composition: itemComposition,
      wovenKnits: itemWovenKnits,
      units: itemTotalUnits,
      poPrice: itemPoPrice,
      price: `SAR ${itemOspSar}`,
      imageName: itemImageName || itemStyleName,
    };
    const modalCatalogRow: CatalogRow = {
      id: editingRowId ?? pendingAnalyzeProductId ?? `draft-${Date.now()}`,
      primary_image_url: imagePreviewUrl ?? undefined,
      ...modalRowPayload,
      status: "draft",
      persisted: true,
    };

    if (isEditMode && editingRowId) {
      const existingRow = catalogRows.find((row) => row.id === editingRowId);
      if (!existingRow) {
        setAddItemError("Unable to find item to edit.");
        return;
      }

      if (!hasAccessToken() || !existingRow.persisted) {
        setCatalogRows((rows) =>
          rows.map((row) =>
            row.id === editingRowId ? { ...row, ...modalRowPayload, status: row.status } : row,
          ),
        );
        setCatalogNotice("Item updated locally.");
        closeAddModal();
        return;
      }

      setIsSavingItem(true);
      try {
        const response = await apiRequest<ProductResponse>(`/catalog/products/${editingRowId}`, {
          method: "PATCH",
          body: JSON.stringify({
            sku: normalizedStyleNo,
            title: itemStyleName,
            category: itemCategory,
            color: itemColor,
            status: existingRow.status,
            ai_attributes: buildAiAttributesFromRow({
              ...modalCatalogRow,
              id: existingRow.id,
              status: existingRow.status,
            }),
          }),
        });
        const savedProduct = await apiRequest<ProductResponse>(`/catalog/products/${editingRowId}`);
        const savedRow = mapProductResponseToCatalogRow(savedProduct, {
          ...existingRow,
          ...modalRowPayload,
          status: response.status as CatalogStatus,
        });

        setCatalogRows((rows) => rows.map((row) => (row.id === editingRowId ? savedRow : row)));
        setCatalogNotice("Item updated successfully.");
        closeAddModal();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to update item.";
        setAddItemError(message);
      } finally {
        setIsSavingItem(false);
      }
      return;
    }

    if (!hasAccessToken()) {
      const localRow: CatalogRow = {
        id: `local-${Date.now()}`,
        ...modalRowPayload,
        status: "draft",
        persisted: false,
      };
      setCatalogRows((rows) => [localRow, ...rows]);
      setCatalogNotice("Item added locally. Sign in to persist to API.");
      closeAddModal();
      return;
    }

    setIsSavingItem(true);
    try {
      const response = pendingAnalyzeProductId
        ? await apiRequest<ProductResponse>(`/catalog/products/${pendingAnalyzeProductId}`, {
            method: "PATCH",
            body: JSON.stringify({
              sku: normalizedStyleNo,
              title: itemStyleName,
              category: itemCategory,
              color: itemColor,
              status: "draft",
              ai_attributes: buildAiAttributesFromRow(modalCatalogRow),
            }),
          })
        : await apiRequest<ProductResponse>("/catalog/products", {
            method: "POST",
            body: JSON.stringify({
              sku: normalizedStyleNo,
              title: itemStyleName,
              category: itemCategory,
              color: itemColor,
              status: "draft",
              ai_attributes: buildAiAttributesFromRow(modalCatalogRow),
            }),
          });

      // Upload image if one was selected
      let imageUrl: string | undefined = undefined;
      if (selectedImageFileRef.current) {
        try {
          const uploadedImage = await uploadCatalogImage(selectedImageFileRef.current);
          imageUrl = uploadedImage.url;

          // Create ProductImage record
          const analysisPayload =
            aiSuggestions || lastAnalyzedImageHash
              ? {
                  image_hash: aiSuggestions?.imageHash ?? lastAnalyzedImageHash ?? undefined,
                  suggestions: aiSuggestions?.values ?? undefined,
                  confidence: aiSuggestions?.confidence ?? undefined,
                  source_context: aiSuggestions?.context ?? undefined,
                }
              : undefined;
          await apiRequest<ProductImageResponse>(`/catalog/products/${response.id}/images`, {
            method: "POST",
            body: JSON.stringify({
              file_name: uploadedImage.filename,
              file_url: imageUrl,
              processing_status: "uploaded",
              analysis: analysisPayload,
            }),
          });
        } catch (uploadError) {
          // Don't fail the whole save if image upload fails
          console.warn("Failed to upload image:", uploadError);
        }
      }
      const savedProduct = await apiRequest<ProductResponse>(`/catalog/products/${response.id}`);

      const createdRow = mapProductResponseToCatalogRow(savedProduct, modalCatalogRow, {
        imageUrl,
        imageName: modalRowPayload.imageName,
      });

      setCatalogRows((rows) => [createdRow, ...rows]);
      setCatalogNotice("Item saved to catalog.");
      closeAddModal();
      // Clear the selected image
      selectedImageFileRef.current = null;
      setImagePreviewUrl(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save item.";
      setAddItemError(message);
    } finally {
      setIsSavingItem(false);
    }
  }

  const applyAiSuggestionToRow = useCallback(
    (rowId: string, itemAi: AiSuggestionsState, fieldKey: AiFieldKey, bypassPrompt = false) => {
      setCatalogRows((prev) => {
        const idx = prev.findIndex((r) => r.id === rowId);
        if (idx === -1) return prev;
        const targetRow = prev[idx];
        if (!targetRow) return prev;
        const val = itemAi.values[fieldKey];
        if (!val) return prev;

        // Bypassing prompt if it was already acknowledged
        if (!bypassPrompt && checkAndPromptOutOfBounds) {
          const proceed = () => applyAiSuggestionToRow(rowId, itemAi, fieldKey, true);
          checkAndPromptOutOfBounds(rowId, fieldKey, val, "ai_suggestion", proceed);
          return prev;
        }

        const nextRow: CatalogRow = {
          id: targetRow.id || "",
          styleNo: targetRow.styleNo || "",
          name: targetRow.name || "",
          category: targetRow.category || "",
          color: targetRow.color || "",
          fabric: targetRow.fabric || "",
          composition: targetRow.composition || "",
          wovenKnits: targetRow.wovenKnits || "",
          units: targetRow.units || "",
          poPrice: targetRow.poPrice || "",
          price: targetRow.price || "",
          status: targetRow.status || "draft",
          persisted: targetRow.persisted || false,
          primary_image_url: targetRow.primary_image_url,
          imageName: targetRow.imageName,
        };
        if (fieldKey === "category") nextRow.category = val;
        if (fieldKey === "styleName") nextRow.name = val;
        if (fieldKey === "color") nextRow.color = val;
        if (fieldKey === "fabric") nextRow.fabric = val;
        if (fieldKey === "composition") nextRow.composition = val;
        if (fieldKey === "wovenKnits") nextRow.wovenKnits = val;

        const updatedArray = [...prev];
        updatedArray[idx] = nextRow;
        return updatedArray;
      });
    },
    [checkAndPromptOutOfBounds],
  );

  return (
    <>
      <DashboardShell hideHeader>
        <section className="surface-card p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-sans text-5xl font-semibold leading-tight">Catalog</h1>
              <p className="mt-2 text-lg text-kira-midgray">Manage your clothing inventory</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <select
                className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-sm text-kira-darkgray "
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                value={selectedTemplateId}
              >
                <option value="">No Template</option>
                {catalogTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="kira-focus-ring border border-kira-warmgray/55 px-3 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray hover:bg-kira-warmgray/20 "
                onClick={() => setIsTemplatePanelOpen(true)}
              >
                Manage Templates
              </button>
              <button
                type="button"
                aria-label="AI learning"
                className={cn(
                  "kira-focus-ring inline-flex h-9 w-9 items-center justify-center transition-colors",
                  isLearningPanelOpen
                    ? "bg-[#1E7145] text-white"
                    : "text-[#1E7145] hover:bg-[#E3F6ED] hover:text-[#185D39]",
                )}
                onClick={() => {
                  setIsLearningPanelOpen(true);
                }}
              >
                <BrainIcon />
              </button>
              <button
                className="kira-focus-ring inline-flex items-center gap-2 border border-kira-warmgray/60 bg-kira-offwhite px-6 py-3 text-sm font-semibold uppercase tracking-[0.04em] text-kira-darkgray "
                onClick={() => setIsBulkUploadOpen((open) => !open)}
                type="button"
              >
                <UploadIcon />
                Bulk Upload
              </button>
              <button
                className="kira-focus-ring inline-flex items-center gap-2 bg-kira-black dark:bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.04em] text-kira-offwhite dark:text-black"
                onClick={openAddModal}
                type="button"
              >
                <PlusIcon />
                Add Item
              </button>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-none border border-kira-warmgray/55 bg-kira-offwhite p-6">
              <p className="text-sm uppercase tracking-[0.08em] text-kira-midgray">Total Items</p>
              <p className="mt-5 text-5xl font-semibold leading-none text-kira-black ">
                {stats.total}
              </p>
            </div>
            <div className="rounded-none border border-kira-warmgray/55 bg-kira-offwhite p-6">
              <p className="text-sm uppercase tracking-[0.08em] text-kira-midgray">Dresses</p>
              <p className="mt-5 text-5xl font-semibold leading-none text-kira-black ">
                {stats.dresses}
              </p>
            </div>
            <div className="rounded-none border border-kira-warmgray/55 bg-kira-offwhite p-6">
              <p className="text-sm uppercase tracking-[0.08em] text-kira-midgray">Cord Sets</p>
              <p className="mt-5 text-5xl font-semibold leading-none text-kira-black ">
                {stats.cordSets}
              </p>
            </div>
          </div>

          {catalogNotice ? (
            <p className="mt-4 rounded-md bg-kira-warmgray/20 px-3 py-2 text-sm text-kira-black ">
              {catalogNotice}
            </p>
          ) : null}
          {isCatalogLoading ? (
            <p className="mt-3 text-sm text-kira-midgray">Loading catalog...</p>
          ) : null}

          {isExportPanelOpen ? (
            <div className="mt-4 rounded-none border border-kira-warmgray/55 bg-kira-offwhite p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-kira-warmgray/45 pb-3">
                <h3 className="text-base font-semibold uppercase tracking-[0.06em] text-kira-black ">
                  Marketplace Export
                </h3>
                <div className="inline-flex border border-kira-warmgray/55 ">
                  <button
                    className={cn(
                      "kira-focus-ring px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em]",
                      activeExportTab === "generate"
                        ? "bg-kira-black text-kira-offwhite"
                        : "bg-kira-offwhite text-kira-darkgray ",
                    )}
                    onClick={() => setActiveExportTab("generate")}
                    type="button"
                  >
                    Generate
                  </button>
                  <button
                    className={cn(
                      "kira-focus-ring border-l border-kira-warmgray/55 px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em]",
                      activeExportTab === "history"
                        ? "bg-kira-black text-kira-offwhite"
                        : "bg-kira-offwhite text-kira-darkgray ",
                    )}
                    onClick={() => setActiveExportTab("history")}
                    type="button"
                  >
                    History
                  </button>
                </div>
              </div>

              {activeExportTab === "generate" ? (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-kira-midgray">
                    Export uses current search/status filters from this page.
                  </p>
                  <p className="text-xs text-kira-midgray">
                    Use XLSX for image preview cells. CSV exports image URLs only.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <select
                      className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-sm text-kira-darkgray "
                      onChange={(event) => setSelectedExportTemplateId(event.target.value)}
                      value={selectedExportTemplateId}
                    >
                      <option value="">Built-in marketplace format</option>
                      {marketplaceTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-sm text-kira-darkgray "
                      onChange={(event) => setExportMarketplace(event.target.value)}
                      value={exportMarketplace}
                    >
                      {MARKETPLACE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <select
                      className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-sm text-kira-darkgray "
                      onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
                      value={exportFormat}
                    >
                      <option value="csv">CSV</option>
                      <option value="xlsx">XLSX</option>
                    </select>
                    <div className="flex gap-2">
                      <button
                        className="kira-focus-ring flex-1 bg-kira-black dark:bg-white px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-kira-offwhite dark:text-black disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isCreatingExport}
                        onClick={() => void handleCreateMarketplaceExport()}
                        type="button"
                      >
                        {isCreatingExport ? "Generating..." : "Generate Export"}
                      </button>
                      <button
                        className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray "
                        onClick={() => setIsMarketplaceTemplatePanelOpen((current) => !current)}
                        type="button"
                      >
                        {isMarketplaceTemplatePanelOpen ? "Close" : "Templates"}
                      </button>
                    </div>
                  </div>
                  {selectedExportTemplateId ? (
                    <p className="text-xs text-kira-midgray">
                      Selected template overrides built-in marketplace column order for this export.
                    </p>
                  ) : null}
                  {exportError ? <p className="text-sm text-rose-700">{exportError}</p> : null}
                  {isMarketplaceTemplatePanelOpen ? (
                    <div className="space-y-4 border border-kira-warmgray/50 bg-kira-offwhite/70 p-4">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <label className="space-y-1 text-sm text-kira-darkgray ">
                          <span className="text-xs uppercase tracking-[0.08em] text-kira-midgray">
                            Template name
                          </span>
                          <input
                            className="kira-focus-ring w-full border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-sm"
                            onChange={(event) => setMarketplaceTemplateName(event.target.value)}
                            placeholder="Amazon IN catalog export"
                            value={marketplaceTemplateName}
                          />
                        </label>
                        <label className="space-y-1 text-sm text-kira-darkgray ">
                          <span className="text-xs uppercase tracking-[0.08em] text-kira-midgray">
                            Marketplace
                          </span>
                          <select
                            className="kira-focus-ring w-full border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-sm"
                            onChange={(event) =>
                              setMarketplaceTemplateMarketplace(event.target.value)
                            }
                            value={marketplaceTemplateMarketplace}
                          >
                            {MARKETPLACE_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 text-sm text-kira-darkgray ">
                          <span className="text-xs uppercase tracking-[0.08em] text-kira-midgray">
                            Sample CSV/XLSX
                          </span>
                          <input
                            accept=".csv,.xlsx"
                            className="block w-full text-sm"
                            onChange={(event) =>
                              setMarketplaceTemplateFile(event.target.files?.[0] ?? null)
                            }
                            type="file"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={isParsingMarketplaceTemplate || !marketplaceTemplateFile}
                          onClick={() => void handleParseMarketplaceTemplateSample()}
                          variant="secondary"
                        >
                          {isParsingMarketplaceTemplate ? "Parsing..." : "Parse sample"}
                        </Button>
                        <Button
                          disabled={isSavingMarketplaceTemplate || !parsedMarketplaceTemplate}
                          onClick={() => void handleSaveMarketplaceTemplate()}
                        >
                          {isSavingMarketplaceTemplate ? "Saving..." : "Save template"}
                        </Button>
                      </div>
                      {marketplaceTemplateError ? (
                        <p className="text-sm text-rose-700">{marketplaceTemplateError}</p>
                      ) : null}
                      {parsedMarketplaceTemplate ? (
                        <div className="space-y-3">
                          <p className="text-xs text-kira-midgray">
                            Detected header row {parsedMarketplaceTemplate.header_row_index}
                            {parsedMarketplaceTemplate.sheet_name
                              ? ` on sheet ${parsedMarketplaceTemplate.sheet_name}`
                              : ""}
                            .
                          </p>
                          <div className="overflow-x-auto border border-kira-warmgray/40">
                            <table className="min-w-full text-sm">
                              <thead className="bg-kira-warmgray/15 text-left text-xs uppercase tracking-[0.06em] text-kira-midgray">
                                <tr>
                                  <th className="px-3 py-2">Sample column</th>
                                  <th className="px-3 py-2">Map to</th>
                                  <th className="px-3 py-2">Required</th>
                                </tr>
                              </thead>
                              <tbody>
                                {parsedMarketplaceTemplate.columns.map((column, index) => (
                                  <tr
                                    key={`${column.header}-${index}`}
                                    className="border-t border-kira-warmgray/30"
                                  >
                                    <td className="px-3 py-2">{column.header}</td>
                                    <td className="px-3 py-2">
                                      <select
                                        className="kira-focus-ring w-full border border-kira-warmgray/55 bg-kira-offwhite px-2 py-1 text-sm"
                                        onChange={(event) =>
                                          handleMarketplaceTemplateColumnChange(index, {
                                            source_field: event.target.value || null,
                                          })
                                        }
                                        value={column.source_field ?? ""}
                                      >
                                        <option value="">Ignore column</option>
                                        {CATALOG_EXPORT_SOURCE_FIELDS.map((field) => (
                                          <option key={field} value={field}>
                                            {field}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td className="px-3 py-2">
                                      <input
                                        checked={column.required}
                                        onChange={(event) =>
                                          handleMarketplaceTemplateColumnChange(index, {
                                            required: event.target.checked,
                                          })
                                        }
                                        type="checkbox"
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                      {marketplaceTemplates.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs uppercase tracking-[0.08em] text-kira-midgray">
                            Saved marketplace templates
                          </p>
                          <div className="space-y-2">
                            {marketplaceTemplates.map((template) => (
                              <div
                                key={template.id}
                                className="flex items-center justify-between border border-kira-warmgray/30 px-3 py-2 text-sm"
                              >
                                <div>
                                  <p className="font-medium text-kira-darkgray ">{template.name}</p>
                                  <p className="text-xs text-kira-midgray">
                                    {template.marketplace_key} •{" "}
                                    {template.file_format.toUpperCase()}
                                  </p>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    onClick={() => setSelectedExportTemplateId(template.id)}
                                    variant="secondary"
                                  >
                                    Use
                                  </Button>
                                  <Button
                                    onClick={() =>
                                      void handleDeleteMarketplaceTemplate(template.id)
                                    }
                                    variant="text"
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs uppercase tracking-[0.08em] text-kira-midgray">
                      Status
                    </label>
                    <select
                      className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-xs text-kira-darkgray "
                      onChange={(event) =>
                        setExportStatusFilter(event.target.value as "all" | ExportStatus)
                      }
                      value={exportStatusFilter}
                    >
                      {EXPORT_STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {formatExportStatusLabel(option)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {exportError ? <p className="text-sm text-rose-700">{exportError}</p> : null}
                  {isExportHistoryLoading ? (
                    <p className="text-sm text-kira-midgray">Loading export history...</p>
                  ) : null}

                  <div className="overflow-x-auto border border-kira-warmgray/50 ">
                    <table className="min-w-full text-sm">
                      <thead className="bg-kira-warmgray/15 text-left text-xs uppercase tracking-[0.06em] text-kira-midgray">
                        <tr>
                          <th className="px-3 py-2">Created</th>
                          <th className="px-3 py-2">Marketplace</th>
                          <th className="px-3 py-2">Format</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Rows</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exportHistory.length === 0 ? (
                          <tr>
                            <td className="px-3 py-3 text-kira-midgray" colSpan={6}>
                              No exports yet.
                            </td>
                          </tr>
                        ) : (
                          exportHistory.map((record) => (
                            <tr
                              className="border-t border-kira-warmgray/35 text-kira-black "
                              key={record.id}
                            >
                              <td className="px-3 py-2">{formatDateTime(record.created_at)}</td>
                              <td className="px-3 py-2">{record.marketplace}</td>
                              <td className="px-3 py-2 uppercase">{record.export_format}</td>
                              <td className="px-3 py-2">
                                {formatExportStatusLabel(record.status)}
                              </td>
                              <td className="px-3 py-2">{record.row_count}</td>
                              <td className="px-3 py-2">
                                {record.file_url ? (
                                  <button
                                    className="kira-focus-ring border border-kira-warmgray/50 px-2 py-1 text-xs text-kira-darkgray hover:bg-kira-warmgray/20 "
                                    onClick={() => void handleDownloadExport(record)}
                                    type="button"
                                  >
                                    Download
                                  </button>
                                ) : (
                                  <span className="text-xs text-kira-midgray">
                                    {record.error_message ?? "--"}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-[280px] items-center gap-2 border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-kira-midgray">
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M16.5 16.5L21 21"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.5"
                />
              </svg>
              <input
                className="kira-focus-ring w-full bg-transparent text-sm text-kira-black outline-none placeholder:text-kira-midgray"
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search by style, name, or category"
                type="search"
                value={searchValue}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-4 py-2 text-sm text-kira-darkgray "
                onChange={(event) => setCategoryFilter(event.target.value)}
                value={categoryFilter}
              >
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-4 py-2 text-sm text-kira-darkgray "
                onChange={(event) => setColorFilter(event.target.value)}
                value={colorFilter}
              >
                {colorOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-4 py-2 text-sm text-kira-darkgray "
                onChange={(event) => setStatusFilter(event.target.value)}
                value={statusFilter}
              >
                <option value="All Statuses">All Statuses</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {formatStatusLabel(option)}
                  </option>
                ))}
              </select>
              <button
                className="kira-focus-ring inline-flex h-10 w-10 items-center justify-center border border-kira-warmgray/55 text-kira-darkgray hover:bg-kira-warmgray/20 "
                onClick={() => {
                  setIsExportPanelOpen((open) => !open);
                  setActiveExportTab("generate");
                }}
                type="button"
              >
                <DownloadIcon />
              </button>
            </div>
          </div>

          {selectedRowIds.length > 0 ? (
            <div className="mt-4 rounded-none border border-kira-warmgray/55 bg-kira-offwhite p-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-semibold text-kira-black ">
                  {selectedRowIds.length} selected
                </p>
                <input
                  className="kira-focus-ring w-28 border border-kira-warmgray/55 bg-transparent px-2 py-1 text-sm text-kira-black "
                  onChange={(event) => setBulkUnitsValue(event.target.value)}
                  placeholder="Units"
                  value={bulkUnitsValue}
                />
                <select
                  className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-3 py-1.5 text-sm text-kira-darkgray "
                  onChange={(event) => setBulkStatus(event.target.value as CatalogStatus | "")}
                  value={bulkStatus}
                >
                  <option value="">Bulk Status</option>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {formatStatusLabel(option)}
                    </option>
                  ))}
                </select>
                <button
                  className="kira-focus-ring bg-kira-black dark:bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-offwhite dark:text-black disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBulkApplying}
                  onClick={() => void handleApplyBulkEdit()}
                  type="button"
                >
                  {isBulkApplying ? "Applying..." : "Apply Bulk Edit"}
                </button>
                <button
                  className="kira-focus-ring border border-kira-warmgray/55 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray "
                  onClick={() => setSelectedRowIds([])}
                  type="button"
                >
                  Clear Selection
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-kira-warmgray/40 pt-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-kira-midgray">
                  Batch Actions
                </span>
                <select
                  className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-3 py-1.5 text-sm text-kira-darkgray "
                  onChange={(event) => setBatchAction(event.target.value as BatchActionKind)}
                  value={batchAction}
                >
                  <option value="">Select Action</option>
                  <option value="update_fabric">Update Fabric</option>
                  <option value="find_replace">Find & Replace</option>
                  <option value="adjust_price">Adjust Price</option>
                  <option value="duplicate">Duplicate Selected</option>
                  <option value="export_selected">Export Selected</option>
                  <option value="delete_selected">Delete Selected</option>
                </select>
                {batchAction === "update_fabric" ? (
                  <select
                    className="kira-focus-ring border border-kira-warmgray/55 bg-kira-offwhite px-3 py-1.5 text-sm text-kira-darkgray "
                    onChange={(event) => setBatchFabricValue(event.target.value)}
                    value={batchFabricValue}
                  >
                    {FABRIC_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  className="kira-focus-ring bg-kira-black dark:bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-offwhite dark:text-black disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBatchActionApplying || batchAction === ""}
                  onClick={() => void handleRunBatchAction()}
                  type="button"
                >
                  {isBatchActionApplying ? "Running..." : "Run Action"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-6 overflow-x-auto border border-kira-warmgray/55 ">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-kira-warmgray/20 text-left text-kira-darkgray ">
                  <th className="px-4 py-4 text-sm font-medium">
                    <input
                      checked={allVisibleSelected}
                      className="h-4 w-4 accent-kira-black"
                      onChange={toggleSelectAllVisible}
                      type="checkbox"
                    />
                  </th>
                  <th className="px-4 py-4 text-sm font-medium uppercase tracking-[0.06em]">
                    Image
                  </th>
                  <th className="px-4 py-4 text-sm font-medium uppercase tracking-[0.06em]">
                    Style No
                  </th>
                  <th className="px-4 py-4 text-sm font-medium uppercase tracking-[0.06em]">
                    Style Name
                  </th>
                  <th className="px-4 py-4 text-sm font-medium uppercase tracking-[0.06em]">
                    Category
                  </th>
                  <th className="px-4 py-4 text-sm font-medium uppercase tracking-[0.06em]">
                    Color
                  </th>
                  <th className="px-4 py-4 text-sm font-medium uppercase tracking-[0.06em]">
                    Fabric
                  </th>
                  <th className="px-4 py-4 text-sm font-medium uppercase tracking-[0.06em]">
                    Units
                  </th>
                  <th className="px-4 py-4 text-sm font-medium uppercase tracking-[0.06em]">
                    Price
                  </th>
                  <th className="px-4 py-4 text-sm font-medium uppercase tracking-[0.06em]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredCatalogRows.map((row) => (
                  <tr className="border-t border-kira-warmgray/45 " key={row.id}>
                    <td className="px-4 py-4">
                      <input
                        checked={selectedIdSet.has(row.id)}
                        className="h-4 w-4 accent-kira-black"
                        onChange={() => toggleRowSelection(row.id)}
                        type="checkbox"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex h-14 w-14 items-center justify-center bg-kira-warmgray/15 text-sm font-semibold text-kira-darkgray overflow-hidden">
                        {row.primary_image_url ? (
                          <img
                            src={getImageUrl(row.primary_image_url) ?? ""}
                            alt=""
                            className="h-full w-full object-cover"
                            height={56}
                            loading="lazy"
                            width={56}
                          />
                        ) : (
                          (row.imageName ?? row.name).slice(0, 1).toUpperCase()
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-kira-black ">{row.styleNo}</td>
                    <td className="px-4 py-4 text-kira-black ">{row.name}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex bg-kira-warmgray/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-kira-darkgray ">
                        {normalizeCategory(row.category)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-kira-black ">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full border"
                          style={{
                            backgroundColor: colorDot(row.color),
                            borderColor: colorDotBorder(row.color),
                          }}
                        />
                        {row.color}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-kira-black ">{row.fabric}</td>
                    <td className="px-4 py-4 text-kira-black ">
                      <input
                        className="kira-focus-ring w-16 border border-kira-warmgray/50 bg-transparent px-2 py-1 text-sm text-kira-black "
                        onChange={(event) => handleInlineUnitsChange(row.id, event.target.value)}
                        type="text"
                        value={row.units}
                      />
                    </td>
                    <td className="px-4 py-4 text-kira-black ">
                      <div className="inline-flex items-center gap-1 border border-kira-warmgray/50 px-2 py-1">
                        <span className="text-xs text-kira-midgray">SAR</span>
                        <input
                          className="kira-focus-ring w-16 bg-transparent text-sm text-kira-black "
                          onChange={(event) => handleInlinePriceChange(row.id, event.target.value)}
                          type="text"
                          value={row.price.replace("SAR", "").trim()}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3 text-kira-midgray">
                        <button
                          className="kira-focus-ring inline-flex h-7 w-7 items-center justify-center hover:text-kira-black "
                          onClick={() => handleEditRow(row)}
                          type="button"
                        >
                          <PencilIcon />
                        </button>
                        <button
                          className="kira-focus-ring inline-flex h-7 w-7 items-center justify-center hover:text-kira-black "
                          onClick={() => handleDeleteRow(row)}
                          type="button"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredCatalogRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-kira-midgray" colSpan={10}>
                      {isCatalogLoading
                        ? "Loading catalog rows..."
                        : catalogRows.length === 0
                          ? "No catalog records yet."
                          : "No catalog rows match current filters."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
        {outOfBoundsPrompt && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
            <div className="kira-modal-open w-full max-w-md border border-kira-warmgray/50 bg-[#FAFAFA] p-6 shadow-2xl">
              <h3 className="mb-3 font-sans text-2xl font-semibold text-kira-black ">
                Unrecognized Value
              </h3>
              <p className="mb-4 text-sm text-kira-darkgray ">
                The value{" "}
                <span className="font-semibold text-kira-black ">
                  &quot;{outOfBoundsPrompt.value}&quot;
                </span>{" "}
                is not in the allowed list for{" "}
                <span className="font-semibold text-kira-black ">
                  {TEMPLATE_FIELD_LABELS[outOfBoundsPrompt.field]}
                </span>{" "}
                based on the current template.
              </p>
              {activeTemplate && activeTemplate.id !== "local-default-template" ? (
                <label className="mb-6 flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    id="add-to-template-cb"
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-kira-brown focus:ring-kira-brown"
                  />
                  <span className="text-sm text-kira-darkgray leading-tight">
                    Add <span className="font-semibold">&quot;{outOfBoundsPrompt.value}&quot;</span>{" "}
                    to the allowed {TEMPLATE_FIELD_LABELS[outOfBoundsPrompt.field]} list permanently
                    for this template.
                  </span>
                </label>
              ) : null}
              <div className="flex justify-end gap-3 border-t border-kira-warmgray/35 pt-4">
                <button
                  className="kira-focus-ring border border-kira-warmgray/55 px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray hover:bg-kira-warmgray/20 "
                  onClick={outOfBoundsPrompt.onCancel}
                >
                  Cancel
                </button>
                <button
                  className="kira-focus-ring bg-kira-black dark:bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-kira-offwhite dark:text-black hover:bg-kira-black/90 dark:hover:bg-gray-200"
                  onClick={() => {
                    const cb = document.getElementById("add-to-template-cb") as HTMLInputElement;
                    outOfBoundsPrompt.onConfirm(cb ? cb.checked : false);
                  }}
                >
                  Use Anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Global Datalists for Template Allowed Lists */}
        <datalist id="list-category">
          {templateCategoryOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="list-styleName">
          {templateStyleNameOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="list-color">
          {templateColorOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="list-fabric">
          {templateFabricOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="list-composition">
          {templateCompositionOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="list-wovenKnits">
          {templateWovenKnitsOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </DashboardShell>
      {isLearningPanelOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 md:p-6">
          <div className="kira-modal-open mx-auto my-2 w-full max-w-[1280px] border border-[#BCD6E7] bg-[#D8E9F5] shadow-[0_30px_90px_rgba(6,6,6,0.24)]">
            <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-5 md:p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[#0A5F9F]">
                    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 16 16">
                      <path
                        d="M8 1.5L9.9 5.3L14 6.1L11 9L11.7 13.1L8 11.1L4.3 13.1L5 9L2 6.1L6.1 5.3L8 1.5Z"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                    </svg>
                    <h3 className="text-2xl leading-none md:text-3xl">AI Learning Progress</h3>
                  </div>
                  <p className="mt-2 text-sm text-[#2B77AF] md:text-base">
                    The AI learns from your corrections to improve accuracy over time
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close AI learning"
                  className="kira-focus-ring inline-flex h-8 w-8 items-center justify-center text-[#5B6772] hover:text-kira-black "
                  onClick={() => setIsLearningPanelOpen(false)}
                >
                  <CloseIcon />
                </button>
              </div>

              {isLearningStatsLoading ? (
                <p className="mt-5 text-sm text-[#48627A]">Loading learning stats...</p>
              ) : null}
              {learningStatsError ? (
                <p className="mt-5 text-sm text-rose-700">{learningStatsError}</p>
              ) : null}

              {learningStats ? (
                <>
                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="border border-[#D9DDE1] bg-[#F4F4F5] px-4 py-5 text-center">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-[#7D8790]">
                        Items Processed
                      </p>
                      <p className="mt-2 text-4xl font-semibold leading-none text-[#085C98]">
                        {learningStats.items_processed}
                      </p>
                    </div>
                    <div className="border border-[#D9DDE1] bg-[#F4F4F5] px-4 py-5 text-center">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-[#7D8790]">
                        Corrections Received
                      </p>
                      <p className="mt-2 text-4xl font-semibold leading-none text-[#085C98]">
                        {learningStats.corrections_received}
                      </p>
                    </div>
                    <div className="border border-[#D9DDE1] bg-[#F4F4F5] px-4 py-5 text-center">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-[#7D8790]">
                        Time Saved
                      </p>
                      <p className="mt-2 text-4xl font-semibold leading-none text-[#085C98]">
                        {learningStats.time_saved_minutes} min
                      </p>
                    </div>
                    <div className="border border-[#D9DDE1] bg-[#F4F4F5] px-4 py-5 text-center">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-[#7D8790]">
                        Avg Accuracy
                      </p>
                      <p className="mt-2 text-4xl font-semibold leading-none text-[#129364]">
                        {learningStats.field_accuracy.length > 0
                          ? `${Math.round(
                              learningStats.field_accuracy.reduce(
                                (sum, item) => sum + item.accuracy_percent,
                                0,
                              ) / learningStats.field_accuracy.length,
                            )}%`
                          : "--"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 border border-[#D9DDE1] bg-[#F5F5F5] p-4">
                    <p className="text-sm uppercase tracking-[0.07em] text-[#48525C]">
                      Field Accuracy
                    </p>
                    <div className="mt-4">
                      {learningStats.field_accuracy.length === 0 ? (
                        <p className="text-sm text-[#6B7280]">No feedback yet.</p>
                      ) : (
                        <div className="flex">
                          <div className="mr-3 flex h-40 flex-col justify-between text-[11px] text-[#6E7680]">
                            <span>100</span>
                            <span>75</span>
                            <span>50</span>
                            <span>25</span>
                            <span>0</span>
                          </div>
                          <div className="relative flex-1">
                            <div className="absolute inset-0 flex h-40 flex-col justify-between">
                              <div className="border-t border-[#D3D8DC]" />
                              <div className="border-t border-[#D3D8DC]" />
                              <div className="border-t border-[#D3D8DC]" />
                              <div className="border-t border-[#D3D8DC]" />
                              <div className="border-t border-[#B9C0C7]" />
                            </div>
                            <div className="relative z-10 flex h-40 items-end gap-5 px-2">
                              {learningStats.field_accuracy.slice(0, 6).map((item) => {
                                const normalized = Math.max(
                                  0,
                                  Math.min(100, item.accuracy_percent),
                                );
                                const barColor = normalized < 60 ? "#D97706" : "#10996B";
                                return (
                                  <div
                                    className="flex min-w-0 flex-1 flex-col items-center justify-end"
                                    key={item.field_name}
                                  >
                                    <div
                                      className="w-[74%] rounded-[4px_4px_0_0] transition-all duration-150 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_6px_14px_rgba(16,153,107,0.25)]"
                                      style={{
                                        height: `${Math.max(6, normalized * 1.35)}px`,
                                        backgroundColor: barColor,
                                      }}
                                    />
                                    <p className="mt-2 text-center text-[11px] text-[#606A74]">
                                      {item.field_name.replace(/_/g, " ")}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 border border-[#98DABB] bg-[#D2E9DE] p-4">
                    <p className="text-base font-semibold text-[#1C6447]">~ What AI Has Learned</p>
                    <ul className="mt-2 space-y-1 text-sm text-[#236A4B]">
                      {learningStats.insights.map((insight, index) => (
                        <li key={`${insight}-${index}`}>• {insight}</li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isTemplatePanelOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 md:p-6">
          <div className="kira-modal-open mx-auto my-2 w-full max-w-[1120px] border border-[#D1D5DB] dark:border-white/10 bg-[#F7F7F5] dark:bg-[#12141B] shadow-[0_30px_90px_rgba(6,6,6,0.24)]">
            <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[#D9DDDB] dark:border-white/10 bg-[#F7F7F5] dark:bg-[#12141B] px-7 py-5">
              <h3 className="font-sans text-4xl font-semibold leading-none md:text-5xl dark:text-white">
                Template Manager
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="kira-focus-ring border border-kira-warmgray/55 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray "
                  onClick={startNewTemplateDraft}
                >
                  New
                </button>
                <button
                  type="button"
                  className="kira-focus-ring border border-kira-warmgray/55 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray disabled:opacity-60"
                  disabled={!selectedTemplateId}
                  onClick={() => void handleSaveTemplate("existing")}
                >
                  {isTemplateSaving ? "Saving..." : "Save Existing"}
                </button>
                <button
                  type="button"
                  className="kira-focus-ring bg-kira-black dark:bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-offwhite dark:text-black disabled:opacity-60"
                  disabled={isTemplateSaving}
                  onClick={() => void handleSaveTemplate("new")}
                >
                  {isTemplateSaving ? "Saving..." : "Save As New"}
                </button>
                <button
                  type="button"
                  className="kira-focus-ring border border-kira-warmgray/55 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray "
                  onClick={() => void handleDeleteTemplate()}
                >
                  Delete
                </button>
                <button
                  type="button"
                  aria-label="Close template panel"
                  className="kira-focus-ring inline-flex h-9 w-9 items-center justify-center text-kira-midgray hover:text-kira-black "
                  onClick={() => setIsTemplatePanelOpen(false)}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-7 py-6">
              {templateNotice ? (
                <p className="mb-4 text-sm text-kira-darkgray ">{templateNotice}</p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                <aside className="border border-kira-warmgray/45 dark:border-white/10 bg-kira-offwhite dark:bg-[#1C1E26] ">
                  <div className="border-b border-kira-warmgray/35 dark:border-white/10 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-kira-midgray dark:text-gray-400">
                      Saved Templates
                    </p>
                  </div>
                  <div className="max-h-[56vh] space-y-1 overflow-y-auto p-2">
                    {catalogTemplates.length === 0 ? (
                      <p className="px-2 py-2 text-sm text-kira-midgray">No templates yet.</p>
                    ) : (
                      catalogTemplates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          className={cn(
                            "kira-focus-ring flex w-full items-center justify-between border px-2 py-2 text-left text-sm",
                            selectedTemplateId === template.id
                              ? "border-kira-black dark:border-white bg-white dark:bg-[#2A2D35] text-kira-black dark:text-white "
                              : "border-transparent text-kira-darkgray dark:text-gray-400 hover:border-kira-warmgray/45 hover:bg-white dark:hover:bg-[#2A2D35] ",
                          )}
                          onClick={() => setSelectedTemplateId(template.id)}
                        >
                          <span className="truncate pr-2">{template.name}</span>
                          {template.is_active ? (
                            <span className="text-[10px] uppercase tracking-[0.08em] text-[#1E7145]">
                              Active
                            </span>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                </aside>

                <div className="min-w-0 border border-kira-warmgray/45 dark:border-white/10 bg-kira-offwhite dark:bg-[#1C1E26] p-4">
                  <p className="mb-3 text-xs uppercase tracking-[0.08em] text-kira-midgray dark:text-gray-400">
                    {selectedTemplateId
                      ? `Editing: ${activeTemplate?.name ?? "Template"}`
                      : "Creating new template"}
                  </p>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Template Name
                      </label>
                      <input
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white dark:placeholder-gray-500 "
                        onChange={(event) => setTemplateName(event.target.value)}
                        value={templateName}
                      />
                    </div>
                    <div className="space-y-2 lg:col-span-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Description
                      </label>
                      <input
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white dark:placeholder-gray-500 "
                        onChange={(event) => setTemplateDescription(event.target.value)}
                        value={templateDescription}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Default Category
                      </label>
                      <select
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm dark:text-white dark:bg-[#1C1E26]"
                        onChange={(event) => setTemplateDefaultCategory(event.target.value)}
                        value={templateDefaultCategory}
                      >
                        {CATEGORY_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Default Style Name
                      </label>
                      <select
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm dark:text-white dark:bg-[#1C1E26]"
                        onChange={(event) => setTemplateDefaultStyleName(event.target.value)}
                        value={templateDefaultStyleName}
                      >
                        {STYLE_NAME_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Style Code Pattern
                      </label>
                      <input
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white dark:placeholder-gray-500 "
                        onChange={(event) => setTemplateStylePattern(event.target.value)}
                        placeholder="Leave empty for Auto (e.g. JINDS26001)"
                        value={templateStylePattern}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Default Color
                      </label>
                      <select
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm dark:text-white dark:bg-[#1C1E26]"
                        onChange={(event) => setTemplateDefaultColor(event.target.value)}
                        value={templateDefaultColor}
                      >
                        {COLOR_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Default Fabric
                      </label>
                      <select
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm dark:text-white dark:bg-[#1C1E26]"
                        onChange={(event) => setTemplateDefaultFabric(event.target.value)}
                        value={templateDefaultFabric}
                      >
                        {FABRIC_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Default Composition
                      </label>
                      <select
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm dark:text-white dark:bg-[#1C1E26]"
                        onChange={(event) => setTemplateDefaultComposition(event.target.value)}
                        value={templateDefaultComposition}
                      >
                        {COMPOSITION_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Allowed Colors (comma separated)
                      </label>
                      <input
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white dark:placeholder-gray-500 "
                        onChange={(event) => setTemplateAllowedColors(event.target.value)}
                        value={templateAllowedColors}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Allowed Fabrics (comma separated)
                      </label>
                      <input
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white dark:placeholder-gray-500 "
                        onChange={(event) => setTemplateAllowedFabrics(event.target.value)}
                        value={templateAllowedFabrics}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Allowed Categories (comma separated)
                      </label>
                      <input
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white dark:placeholder-gray-500 "
                        onChange={(event) => setTemplateAllowedCategories(event.target.value)}
                        value={templateAllowedCategories}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Allowed Style Names (comma separated)
                      </label>
                      <input
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white dark:placeholder-gray-500 "
                        onChange={(event) => setTemplateAllowedStyleNames(event.target.value)}
                        value={templateAllowedStyleNames}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Allowed Compositions (comma separated)
                      </label>
                      <input
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white dark:placeholder-gray-500 "
                        onChange={(event) => setTemplateAllowedCompositions(event.target.value)}
                        value={templateAllowedCompositions}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-kira-midgray">
                        Allowed Woven / Knits (comma separated)
                      </label>
                      <input
                        className="kira-focus-ring w-full border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white dark:placeholder-gray-500 "
                        onChange={(event) => setTemplateAllowedWovenKnits(event.target.value)}
                        value={templateAllowedWovenKnits}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isBulkUploadOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="kira-modal-open w-full max-w-[850px] border border-kira-warmgray/50 dark:border-white/10 bg-[#FAFAFA] dark:bg-[#12141B] shadow-2xl transition-all duration-300">
            <div className="flex items-center justify-between border-b border-kira-warmgray/50 dark:border-white/10 px-6 py-5">
              <h2 className="font-sans text-[28px] font-semibold text-kira-black dark:text-white tracking-tight">
                Bulk Upload
              </h2>
              <button
                className="kira-focus-ring inline-flex h-9 w-9 items-center justify-center text-kira-midgray hover:text-kira-black transition-colors"
                onClick={() => setIsBulkUploadOpen(false)}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>

            {uploadItems.length === 0 ? (
              <div className="p-8">
                <input
                  accept=".jpg,.jpeg,.png,.webp"
                  className="hidden"
                  multiple
                  onChange={handleBulkFileInput}
                  ref={fileInputRef}
                  type="file"
                />

                <div
                  className={cn(
                    "cursor-pointer border-[1.5px] border-dashed py-24 text-center transition-all duration-200 flex flex-col items-center justify-center",
                    isDropActive
                      ? "border-kira-brown bg-kira-brown/5 dark:border-kira-brown/50 dark:bg-kira-brown/20"
                      : "border-[#D9D9D9] dark:border-white/20 hover:border-kira-midgray hover:bg-black/[0.02] dark:hover:bg-white/5",
                  )}
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setIsDropActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDropActive(false);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDropActive(true);
                  }}
                  onDrop={handleBulkDrop}
                >
                  <div className="w-14 h-14 mb-4 flex items-center justify-center text-[#9CA3AF]">
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                  <p className="text-[#111827] dark:text-gray-200 font-medium text-[15px] mb-1">
                    Drag & drop multiple images
                  </p>
                  <p className="text-[#6B7280] dark:text-gray-400 text-[13px]">
                    or click to select • PNG, JPG up to 10MB each
                  </p>
                </div>

                {uploadMessage ? (
                  <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 text-center">
                    {uploadMessage}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col h-[65vh]">
                <div className="flex-1 overflow-y-auto px-6 py-6 border-b border-kira-warmgray/50 ">
                  {/* Common Settings Box */}
                  <div className="border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#1C1E26] mb-8">
                    <div className="px-5 py-3.5 border-b border-[#E5E7EB] dark:border-white/10 flex items-center gap-2">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="text-[#6B7280] dark:text-gray-400"
                      >
                        <path
                          d="M12 2L2 7l10 5 10-5-10-5zm0 13.5l-10-5v3.5l10 5 10-5v-3.5l-10 5z"
                          fill="currentColor"
                        />
                      </svg>
                      <span className="text-xs font-semibold tracking-wider text-[#6B7280] dark:text-gray-400">
                        COMMON SETTINGS (APPLIED TO ALL ITEMS)
                      </span>
                    </div>

                    <div className="px-5 py-6 flex gap-12">
                      <div className="flex gap-8">
                        <div>
                          <span className="text-[11px] text-[#9CA3AF] mr-3">Composition</span>
                          <select
                            className="bg-transparent text-sm text-[#111827] dark:text-white border-b border-[#E5E7EB] dark:border-white/10 pb-2 outline-none w-36 cursor-pointer dark:bg-[#12141B]"
                            value={bulkComposition}
                            onChange={(e) => setBulkComposition(e.target.value)}
                          >
                            <option>100% Polyester</option>
                            <option>100% Cotton</option>
                          </select>
                        </div>
                        <div>
                          <span className="text-[11px] text-[#9CA3AF] mr-3">Woven/Knits</span>
                          <select
                            className="bg-transparent text-sm text-[#111827] dark:text-white border-b border-[#E5E7EB] dark:border-white/10 pb-2 outline-none w-24 cursor-pointer dark:bg-[#12141B]"
                            value={bulkWovenKnits}
                            onChange={(e) => setBulkWovenKnits(e.target.value)}
                          >
                            <option>Woven</option>
                            <option>Knits</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex gap-10 border-l border-[#E5E7EB] pl-10">
                        <div>
                          <span className="text-[11px] text-[#9CA3AF] block mb-2">PO Price</span>
                          <input
                            type="text"
                            value={bulkPoPrice}
                            onChange={(e) => setBulkPoPrice(e.target.value)}
                            className="bg-transparent text-sm text-[#111827] dark:text-white border-b border-[#E5E7EB] dark:border-white/10 pb-2 outline-none w-24"
                          />
                        </div>
                        <div>
                          <span className="text-[11px] text-[#9CA3AF] block mb-2">OSPs SAR</span>
                          <input
                            type="text"
                            value={bulkOspSar}
                            onChange={(e) => setBulkOspSar(e.target.value)}
                            className="bg-transparent text-sm text-[#111827] dark:text-white border-b border-[#E5E7EB] dark:border-white/10 pb-2 outline-none w-24"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-[15px] text-[#6B7280]">
                      {uploadItems.length} images selected
                    </h3>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-kira-black"
                          checked={bulkAnalyzeAllEnabled}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setBulkAnalyzeAllEnabled(checked);
                            setUploadItems((items) =>
                              items.map((item) => ({ ...item, analyzeWithAi: checked })),
                            );
                          }}
                        />
                        Analyze all with AI
                      </label>
                      <button
                        className="bg-[#D4AF37] hover:bg-[#B8962A] text-white px-5 py-2.5 text-xs font-bold tracking-wider rounded-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                        onClick={() => void handleAnalyzeAll()}
                        disabled={isBulkAnalyzing || uploadItems.length === 0}
                      >
                        {isBulkAnalyzing ? (
                          <i className="ri-loader-4-line text-sm animate-spin"></i>
                        ) : (
                          <i className="ri-brain-line text-sm"></i>
                        )}
                        {isBulkAnalyzing ? "ANALYZING..." : "RUN AI FOR SELECTED"}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-[2px] bg-[#E5E7EB] dark:bg-black/40 border border-[#E5E7EB] dark:border-white/10">
                    {uploadItems.map((item) => (
                      <div
                        key={item.id}
                        className="bg-white dark:bg-[#1C1E26] p-4 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-6">
                          <div className="w-[100px] h-[100px] bg-[#E5E7EB] dark:bg-black/30 flex items-center justify-center text-[#9CA3AF] overflow-hidden">
                            {item.previewUrl ? (
                              <img
                                src={item.previewUrl}
                                alt={item.name}
                                className="w-full h-full object-cover"
                                height={100}
                                loading="lazy"
                                width={100}
                              />
                            ) : (
                              <i className="ri-image-line text-2xl"></i>
                            )}
                          </div>
                          <span className="font-medium text-[#111827] dark:text-gray-200 text-[15px]">
                            {item.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-6">
                          <div className="flex flex-col items-center gap-1 text-[#6B7280]">
                            {item.status === "queued" ? (
                              <>
                                <i className="ri-time-line text-base"></i>
                                <span className="text-xs">In queue</span>
                              </>
                            ) : item.status === "uploading" ? (
                              <>
                                <i className="ri-loader-4-line text-base animate-spin text-kira-brown"></i>
                                <span className="text-xs text-kira-brown">{item.progress}%</span>
                              </>
                            ) : item.status === "completed_local" ? (
                              <>
                                <i className="ri-checkbox-circle-line text-base text-[#64748B]"></i>
                                <span className="text-xs text-[#64748B]">
                                  {item.analysis?.mode === "manual" ? "Manual" : "Ready"}
                                </span>
                              </>
                            ) : (
                              <>
                                <i className="ri-check-line text-base text-[#1E7145]"></i>
                                <span className="text-xs text-[#1E7145]">Done</span>
                              </>
                            )}
                          </div>
                          <div className="flex min-w-[220px] flex-col items-end gap-2">
                            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-kira-black"
                                checked={item.analyzeWithAi ?? true}
                                onChange={() => toggleUploadAnalyzeWithAi(item.id)}
                              />
                              Analyze with AI
                            </label>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="border border-[#D1D5DB] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#111827] transition-colors hover:bg-[#F3F4F6] disabled:opacity-50 dark:border-white/10 dark:text-white dark:hover:bg-[#2A2D35]"
                                onClick={() => void handleManualReviewItem(item.id)}
                                disabled={item.status === "queued" || item.status === "uploading"}
                              >
                                Edit manually
                              </button>
                              <button
                                type="button"
                                className="bg-[#111827] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-black disabled:opacity-50"
                                onClick={() => void handleAnalyzeItemWithAi(item.id)}
                                disabled={
                                  isBulkAnalyzing ||
                                  item.status === "queued" ||
                                  item.status === "uploading" ||
                                  item.analyzeWithAi === false
                                }
                              >
                                Analyze now
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 px-6 py-5 bg-white dark:bg-[#12141B] border-t border-[#E5E7EB] dark:border-white/10">
                  <button
                    className="border border-[#D1D5DB] dark:border-white/10 bg-white dark:bg-[#1C1E26] px-8 py-3 text-xs font-bold tracking-widest text-[#111827] dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#2A2D35] transition-colors"
                    onClick={() => setIsBulkUploadOpen(false)}
                    type="button"
                  >
                    CANCEL
                  </button>
                  <button
                    className="bg-[#111827] hover:bg-black text-white px-8 py-3 text-xs font-bold tracking-widest flex items-center gap-2 transition-colors disabled:opacity-50"
                    disabled={isBulkAnalyzing || isUploadProcessing || uploadItems.length === 0}
                    onClick={() => void handleSaveAllToCatalog()}
                    type="button"
                  >
                    <i className="ri-add-line text-sm leading-none"></i>
                    REVIEW & SAVE
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {isBulkReviewOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-[1220px] border border-kira-warmgray/55 dark:border-white/10 bg-kira-offwhite dark:bg-[#12141B] shadow-2xl">
            <div className="flex items-center justify-between border-b border-kira-warmgray/45 dark:border-white/10 px-6 py-4">
              <div>
                <h3 className="text-xl font-semibold text-kira-black dark:text-white ">
                  Batch Review
                </h3>
                <p className="text-sm text-kira-midgray dark:text-gray-400">
                  Verify AI or manual details before catalog save.
                </p>
              </div>
              <button
                type="button"
                className="kira-focus-ring inline-flex h-8 w-8 items-center justify-center text-kira-midgray hover:text-kira-black "
                onClick={() => setIsBulkReviewOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="border-b border-kira-warmgray/35 px-6 py-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="border border-kira-warmgray/40 dark:border-white/10 bg-white dark:bg-[#1C1E26] px-3 py-2 text-xs text-kira-darkgray dark:text-gray-300 ">
                  Prepared:{" "}
                  <span className="font-semibold text-kira-black dark:text-white ">
                    {bulkReviewStats.prepared}
                  </span>
                </div>
                <div className="border border-kira-warmgray/40 dark:border-white/10 bg-white dark:bg-[#1C1E26] px-3 py-2 text-xs text-kira-darkgray dark:text-gray-300 ">
                  Ready:{" "}
                  <span className="font-semibold text-[#1E7145]">{bulkReviewStats.ready}</span>
                </div>
                <div className="border border-kira-warmgray/40 dark:border-white/10 bg-white dark:bg-[#1C1E26] px-3 py-2 text-xs text-kira-darkgray dark:text-gray-300 ">
                  Needs Review:{" "}
                  <span className="font-semibold text-[#B45309]">
                    {bulkReviewStats.needsReview}
                  </span>
                </div>
                <div className="border border-kira-warmgray/40 dark:border-white/10 bg-white dark:bg-[#1C1E26] px-3 py-2 text-xs text-kira-darkgray dark:text-gray-300 ">
                  Approved:{" "}
                  <span className="font-semibold text-kira-black dark:text-white ">
                    {bulkReviewStats.approved}
                  </span>
                </div>
                <div className="border border-kira-warmgray/40 dark:border-white/10 bg-white dark:bg-[#1C1E26] px-3 py-2 text-xs text-kira-darkgray dark:text-gray-300 ">
                  Failed:{" "}
                  <span className="font-semibold text-rose-700">{bulkReviewStats.failed}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {uploadMessage ? (
                  <div className="w-full rounded-md border border-kira-warmgray/45 bg-white px-3 py-2 text-sm text-kira-darkgray dark:border-white/10 dark:bg-[#1C1E26] dark:text-gray-300">
                    {uploadMessage}
                  </div>
                ) : null}
                <input
                  type="search"
                  className="kira-focus-ring min-w-[220px] flex-1 border border-kira-warmgray/55 dark:border-white/20 bg-white dark:bg-[#1C1E26] px-3 py-2 text-sm text-kira-black dark:text-white dark:placeholder-gray-500 "
                  placeholder="Search file/style/category..."
                  value={bulkReviewQuery}
                  onChange={(event) => setBulkReviewQuery(event.target.value)}
                />
                <select
                  className="kira-focus-ring border border-kira-warmgray/55 dark:border-white/20 bg-white dark:bg-[#1C1E26] px-3 py-2 text-sm text-kira-darkgray dark:text-white "
                  value={bulkReviewFilter}
                  onChange={(event) =>
                    setBulkReviewFilter(
                      event.target.value as
                        | "all"
                        | "ready"
                        | "needs_review"
                        | "approved"
                        | "failed",
                    )
                  }
                >
                  <option value="all">All</option>
                  <option value="ready">Ready</option>
                  <option value="needs_review">Needs Review</option>
                  <option value="approved">Approved</option>
                  <option value="failed">Failed</option>
                </select>
                <button
                  type="button"
                  className="kira-focus-ring border border-kira-warmgray/55 px-3 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray "
                  onClick={approveAllReadyUploads}
                >
                  Approve All Ready
                </button>
              </div>
            </div>

            <div className="max-h-[62vh] overflow-auto px-6 py-4">
              <table className="min-w-full border border-kira-warmgray/45 dark:border-white/10 bg-white dark:bg-[#1C1E26] text-sm">
                <thead className="sticky top-0 z-10 bg-kira-offwhite dark:bg-[#2A2D35] text-[11px] uppercase tracking-[0.06em] text-kira-midgray dark:text-gray-400">
                  <tr>
                    <th className="px-2 py-2 text-left">Image</th>
                    <th className="px-2 py-2 text-left">Style No</th>
                    <th className="px-2 py-2 text-left">Style Name</th>
                    <th className="px-2 py-2 text-left">Category</th>
                    <th className="px-2 py-2 text-left">Color</th>
                    <th className="px-2 py-2 text-left">Fabric</th>
                    <th className="px-2 py-2 text-left">Units</th>
                    <th className="px-2 py-2 text-left">OSP</th>
                    <th className="px-2 py-2 text-left">Confidence</th>
                    <th className="px-2 py-2 text-left">Source</th>
                    <th className="px-2 py-2 text-left">Approve</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkReviewRows.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-kira-warmgray/35 dark:border-white/10 "
                    >
                      <td className="px-2 py-2">
                        <div className="h-12 w-12 overflow-hidden border border-kira-warmgray/45 dark:border-white/10 bg-kira-offwhite dark:bg-black/40 ">
                          {item.previewUrl ? (
                            <img
                              src={item.previewUrl}
                              alt={item.name}
                              className="h-full w-full object-cover"
                              height={48}
                              loading="lazy"
                              width={48}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {item.analysis ? (
                          <input
                            className="kira-focus-ring w-36 border border-kira-warmgray/45 dark:border-white/20 px-2 py-1 text-xs dark:bg-[#12141B] dark:text-white"
                            value={item.analysis.styleNo}
                            onChange={(event) =>
                              updateUploadAnalysisField(
                                item.id,
                                "styleNo",
                                event.target.value.toUpperCase(),
                              )
                            }
                          />
                        ) : (
                          <span className="text-xs text-kira-midgray">{item.error ?? "--"}</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {item.analysis ? (
                          <select
                            className="kira-focus-ring w-40 border border-kira-warmgray/45 dark:border-white/20 px-2 py-1 text-xs dark:bg-[#12141B] dark:text-white"
                            value={item.analysis.styleName}
                            onChange={(event) =>
                              updateUploadAnalysisField(item.id, "styleName", event.target.value)
                            }
                          >
                            {withCurrentOption(
                              templateStyleNameOptions,
                              item.analysis.styleName,
                            ).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {item.analysis ? (
                          <select
                            className="kira-focus-ring w-28 border border-kira-warmgray/45 dark:border-white/20 px-2 py-1 text-xs dark:bg-[#12141B] dark:text-white"
                            value={item.analysis.category}
                            onChange={(event) =>
                              updateUploadAnalysisField(item.id, "category", event.target.value)
                            }
                          >
                            {withCurrentOption(templateCategoryOptions, item.analysis.category).map(
                              (option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ),
                            )}
                          </select>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {item.analysis ? (
                          <select
                            className="kira-focus-ring w-28 border border-kira-warmgray/45 dark:border-white/20 px-2 py-1 text-xs dark:bg-[#12141B] dark:text-white"
                            value={item.analysis.color}
                            onChange={(event) =>
                              updateUploadAnalysisField(item.id, "color", event.target.value)
                            }
                          >
                            {withCurrentOption(templateColorOptions, item.analysis.color).map(
                              (option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ),
                            )}
                          </select>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {item.analysis ? (
                          <select
                            className="kira-focus-ring w-36 border border-kira-warmgray/45 dark:border-white/20 px-2 py-1 text-xs dark:bg-[#12141B] dark:text-white"
                            value={item.analysis.fabric}
                            onChange={(event) =>
                              updateUploadAnalysisField(item.id, "fabric", event.target.value)
                            }
                          >
                            {withCurrentOption(templateFabricOptions, item.analysis.fabric).map(
                              (option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ),
                            )}
                          </select>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {item.analysis ? (
                          <select
                            className="kira-focus-ring w-14 border border-kira-warmgray/45 dark:border-white/20 px-2 py-1 text-xs dark:bg-[#12141B] dark:text-white"
                            value={item.analysis.units}
                            onChange={(event) =>
                              updateUploadAnalysisField(item.id, "units", event.target.value)
                            }
                          >
                            {withCurrentOption([...TOTAL_UNITS_OPTIONS], item.analysis.units).map(
                              (option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ),
                            )}
                          </select>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {item.analysis ? (
                          <input
                            className="kira-focus-ring w-16 border border-kira-warmgray/45 dark:border-white/20 px-2 py-1 text-xs dark:bg-[#12141B] dark:text-white"
                            value={item.analysis.ospSar}
                            onChange={(event) =>
                              updateUploadAnalysisField(
                                item.id,
                                "ospSar",
                                event.target.value.replace(/[^0-9.]/g, ""),
                              )
                            }
                          />
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {item.analysis ? (
                          item.analysis.mode === "manual" ? (
                            <span className="inline-flex rounded-sm border border-[#CBD5E1] bg-[#F8FAFC] px-2 py-1 text-xs font-semibold text-[#475569]">
                              Manual
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "inline-flex rounded-sm border px-2 py-1 text-xs font-semibold",
                                item.analysis.confidence >= 85
                                  ? "border-[#9EDAB7] bg-[#DDF4E7] text-[#1E7145]"
                                  : item.analysis.confidence >= 60
                                    ? "border-[#E6D7A7] bg-[#FAF2D8] text-[#7A641A]"
                                    : "border-[#E4BABA] bg-[#FCE7E7] text-[#9F3A3A]",
                              )}
                            >
                              {item.analysis.confidence}%
                            </span>
                          )
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {item.analysis ? (
                          <span className="text-xs font-medium uppercase tracking-[0.06em] text-kira-midgray dark:text-gray-400">
                            {item.analysis.mode === "ai" ? "AI" : "Manual"}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {item.analysis ? (
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-kira-black"
                            checked={Boolean(item.approved)}
                            onChange={() => toggleUploadApproval(item.id)}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {bulkReviewRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-sm text-kira-midgray" colSpan={11}>
                        No items match current review filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 border-t border-kira-warmgray/35 dark:border-white/10 px-6 py-4">
              <button
                type="button"
                className="kira-focus-ring border border-kira-warmgray/55 dark:border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray dark:text-gray-300 "
                onClick={() => setIsBulkReviewOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="kira-focus-ring border border-kira-warmgray/55 dark:border-white/10 bg-white dark:bg-[#1C1E26] px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray dark:text-gray-300 disabled:opacity-60"
                disabled={isSavingReviewedItems}
                onClick={() => void handleSaveReviewedItems(true)}
              >
                {isSavingReviewedItems ? "Saving..." : "Save Approved"}
              </button>
              <button
                type="button"
                className="kira-focus-ring bg-kira-black dark:bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-kira-offwhite dark:text-black disabled:opacity-60"
                disabled={isSavingReviewedItems}
                onClick={() => void handleSaveReviewedItems(false)}
              >
                {isSavingReviewedItems ? "Saving..." : "Save All"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isFindReplaceOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg border border-kira-warmgray/55 dark:border-white/10 bg-kira-offwhite dark:bg-[#12141B] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-kira-black dark:text-white ">
                Batch Find & Replace
              </h3>
              <button
                type="button"
                className="kira-focus-ring inline-flex h-8 w-8 items-center justify-center text-kira-midgray dark:text-gray-400 hover:text-kira-black dark:hover:text-white "
                onClick={() => setIsFindReplaceOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <p className="mt-2 text-sm text-kira-midgray dark:text-gray-400">
              Apply text replacement across selected rows.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <select
                className="kira-focus-ring border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-darkgray dark:text-gray-200 dark:bg-[#1C1E26] "
                onChange={(event) =>
                  setFindReplaceField(event.target.value as BatchFindReplaceField)
                }
                value={findReplaceField}
              >
                {Object.entries(BATCH_FIND_REPLACE_FIELD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                className="kira-focus-ring border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white "
                onChange={(event) => setFindReplaceQuery(event.target.value)}
                placeholder="Find text"
                value={findReplaceQuery}
              />
              <input
                className="kira-focus-ring border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white "
                onChange={(event) => setFindReplaceReplacement(event.target.value)}
                placeholder="Replace with"
                value={findReplaceReplacement}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="kira-focus-ring border border-kira-warmgray/55 dark:border-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray dark:text-gray-300 hover:bg-white/5 "
                onClick={() => setIsFindReplaceOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="kira-focus-ring bg-kira-black dark:bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-offwhite dark:text-black"
                onClick={() => void handleApplyFindReplace()}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isPriceAdjustOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg border border-kira-warmgray/55 dark:border-white/10 bg-kira-offwhite dark:bg-[#12141B] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-kira-black dark:text-white ">
                Batch Price Adjustment
              </h3>
              <button
                type="button"
                className="kira-focus-ring inline-flex h-8 w-8 items-center justify-center text-kira-midgray dark:text-gray-400 hover:text-kira-black dark:hover:text-white "
                onClick={() => setIsPriceAdjustOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <p className="mt-2 text-sm text-kira-midgray dark:text-gray-400">
              Adjust selected prices in one step.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <select
                className="kira-focus-ring border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-darkgray dark:text-gray-200 dark:bg-[#1C1E26] "
                onChange={(event) => setPriceAdjustMode(event.target.value as PriceAdjustMode)}
                value={priceAdjustMode}
              >
                <option value="percent_up">Increase by %</option>
                <option value="percent_down">Decrease by %</option>
                <option value="add_fixed">Add fixed amount</option>
                <option value="set_exact">Set exact price</option>
              </select>
              <input
                className="kira-focus-ring border border-kira-warmgray/55 dark:border-white/20 bg-transparent px-3 py-2 text-sm text-kira-black dark:text-white "
                onChange={(event) => setPriceAdjustValue(event.target.value)}
                placeholder="Value"
                value={priceAdjustValue}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="kira-focus-ring border border-kira-warmgray/55 dark:border-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray dark:text-gray-300 hover:bg-white/5 "
                onClick={() => setIsPriceAdjustOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="kira-focus-ring bg-kira-black dark:bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-kira-offwhite dark:text-black"
                onClick={() => void handleApplyPriceAdjustment()}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddModalOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 md:p-6">
          <div className="kira-modal-open mx-auto my-2 w-full max-w-[1120px] border border-[#D1D5DB] dark:border-white/10 bg-[#F7F7F5] dark:bg-[#12141B] shadow-[0_30px_90px_rgba(6,6,6,0.24)] transition-all duration-300">
            <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[#D9DDDB] dark:border-white/10 bg-[#F7F7F5] dark:bg-[#12141B] px-7 py-5">
              <div className="flex items-center gap-4">
                <h2 className="font-sans text-4xl font-semibold leading-none md:text-5xl dark:text-white">
                  {isEditMode ? "Edit Item" : "Add New Item"}
                </h2>
              </div>
              <div className="flex items-center gap-5">
                <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-[#6D7772] dark:text-gray-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-[#A1A7A4] dark:border-white/20 accent-[#1E7145]"
                    checked={rememberLastValues}
                    onChange={(e) => {
                      setRememberLastValues(e.target.checked);
                      localStorage.setItem("kira_remember_last_values", String(e.target.checked));
                    }}
                  />
                  Remember Values
                </label>
                <button
                  className="kira-focus-ring inline-flex h-9 w-9 items-center justify-center text-[#7B8086] dark:text-gray-400 hover:text-kira-black dark:hover:text-white "
                  onClick={closeAddModal}
                  type="button"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <form className="flex max-h-[calc(100vh-5rem)] flex-col" onSubmit={handleSaveNewItem}>
              <div className="flex-1 overflow-y-auto px-7 py-7">
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <input
                      accept=".png,.jpg,.jpeg,.webp"
                      className="hidden"
                      onChange={handleAddItemImageInput}
                      ref={addItemImageInputRef}
                      type="file"
                    />

                    {imagePreviewUrl ? (
                      <>
                        <div
                          className="relative w-full aspect-[3/4] cursor-pointer overflow-hidden border border-[#D3D7D4] dark:border-white/10 bg-[#ECEFEE] dark:bg-[#1C1E26]"
                          onClick={() => addItemImageInputRef.current?.click()}
                        >
                          <img
                            src={getImageUrl(imagePreviewUrl) ?? ""}
                            alt="Preview"
                            className="absolute inset-0 h-full w-full object-cover"
                            loading="lazy"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              resetImageLabelTracking();
                              setImagePreviewUrl(null);
                              selectedImageFileRef.current = null;
                              setItemImageName("");
                              setAnalysisStage(null);
                              setAiSuggestions(null);
                              setIsAiSuggestionsVisible(false);
                              setFeedbackCompletedFields({});
                              setOverallConfidence(null);
                              setFieldConfidence({});
                              setFieldContext({});
                              setLastAnalyzedImageHash(null);
                              if (addItemImageInputRef.current) {
                                addItemImageInputRef.current.value = "";
                              }
                            }}
                            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center border border-[#CFD3D1] dark:border-white/10 bg-white dark:bg-[#12141B] text-kira-black dark:text-white hover:bg-white dark:hover:bg-[#1C1E26] "
                          >
                            <CloseIcon />
                          </button>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAnalyzeImage();
                            }}
                            disabled={isAnalyzing}
                            className={cn(
                              "flex-1 flex items-center justify-center gap-2 rounded-none border border-[#D0AE3B] bg-[#D0AE3B] py-3 text-sm font-semibold uppercase tracking-[0.08em] text-white hover:bg-[#BA9A2E]",
                              isAnalyzing && "opacity-70 cursor-not-allowed",
                            )}
                          >
                            {isAnalyzing ? (
                              <>
                                <svg
                                  className="h-4 w-4 animate-spin text-white"
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                >
                                  <circle
                                    className="opacity-30"
                                    cx="12"
                                    cy="12"
                                    r="9"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                  ></circle>
                                  <path
                                    className="opacity-90"
                                    fill="currentColor"
                                    d="M12 3a9 9 0 0 1 9 9h-2.6a6.4 6.4 0 0 0-6.4-6.4V3Z"
                                  ></path>
                                </svg>
                                AI ANALYZING...
                              </>
                            ) : (
                              <>
                                <svg
                                  aria-hidden="true"
                                  className="h-4 w-4"
                                  fill="none"
                                  viewBox="0 0 20 20"
                                >
                                  <circle
                                    cx="10"
                                    cy="10"
                                    r="4.6"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                  />
                                  <path
                                    d="M10 3V6M10 14V17M3 10H6M14 10H17"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeWidth="1.5"
                                  />
                                </svg>
                                ANALYZE WITH AI
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              resetImageLabelTracking();
                              setImagePreviewUrl(null);
                              selectedImageFileRef.current = null;
                              setItemImageName("");
                              setAnalysisStage(null);
                              setAiSuggestions(null);
                              setIsAiSuggestionsVisible(false);
                              setFeedbackCompletedFields({});
                              setOverallConfidence(null);
                              setFieldConfidence({});
                              setFieldContext({});
                              setLastAnalyzedImageHash(null);
                              if (addItemImageInputRef.current) {
                                addItemImageInputRef.current.value = "";
                              }
                            }}
                            className="flex h-11 w-11 items-center justify-center border border-[#C6CBC9] dark:border-white/10 bg-[#F2F3F2] dark:bg-[#12141B] text-[#4B5563] dark:text-gray-300 hover:bg-white dark:hover:bg-[#1C1E26] "
                            title="Clear image"
                          >
                            <svg
                              aria-hidden="true"
                              className="h-4 w-4"
                              fill="none"
                              viewBox="0 0 20 20"
                            >
                              <path
                                d="M6 6L14 14M14 6L6 14"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeWidth="1.8"
                              />
                            </svg>
                          </button>
                        </div>

                        {!isAnalyzing ? (
                          <p className="text-xs text-kira-midgray">
                            AI analysis is manual. Click{" "}
                            <span className="font-semibold text-kira-black dark:text-white ">
                              ANALYZE WITH AI
                            </span>{" "}
                            after uploading.
                          </p>
                        ) : null}

                        {isAnalyzing ? (
                          <div className="mt-4 border border-[#A7D2F5] bg-[#E8F3FC] px-4 py-4">
                            <div className="mb-2 flex items-center gap-2 text-[#1871B8]">
                              <svg
                                aria-hidden="true"
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  d="M10 2.8L11.9 6.6L16.1 7.4L13 10.4L13.7 14.6L10 12.6L6.3 14.6L7 10.4L3.9 7.4L8.1 6.6L10 2.8Z"
                                  stroke="currentColor"
                                  strokeWidth="1.3"
                                />
                              </svg>
                              <span className="text-[28px] leading-none">AI Processing</span>
                            </div>
                            <p className="text-sm text-[#2D80C4]">
                              {analysisStage ??
                                "Analyzing image features, detecting color, style, and fabric..."}
                            </p>
                          </div>
                        ) : null}
                        {itemImageError ? (
                          <p className="text-sm text-rose-700">{itemImageError}</p>
                        ) : null}

                        {!isAnalyzing && isAiSuggestionsVisible && aiSuggestions && (
                          <div className="relative mt-4 border border-[#8FD0AA] bg-[#DDEDE3] px-4 py-4 text-kira-black ">
                            <div className="mb-3 flex items-center justify-between">
                              <div className="flex items-center gap-2 font-semibold text-[#1E7145]">
                                <svg
                                  aria-hidden="true"
                                  className="h-4 w-4"
                                  fill="none"
                                  viewBox="0 0 16 16"
                                >
                                  <path
                                    d="M8 1.5L9.9 5.3L14 6.1L11 9L11.7 13.1L8 11.1L4.3 13.1L5 9L2 6.1L6.1 5.3L8 1.5Z"
                                    stroke="currentColor"
                                    strokeWidth="1.2"
                                  />
                                </svg>
                                <span className="text-[24px] leading-none">AI Suggestions</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleAcceptAllAI()}
                                className="kira-focus-ring bg-[#219653] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1A7A43]"
                              >
                                Accept All
                              </button>
                            </div>

                            <div className="space-y-0.5">
                              <AiSuggestionRow
                                fieldKey="color"
                                label="Color"
                                value={aiSuggestions.values.color}
                                confidence={aiSuggestions.confidence.color}
                                onFeedback={handleSuggestionFeedback}
                                isSubmitting={isFeedbackSubmitting}
                                isFeedbackLocked={Boolean(feedbackCompletedFields.color)}
                              />
                              <AiSuggestionRow
                                fieldKey="category"
                                label="Category"
                                value={aiSuggestions.values.category}
                                confidence={aiSuggestions.confidence.category}
                                onFeedback={handleSuggestionFeedback}
                                isSubmitting={isFeedbackSubmitting}
                                isFeedbackLocked={Boolean(feedbackCompletedFields.category)}
                              />
                              <AiSuggestionRow
                                fieldKey="styleName"
                                label="Style Name"
                                value={aiSuggestions.values.styleName}
                                confidence={aiSuggestions.confidence.styleName}
                                onFeedback={handleSuggestionFeedback}
                                isSubmitting={isFeedbackSubmitting}
                                isFeedbackLocked={Boolean(feedbackCompletedFields.styleName)}
                              />
                              <AiSuggestionRow
                                fieldKey="fabric"
                                label="Fabric"
                                value={aiSuggestions.values.fabric}
                                confidence={aiSuggestions.confidence.fabric}
                                onFeedback={handleSuggestionFeedback}
                                isSubmitting={isFeedbackSubmitting}
                                isFeedbackLocked={Boolean(feedbackCompletedFields.fabric)}
                              />
                              <AiSuggestionRow
                                fieldKey="composition"
                                label="Composition"
                                value={aiSuggestions.values.composition}
                                confidence={aiSuggestions.confidence.composition}
                                onFeedback={handleSuggestionFeedback}
                                isSubmitting={isFeedbackSubmitting}
                                isFeedbackLocked={Boolean(feedbackCompletedFields.composition)}
                              />
                              <AiSuggestionRow
                                fieldKey="wovenKnits"
                                label="Woven / Knits"
                                value={aiSuggestions.values.wovenKnits}
                                confidence={aiSuggestions.confidence.wovenKnits}
                                onFeedback={handleSuggestionFeedback}
                                isSubmitting={isFeedbackSubmitting}
                                isFeedbackLocked={Boolean(feedbackCompletedFields.wovenKnits)}
                              />
                            </div>

                            <div className="mt-3 border-t border-[#96CDB0] pt-3">
                              <div className="flex items-center justify-between">
                                <p className="text-[18px] text-[#2F6152]">Overall Confidence</p>
                                <span className="text-[30px] font-bold leading-none text-[#1E7145]">
                                  {overallConfidence ?? "--"}%
                                </span>
                              </div>
                            </div>

                            <details className="mt-3 border border-[#B5D7C3] bg-white px-3 py-2">
                              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4A5D52]">
                                Advanced Actions
                              </summary>
                              <div className="mt-2 space-y-2">
                                <button
                                  type="button"
                                  className="kira-focus-ring w-full border border-kira-warmgray/55 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-kira-darkgray hover:bg-kira-warmgray/20 "
                                  onClick={applySeasonalDefaults}
                                >
                                  Apply {seasonalRecommendation.season} defaults
                                </button>
                                {lowConfidenceFields.length > 0 && similarItems.length > 0 ? (
                                  <div className="space-y-2">
                                    {similarItems.map((item) => (
                                      <div
                                        className="flex items-center justify-between border border-[#E5E7EB] px-2 py-2"
                                        key={item.id}
                                      >
                                        <div className="text-xs text-kira-darkgray ">
                                          <p className="font-semibold">{item.styleNo}</p>
                                          <p>
                                            {item.color} • {item.fabric} • {item.composition}
                                          </p>
                                        </div>
                                        <button
                                          type="button"
                                          className="kira-focus-ring border border-kira-warmgray/55 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-kira-darkgray hover:bg-kira-warmgray/20 "
                                          onClick={() => applySimilarItemDefaults(item)}
                                        >
                                          Inherit
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          </div>
                        )}
                      </>
                    ) : (
                      <div
                        className={cn(
                          "flex min-h-[300px] cursor-pointer flex-col items-center justify-center border-2 border-dashed p-4 text-center",
                          isItemDropActive
                            ? "border-kira-brown bg-kira-brown/10 dark:border-kira-brown/50 dark:bg-kira-brown/20"
                            : "border-kira-warmgray/60 dark:border-white/10 bg-kira-offwhite dark:bg-[#1C1E26]",
                        )}
                        onClick={() => addItemImageInputRef.current?.click()}
                        onDragEnter={(event) => {
                          event.preventDefault();
                          setIsItemDropActive(true);
                        }}
                        onDragLeave={(event) => {
                          event.preventDefault();
                          setIsItemDropActive(false);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setIsItemDropActive(true);
                        }}
                        onDrop={handleAddItemDrop}
                      >
                        <span className="text-kira-black dark:text-gray-300">
                          <UploadIcon />
                        </span>
                        <p className="mt-4 text-xl font-semibold text-kira-black dark:text-white ">
                          Click to upload{" "}
                          <span className="font-normal text-kira-midgray dark:text-gray-400">
                            or drag and drop
                          </span>
                        </p>
                        <p className="mt-2 text-base text-kira-midgray dark:text-gray-400">
                          PNG, JPG up to 10MB
                        </p>
                        {itemImageError ? (
                          <p className="mt-2 text-sm text-rose-700">{itemImageError}</p>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2">
                    <div className="col-span-1 md:col-span-2 space-y-2 border-b border-kira-warmgray/30 pb-5">
                      <div className="flex items-center justify-between">
                        <FieldLabel>Style No</FieldLabel>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!itemCategory) {
                              setAddItemError("Please select a Category first.");
                              return;
                            }
                            try {
                              const res = await apiRequest<{ style_code: string }>(
                                "/catalog/generate-style-code",
                                {
                                  method: "POST",
                                  body: JSON.stringify({
                                    brand: companyBrand,
                                    category: itemCategory,
                                    pattern: activeTemplate?.style_code_pattern ?? undefined,
                                  }),
                                },
                              );
                              setItemStyleNo(res.style_code);
                              setCatalogNotice("Style No generated.");
                            } catch (e: any) {
                              setAddItemError(e.message || "Failed to generate Style No.");
                            }
                          }}
                          className="kira-focus-ring inline-flex items-center gap-1.5 bg-[#12141B] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
                        >
                          <svg
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                            fill="none"
                            viewBox="0 0 16 16"
                          >
                            <path
                              d="M8 2.2L9.5 5.3L12.8 6.1L10.4 8.4L11 11.7L8 10.1L5 11.7L5.6 8.4L3.2 6.1L6.5 5.3L8 2.2Z"
                              stroke="currentColor"
                              strokeWidth="1.2"
                            />
                          </svg>
                          Auto
                        </button>
                      </div>
                      <input
                        className="kira-focus-ring w-full border-0 border-b border-kira-warmgray/70 dark:border-white/20 bg-transparent px-0 pb-2 pt-1 text-3xl font-medium text-kira-black dark:text-white outline-none placeholder:font-normal placeholder:text-kira-midgray dark:placeholder:text-gray-500"
                        onChange={(event) => setItemStyleNo(event.target.value)}
                        placeholder="e.g., HRDS25001"
                        required
                        value={itemStyleNo}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel
                        confidence={fieldConfidence.category}
                        context={fieldContext.category}
                      >
                        Category
                      </FieldLabel>
                      <select
                        className="kira-focus-ring w-full border-0 border-b border-kira-warmgray/70 dark:border-white/20 bg-transparent px-0 pb-2 pt-1 text-xl text-kira-black dark:text-white dark:bg-[#12141B] outline-none"
                        onChange={(event) => {
                          const newCat = event.target.value;
                          setItemCategory(newCat);
                          if (!editingRowId) {
                            generateBulkStyleCode(newCat).then((code) => setItemStyleNo(code));
                          }
                        }}
                        value={itemCategory}
                      >
                        {addItemCategoryOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <FieldLabel
                        confidence={fieldConfidence.styleName}
                        context={fieldContext.styleName}
                      >
                        Style Name
                      </FieldLabel>
                      <select
                        className="kira-focus-ring w-full border-0 border-b border-kira-warmgray/70 dark:border-white/20 bg-transparent px-0 pb-2 pt-1 text-xl text-kira-black dark:text-white dark:bg-[#12141B] outline-none"
                        onChange={(event) => setItemStyleName(event.target.value)}
                        value={itemStyleName}
                      >
                        {addItemStyleNameOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel confidence={fieldConfidence.color} context={fieldContext.color}>
                        Color
                      </FieldLabel>
                      <select
                        className="kira-focus-ring w-full border-0 border-b border-kira-warmgray/70 dark:border-white/20 bg-transparent px-0 pb-2 pt-1 text-xl text-kira-black dark:text-white dark:bg-[#12141B] outline-none"
                        onChange={(event) => setItemColor(event.target.value)}
                        value={itemColor}
                      >
                        {addItemColorOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <FieldLabel confidence={fieldConfidence.fabric} context={fieldContext.fabric}>
                        Fabric
                      </FieldLabel>
                      <select
                        className="kira-focus-ring w-full border-0 border-b border-kira-warmgray/70 dark:border-white/20 bg-transparent px-0 pb-2 pt-1 text-xl text-kira-black dark:text-white dark:bg-[#12141B] outline-none"
                        onChange={(event) => setItemFabric(event.target.value)}
                        value={itemFabric}
                      >
                        {addItemFabricOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel
                        confidence={fieldConfidence.composition}
                        context={fieldContext.composition}
                      >
                        Composition
                      </FieldLabel>
                      <select
                        className="kira-focus-ring w-full border-0 border-b border-kira-warmgray/70 dark:border-white/20 bg-transparent px-0 pb-2 pt-1 text-xl text-kira-black dark:text-white dark:bg-[#12141B] outline-none"
                        onChange={(event) => setItemComposition(event.target.value)}
                        value={itemComposition}
                      >
                        {addItemCompositionOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <FieldLabel
                        confidence={fieldConfidence.wovenKnits}
                        context={fieldContext.wovenKnits}
                      >
                        Woven / Knits
                      </FieldLabel>
                      <select
                        className="kira-focus-ring w-full border-0 border-b border-kira-warmgray/70 dark:border-white/20 bg-transparent px-0 pb-2 pt-1 text-xl text-kira-black dark:text-white dark:bg-[#12141B] outline-none"
                        onChange={(event) => setItemWovenKnits(event.target.value)}
                        value={itemWovenKnits}
                      >
                        {addItemWovenKnitsOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Total Units</FieldLabel>
                      <select
                        className="kira-focus-ring w-full border-0 border-b border-kira-warmgray/70 dark:border-white/20 bg-transparent px-0 pb-2 pt-1 text-xl text-kira-black dark:text-white dark:bg-[#12141B] outline-none"
                        onChange={(event) => setItemTotalUnits(event.target.value)}
                        value={itemTotalUnits}
                      >
                        {TOTAL_UNITS_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <FieldLabel>PO Price</FieldLabel>
                      <select
                        className="kira-focus-ring w-full border-0 border-b border-kira-warmgray/70 dark:border-white/20 bg-transparent px-0 pb-2 pt-1 text-xl text-kira-black dark:text-white dark:bg-[#12141B] outline-none"
                        onChange={(event) => setItemPoPrice(event.target.value)}
                        value={itemPoPrice}
                      >
                        {PO_PRICE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>OSPS in SAR</FieldLabel>
                      <select
                        className="kira-focus-ring w-full border-0 border-b border-kira-warmgray/70 dark:border-white/20 bg-transparent px-0 pb-2 pt-1 text-xl text-kira-black dark:text-white dark:bg-[#12141B] outline-none"
                        onChange={(event) => setItemOspSar(event.target.value)}
                        value={itemOspSar}
                      >
                        {OSP_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {addItemError ? (
                  <p className="mt-5 rounded-md bg-kira-warmgray/20 px-3 py-2 text-sm text-kira-black ">
                    {addItemError}
                  </p>
                ) : null}
              </div>

              <div className="flex justify-end gap-3 border-t border-kira-warmgray/50 dark:border-white/10 bg-kira-offwhite dark:bg-[#12141B] px-5 py-4">
                <button
                  className="kira-focus-ring border border-kira-warmgray/60 dark:border-white/10 bg-kira-offwhite dark:bg-[#1C1E26] px-6 py-2.5 text-sm font-semibold uppercase tracking-[0.06em] text-kira-darkgray dark:text-gray-300 "
                  onClick={closeAddModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="kira-focus-ring inline-flex items-center gap-2 bg-kira-black dark:bg-white px-6 py-2.5 text-sm font-semibold uppercase tracking-[0.06em] text-kira-offwhite dark:text-black"
                  disabled={isSavingItem}
                  type="submit"
                >
                  <PlusIcon />
                  {isSavingItem ? "Saving..." : "Save to Catalog"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isCorrectionModalOpen && correctionFieldKey ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-[460px] border border-kira-warmgray/60 bg-kira-offwhite p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-kira-warmgray/50 pb-3">
              <div>
                <h3 className="font-sans text-2xl font-semibold text-kira-black ">
                  Correction Feedback
                </h3>
                <p className="mt-1 text-sm text-kira-midgray">
                  Tell AI why{" "}
                  <span className="font-semibold text-kira-black ">
                    {AI_FIELD_LABELS[correctionFieldKey]}
                  </span>{" "}
                  was incorrect.
                </p>
              </div>
              <button
                type="button"
                className="kira-focus-ring inline-flex h-8 w-8 items-center justify-center text-kira-midgray hover:text-kira-black "
                onClick={() => {
                  setIsCorrectionModalOpen(false);
                  setCorrectionFieldKey(null);
                  setCorrectionValue("");
                  setCorrectionValueError(null);
                }}
              >
                <CloseIcon />
              </button>
            </div>
            <form className="mt-4 space-y-4" onSubmit={handleSubmitCorrectionModal}>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.08em] text-kira-midgray">
                  Reason
                </label>
                <select
                  className="kira-focus-ring mt-1 w-full border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-sm text-kira-darkgray "
                  value={correctionReasonCode}
                  onChange={(event) => setCorrectionReasonCode(event.target.value)}
                >
                  {CORRECTION_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.08em] text-kira-midgray">
                  Corrected Value
                </label>
                <input
                  className="kira-focus-ring mt-1 w-full border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-sm text-kira-black "
                  placeholder={`Enter corrected ${AI_FIELD_LABELS[correctionFieldKey]}`}
                  value={correctionValue}
                  onChange={(event) => {
                    setCorrectionValue(event.target.value);
                    if (correctionValueError) {
                      setCorrectionValueError(null);
                    }
                  }}
                />
                {correctionValueError ? (
                  <p className="mt-1 text-xs text-rose-700">{correctionValueError}</p>
                ) : (
                  <p className="mt-1 text-xs text-kira-midgray">
                    This value will replace the field and be added to allowed{" "}
                    {AI_FIELD_LABELS[correctionFieldKey]} list.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.08em] text-kira-midgray">
                  Details (helps AI learn)
                </label>
                <textarea
                  className="kira-focus-ring mt-1 min-h-[100px] w-full border border-kira-warmgray/55 bg-kira-offwhite px-3 py-2 text-sm text-kira-black "
                  placeholder="What should AI look at next time?"
                  value={correctionNotes}
                  onChange={(event) => setCorrectionNotes(event.target.value)}
                />
              </div>
              <div className="flex justify-end gap-3 border-t border-kira-warmgray/45 pt-3">
                <button
                  type="button"
                  className="kira-focus-ring border border-kira-warmgray/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-kira-darkgray "
                  onClick={() => {
                    setIsCorrectionModalOpen(false);
                    setCorrectionFieldKey(null);
                    setCorrectionValue("");
                    setCorrectionValueError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isFeedbackSubmitting}
                  className="kira-focus-ring bg-kira-black dark:bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-kira-offwhite dark:text-black disabled:opacity-60"
                >
                  {isFeedbackSubmitting ? "Submitting..." : "Submit Feedback"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CartonBreakdown } from "@/src/components/received-po/CartonBreakdown";
import { DocumentCard } from "@/src/components/received-po/DocumentCard";
import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { PackingRulesPanel } from "@/src/components/dashboard/packing-rules-panel";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { normalizeStickerAssetUrlForPdf } from "@/src/lib/sticker-asset-pdf";
import { cn } from "@/src/lib/cn";
import {
  createMarketplaceDocumentTemplate,
  listMarketplaceDocumentTemplates,
  parseMarketplaceTemplateSample,
  type MarketplaceDocumentTemplate,
  type MarketplaceDocumentTemplateParseResponse,
} from "@/src/lib/marketplace-document-templates";
import {
  type BarcodeJob,
  type ExportMode,
  type Invoice,
  type InvoiceDetails,
  type PackingList,
  type ReceivedPO,
  createBarcodeJob,
  createInvoiceDraft,
  createPackingList,
  generateInvoicePdf,
  generatePackingListPdf,
  getOptionalBarcodeJob,
  getOptionalInvoice,
  getOptionalPackingList,
  getReceivedPO,
  resolveFileUrl,
  updateInvoice,
  updatePackingListCarton,
} from "@/src/lib/received-po";
import {
  createBuyerDocumentTemplate,
  getBrandProfile,
  listBuyerDocumentTemplates,
  parseBuyerDocumentTemplateSample,
  type BrandProfile,
  type BuyerDocumentTemplate,
  type BuyerDocumentTemplateParseResponse,
} from "@/src/lib/settings";
import {
  getStickerTemplate,
  listStickerTemplates,
  resolveStickerAssetUrl,
  updateStickerTemplate,
  uploadStickerImage,
  type StickerElement,
  type StickerTemplateKind,
  type StickerTemplate,
} from "@/src/lib/sticker-templates";
import {
  buildCartonDrafts,
  type CartonDraftState,
  formatDocumentCurrency,
} from "@/src/lib/received-po-ui";

interface ReceivedPODocumentsViewProps {
  receivedPoId: string;
}

type DocumentWorkspaceTab = "barcode" | "invoice" | "packing";

const EMPTY_INVOICE_DETAILS: InvoiceDetails = {
  marketplace_name: "",
  supplier_name: "",
  address: "",
  gst_number: "",
  pan_number: "",
  fbs_name: "",
  vendor_company_name: "",
  supplier_city: "",
  supplier_state: "",
  supplier_pincode: "",
  delivery_from_name: "",
  delivery_from_address: "",
  delivery_from_city: "",
  delivery_from_pincode: "",
  origin_country: "",
  origin_state: "",
  origin_district: "",
  bill_to_name: "",
  bill_to_address: "",
  bill_to_gst: "",
  bill_to_pan: "",
  ship_to_name: "",
  ship_to_address: "",
  ship_to_gst: "",
  stamp_image_url: "",
};

function previewTextForElement(element: StickerElement): string {
  const field = String(element.properties.field ?? "");
  if (element.element_type === "text_static") {
    return String(element.properties.content ?? "Text");
  }
  if (element.element_type === "text_dynamic") {
    const socialValue = String(element.properties.social_value ?? "").trim();
    if (socialValue) {
      return socialValue;
    }
    if (field === "po_number") return "PO No : 70150792";
    if (field === "model_number") return "Model No. : IN000090128";
    if (field === "option_id") return "Option ID : 7015079228";
    if (field === "size") return "Size : M";
    if (field === "quantity") return "Qty : 7";
    if (field === "styli_sku") return "701507922803";
    return String(element.properties.label ?? "Text");
  }
  if (element.element_type === "barcode") {
    return "701507922803";
  }
  return "";
}

function StickerTemplatePreview({
  template,
}: {
  template: {
    width_mm: number;
    height_mm: number;
    border_color: string | null;
    border_radius_mm: number;
    background_color: string;
    elements?: StickerElement[] | null;
  };
}): JSX.Element {
  const scale = Math.min(160 / template.width_mm, 210 / template.height_mm);
  const width = template.width_mm * scale;
  const height = template.height_mm * scale;
  const elements = template.elements ?? [];

  return (
    <div className="flex justify-center rounded-xl border border-kira-warmgray/20 bg-kira-offwhite/50 p-3 dark:border-white/10 dark:bg-white/5">
      <div
        className="relative overflow-hidden shadow-sm"
        style={{
          width,
          height,
          backgroundColor: template.background_color,
          border: `1px solid ${template.border_color ?? "#d7c9bc"}`,
          borderRadius: `${template.border_radius_mm * scale}px`,
        }}
      >
        {elements
          .slice()
          .sort((left, right) => left.z_index - right.z_index)
          .map((element) => {
            const commonStyle = {
              left: `${element.x_mm * scale}px`,
              top: `${element.y_mm * scale}px`,
              width: `${element.width_mm * scale}px`,
              height: `${element.height_mm * scale}px`,
            };

            if (element.element_type === "image") {
              const assetUrl = resolveStickerAssetUrl(String(element.properties.asset_url ?? ""));
              return assetUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="absolute object-contain"
                  key={element.id}
                  src={assetUrl}
                  style={commonStyle}
                />
              ) : (
                <div
                  className="absolute flex items-center justify-center border border-dashed border-kira-midgray/60 text-[8px] text-kira-midgray"
                  key={element.id}
                  style={commonStyle}
                >
                  Logo
                </div>
              );
            }

            if (element.element_type === "barcode") {
              return (
                <div
                  className="absolute flex flex-col items-center justify-center"
                  key={element.id}
                  style={commonStyle}
                >
                  <div
                    className="h-[42%] w-[82%]"
                    style={{
                      background:
                        "repeating-linear-gradient(90deg,#111 0 2px,#fff 2px 3px,#111 3px 4px,#fff 4px 6px)",
                    }}
                  />
                  <span className="mt-1 text-[8px] font-medium text-kira-black">701507922803</span>
                </div>
              );
            }

            if (element.element_type === "line") {
              return (
                <div
                  className="absolute bg-kira-black"
                  key={element.id}
                  style={
                    String(element.properties.orientation ?? "horizontal") === "vertical"
                      ? { ...commonStyle, width: "1px" }
                      : {
                          ...commonStyle,
                          height: `${Math.max(1, Number(element.properties.thickness_pt ?? 1))}px`,
                        }
                  }
                />
              );
            }

            return (
              <div
                className="absolute overflow-hidden text-kira-black"
                key={element.id}
                style={{
                  ...commonStyle,
                  fontSize: `${Math.max(8, Number(element.properties.font_size ?? 8) * scale * 0.42)}px`,
                  fontWeight:
                    String(
                      element.properties.font_weight ?? element.properties.value_weight ?? "normal",
                    ) === "bold"
                      ? 700
                      : 400,
                  textAlign: String(element.properties.alignment ?? "center") as
                    | "left"
                    | "center"
                    | "right",
                  color: String(element.properties.color ?? "#111111"),
                  lineHeight: 1.15,
                }}
              >
                {previewTextForElement(element)}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function StandardTemplatePreview(): JSX.Element {
  return (
    <div className="flex justify-center rounded-xl border border-kira-warmgray/20 bg-kira-offwhite/50 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="relative h-[210px] w-[158px] overflow-hidden rounded-[10px] border border-[#dc5096] bg-white shadow-sm">
        <div className="pt-3 text-center text-[11px] font-bold text-black">BRAND</div>
        <div className="mt-5 text-center text-[9px] text-black">PO No : 70150792</div>
        <div className="mt-1 text-center text-[9px] text-black">Model No. : IN000090128</div>
        <div className="mt-1 text-center text-[9px] text-black">Option ID : 7015079228</div>
        <div className="mx-auto mt-5 h-8 w-24 border-y border-black" />
        <div className="mt-1 text-center text-[8px] text-black">701507922803</div>
        <div className="mt-4 text-center text-[9px] font-semibold text-black">Qty : 7</div>
        <div className="mt-1 text-center text-[11px] font-bold text-black">Size : M</div>
        <div className="mt-1 text-center text-[8px] text-black">Made in India</div>
      </div>
    </div>
  );
}

async function loadTemplatesWithElements(): Promise<StickerTemplate[]> {
  const templates = await listStickerTemplates();
  const fullTemplates = await Promise.all(
    templates.map(async (template) => {
      if (template.elements && template.elements.length > 0) {
        return template;
      }
      try {
        return await getStickerTemplate(template.id);
      } catch {
        return template;
      }
    }),
  );
  return fullTemplates;
}

function buildTemplateElementPayload(template: StickerTemplate) {
  return template.elements.map((element, index) => ({
    element_type: element.element_type,
    x_mm: element.x_mm,
    y_mm: element.y_mm,
    width_mm: element.width_mm,
    height_mm: element.height_mm,
    z_index: element.z_index ?? index,
    properties: element.properties,
  }));
}
const DOC_INPUT_CLASS = "kira-field w-full";
const DOC_TEXTAREA_CLASS = "kira-textarea min-h-24 w-full";

type SurfaceTone = "neutral" | "active" | "success" | "warning";

function toneClasses(tone: SurfaceTone): string {
  if (tone === "success") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200";
  }
  if (tone === "active") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200";
  }
  if (tone === "warning") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200";
  }
  return "border-kira-warmgray/25 bg-kira-warmgray/14 text-kira-darkgray dark:border-white/10 dark:bg-white/8 dark:text-gray-300";
}

function resolveDocumentTone(status: string | null | undefined): SurfaceTone {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "final" || normalized === "done") {
    return "success";
  }
  if (normalized === "draft" || normalized === "pending" || normalized === "generating") {
    return "active";
  }
  if (normalized === "failed" || normalized === "requires invoice") {
    return "warning";
  }
  return "neutral";
}

function StatusPill({ label, tone }: { label: string; tone: SurfaceTone }): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
        toneClasses(tone),
      )}
    >
      {label}
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-kira-warmgray/15 bg-white/75 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
      <p className="text-[11px] uppercase tracking-[0.16em] text-kira-midgray">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-[-0.02em] text-kira-black dark:text-white">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-kira-midgray dark:text-gray-400">{detail}</p>
    </div>
  );
}

function WorkspaceTabCard({
  active,
  label,
  summary,
  tone,
  onClick,
}: {
  active: boolean;
  label: string;
  summary: string;
  tone: SurfaceTone;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      aria-label={label}
      className={cn(
        "group min-w-[220px] rounded-[22px] border px-4 py-4 text-left transition duration-200",
        active
          ? "border-kira-brown/25 bg-white shadow-[0_18px_45px_-28px_rgba(95,66,44,0.55)] dark:border-white/15 dark:bg-white/10"
          : "border-transparent bg-white/45 hover:border-kira-warmgray/25 hover:bg-white/75 dark:bg-white/[0.04] dark:hover:border-white/10 dark:hover:bg-white/[0.07]",
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-[-0.01em] text-kira-black dark:text-white">
            {label}
          </p>
          <p className="mt-1 text-xs leading-5 text-kira-midgray dark:text-gray-400">{summary}</p>
        </div>
        <StatusPill label={active ? "Open" : "Ready"} tone={active ? "active" : tone} />
      </div>
    </button>
  );
}

interface PackingTemplateDraft {
  name: string;
  marketplace_key: string;
  layout_key: string;
  title: string;
  po_number_label: string;
  quantity_header: string;
}

function buildPackingTemplateDraft(distributor: string | null | undefined): PackingTemplateDraft {
  const marketplaceKey = String(distributor ?? "").trim() || "generic";
  const marketplaceLabel = marketplaceKey || "Marketplace";
  return {
    name: `${marketplaceLabel} Packing List`,
    marketplace_key: marketplaceKey,
    layout_key: "default_v1",
    title: `${marketplaceLabel.toUpperCase()} PACKING LIST`,
    po_number_label: `${marketplaceLabel.toUpperCase()} PO NUMBER`,
    quantity_header: `${marketplaceLabel.toUpperCase()} QTY`,
  };
}

interface BarcodeTemplateDraft {
  name: string;
  marketplace_key: string;
  sticker_template_kind: StickerTemplateKind;
  sticker_template_id: string;
  width_mm: string;
  height_mm: string;
}

function buildBarcodeTemplateDraft(distributor: string | null | undefined): BarcodeTemplateDraft {
  const marketplaceKey = String(distributor ?? "").trim() || "generic";
  const marketplaceLabel = marketplaceKey || "Marketplace";
  return {
    name: `${marketplaceLabel} Barcode`,
    marketplace_key: marketplaceKey,
    sticker_template_kind: "styli",
    sticker_template_id: "",
    width_mm: "45.03",
    height_mm: "60",
  };
}

interface InvoiceTemplateDraft {
  name: string;
  buyer_key: string;
  layout_key: "default_v1" | "landmark_v1";
}

function buildInvoiceTemplateDraft(distributor: string | null | undefined): InvoiceTemplateDraft {
  const buyerKey = String(distributor ?? "").trim() || "generic";
  const buyerLabel = buyerKey || "Marketplace";
  return {
    name: `${buyerLabel} Invoice`,
    buyer_key: buyerKey,
    layout_key: "default_v1",
  };
}

function resolveBarcodeMarketplaceConfig(template: MarketplaceDocumentTemplate | null): {
  stickerTemplateKind: StickerTemplateKind;
  stickerTemplateId: string | null;
  widthMm: number | null;
  heightMm: number | null;
} {
  const layout = (template?.layout ?? {}) as Record<string, unknown>;
  const rawKind = String(layout.sticker_template_kind ?? "styli");
  const stickerTemplateKind: StickerTemplateKind = rawKind === "custom" ? "custom" : "styli";
  const rawTemplateId = String(layout.sticker_template_id ?? "").trim();
  const widthValue = Number(layout.width_mm);
  const heightValue = Number(layout.height_mm);
  return {
    stickerTemplateKind,
    stickerTemplateId: rawTemplateId || null,
    widthMm: Number.isFinite(widthValue) ? widthValue : null,
    heightMm: Number.isFinite(heightValue) ? heightValue : null,
  };
}

function brandProfileToInvoiceDetails(profile: BrandProfile): InvoiceDetails {
  return {
    marketplace_name: "",
    supplier_name: profile.supplier_name,
    address: profile.address,
    gst_number: profile.gst_number,
    pan_number: profile.pan_number,
    fbs_name: profile.fbs_name,
    vendor_company_name: profile.vendor_company_name,
    supplier_city: profile.supplier_city,
    supplier_state: profile.supplier_state,
    supplier_pincode: profile.supplier_pincode,
    delivery_from_name: profile.delivery_from_name,
    delivery_from_address: profile.delivery_from_address,
    delivery_from_city: profile.delivery_from_city,
    delivery_from_pincode: profile.delivery_from_pincode,
    origin_country: profile.origin_country,
    origin_state: profile.origin_state,
    origin_district: profile.origin_district,
    bill_to_name: profile.bill_to_name,
    bill_to_address: profile.bill_to_address,
    bill_to_gst: profile.bill_to_gst,
    bill_to_pan: profile.bill_to_pan,
    ship_to_name: profile.ship_to_name,
    ship_to_address: profile.ship_to_address,
    ship_to_gst: profile.ship_to_gst,
    stamp_image_url: profile.stamp_image_url,
  };
}

function normalizeBuyerKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function mergeBuyerTemplateDefaults(
  base: InvoiceDetails,
  template: BuyerDocumentTemplate | null,
  distributor: string | null | undefined,
): InvoiceDetails {
  const merged: InvoiceDetails = { ...base };
  if (template) {
    for (const [key, value] of Object.entries(template.defaults)) {
      if (typeof value === "string" && value.trim()) {
        merged[key as keyof InvoiceDetails] = value;
      }
    }
  }
  if (!merged.marketplace_name.trim()) {
    merged.marketplace_name = distributor || "Marketplace";
  }
  return merged;
}

function mergeInvoiceDetails(
  base: InvoiceDetails,
  overrides: Partial<InvoiceDetails>,
): InvoiceDetails {
  const merged: InvoiceDetails = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "string" && value.trim()) {
      merged[key as keyof InvoiceDetails] = value;
    }
  }
  return merged;
}

function matchBuyerTemplate(
  templates: BuyerDocumentTemplate[],
  distributor: string | null | undefined,
): BuyerDocumentTemplate | null {
  const normalizedDistributor = normalizeBuyerKey(distributor);
  if (!normalizedDistributor) {
    return templates.find((template) => template.is_default) ?? null;
  }
  const exactMatch =
    templates.find((template) => normalizeBuyerKey(template.buyer_key) === normalizedDistributor) ??
    null;
  if (exactMatch) {
    return exactMatch;
  }
  const containsMatch =
    templates.find((template) => {
      const buyerKey = normalizeBuyerKey(template.buyer_key);
      return buyerKey.length > 0 && normalizedDistributor.includes(buyerKey);
    }) ?? null;
  if (containsMatch) {
    return containsMatch;
  }
  return templates.find((template) => template.is_default) ?? null;
}

function matchMarketplaceTemplate(
  templates: MarketplaceDocumentTemplate[],
  marketplaceName: string | null | undefined,
): MarketplaceDocumentTemplate | null {
  const normalizedMarketplace = normalizeBuyerKey(marketplaceName);
  if (!normalizedMarketplace) {
    return templates.find((template) => template.is_default) ?? null;
  }
  const exactMatch =
    templates.find(
      (template) => normalizeBuyerKey(template.marketplace_key) === normalizedMarketplace,
    ) ?? null;
  if (exactMatch) {
    return exactMatch;
  }
  const containsMatch =
    templates.find((template) => {
      const marketplaceKey = normalizeBuyerKey(template.marketplace_key);
      return marketplaceKey.length > 0 && normalizedMarketplace.includes(marketplaceKey);
    }) ?? null;
  if (containsMatch) {
    return containsMatch;
  }
  return templates.find((template) => template.is_default) ?? null;
}

export function ReceivedPODocumentsView({
  receivedPoId,
}: ReceivedPODocumentsViewProps): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTemplateId = searchParams.get("templateId");
  const [receivedPO, setReceivedPO] = useState<ReceivedPO | null>(null);
  const [barcodeJob, setBarcodeJob] = useState<BarcodeJob | null>(null);
  const [activeBarcodeJobId, setActiveBarcodeJobId] = useState<string | null>(null);
  const [stickerTemplates, setStickerTemplates] = useState<StickerTemplate[]>([]);
  const [selectedBarcodeTemplate, setSelectedBarcodeTemplate] = useState<string>("styli");
  const [barcodeTemplates, setBarcodeTemplates] = useState<MarketplaceDocumentTemplate[]>([]);
  const [selectedBarcodeMarketplaceTemplateId, setSelectedBarcodeMarketplaceTemplateId] = useState<
    string | null
  >(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [buyerTemplates, setBuyerTemplates] = useState<BuyerDocumentTemplate[]>([]);
  const [selectedBuyerTemplateId, setSelectedBuyerTemplateId] = useState<string | null>(null);
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);
  const [packingList, setPackingList] = useState<PackingList | null>(null);
  const [packingTemplates, setPackingTemplates] = useState<MarketplaceDocumentTemplate[]>([]);
  const [selectedPackingTemplateId, setSelectedPackingTemplateId] = useState<string | null>(null);
  const [numberOfCartons, setNumberOfCartons] = useState("0");
  const [exportMode, setExportMode] = useState<ExportMode>("Air");
  const [grossWeight, setGrossWeight] = useState("");
  const [defaultInvoiceDetails, setDefaultInvoiceDetails] =
    useState<InvoiceDetails>(EMPTY_INVOICE_DETAILS);
  const [invoiceDetailsDraft, setInvoiceDetailsDraft] =
    useState<InvoiceDetails>(EMPTY_INVOICE_DETAILS);
  const [invoiceDetailsDialogOpen, setInvoiceDetailsDialogOpen] = useState(false);
  const [invoiceEditorOpen, setInvoiceEditorOpen] = useState(false);
  const [invoiceTemplateEditorOpen, setInvoiceTemplateEditorOpen] = useState(false);
  const [invoiceTemplateDraft, setInvoiceTemplateDraft] = useState<InvoiceTemplateDraft>(
    buildInvoiceTemplateDraft(null),
  );
  const [invoiceTemplateSampleFile, setInvoiceTemplateSampleFile] = useState<File | null>(null);
  const [parsedInvoiceTemplateSample, setParsedInvoiceTemplateSample] =
    useState<BuyerDocumentTemplateParseResponse | null>(null);
  const [isParsingInvoiceTemplate, setIsParsingInvoiceTemplate] = useState(false);
  const [activeTab, setActiveTab] = useState<DocumentWorkspaceTab>("barcode");
  const [pendingPdfs, setPendingPdfs] = useState<{ invoice?: boolean; packing?: boolean }>({});
  const [packingListPreviewOpen, setPackingListPreviewOpen] = useState(false);
  const [pdfPreviewModal, setPdfPreviewModal] = useState<{
    title: string;
    url: string | null;
  } | null>(null);
  const [packingRulesDialogOpen, setPackingRulesDialogOpen] = useState(false);
  const [barcodeTemplateEditorOpen, setBarcodeTemplateEditorOpen] = useState(false);
  const [barcodeTemplateDraft, setBarcodeTemplateDraft] = useState<BarcodeTemplateDraft>(
    buildBarcodeTemplateDraft(null),
  );
  const [barcodeTemplateSampleFile, setBarcodeTemplateSampleFile] = useState<File | null>(null);
  const [parsedBarcodeTemplateSample, setParsedBarcodeTemplateSample] =
    useState<MarketplaceDocumentTemplateParseResponse | null>(null);
  const [isParsingBarcodeTemplate, setIsParsingBarcodeTemplate] = useState(false);
  const [packingTemplateEditorOpen, setPackingTemplateEditorOpen] = useState(false);
  const [packingTemplateDraft, setPackingTemplateDraft] = useState<PackingTemplateDraft>(
    buildPackingTemplateDraft(null),
  );
  const [packingTemplateSampleFile, setPackingTemplateSampleFile] = useState<File | null>(null);
  const [parsedPackingTemplateSample, setParsedPackingTemplateSample] =
    useState<MarketplaceDocumentTemplateParseResponse | null>(null);
  const [isParsingPackingTemplate, setIsParsingPackingTemplate] = useState(false);
  const [cartonDrafts, setCartonDrafts] = useState<Record<string, CartonDraftState>>({});
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCartonId, setSavingCartonId] = useState<string | null>(null);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [autoTriggered, setAutoTriggered] = useState(false);

  const totalPieces = useMemo(
    () => packingList?.cartons.reduce((sum, carton) => sum + carton.total_pieces, 0) ?? 0,
    [packingList],
  );
  const selectedStickerTemplateName = useMemo(() => {
    if (selectedBarcodeTemplate === "styli") {
      return "Standard format";
    }
    return (
      stickerTemplates.find((template) => template.id === selectedBarcodeTemplate)?.name ??
      "Select template"
    );
  }, [selectedBarcodeTemplate, stickerTemplates]);
  const selectedBarcodeMarketplaceTemplate = useMemo(
    () =>
      barcodeTemplates.find((template) => template.id === selectedBarcodeMarketplaceTemplateId) ??
      null,
    [barcodeTemplates, selectedBarcodeMarketplaceTemplateId],
  );
  const barcodeMarketplaceSummary = useMemo(() => {
    if (!selectedBarcodeMarketplaceTemplate) {
      return "Current sticker selection";
    }
    const config = resolveBarcodeMarketplaceConfig(selectedBarcodeMarketplaceTemplate);
    const sizeSummary =
      config.widthMm && config.heightMm
        ? ` · ${config.widthMm.toFixed(2)} × ${config.heightMm.toFixed(2)} mm`
        : "";
    return `${selectedBarcodeMarketplaceTemplate.name} · ${config.stickerTemplateKind}${sizeSummary}`;
  }, [selectedBarcodeMarketplaceTemplate]);
  const selectedBuyerTemplate = useMemo(
    () => buyerTemplates.find((template) => template.id === selectedBuyerTemplateId) ?? null,
    [buyerTemplates, selectedBuyerTemplateId],
  );
  const buyerTemplateSummary = useMemo(() => {
    if (!selectedBuyerTemplate) {
      return "Current default layout";
    }
    return `${selectedBuyerTemplate.name} · ${selectedBuyerTemplate.layout_key}`;
  }, [selectedBuyerTemplate]);
  const selectedPackingTemplate = useMemo(
    () => packingTemplates.find((template) => template.id === selectedPackingTemplateId) ?? null,
    [packingTemplates, selectedPackingTemplateId],
  );
  const packingTemplateSummary = useMemo(() => {
    if (!selectedPackingTemplate) {
      return "Current default layout";
    }
    return `${selectedPackingTemplate.name} · ${
      String(selectedPackingTemplate.layout.layout_key ?? "default_v1") || "default_v1"
    }`;
  }, [selectedPackingTemplate]);

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      try {
        const [
          nextReceivedPO,
          nextBarcodeJob,
          nextInvoice,
          nextPackingList,
          nextTemplates,
          nextBarcodeTemplates,
          nextBuyerTemplates,
          nextBrandProfile,
          nextPackingTemplates,
        ] = await Promise.all([
          getReceivedPO(receivedPoId),
          getOptionalBarcodeJob(receivedPoId),
          getOptionalInvoice(receivedPoId),
          getOptionalPackingList(receivedPoId),
          loadTemplatesWithElements(),
          listMarketplaceDocumentTemplates("barcode"),
          listBuyerDocumentTemplates(),
          getBrandProfile(),
          listMarketplaceDocumentTemplates("packing_list"),
        ]);
        if (!active) {
          return;
        }
        const matchedBuyerTemplate =
          (nextInvoice?.buyer_template_id
            ? nextBuyerTemplates.find((template) => template.id === nextInvoice.buyer_template_id)
            : null) ?? matchBuyerTemplate(nextBuyerTemplates, nextReceivedPO.distributor);
        const defaultDetails = mergeBuyerTemplateDefaults(
          {
            ...brandProfileToInvoiceDetails(nextBrandProfile),
            marketplace_name: nextReceivedPO.distributor || "Marketplace",
          },
          matchedBuyerTemplate,
          nextReceivedPO.distributor,
        );
        const matchedPackingTemplate =
          (nextPackingList?.template_id
            ? nextPackingTemplates.find((template) => template.id === nextPackingList.template_id)
            : null) ?? matchMarketplaceTemplate(nextPackingTemplates, nextReceivedPO.distributor);
        const matchedBarcodeTemplate =
          (nextBarcodeJob?.marketplace_template_id
            ? nextBarcodeTemplates.find(
                (template) => template.id === nextBarcodeJob.marketplace_template_id,
              )
            : null) ?? matchMarketplaceTemplate(nextBarcodeTemplates, nextReceivedPO.distributor);
        const matchedBarcodeConfig = resolveBarcodeMarketplaceConfig(matchedBarcodeTemplate);
        const defaultTemplateId = nextTemplates.find((template) => template.is_default)?.id ?? null;
        setReceivedPO(nextReceivedPO);
        setBarcodeJob(nextBarcodeJob);
        setActiveBarcodeJobId(nextBarcodeJob?.id ?? null);
        setStickerTemplates(nextTemplates);
        setBarcodeTemplates(nextBarcodeTemplates);
        setSelectedBarcodeMarketplaceTemplateId(matchedBarcodeTemplate?.id ?? null);
        setBarcodeTemplateDraft(buildBarcodeTemplateDraft(nextReceivedPO.distributor));
        setBuyerTemplates(nextBuyerTemplates);
        setBrandProfile(nextBrandProfile);
        setSelectedBuyerTemplateId(matchedBuyerTemplate?.id ?? null);
        setInvoiceTemplateDraft(buildInvoiceTemplateDraft(nextReceivedPO.distributor));
        setPackingTemplates(nextPackingTemplates);
        setSelectedPackingTemplateId(matchedPackingTemplate?.id ?? null);
        setPackingTemplateDraft(buildPackingTemplateDraft(nextReceivedPO.distributor));
        setSelectedBarcodeTemplate(
          requestedTemplateId &&
            nextTemplates.some((template) => template.id === requestedTemplateId)
            ? requestedTemplateId
            : nextBarcodeJob?.template_kind === "custom"
              ? (nextBarcodeJob.template_id ?? defaultTemplateId ?? "styli")
              : nextBarcodeJob?.template_kind === "styli"
                ? "styli"
                : matchedBarcodeConfig.stickerTemplateKind === "custom"
                  ? (matchedBarcodeConfig.stickerTemplateId ?? defaultTemplateId ?? "styli")
                  : "styli",
        );
        setInvoice(nextInvoice);
        const savedCartons = nextInvoice?.number_of_cartons ?? 0;
        const actualCartons =
          savedCartons > 0 ? savedCartons : (nextPackingList?.cartons.length ?? 0);
        setNumberOfCartons(actualCartons.toString());
        setExportMode(nextInvoice?.export_mode ?? "Air");
        setGrossWeight(nextInvoice?.gross_weight?.toString() ?? "");
        setDefaultInvoiceDetails(defaultDetails);
        setInvoiceDetailsDraft(nextInvoice?.details ?? defaultDetails);
        setPackingList(nextPackingList);
        setCartonDrafts(buildCartonDrafts(nextPackingList));
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load document workspace.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [receivedPoId, requestedTemplateId]);

  useEffect(() => {
    if (!receivedPO || packingList) {
      return;
    }
    const matchedPackingTemplate = matchMarketplaceTemplate(
      packingTemplates,
      receivedPO.distributor,
    );
    setSelectedPackingTemplateId(matchedPackingTemplate?.id ?? null);
  }, [packingList, packingTemplates, receivedPO]);

  useEffect(() => {
    if (!receivedPO || !brandProfile) {
      return;
    }
    const nextDefaultDetails = mergeBuyerTemplateDefaults(
      {
        ...brandProfileToInvoiceDetails(brandProfile),
        marketplace_name: receivedPO.distributor || "Marketplace",
      },
      selectedBuyerTemplate,
      receivedPO.distributor,
    );
    setDefaultInvoiceDetails(nextDefaultDetails);
    if (!invoice) {
      setInvoiceDetailsDraft(nextDefaultDetails);
    }
  }, [brandProfile, invoice, receivedPO, selectedBuyerTemplate]);

  useEffect(() => {
    if (!receivedPO || barcodeJob) {
      return;
    }
    const matchedBarcodeTemplate = matchMarketplaceTemplate(
      barcodeTemplates,
      receivedPO.distributor,
    );
    setSelectedBarcodeMarketplaceTemplateId(matchedBarcodeTemplate?.id ?? null);
  }, [barcodeJob, barcodeTemplates, receivedPO]);

  useEffect(() => {
    if (!selectedBarcodeMarketplaceTemplate || barcodeJob) {
      return;
    }
    const config = resolveBarcodeMarketplaceConfig(selectedBarcodeMarketplaceTemplate);
    if (config.stickerTemplateKind === "custom" && config.stickerTemplateId) {
      setSelectedBarcodeTemplate(config.stickerTemplateId);
      return;
    }
    setSelectedBarcodeTemplate("styli");
  }, [barcodeJob, selectedBarcodeMarketplaceTemplate]);

  useEffect(() => {
    const targetBarcodeJobId = activeBarcodeJobId ?? barcodeJob?.id ?? null;
    if (
      !barcodeJob ||
      !targetBarcodeJobId ||
      !["pending", "generating"].includes(barcodeJob.status)
    ) {
      return undefined;
    }
    const interval = window.setInterval(async () => {
      try {
        const nextBarcodeJob = await getOptionalBarcodeJob(receivedPoId, targetBarcodeJobId);
        if (nextBarcodeJob) {
          setBarcodeJob(nextBarcodeJob);
          setSelectedBarcodeMarketplaceTemplateId(
            nextBarcodeJob.marketplace_template_id ?? selectedBarcodeMarketplaceTemplateId,
          );
          if (!["pending", "generating"].includes(nextBarcodeJob.status)) {
            if (nextBarcodeJob.status === "failed") {
              setWorkingKey(null);
              setStatusLine(null);
              setError(
                "Barcode PDF generation failed. The template image/logo could not be loaded. Re-upload it in the sticker builder, save the template, and try again.",
              );
            }
            window.clearInterval(interval);
          }
        }
      } catch {
        window.clearInterval(interval);
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [activeBarcodeJobId, barcodeJob, receivedPoId, selectedBarcodeMarketplaceTemplateId]);

  useEffect(() => {
    if (!invoice || invoice.status === "final" || invoice.file_url) {
      return undefined;
    }
    const interval = window.setInterval(async () => {
      try {
        const nextInvoice = await getOptionalInvoice(receivedPoId);
        if (nextInvoice) {
          setInvoice(nextInvoice);
          setInvoiceDetailsDraft(nextInvoice.details);
          if (nextInvoice.status === "final" || nextInvoice.file_url) {
            setWorkingKey((current) => (current === "invoice-pdf" ? null : current));
            setPendingPdfs((prev) => ({ ...prev, invoice: false }));
            window.clearInterval(interval);
          } else if (nextInvoice.status === "failed") {
            setWorkingKey((current) => (current === "invoice-pdf" ? null : current));
            setPendingPdfs((prev) => ({ ...prev, invoice: false }));
            setStatusLine(null);
            setError("Invoice PDF generation failed. Please try again.");
            window.clearInterval(interval);
          }
        }
      } catch {
        window.clearInterval(interval);
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [invoice, receivedPoId]);

  useEffect(() => {
    if (!packingList || packingList.status === "final" || packingList.file_url) {
      return undefined;
    }
    const interval = window.setInterval(async () => {
      try {
        const nextPackingList = await getOptionalPackingList(receivedPoId);
        if (nextPackingList) {
          setPackingList(nextPackingList);
          setSelectedPackingTemplateId(nextPackingList.template_id ?? selectedPackingTemplateId);
          setCartonDrafts(buildCartonDrafts(nextPackingList));
          if (nextPackingList.status === "final" || nextPackingList.file_url) {
            setWorkingKey((current) => (current === "packing-list-pdf" ? null : current));
            setPendingPdfs((prev) => ({ ...prev, packing: false }));
            window.clearInterval(interval);
          } else if (nextPackingList.status === "failed") {
            setWorkingKey((current) => (current === "packing-list-pdf" ? null : current));
            setPendingPdfs((prev) => ({ ...prev, packing: false }));
            setStatusLine(null);
            setError("Packing list PDF generation failed. Please try again.");
            window.clearInterval(interval);
          }
        }
      } catch {
        window.clearInterval(interval);
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [packingList, receivedPoId, selectedPackingTemplateId]);

  useEffect(() => {
    if (barcodeJob?.file_url && invoice?.file_url && packingList?.file_url) {
      setStatusLine("All documents successfully generated and ready for download!");
    }
  }, [barcodeJob?.file_url, invoice?.file_url, packingList?.file_url]);

  const openFile = (fileUrl: string | null): void => {
    const resolved = resolveFileUrl(fileUrl);
    if (!resolved) {
      return;
    }
    window.open(resolved, "_blank", "noopener,noreferrer");
  };

  const updateInvoiceDetailsField = (field: keyof InvoiceDetails, value: string): void => {
    setInvoiceDetailsDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const refreshCustomTemplateImagesForPdf = async (templateId: string): Promise<void> => {
    const template = await getStickerTemplate(templateId);
    let changed = false;
    let failedImageCount = 0;

    const nextElements = await Promise.all(
      template.elements.map(async (element) => {
        if (element.element_type !== "image") {
          return element;
        }

        const rawAssetUrl = String(element.properties.asset_url ?? "").trim();
        if (!rawAssetUrl) {
          return element;
        }

        const resolvedAssetUrl = resolveStickerAssetUrl(rawAssetUrl);
        if (!resolvedAssetUrl) {
          return element;
        }

        try {
          const normalizedFile = await normalizeStickerAssetUrlForPdf(
            resolvedAssetUrl,
            `${template.name}-${element.id}`,
          );
          const uploaded = await uploadStickerImage(normalizedFile);
          if (!uploaded.url || uploaded.url === rawAssetUrl) {
            return element;
          }
          changed = true;
          return {
            ...element,
            properties: {
              ...element.properties,
              asset_url: uploaded.url,
            },
          };
        } catch {
          failedImageCount += 1;
          return element;
        }
      }),
    );

    if (failedImageCount > 0) {
      throw new Error(
        failedImageCount === 1
          ? "Template logo/image could not be prepared for PDF. Re-upload it in the sticker builder, save the template, and try again."
          : "Some template images could not be prepared for PDF. Re-upload them in the sticker builder, save the template, and try again.",
      );
    }

    if (!changed) {
      return;
    }

    const savedTemplate = await updateStickerTemplate(template.id, {
      elements: buildTemplateElementPayload({
        ...template,
        elements: nextElements,
      }),
    });
    setStickerTemplates((current) =>
      current.map((item) => (item.id === savedTemplate.id ? savedTemplate : item)),
    );
  };

  const handleGenerateBarcodes = async (isBatch = false): Promise<void> => {
    try {
      if (!isBatch) {
        setActiveTab("barcode");
        setWorkingKey("barcodes");
      }
      setError(null);
      setStatusLine(null);
      const templateKind = selectedBarcodeTemplate === "styli" ? "styli" : "custom";
      const templateId = templateKind === "custom" ? selectedBarcodeTemplate : null;
      if (templateId) {
        setStatusLine("Preparing template images for PDF...");
        await refreshCustomTemplateImagesForPdf(templateId);
      }
      const createdJob = await createBarcodeJob(
        receivedPoId,
        templateKind === "styli"
          ? {
              template_kind: "styli",
              marketplace_template_id: selectedBarcodeMarketplaceTemplateId,
            }
          : {
              template_kind: "custom",
              template_id: templateId,
              marketplace_template_id: selectedBarcodeMarketplaceTemplateId,
            },
      );
      setActiveBarcodeJobId(createdJob.job_id);
      setBarcodeJob({
        id: createdJob.job_id,
        received_po_id: receivedPoId,
        status: createdJob.status,
        template_kind: templateKind,
        template_id: templateId,
        marketplace_template_id: createdJob.marketplace_template_id,
        marketplace_template_name: createdJob.marketplace_template_name,
        file_url: null,
        total_stickers: receivedPO?.items.length ?? barcodeJob?.total_stickers ?? 0,
        total_pages: 0,
        created_at: new Date().toISOString(),
      });
      const nextStatus = await getOptionalBarcodeJob(receivedPoId, createdJob.job_id);
      setBarcodeJob(nextStatus);
      setStatusLine("Barcode generation started.");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to generate barcode sheet.",
      );
    } finally {
      if (!isBatch) {
        setWorkingKey(null);
      }
    }
  };

  const handleCreateBarcodeTemplate = async (): Promise<void> => {
    try {
      setWorkingKey("barcode-template-create");
      setError(null);
      const createdTemplate = await createMarketplaceDocumentTemplate({
        name: barcodeTemplateDraft.name,
        marketplace_key: barcodeTemplateDraft.marketplace_key,
        document_type: "barcode",
        template_kind: "sticker",
        file_format: parsedBarcodeTemplateSample?.file_format ?? "pdf",
        sample_file_url: parsedBarcodeTemplateSample?.sample_file_url ?? null,
        header_row_index: 1,
        columns: [],
        layout: {
          sticker_template_kind: barcodeTemplateDraft.sticker_template_kind,
          sticker_template_id:
            barcodeTemplateDraft.sticker_template_kind === "custom"
              ? barcodeTemplateDraft.sticker_template_id || null
              : null,
          width_mm: Number(barcodeTemplateDraft.width_mm) || null,
          height_mm: Number(barcodeTemplateDraft.height_mm) || null,
        },
        is_default: false,
        is_active: true,
      });
      setBarcodeTemplates((current) => [createdTemplate, ...current]);
      setSelectedBarcodeMarketplaceTemplateId(createdTemplate.id);
      setBarcodeTemplateEditorOpen(false);
      setStatusLine("Barcode marketplace template saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save barcode template.");
    } finally {
      setWorkingKey(null);
    }
  };

  const handleParseBarcodeTemplateSample = async (): Promise<void> => {
    if (!barcodeTemplateSampleFile) {
      setError("Choose a barcode PDF or image sample first.");
      return;
    }
    try {
      setIsParsingBarcodeTemplate(true);
      setError(null);
      const parsed = await parseMarketplaceTemplateSample(barcodeTemplateSampleFile, "barcode");
      setParsedBarcodeTemplateSample(parsed);
      setBarcodeTemplateDraft((current) => ({
        ...current,
        width_mm: String(parsed.layout.width_mm ?? current.width_mm),
        height_mm: String(parsed.layout.height_mm ?? current.height_mm),
      }));
      setStatusLine("Barcode sample parsed. Review the inferred dimensions, then save.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to parse barcode sample.");
    } finally {
      setIsParsingBarcodeTemplate(false);
    }
  };

  const handleCreateInvoice = async (): Promise<void> => {
    try {
      setActiveTab("invoice");
      setWorkingKey("invoice-create");
      setError(null);
      const nextInvoice = await createInvoiceDraft(receivedPoId, {
        number_of_cartons: Math.max(0, Number(numberOfCartons) || 0),
        export_mode: exportMode,
        buyer_template_id: selectedBuyerTemplateId,
        details: invoiceDetailsDraft,
      });
      setInvoice(nextInvoice);
      setSelectedBuyerTemplateId(nextInvoice.buyer_template_id ?? null);
      setNumberOfCartons(nextInvoice.number_of_cartons.toString());
      setExportMode(nextInvoice.export_mode);
      setGrossWeight(nextInvoice.gross_weight?.toString() ?? "");
      setInvoiceDetailsDraft(nextInvoice.details);
      setStatusLine("Invoice draft created.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create invoice.");
    } finally {
      setWorkingKey(null);
    }
  };

  const handleParseInvoiceTemplateSample = async (): Promise<void> => {
    if (!invoiceTemplateSampleFile) {
      setError("Choose an invoice PDF sample first.");
      return;
    }
    try {
      setIsParsingInvoiceTemplate(true);
      setError(null);
      const parsed = await parseBuyerDocumentTemplateSample(invoiceTemplateSampleFile);
      const learnedBuyerKey = parsed.defaults.marketplace_name.trim();
      setParsedInvoiceTemplateSample(parsed);
      setInvoiceTemplateDraft((current) => ({
        ...current,
        name: learnedBuyerKey ? `${learnedBuyerKey} Invoice` : current.name,
        buyer_key: learnedBuyerKey || current.buyer_key,
        layout_key: parsed.layout_key,
      }));
      setInvoiceDetailsDraft((current) => mergeInvoiceDetails(current, parsed.defaults));
      setStatusLine("Invoice sample parsed. Review the inferred defaults, then save the template.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to parse invoice sample.");
    } finally {
      setIsParsingInvoiceTemplate(false);
    }
  };

  const handleCreateInvoiceTemplate = async (): Promise<void> => {
    try {
      setWorkingKey("invoice-template-create");
      setError(null);
      const createdTemplate = await createBuyerDocumentTemplate({
        name: invoiceTemplateDraft.name,
        buyer_key: invoiceTemplateDraft.buyer_key,
        document_type: "invoice",
        layout_key: invoiceTemplateDraft.layout_key,
        defaults: invoiceDetailsDraft,
        is_default: false,
        is_active: true,
      });
      setBuyerTemplates((current) => [createdTemplate, ...current]);
      setSelectedBuyerTemplateId(createdTemplate.id);
      setInvoiceTemplateEditorOpen(false);
      setStatusLine("Buyer template saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save buyer template.");
    } finally {
      setWorkingKey(null);
    }
  };

  const handleSaveGrossWeight = async (): Promise<void> => {
    try {
      setWorkingKey("invoice-weight");
      setError(null);
      const nextInvoice = await updateInvoice(receivedPoId, {
        gross_weight: grossWeight ? Number(grossWeight) : null,
        number_of_cartons: Math.max(0, Number(numberOfCartons) || 0),
        export_mode: exportMode,
        buyer_template_id: selectedBuyerTemplateId,
        details: invoiceDetailsDraft,
      });
      setInvoice(nextInvoice);
      setSelectedBuyerTemplateId(nextInvoice.buyer_template_id ?? null);
      setNumberOfCartons(nextInvoice.number_of_cartons.toString());
      setExportMode(nextInvoice.export_mode);
      setInvoiceDetailsDraft(nextInvoice.details);
      setStatusLine("Invoice draft details saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update invoice weight.");
    } finally {
      setWorkingKey(null);
    }
  };

  const handleGenerateInvoicePdf = async (isBatch = false): Promise<void> => {
    try {
      if (!isBatch) {
        setActiveTab("invoice");
        setWorkingKey("invoice-pdf");
      }
      setPendingPdfs((prev) => ({ ...prev, invoice: true }));
      setError(null);
      const ensuredInvoice =
        invoice ??
        (await createInvoiceDraft(receivedPoId, {
          number_of_cartons: Math.max(0, Number(numberOfCartons) || 0),
          export_mode: exportMode,
          buyer_template_id: selectedBuyerTemplateId,
          details: invoiceDetailsDraft,
        }));
      setInvoice(ensuredInvoice);
      setSelectedBuyerTemplateId(ensuredInvoice.buyer_template_id ?? null);
      setInvoiceDetailsDraft(ensuredInvoice.details);
      const generation = await generateInvoicePdf(receivedPoId);
      setInvoice((current) =>
        current
          ? {
              ...current,
              status: generation.status,
              file_url: generation.file_url,
            }
          : current,
      );
      setStatusLine("Invoice PDF generation started.");
    } catch (nextError) {
      if (!isBatch) {
        setWorkingKey(null);
      }
      setError(nextError instanceof Error ? nextError.message : "Failed to generate invoice PDF.");
    } finally {
      if (!isBatch) {
        setWorkingKey(null);
      }
    }
  };

  const handleSaveInvoiceDetails = async (): Promise<void> => {
    try {
      setError(null);
      if (!invoice) {
        setInvoiceDetailsDialogOpen(false);
        setStatusLine("Invoice details updated. They’ll be used when you create the draft.");
        return;
      }
      setWorkingKey("invoice-details");
      const nextInvoice = await updateInvoice(receivedPoId, {
        gross_weight: grossWeight ? Number(grossWeight) : null,
        number_of_cartons: Math.max(0, Number(numberOfCartons) || 0),
        export_mode: exportMode,
        buyer_template_id: selectedBuyerTemplateId,
        details: invoiceDetailsDraft,
      });
      setInvoice(nextInvoice);
      setSelectedBuyerTemplateId(nextInvoice.buyer_template_id ?? null);
      setInvoiceDetailsDraft(nextInvoice.details);
      setInvoiceDetailsDialogOpen(false);
      setStatusLine("Invoice details saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save invoice details.");
    } finally {
      setWorkingKey(null);
    }
  };

  const handleUseDefaultInvoiceDetails = async (): Promise<void> => {
    try {
      setError(null);
      setInvoiceDetailsDraft(defaultInvoiceDetails);
      if (!invoice) {
        setInvoiceDetailsDialogOpen(false);
        setStatusLine("Invoice defaults restored for the next draft.");
        return;
      }
      setWorkingKey("invoice-defaults");
      const nextInvoice = await updateInvoice(receivedPoId, {
        gross_weight: grossWeight ? Number(grossWeight) : null,
        number_of_cartons: Math.max(0, Number(numberOfCartons) || 0),
        export_mode: exportMode,
        buyer_template_id: selectedBuyerTemplateId,
        details: defaultInvoiceDetails,
      });
      setInvoice(nextInvoice);
      setSelectedBuyerTemplateId(nextInvoice.buyer_template_id ?? null);
      setInvoiceDetailsDraft(nextInvoice.details);
      setInvoiceDetailsDialogOpen(false);
      setStatusLine("Invoice defaults applied.");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to apply default invoice details.",
      );
    } finally {
      setWorkingKey(null);
    }
  };

  const handleCreatePackingList = async (isBatch = false): Promise<void> => {
    try {
      if (!isBatch) {
        setActiveTab("packing");
        setWorkingKey("packing-list-create");
      }
      setError(null);
      await createPackingList(receivedPoId, { template_id: selectedPackingTemplateId });
      const nextPackingList = await getOptionalPackingList(receivedPoId);
      setPackingList(nextPackingList);
      setSelectedPackingTemplateId(nextPackingList?.template_id ?? selectedPackingTemplateId);
      setCartonDrafts(buildCartonDrafts(nextPackingList));
      setStatusLine("Packing list created from confirmed PO quantities.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create packing list.");
    } finally {
      if (!isBatch) {
        setWorkingKey(null);
      }
    }
  };

  const handleSaveCarton = async (cartonId: string): Promise<void> => {
    const draft = cartonDrafts[cartonId];
    if (!draft) {
      return;
    }
    try {
      setSavingCartonId(cartonId);
      setError(null);
      await updatePackingListCarton(receivedPoId, cartonId, {
        gross_weight: draft.gross_weight ? Number(draft.gross_weight) : null,
        net_weight: draft.net_weight ? Number(draft.net_weight) : null,
        dimensions: draft.dimensions || null,
      });
      const nextPackingList = await getOptionalPackingList(receivedPoId);
      setPackingList(nextPackingList);
      setCartonDrafts(buildCartonDrafts(nextPackingList));
      setStatusLine(`Saved carton ${cartonId}.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save carton details.");
    } finally {
      setSavingCartonId(null);
    }
  };

  const handleGeneratePackingListPdf = async (isBatch = false): Promise<void> => {
    try {
      if (!isBatch) {
        setActiveTab("packing");
        setWorkingKey("packing-list-pdf");
      }
      setPendingPdfs((prev) => ({ ...prev, packing: true }));
      setError(null);
      if (!packingList) {
        await handleCreatePackingList(isBatch);
      }
      const generation = await generatePackingListPdf(receivedPoId, {
        template_id: selectedPackingTemplateId,
      });
      setPackingList((current) =>
        current
          ? {
              ...current,
              template_id: generation.template_id,
              template_name: generation.template_name,
              layout_key: generation.layout_key,
              status: generation.status,
              file_url: generation.file_url,
            }
          : current,
      );
      setStatusLine("Packing list PDF generation started.");
    } catch (nextError) {
      if (!isBatch) {
        setWorkingKey(null);
      }
      setError(
        nextError instanceof Error ? nextError.message : "Failed to generate packing list PDF.",
      );
    } finally {
      if (!isBatch) {
        setWorkingKey(null);
      }
    }
  };

  const handleCreatePackingTemplate = async (): Promise<void> => {
    try {
      setWorkingKey("packing-template-create");
      setError(null);
      const createdTemplate = await createMarketplaceDocumentTemplate({
        name: packingTemplateDraft.name,
        marketplace_key: packingTemplateDraft.marketplace_key,
        document_type: "packing_list",
        template_kind: "pdf_layout",
        file_format: parsedPackingTemplateSample?.file_format ?? "pdf",
        sample_file_url: parsedPackingTemplateSample?.sample_file_url ?? null,
        header_row_index: 1,
        columns: [],
        layout: {
          layout_key: packingTemplateDraft.layout_key || "default_v1",
          title: packingTemplateDraft.title,
          meta_labels: {
            po_number: packingTemplateDraft.po_number_label,
          },
          column_headers: {
            quantity: packingTemplateDraft.quantity_header,
          },
        },
        is_default: false,
        is_active: true,
      });
      setPackingTemplates((current) => [createdTemplate, ...current]);
      setSelectedPackingTemplateId(createdTemplate.id);
      setPackingTemplateEditorOpen(false);
      setStatusLine("Packing list template saved.");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to save packing list template.",
      );
    } finally {
      setWorkingKey(null);
    }
  };

  const handleParsePackingTemplateSample = async (): Promise<void> => {
    if (!packingTemplateSampleFile) {
      setError("Choose a packing list PDF sample first.");
      return;
    }
    try {
      setIsParsingPackingTemplate(true);
      setError(null);
      const parsed = await parseMarketplaceTemplateSample(
        packingTemplateSampleFile,
        "packing_list",
      );
      setParsedPackingTemplateSample(parsed);
      const layout = parsed.layout as Record<string, unknown>;
      const metaLabels =
        typeof layout.meta_labels === "object" && layout.meta_labels
          ? (layout.meta_labels as Record<string, unknown>)
          : {};
      const columnHeaders =
        typeof layout.column_headers === "object" && layout.column_headers
          ? (layout.column_headers as Record<string, unknown>)
          : {};
      setPackingTemplateDraft((current) => ({
        ...current,
        layout_key: String(layout.layout_key ?? current.layout_key),
        title: String(layout.title ?? current.title),
        po_number_label: String(metaLabels.po_number ?? current.po_number_label),
        quantity_header: String(columnHeaders.quantity ?? current.quantity_header),
      }));
      setStatusLine("Packing list sample parsed. Review the inferred labels, then save.");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to parse packing list sample.",
      );
    } finally {
      setIsParsingPackingTemplate(false);
    }
  };

  const handleGenerateAllDocuments = async (): Promise<void> => {
    try {
      setWorkingKey("generate-all");
      setError(null);
      setStatusLine("Generating all documents in sequence...");

      if (!barcodeJob?.file_url) {
        await handleGenerateBarcodes(true);
      }

      if (!invoice?.file_url) {
        await handleGenerateInvoicePdf(true);
      }

      if (!packingList?.file_url) {
        await handleGeneratePackingListPdf(true);
      }

      setStatusLine("All document generations initiated! Polling for completed PDFs...");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed during batch document generation.",
      );
    } finally {
      setWorkingKey(null);
    }
  };

  useEffect(() => {
    if (!loading && !autoTriggered && searchParams.get("autoGenerate") === "true") {
      setAutoTriggered(true);
      if (!barcodeJob?.file_url && !workingKey) {
        handleGenerateAllDocuments();
      }
    }
  }, [loading, autoTriggered, searchParams, barcodeJob, workingKey]);

  const workspaceTabs: Array<{
    key: DocumentWorkspaceTab;
    label: string;
    summary: string;
    tone: SurfaceTone;
  }> = [
    {
      key: "barcode",
      label: "Step 1: Barcodes",
      summary: barcodeJob
        ? `${barcodeJob.total_stickers} stickers · ${barcodeJob.total_pages || 0} pages`
        : selectedBarcodeTemplate === "styli"
          ? "Standard format selected"
          : "Custom sticker template selected",
      tone: resolveDocumentTone(barcodeJob?.status ?? "not generated"),
    },
    {
      key: "invoice",
      label: "Step 2: Invoice",
      summary: invoice
        ? `${invoice.invoice_number} · ${formatDocumentCurrency(invoice.total_amount)}`
        : "Draft not created yet",
      tone: resolveDocumentTone(invoice?.status ?? "not created"),
    },
    {
      key: "packing",
      label: "Step 3: Packing List",
      summary: packingList
        ? `${packingList.cartons.length} cartons · ${totalPieces} pieces`
        : invoice
          ? "Ready to create once carton planning starts"
          : "Blocked until invoice exists",
      tone: resolveDocumentTone(
        packingList?.status ?? (invoice ? "not created" : "requires invoice"),
      ),
    },
  ];

  return (
    <DashboardShell
      subtitle="Generate the three downstream documents from the confirmed marketplace PO."
      title="Received PO Documents"
      titleAppend={
        <div className="ml-3 flex items-center gap-3">
          {(() => {
            const isAnyGenerating =
              workingKey === "generate-all" ||
              workingKey === "barcodes" ||
              workingKey === "invoice-pdf" ||
              workingKey === "packing-list-pdf" ||
              Boolean(pendingPdfs.invoice || pendingPdfs.packing) ||
              Boolean(
                barcodeJob &&
                !barcodeJob.file_url &&
                ["pending", "generating", "processing"].includes(barcodeJob.status),
              );
            return (
              <Button disabled={isAnyGenerating} onClick={handleGenerateAllDocuments}>
                {isAnyGenerating ? "Generating..." : "Generate All Documents"}
              </Button>
            );
          })()}
          <div className="group relative z-50 inline-block">
            <button
              className="flex h-5 w-5 items-center justify-center rounded-full bg-kira-warmgray/25 text-[10px] font-bold text-kira-darkgray hover:bg-kira-warmgray/40 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20"
              type="button"
            >
              ?
            </button>
            <div className="absolute left-1/2 top-full hidden w-[340px] -translate-x-1/2 pt-2 group-hover:block">
              <div className="flex max-h-[220px] flex-col gap-3 overflow-y-auto overscroll-contain rounded-[20px] border border-kira-warmgray/15 bg-white p-4 shadow-[0_30px_90px_-20px_rgba(76,56,37,0.35)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden dark:border-white/10 dark:bg-[#181411]">
                <p className="text-[11px] uppercase tracking-[0.18em] text-kira-midgray">
                  Workflow
                </p>
                {[
                  {
                    step: "1",
                    title: "Pick the output",
                    body: "Switch between barcode, invoice, and packing list to focus the workspace.",
                  },
                  {
                    step: "2",
                    title: "Choose or learn a template",
                    body: "Use the saved marketplace template, create one manually, or import from a sample file.",
                  },
                  {
                    step: "3",
                    title: "Generate the final document",
                    body: "Review the current defaults, then create the draft or export the finished PDF.",
                  },
                ].map((item) => (
                  <div className="flex gap-3 text-left" key={item.step}>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-kira-black text-xs font-semibold text-white dark:bg-white dark:text-kira-black">
                      {item.step}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-kira-black dark:text-white">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-kira-midgray dark:text-gray-400">
                        {item.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {loading ? (
          <Card className="rounded-[28px] border border-kira-warmgray/15 p-5 text-sm text-kira-darkgray shadow-[0_24px_70px_-48px_rgba(76,56,37,0.45)] dark:text-gray-200">
            Loading document workspace...
          </Card>
        ) : null}
        {error ? (
          <Card className="rounded-[24px] border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-700 dark:border-rose-400/15 dark:bg-rose-400/10 dark:text-rose-200">
            {error}
          </Card>
        ) : null}
        {statusLine ? (
          <Card className="rounded-[24px] border border-sky-500/15 bg-sky-500/10 p-4 text-sm text-sky-700 dark:border-sky-400/15 dark:bg-sky-400/10 dark:text-sky-200">
            {statusLine}
          </Card>
        ) : null}

        <div className="rounded-[28px] border border-kira-warmgray/20 bg-kira-offwhite/35 p-3 shadow-[0_24px_70px_-55px_rgba(76,56,37,0.45)] dark:border-white/10 dark:bg-white/5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {workspaceTabs.map((tab) => (
              <WorkspaceTabCard
                active={activeTab === tab.key}
                key={tab.key}
                label={tab.label}
                onClick={() => setActiveTab(tab.key)}
                summary={tab.summary}
                tone={tab.tone}
              />
            ))}
          </div>
        </div>

        <div className="space-y-5">
          {activeTab === "barcode" ? (
            <DocumentCard
              actions={
                <>
                  {(() => {
                    const isBarcodesGenerating =
                      workingKey === "barcodes" ||
                      workingKey === "generate-all" ||
                      Boolean(
                        barcodeJob &&
                        !barcodeJob.file_url &&
                        ["pending", "generating", "processing"].includes(barcodeJob.status),
                      );
                    return (
                      <Button
                        disabled={isBarcodesGenerating}
                        onClick={() => handleGenerateBarcodes()}
                      >
                        {isBarcodesGenerating ? "Generating..." : "Generate barcodes"}
                      </Button>
                    );
                  })()}
                  {barcodeJob?.file_url ? (
                    <>
                      <Button
                        onClick={() =>
                          setPdfPreviewModal({
                            title: "Barcode Sheet Preview",
                            url: barcodeJob.file_url,
                          })
                        }
                        variant="secondary"
                      >
                        Preview
                      </Button>
                      <Button onClick={() => openFile(barcodeJob.file_url)} variant="secondary">
                        Download PDF
                      </Button>
                    </>
                  ) : null}
                </>
              }
              description={`${barcodeJob?.total_stickers ?? 0} stickers ready for barcode output.`}
              status={barcodeJob?.status ?? "not generated"}
              title="Barcode sheet"
            >
              <div className="space-y-8 text-sm text-kira-darkgray dark:text-gray-200">
                {/* --- CONFIGURATION --- */}
                <div className="space-y-5">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-kira-midgray">
                    Configuration
                  </h3>

                  {/* Step 1: Sticker Design */}
                  <div className="rounded-2xl border border-kira-warmgray/25 bg-kira-offwhite/40 p-5 dark:border-white/10 dark:bg-white/5">
                    <label className="block">
                      <span className="mb-1 block font-medium text-kira-black dark:text-white">
                        1. Sticker Design
                      </span>
                      <p className="mb-4 text-xs text-kira-midgray">
                        Select the core design format for your stickers.
                      </p>
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto]">
                        <button
                          aria-label="Sticker template"
                          className="kira-focus-ring flex w-full items-center justify-between rounded-md border border-kira-warmgray/35 bg-white px-3 py-2 text-left text-kira-black dark:border-white/15 dark:bg-white/5 dark:text-white"
                          onClick={() => setTemplatePickerOpen(true)}
                          type="button"
                        >
                          <span>{selectedStickerTemplateName}</span>
                          <span className="text-xs text-kira-midgray dark:text-gray-400">
                            Choose
                          </span>
                        </button>
                        <Button
                          onClick={() =>
                            router.push(
                              `/dashboard/sticker-builder?returnTo=${encodeURIComponent(
                                `/dashboard/received-pos/${receivedPoId}/documents`,
                              )}&preset=styli`,
                            )
                          }
                          variant="secondary"
                        >
                          Open sticker builder
                        </Button>
                      </div>
                    </label>
                  </div>

                  {/* Step 2: Marketplace Formatting */}
                  <div className="rounded-2xl border border-kira-warmgray/25 bg-kira-offwhite/40 p-5 dark:border-white/10 dark:bg-white/5">
                    <label className="block">
                      <span className="mb-1 block font-medium text-kira-black dark:text-white">
                        2. Marketplace Formatting (Optional)
                      </span>
                      <p className="mb-4 text-xs text-kira-midgray">
                        Apply specific marketplace layouts like Styli or Landmark to your sticker.
                      </p>
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto]">
                        <select
                          aria-label="Marketplace barcode template"
                          className={cn(
                            DOC_INPUT_CLASS,
                            "bg-transparent dark:bg-white/5 dark:text-white",
                          )}
                          onChange={(event) =>
                            setSelectedBarcodeMarketplaceTemplateId(event.target.value || null)
                          }
                          value={selectedBarcodeMarketplaceTemplateId ?? ""}
                        >
                          <option className="dark:bg-[#1A1C23] dark:text-white" value="">
                            Use sticker selection directly
                          </option>
                          {barcodeTemplates.map((template) => (
                            <option
                              className="dark:bg-[#1A1C23] dark:text-white"
                              key={template.id}
                              value={template.id}
                            >
                              {template.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          onClick={() => setBarcodeTemplateEditorOpen(true)}
                          variant="secondary"
                        >
                          Import / Create Template
                        </Button>
                      </div>
                      {barcodeMarketplaceSummary ? (
                        <p className="mt-2 text-xs text-kira-midgray">
                          {barcodeMarketplaceSummary}
                        </p>
                      ) : null}
                    </label>
                  </div>
                </div>

                {/* --- SUMMARY --- */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-kira-midgray">
                    Output Summary
                  </h3>
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-kira-warmgray/25 bg-kira-offwhite/80 p-4 dark:border-white/10 dark:bg-white/5">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-kira-warmgray/25 bg-white px-3 py-1.5 text-sm font-medium text-kira-black shadow-sm dark:border-white/10 dark:bg-[#1A1C23] dark:text-white">
                      <span className="text-base">🏷️</span>
                      {barcodeJob?.total_stickers ?? 0} Stickers
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-kira-warmgray/25 bg-white px-3 py-1.5 text-sm font-medium text-kira-black shadow-sm dark:border-white/10 dark:bg-[#1A1C23] dark:text-white">
                      <span className="text-base">📏</span>
                      {selectedBarcodeTemplate === "styli" ? "Standard format" : "Custom template"}
                    </span>
                    {barcodeJob?.total_pages ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-kira-warmgray/25 bg-white px-3 py-1.5 text-sm font-medium text-kira-black shadow-sm dark:border-white/10 dark:bg-[#1A1C23] dark:text-white">
                        <span className="text-base">📄</span>
                        {barcodeJob.total_pages} Page{barcodeJob.total_pages === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </div>
                {barcodeTemplateEditorOpen ? (
                  <div className="fixed inset-0 z-50 flex items-start justify-center bg-kira-black/40 px-4 py-8">
                    <div
                      aria-modal="true"
                      className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl dark:border dark:border-white/10 dark:bg-[#12141B]"
                      role="dialog"
                    >
                      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                        <h2 className="text-xl font-semibold text-kira-black dark:text-white">
                          Barcode template setup
                        </h2>
                        <Button
                          onClick={() => setBarcodeTemplateEditorOpen(false)}
                          variant="secondary"
                        >
                          Close
                        </Button>
                      </div>
                      <div className="space-y-6">
                        <div className="rounded-xl border border-kira-warmgray/20 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
                          <p className="text-sm font-semibold text-kira-black dark:text-white">
                            Import from sample
                          </p>
                          <p className="mt-1 text-xs text-kira-midgray">
                            Upload a barcode PDF or image sample and we&apos;ll infer the sticker
                            dimensions for you.
                          </p>
                          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr),auto]">
                            <input
                              accept=".pdf,.png,.jpg,.jpeg,.webp"
                              className={DOC_INPUT_CLASS}
                              onChange={(event) =>
                                setBarcodeTemplateSampleFile(event.target.files?.[0] ?? null)
                              }
                              type="file"
                            />
                            <Button
                              disabled={isParsingBarcodeTemplate}
                              onClick={handleParseBarcodeTemplateSample}
                              variant="secondary"
                            >
                              {isParsingBarcodeTemplate ? "Parsing..." : "Import from sample"}
                            </Button>
                          </div>
                          {parsedBarcodeTemplateSample ? (
                            <p className="mt-2 text-xs text-kira-midgray">
                              Learned size: {String(parsedBarcodeTemplateSample.layout.width_mm)} ×{" "}
                              {String(parsedBarcodeTemplateSample.layout.height_mm)} mm
                            </p>
                          ) : null}
                        </div>

                        <div className="rounded-xl border border-kira-warmgray/20 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
                          <p className="text-sm font-semibold text-kira-black dark:text-white">
                            Create manually
                          </p>
                          <p className="mt-1 text-xs text-kira-midgray">
                            Set the marketplace key, sticker source, and dimensions yourself.
                          </p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Template name
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setBarcodeTemplateDraft((current) => ({
                                    ...current,
                                    name: event.target.value,
                                  }))
                                }
                                type="text"
                                value={barcodeTemplateDraft.name}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Marketplace key
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setBarcodeTemplateDraft((current) => ({
                                    ...current,
                                    marketplace_key: event.target.value,
                                  }))
                                }
                                type="text"
                                value={barcodeTemplateDraft.marketplace_key}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Sticker source
                              </span>
                              <select
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setBarcodeTemplateDraft((current) => ({
                                    ...current,
                                    sticker_template_kind: event.target
                                      .value as StickerTemplateKind,
                                  }))
                                }
                                value={barcodeTemplateDraft.sticker_template_kind}
                              >
                                <option value="styli">Standard format</option>
                                <option value="custom">Custom sticker template</option>
                              </select>
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Custom sticker template
                              </span>
                              <select
                                className={DOC_INPUT_CLASS}
                                disabled={barcodeTemplateDraft.sticker_template_kind !== "custom"}
                                onChange={(event) =>
                                  setBarcodeTemplateDraft((current) => ({
                                    ...current,
                                    sticker_template_id: event.target.value,
                                  }))
                                }
                                value={barcodeTemplateDraft.sticker_template_id}
                              >
                                <option value="">Select custom sticker template</option>
                                {stickerTemplates.map((template) => (
                                  <option key={template.id} value={template.id}>
                                    {template.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Width (mm)
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setBarcodeTemplateDraft((current) => ({
                                    ...current,
                                    width_mm: event.target.value,
                                  }))
                                }
                                type="number"
                                value={barcodeTemplateDraft.width_mm}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Height (mm)
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setBarcodeTemplateDraft((current) => ({
                                    ...current,
                                    height_mm: event.target.value,
                                  }))
                                }
                                type="number"
                                value={barcodeTemplateDraft.height_mm}
                              />
                            </label>
                            <div className="md:col-span-2">
                              <Button
                                disabled={workingKey === "barcode-template-create"}
                                onClick={handleCreateBarcodeTemplate}
                                variant="secondary"
                              >
                                {workingKey === "barcode-template-create"
                                  ? "Saving..."
                                  : "Create barcode template"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </DocumentCard>
          ) : null}

          {activeTab === "invoice" ? (
            <DocumentCard
              actions={
                <>
                  {(() => {
                    const isInvoiceGenerating =
                      workingKey === "invoice-create" ||
                      workingKey === "invoice-pdf" ||
                      workingKey === "generate-all" ||
                      Boolean(pendingPdfs.invoice);
                    return (
                      <>
                        {!invoice ? (
                          <Button disabled={isInvoiceGenerating} onClick={handleCreateInvoice}>
                            {isInvoiceGenerating ? "Creating..." : "Create invoice"}
                          </Button>
                        ) : null}
                        {invoice ? (
                          <Button
                            disabled={isInvoiceGenerating}
                            onClick={() => handleGenerateInvoicePdf()}
                          >
                            {isInvoiceGenerating ? "Generating..." : "Generate invoice PDF"}
                          </Button>
                        ) : null}
                      </>
                    );
                  })()}
                  {invoice?.file_url ? (
                    <>
                      <Button
                        onClick={() =>
                          setPdfPreviewModal({
                            title: "Commercial Invoice Preview",
                            url: invoice.file_url,
                          })
                        }
                        variant="secondary"
                      >
                        Preview
                      </Button>
                      <Button onClick={() => openFile(invoice.file_url)} variant="secondary">
                        Download PDF
                      </Button>
                    </>
                  ) : null}
                </>
              }
              description={
                invoice
                  ? `${invoice.invoice_number} · ${formatDocumentCurrency(invoice.total_amount)}`
                  : "Create a commercial invoice draft from the confirmed PO."
              }
              status={invoice?.status ?? "not created"}
              title="Invoice"
            >
              {invoice ? (
                <div className="space-y-3 text-sm text-kira-darkgray dark:text-gray-200">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-kira-midgray">
                        Total Qty
                      </p>
                      <p className="mt-1 text-kira-black dark:text-white">
                        {invoice.total_quantity} pcs
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-kira-midgray">
                        Subtotal
                      </p>
                      <p className="mt-1 text-kira-black dark:text-white">
                        {formatDocumentCurrency(invoice.subtotal)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-kira-midgray">
                        {invoice.tax_mode === "intrastate" ? "CGST + SGST" : "IGST"}
                      </p>
                      <p className="mt-1 text-kira-black dark:text-white">
                        {formatDocumentCurrency(
                          invoice.tax_mode === "intrastate"
                            ? invoice.cgst_amount + invoice.sgst_amount
                            : invoice.igst_amount,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-kira-midgray">Total</p>
                      <p className="mt-1 text-kira-black dark:text-white">
                        {formatDocumentCurrency(invoice.total_amount)}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-kira-warmgray/25 bg-kira-offwhite/40 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto] md:items-end">
                      <label className="block text-sm">
                        <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                          Buyer template
                        </span>
                        <select
                          className={DOC_INPUT_CLASS}
                          onChange={(event) =>
                            setSelectedBuyerTemplateId(event.target.value || null)
                          }
                          value={selectedBuyerTemplateId ?? ""}
                        >
                          <option value="">Use current default layout</option>
                          {buyerTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        disabled={workingKey === "invoice-defaults"}
                        onClick={handleUseDefaultInvoiceDetails}
                        variant="secondary"
                      >
                        Apply template defaults
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-kira-midgray">
                      {buyerTemplateSummary}
                      {selectedBuyerTemplate
                        ? ` · matched with buyer key "${selectedBuyerTemplate.buyer_key}"`
                        : ""}
                    </p>
                    <div className="mt-3">
                      <Button
                        onClick={() => setInvoiceTemplateEditorOpen(true)}
                        variant="secondary"
                      >
                        Create or import template
                      </Button>
                    </div>
                    {invoiceTemplateEditorOpen ? (
                      <div className="fixed inset-0 z-50 flex items-start justify-center bg-kira-black/40 px-4 py-8">
                        <div
                          aria-modal="true"
                          className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl dark:border dark:border-white/10 dark:bg-[#12141B]"
                          role="dialog"
                        >
                          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                            <h2 className="text-xl font-semibold text-kira-black dark:text-white">
                              Invoice template setup
                            </h2>
                            <Button
                              onClick={() => setInvoiceTemplateEditorOpen(false)}
                              variant="secondary"
                            >
                              Close
                            </Button>
                          </div>
                          <div className="space-y-6">
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-kira-black dark:text-white">
                                Import from sample
                              </p>
                              <p className="text-xs text-kira-midgray">
                                Upload an existing invoice PDF and we&apos;ll prefill the buyer
                                layout and destination blocks before you save the template.
                              </p>
                              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto] md:items-end">
                                <label className="block text-sm">
                                  <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                    Invoice PDF sample
                                  </span>
                                  <input
                                    accept="application/pdf"
                                    className={DOC_INPUT_CLASS}
                                    onChange={(event) =>
                                      setInvoiceTemplateSampleFile(event.target.files?.[0] ?? null)
                                    }
                                    type="file"
                                  />
                                </label>
                                <Button
                                  disabled={isParsingInvoiceTemplate}
                                  onClick={handleParseInvoiceTemplateSample}
                                  variant="secondary"
                                >
                                  {isParsingInvoiceTemplate ? "Parsing..." : "Import sample"}
                                </Button>
                              </div>
                              {parsedInvoiceTemplateSample ? (
                                <p className="text-xs text-kira-midgray">
                                  Learned layout: {parsedInvoiceTemplateSample.layout_key}
                                  {parsedInvoiceTemplateSample.detected_headers.length > 0
                                    ? ` · detected ${parsedInvoiceTemplateSample.detected_headers.join(", ")}`
                                    : ""}
                                </p>
                              ) : null}
                            </div>
                            <hr className="border-kira-warmgray/20 dark:border-white/10" />
                            <div className="space-y-3">
                              <p className="text-sm font-medium text-kira-black dark:text-white">
                                Create manually
                              </p>
                              <p className="text-xs text-kira-midgray">
                                The template will save the current invoice details. Use the invoice
                                details editor if you want to adjust addresses, GST fields, or stamp
                                defaults first.
                              </p>
                              <div className="grid gap-3 md:grid-cols-3">
                                <label className="block text-sm">
                                  <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                    Template name
                                  </span>
                                  <input
                                    className={DOC_INPUT_CLASS}
                                    onChange={(event) =>
                                      setInvoiceTemplateDraft((current) => ({
                                        ...current,
                                        name: event.target.value,
                                      }))
                                    }
                                    value={invoiceTemplateDraft.name}
                                  />
                                </label>
                                <label className="block text-sm">
                                  <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                    Buyer key
                                  </span>
                                  <input
                                    className={DOC_INPUT_CLASS}
                                    onChange={(event) =>
                                      setInvoiceTemplateDraft((current) => ({
                                        ...current,
                                        buyer_key: event.target.value,
                                      }))
                                    }
                                    value={invoiceTemplateDraft.buyer_key}
                                  />
                                </label>
                                <label className="block text-sm">
                                  <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                    Layout
                                  </span>
                                  <select
                                    className={DOC_INPUT_CLASS}
                                    onChange={(event) =>
                                      setInvoiceTemplateDraft((current) => ({
                                        ...current,
                                        layout_key: event.target.value as
                                          | "default_v1"
                                          | "landmark_v1",
                                      }))
                                    }
                                    value={invoiceTemplateDraft.layout_key}
                                  >
                                    <option value="default_v1">Default v1</option>
                                    <option value="landmark_v1">Landmark v1</option>
                                  </select>
                                </label>
                              </div>
                              <div className="flex flex-wrap gap-2 pt-2">
                                <Button
                                  onClick={() => setInvoiceDetailsDialogOpen(true)}
                                  variant="secondary"
                                >
                                  Edit template defaults
                                </Button>
                                <Button
                                  disabled={workingKey === "invoice-template-create"}
                                  onClick={handleCreateInvoiceTemplate}
                                  variant="secondary"
                                >
                                  {workingKey === "invoice-template-create"
                                    ? "Saving..."
                                    : "Create buyer template"}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="kira-muted-panel">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-kira-black dark:text-white">
                          Invoice details and draft inputs are hidden by default.
                        </p>
                      </div>
                      <Button
                        onClick={() => setInvoiceEditorOpen((current) => !current)}
                        variant="secondary"
                      >
                        {invoiceEditorOpen ? "Hide details" : "Edit details"}
                      </Button>
                    </div>
                  </div>
                  {invoiceEditorOpen ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => setInvoiceDetailsDialogOpen(true)}
                          variant="secondary"
                        >
                          Change invoice details
                        </Button>
                        <Button
                          disabled={workingKey === "invoice-defaults"}
                          onClick={handleUseDefaultInvoiceDetails}
                          variant="secondary"
                        >
                          Use defaults
                        </Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="block text-sm">
                          <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                            Cartons
                          </span>
                          <input
                            className={DOC_INPUT_CLASS}
                            min="0"
                            onChange={(event) => setNumberOfCartons(event.target.value)}
                            step="1"
                            type="number"
                            value={numberOfCartons}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                            Export mode
                          </span>
                          <select
                            className={DOC_INPUT_CLASS}
                            onChange={(event) => setExportMode(event.target.value as ExportMode)}
                            value={exportMode}
                          >
                            <option value="Air">Air</option>
                            <option value="Sea">Sea</option>
                            <option value="Road">Road</option>
                          </select>
                        </label>
                        <label className="block flex-1 text-sm">
                          <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                            Gross weight (kg)
                          </span>
                          <input
                            className={DOC_INPUT_CLASS}
                            min="0"
                            onChange={(event) => setGrossWeight(event.target.value)}
                            step="0.01"
                            type="number"
                            value={grossWeight}
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-end gap-3">
                        <Button
                          disabled={
                            workingKey === "invoice-weight" || workingKey === "invoice-details"
                          }
                          onClick={handleSaveGrossWeight}
                          variant="secondary"
                        >
                          Save draft details
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {invoice.total_amount_words ? (
                    <p className="text-xs leading-5 text-kira-midgray">
                      Amount in words: {invoice.total_amount_words}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3 text-sm text-kira-darkgray dark:text-gray-200">
                  <div className="rounded-2xl border border-kira-warmgray/25 bg-kira-offwhite/40 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto] md:items-end">
                      <label className="block text-sm">
                        <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                          Buyer template
                        </span>
                        <select
                          className={DOC_INPUT_CLASS}
                          onChange={(event) =>
                            setSelectedBuyerTemplateId(event.target.value || null)
                          }
                          value={selectedBuyerTemplateId ?? ""}
                        >
                          <option value="">Use current default layout</option>
                          {buyerTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button onClick={handleUseDefaultInvoiceDetails} variant="secondary">
                        Apply template defaults
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-kira-midgray">
                      {buyerTemplateSummary}
                      {selectedBuyerTemplate
                        ? ` · matched with buyer key "${selectedBuyerTemplate.buyer_key}"`
                        : ""}
                    </p>
                    <div className="mt-3">
                      <Button
                        onClick={() => setInvoiceTemplateEditorOpen((current) => !current)}
                        variant="secondary"
                      >
                        {invoiceTemplateEditorOpen
                          ? "Hide template setup"
                          : "Create or import template"}
                      </Button>
                    </div>
                    {invoiceTemplateEditorOpen ? (
                      <div className="mt-4 space-y-4 rounded-2xl border border-kira-warmgray/20 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-kira-black dark:text-white">
                            Import from sample
                          </p>
                          <p className="text-xs text-kira-midgray">
                            Upload an existing invoice PDF and we&apos;ll prefill the buyer layout
                            and destination blocks before you save the template.
                          </p>
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto] md:items-end">
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Invoice PDF sample
                              </span>
                              <input
                                accept="application/pdf"
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setInvoiceTemplateSampleFile(event.target.files?.[0] ?? null)
                                }
                                type="file"
                              />
                            </label>
                            <Button
                              disabled={isParsingInvoiceTemplate}
                              onClick={handleParseInvoiceTemplateSample}
                              variant="secondary"
                            >
                              {isParsingInvoiceTemplate ? "Parsing..." : "Import sample"}
                            </Button>
                          </div>
                          {parsedInvoiceTemplateSample ? (
                            <p className="text-xs text-kira-midgray">
                              Learned layout: {parsedInvoiceTemplateSample.layout_key}
                              {parsedInvoiceTemplateSample.detected_headers.length > 0
                                ? ` · detected ${parsedInvoiceTemplateSample.detected_headers.join(", ")}`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-kira-black dark:text-white">
                            Create manually
                          </p>
                          <p className="text-xs text-kira-midgray">
                            The template will save the current invoice details. Use the invoice
                            details editor if you want to adjust addresses, GST fields, or stamp
                            defaults first.
                          </p>
                          <div className="grid gap-3 md:grid-cols-3">
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Template name
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setInvoiceTemplateDraft((current) => ({
                                    ...current,
                                    name: event.target.value,
                                  }))
                                }
                                value={invoiceTemplateDraft.name}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Buyer key
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setInvoiceTemplateDraft((current) => ({
                                    ...current,
                                    buyer_key: event.target.value,
                                  }))
                                }
                                value={invoiceTemplateDraft.buyer_key}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Layout
                              </span>
                              <select
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setInvoiceTemplateDraft((current) => ({
                                    ...current,
                                    layout_key: event.target.value as "default_v1" | "landmark_v1",
                                  }))
                                }
                                value={invoiceTemplateDraft.layout_key}
                              >
                                <option value="default_v1">Default v1</option>
                                <option value="landmark_v1">Landmark v1</option>
                              </select>
                            </label>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              onClick={() => setInvoiceDetailsDialogOpen(true)}
                              variant="secondary"
                            >
                              Edit template defaults
                            </Button>
                            <Button
                              disabled={workingKey === "invoice-template-create"}
                              onClick={handleCreateInvoiceTemplate}
                              variant="secondary"
                            >
                              {workingKey === "invoice-template-create"
                                ? "Saving..."
                                : "Create buyer template"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="kira-muted-panel">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-kira-black dark:text-white">
                          Invoice details and draft inputs are hidden by default.
                        </p>
                      </div>
                      <Button
                        onClick={() => setInvoiceEditorOpen((current) => !current)}
                        variant="secondary"
                      >
                        {invoiceEditorOpen ? "Hide details" : "Edit details"}
                      </Button>
                    </div>
                  </div>
                  {invoiceEditorOpen ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => setInvoiceDetailsDialogOpen(true)}
                          variant="secondary"
                        >
                          Change invoice details
                        </Button>
                        <Button onClick={handleUseDefaultInvoiceDetails} variant="secondary">
                          Use defaults
                        </Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="block text-sm">
                          <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                            Cartons
                          </span>
                          <input
                            className={DOC_INPUT_CLASS}
                            min="0"
                            onChange={(event) => setNumberOfCartons(event.target.value)}
                            step="1"
                            type="number"
                            value={numberOfCartons}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                            Export mode
                          </span>
                          <select
                            className={DOC_INPUT_CLASS}
                            onChange={(event) => setExportMode(event.target.value as ExportMode)}
                            value={exportMode}
                          >
                            <option value="Air">Air</option>
                            <option value="Sea">Sea</option>
                            <option value="Road">Road</option>
                          </select>
                        </label>
                      </div>
                      <p className="text-xs leading-5 text-kira-midgray">
                        The invoice draft will snapshot current PO line items so later PO edits do
                        not change the commercial invoice.
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </DocumentCard>
          ) : null}

          {activeTab === "packing" ? (
            <DocumentCard
              actions={
                <>
                  <Button onClick={() => setPackingRulesDialogOpen(true)} variant="secondary">
                    Change packing rules
                  </Button>
                  {!packingList && !invoice ? (
                    <Button disabled variant="secondary">
                      Create invoice first
                    </Button>
                  ) : null}
                  {(() => {
                    const isPackingGenerating =
                      workingKey === "packing-list-create" ||
                      workingKey === "packing-list-pdf" ||
                      workingKey === "generate-all" ||
                      Boolean(pendingPdfs.packing);
                    return (
                      <>
                        {!packingList && invoice ? (
                          <Button
                            disabled={isPackingGenerating}
                            onClick={() => handleCreatePackingList()}
                          >
                            {isPackingGenerating ? "Creating..." : "Create packing list draft"}
                          </Button>
                        ) : null}
                        {packingList ? (
                          <Button
                            onClick={() => setPackingListPreviewOpen(true)}
                            variant="secondary"
                          >
                            Review Cartons
                          </Button>
                        ) : null}
                        {packingList ? (
                          <Button
                            disabled={isPackingGenerating}
                            onClick={() => handleGeneratePackingListPdf()}
                          >
                            {isPackingGenerating ? "Generating..." : "Generate PDF"}
                          </Button>
                        ) : null}
                      </>
                    );
                  })()}
                  {packingList?.file_url ? (
                    <>
                      <Button
                        onClick={() =>
                          setPdfPreviewModal({
                            title: "Packing List Preview",
                            url: packingList.file_url,
                          })
                        }
                        variant="secondary"
                      >
                        Preview
                      </Button>
                      <Button onClick={() => openFile(packingList.file_url)} variant="secondary">
                        Download PDF
                      </Button>
                    </>
                  ) : null}
                </>
              }
              description={
                packingList
                  ? `${packingList.cartons.length} cartons · ${totalPieces} pieces${packingList.invoice_number ? ` · linked to ${packingList.invoice_number}` : ""}`
                  : invoice
                    ? "Create carton assignments from the confirmed PO before generating the final packing-list PDF."
                    : "An invoice draft is required before generating a packing list."
              }
              status={packingList?.status ?? "not created"}
              title="Packing list"
            >
              {!packingList && !invoice ? (
                <p className="text-sm text-kira-midgray">
                  Create an invoice draft first. The packing list will be linked to it so commercial
                  row data stays consistent between documents.
                </p>
              ) : null}
              {!packingList ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-kira-warmgray/25 bg-kira-offwhite/40 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto] md:items-end">
                      <label className="block text-sm">
                        <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                          Packing list template
                        </span>
                        <select
                          aria-label="Packing list template"
                          className={DOC_INPUT_CLASS}
                          onChange={(event) =>
                            setSelectedPackingTemplateId(event.target.value || null)
                          }
                          value={selectedPackingTemplateId ?? ""}
                        >
                          <option value="">Use current default layout</option>
                          {packingTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        onClick={() => setPackingTemplateEditorOpen((current) => !current)}
                        variant="secondary"
                      >
                        Import / Create Template
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-kira-midgray">
                      {packingTemplateSummary}
                      {selectedPackingTemplate
                        ? ` · matched with marketplace key "${selectedPackingTemplate.marketplace_key}"`
                        : ""}
                    </p>
                    {packingTemplateEditorOpen ? (
                      <div className="mt-4 space-y-5">
                        <div className="rounded-xl border border-kira-warmgray/20 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
                          <p className="text-sm font-semibold text-kira-black dark:text-white">
                            Import from sample
                          </p>
                          <p className="mt-1 text-xs text-kira-midgray">
                            Upload an existing packing list PDF and we&apos;ll infer the title and
                            key labels for you.
                          </p>
                          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr),auto]">
                            <input
                              accept=".pdf"
                              className={DOC_INPUT_CLASS}
                              onChange={(event) =>
                                setPackingTemplateSampleFile(event.target.files?.[0] ?? null)
                              }
                              type="file"
                            />
                            <Button
                              disabled={isParsingPackingTemplate}
                              onClick={handleParsePackingTemplateSample}
                              variant="secondary"
                            >
                              {isParsingPackingTemplate ? "Parsing..." : "Import from sample"}
                            </Button>
                          </div>
                          {parsedPackingTemplateSample ? (
                            <p className="mt-2 text-xs text-kira-midgray">
                              Learned title:{" "}
                              {String(
                                (parsedPackingTemplateSample.layout as Record<string, unknown>)
                                  .title ?? packingTemplateDraft.title,
                              )}
                            </p>
                          ) : null}
                        </div>

                        <div className="rounded-xl border border-kira-warmgray/20 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
                          <p className="text-sm font-semibold text-kira-black dark:text-white">
                            Create manually
                          </p>
                          <p className="mt-1 text-xs text-kira-midgray">
                            Set the marketplace key, title, and visible labels yourself.
                          </p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Template name
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    name: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.name}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Marketplace key
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    marketplace_key: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.marketplace_key}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Layout key
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    layout_key: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.layout_key}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Title
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    title: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.title}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                PO label
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    po_number_label: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.po_number_label}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Quantity header
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    quantity_header: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.quantity_header}
                              />
                            </label>
                            <div className="md:col-span-2">
                              <Button
                                disabled={workingKey === "packing-template-create"}
                                onClick={handleCreatePackingTemplate}
                                variant="secondary"
                              >
                                {workingKey === "packing-template-create"
                                  ? "Saving..."
                                  : "Create packing template"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs leading-5 text-kira-midgray">
                    Packing rules apply when a new packing list draft is created.
                  </p>
                </div>
              ) : null}
              {packingList ? (
                <div className="space-y-3 text-sm text-kira-midgray">
                  <div className="rounded-2xl border border-kira-warmgray/25 bg-kira-offwhite/40 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto] md:items-end">
                      <label className="block text-sm">
                        <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                          Packing list template
                        </span>
                        <select
                          aria-label="Packing list template"
                          className={DOC_INPUT_CLASS}
                          onChange={(event) =>
                            setSelectedPackingTemplateId(event.target.value || null)
                          }
                          value={selectedPackingTemplateId ?? ""}
                        >
                          <option value="">Use current default layout</option>
                          {packingTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        onClick={() => setPackingTemplateEditorOpen((current) => !current)}
                        variant="secondary"
                      >
                        Import / Create Template
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-kira-midgray">
                      {packingTemplateSummary}
                      {selectedPackingTemplate
                        ? ` · matched with marketplace key "${selectedPackingTemplate.marketplace_key}"`
                        : ""}
                    </p>
                    {packingTemplateEditorOpen ? (
                      <div className="mt-4 space-y-5">
                        <div className="rounded-xl border border-kira-warmgray/20 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
                          <p className="text-sm font-semibold text-kira-black dark:text-white">
                            Import from sample
                          </p>
                          <p className="mt-1 text-xs text-kira-midgray">
                            Upload an existing packing list PDF and we&apos;ll infer the title and
                            key labels for you.
                          </p>
                          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr),auto]">
                            <input
                              accept=".pdf"
                              className={DOC_INPUT_CLASS}
                              onChange={(event) =>
                                setPackingTemplateSampleFile(event.target.files?.[0] ?? null)
                              }
                              type="file"
                            />
                            <Button
                              disabled={isParsingPackingTemplate}
                              onClick={handleParsePackingTemplateSample}
                              variant="secondary"
                            >
                              {isParsingPackingTemplate ? "Parsing..." : "Import from sample"}
                            </Button>
                          </div>
                          {parsedPackingTemplateSample ? (
                            <p className="mt-2 text-xs text-kira-midgray">
                              Learned title:{" "}
                              {String(
                                (parsedPackingTemplateSample.layout as Record<string, unknown>)
                                  .title ?? packingTemplateDraft.title,
                              )}
                            </p>
                          ) : null}
                        </div>

                        <div className="rounded-xl border border-kira-warmgray/20 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
                          <p className="text-sm font-semibold text-kira-black dark:text-white">
                            Create manually
                          </p>
                          <p className="mt-1 text-xs text-kira-midgray">
                            Set the marketplace key, title, and visible labels yourself.
                          </p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Template name
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    name: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.name}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Marketplace key
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    marketplace_key: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.marketplace_key}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Layout key
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    layout_key: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.layout_key}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Title
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    title: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.title}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                PO label
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    po_number_label: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.po_number_label}
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                                Quantity header
                              </span>
                              <input
                                className={DOC_INPUT_CLASS}
                                onChange={(event) =>
                                  setPackingTemplateDraft((current) => ({
                                    ...current,
                                    quantity_header: event.target.value,
                                  }))
                                }
                                type="text"
                                value={packingTemplateDraft.quantity_header}
                              />
                            </label>
                            <div className="md:col-span-2">
                              <Button
                                disabled={workingKey === "packing-template-create"}
                                onClick={handleCreatePackingTemplate}
                                variant="secondary"
                              >
                                {workingKey === "packing-template-create"
                                  ? "Saving..."
                                  : "Create packing template"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <p>
                    Packing list is ready. Review the full carton breakdown in Preview, then
                    generate the final PDF when everything looks right.
                  </p>
                  <p>
                    Carton details can still be edited from the preview dialog before PDF
                    generation.
                  </p>
                </div>
              ) : null}
            </DocumentCard>
          ) : null}
        </div>
      </div>
      {templatePickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-kira-black/40 px-4 py-8">
          <div
            aria-modal="true"
            className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl dark:border dark:border-white/10 dark:bg-[#12141B]"
            role="dialog"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-kira-black dark:text-white">
                  Choose sticker template
                </h2>
                <p className="mt-1 text-sm text-kira-midgray dark:text-gray-400">
                  Pick a template visually, or create a new one in the builder.
                </p>
              </div>
              <Button onClick={() => setTemplatePickerOpen(false)} variant="secondary">
                Close
              </Button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <button
                className={`rounded-2xl border p-4 text-left transition ${
                  selectedBarcodeTemplate === "styli"
                    ? "border-kira-brown bg-kira-brown/10 dark:border-amber-300/40 dark:bg-amber-300/10"
                    : "border-kira-warmgray/30 bg-transparent hover:border-kira-brown/50 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/25 dark:hover:bg-white/10"
                }`}
                onClick={() => {
                  setSelectedBarcodeTemplate("styli");
                  setSelectedBarcodeMarketplaceTemplateId(null);
                  setTemplatePickerOpen(false);
                }}
                type="button"
              >
                <StandardTemplatePreview />
                <div className="mt-3">
                  <p className="font-medium text-kira-black dark:text-white">Standard format</p>
                  <p className="text-xs text-kira-midgray dark:text-gray-400">
                    Fixed marketplace-compatible sticker sheet
                  </p>
                </div>
              </button>

              {stickerTemplates.map((template) => (
                <button
                  className={`rounded-2xl border p-4 text-left transition ${
                    selectedBarcodeTemplate === template.id
                      ? "border-kira-brown bg-kira-brown/10 dark:border-amber-300/40 dark:bg-amber-300/10"
                      : "border-kira-warmgray/30 bg-transparent hover:border-kira-brown/50 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/25 dark:hover:bg-white/10"
                  }`}
                  key={template.id}
                  onClick={() => {
                    setSelectedBarcodeTemplate(template.id);
                    setSelectedBarcodeMarketplaceTemplateId(null);
                    setTemplatePickerOpen(false);
                  }}
                  type="button"
                >
                  <StickerTemplatePreview template={template} />
                  <div className="mt-3">
                    <p className="font-medium text-kira-black dark:text-white">
                      {template.name}
                      {template.is_default ? " (Default)" : ""}
                    </p>
                    <p className="text-xs text-kira-midgray dark:text-gray-400">
                      {template.width_mm.toFixed(2)} × {template.height_mm.toFixed(2)} mm
                    </p>
                  </div>
                </button>
              ))}

              <button
                className="rounded-2xl border border-dashed border-kira-warmgray/40 bg-transparent p-4 text-left transition hover:border-kira-brown/50 dark:border-white/15 dark:bg-white/5 dark:hover:border-white/25 dark:hover:bg-white/10"
                onClick={() =>
                  router.push(
                    `/dashboard/sticker-builder?returnTo=${encodeURIComponent(
                      `/dashboard/received-pos/${receivedPoId}/documents`,
                    )}&preset=styli`,
                  )
                }
                type="button"
              >
                <div className="flex h-[240px] items-center justify-center rounded-xl border border-dashed border-kira-warmgray/30 bg-kira-offwhite/50 text-sm text-kira-midgray dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                  Create new template
                </div>
                <div className="mt-3">
                  <p className="font-medium text-kira-black dark:text-white">New template</p>
                  <p className="text-xs text-kira-midgray dark:text-gray-400">
                    Open the sticker builder and start from a visual base.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {packingRulesDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-kira-black/40 px-4 py-8">
          <div
            aria-modal="true"
            className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl dark:border dark:border-white/10 dark:bg-[#12141B]"
            role="dialog"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-kira-black dark:text-white">
                  Packing rules
                </h2>
                <p className="mt-1 text-sm text-kira-midgray dark:text-gray-400">
                  Adjust carton split rules here without leaving the received PO workflow. Existing
                  packing list drafts keep their current carton assignments.
                </p>
              </div>
              <Button onClick={() => setPackingRulesDialogOpen(false)} variant="secondary">
                Close
              </Button>
            </div>

            <PackingRulesPanel className="mt-6" />
          </div>
        </div>
      ) : null}
      {packingListPreviewOpen && packingList ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-kira-black/40 px-4 py-8">
          <div
            aria-modal="true"
            className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl dark:border dark:border-white/10 dark:bg-[#12141B]"
            role="dialog"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-kira-black dark:text-white">
                  Packing list preview
                </h2>
                <p className="mt-1 text-sm text-kira-midgray">
                  Review every carton allocation and update carton measurements here before
                  generating the PDF.
                </p>
              </div>
              <Button onClick={() => setPackingListPreviewOpen(false)} variant="secondary">
                Close
              </Button>
            </div>

            <div className="mt-6">
              <CartonBreakdown
                cartons={packingList.cartons}
                lineItems={receivedPO?.items ?? []}
                drafts={cartonDrafts}
                expandAll
                onChange={(cartonId, field, value) =>
                  setCartonDrafts((current) => ({
                    ...current,
                    [cartonId]: {
                      ...(current[cartonId] ?? {
                        gross_weight: "",
                        net_weight: "",
                        dimensions: "",
                      }),
                      [field]: value,
                    },
                  }))
                }
                onSave={handleSaveCarton}
                savingCartonId={savingCartonId}
              />
            </div>
          </div>
        </div>
      ) : null}
      {pdfPreviewModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-kira-black/60 backdrop-blur-sm p-4 md:p-8 animate-in fade-in duration-200">
          <div
            aria-modal="true"
            className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] bg-white shadow-2xl dark:border dark:border-white/10 dark:bg-[#12141B]"
            role="dialog"
          >
            <div className="flex items-center justify-between border-b border-kira-warmgray/20 px-6 py-4 dark:border-white/10">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 font-bold dark:bg-emerald-500/20 dark:text-emerald-400">
                  📄
                </span>
                <div>
                  <h2 className="text-lg font-bold text-kira-black dark:text-white">
                    {pdfPreviewModal.title}
                  </h2>
                  <p className="text-xs text-kira-midgray dark:text-gray-400">
                    Document ready for download or direct printing
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {pdfPreviewModal.url ? (
                  <Button
                    onClick={() => openFile(pdfPreviewModal.url)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 text-xs"
                  >
                    <span>⬇ Download PDF</span>
                  </Button>
                ) : null}
                <Button
                  onClick={() => setPdfPreviewModal(null)}
                  variant="secondary"
                  className="text-xs"
                >
                  Close
                </Button>
              </div>
            </div>
            <div className="flex-1 bg-kira-offwhite/50 p-4 dark:bg-black/40 overflow-hidden flex items-center justify-center">
              {pdfPreviewModal.url ? (
                <iframe
                  src={resolveFileUrl(pdfPreviewModal.url) ?? ""}
                  className="h-full w-full rounded-xl border border-kira-warmgray/30 bg-white shadow-inner dark:border-white/10"
                  title={pdfPreviewModal.title}
                />
              ) : (
                <div className="text-center p-8">
                  <p className="text-sm font-semibold text-kira-darkgray dark:text-gray-300">
                    PDF not generated yet.
                  </p>
                  <p className="text-xs text-kira-midgray mt-1">
                    Please click generate to build the PDF document.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {invoiceDetailsDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-kira-black/40 px-4 py-8">
          <div
            aria-modal="true"
            className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl dark:border dark:border-white/10 dark:bg-[#12141B]"
            role="dialog"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-kira-black dark:text-white">
                  Invoice details
                </h2>
                <p className="mt-1 text-sm text-kira-midgray">
                  Update invoice-specific supplier, delivery, billing, shipping, and origin details
                  here. Settings remain the source of your defaults.
                </p>
              </div>
              <Button onClick={() => setInvoiceDetailsDialogOpen(false)} variant="secondary">
                Close
              </Button>
            </div>

            <div className="mt-6 space-y-6">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-kira-midgray">
                  Supplier
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Supplier name
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("supplier_name", event.target.value)
                      }
                      value={invoiceDetailsDraft.supplier_name}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      FBS name
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("fbs_name", event.target.value)
                      }
                      value={invoiceDetailsDraft.fbs_name}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Vendor company name
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("vendor_company_name", event.target.value)
                      }
                      value={invoiceDetailsDraft.vendor_company_name}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      GST number
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("gst_number", event.target.value)
                      }
                      value={invoiceDetailsDraft.gst_number}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      PAN number
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("pan_number", event.target.value)
                      }
                      value={invoiceDetailsDraft.pan_number}
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Address
                    </span>
                    <textarea
                      className={DOC_TEXTAREA_CLASS}
                      onChange={(event) => updateInvoiceDetailsField("address", event.target.value)}
                      value={invoiceDetailsDraft.address}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">City</span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("supplier_city", event.target.value)
                      }
                      value={invoiceDetailsDraft.supplier_city}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">State</span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("supplier_state", event.target.value)
                      }
                      value={invoiceDetailsDraft.supplier_state}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Pincode
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("supplier_pincode", event.target.value)
                      }
                      value={invoiceDetailsDraft.supplier_pincode}
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-kira-midgray">
                  Delivery And Origin
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Delivery from name
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("delivery_from_name", event.target.value)
                      }
                      value={invoiceDetailsDraft.delivery_from_name}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Delivery from city
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("delivery_from_city", event.target.value)
                      }
                      value={invoiceDetailsDraft.delivery_from_city}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Delivery from pincode
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("delivery_from_pincode", event.target.value)
                      }
                      value={invoiceDetailsDraft.delivery_from_pincode}
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Delivery from address
                    </span>
                    <textarea
                      className={DOC_TEXTAREA_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("delivery_from_address", event.target.value)
                      }
                      value={invoiceDetailsDraft.delivery_from_address}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Origin country
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("origin_country", event.target.value)
                      }
                      value={invoiceDetailsDraft.origin_country}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Origin state
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("origin_state", event.target.value)
                      }
                      value={invoiceDetailsDraft.origin_state}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Origin district
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("origin_district", event.target.value)
                      }
                      value={invoiceDetailsDraft.origin_district}
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-kira-midgray">
                  Bill To And Ship To
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Marketplace label
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("marketplace_name", event.target.value)
                      }
                      value={invoiceDetailsDraft.marketplace_name}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Bill to name
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("bill_to_name", event.target.value)
                      }
                      value={invoiceDetailsDraft.bill_to_name}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Bill to GST
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("bill_to_gst", event.target.value)
                      }
                      value={invoiceDetailsDraft.bill_to_gst}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Bill to PAN
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("bill_to_pan", event.target.value)
                      }
                      value={invoiceDetailsDraft.bill_to_pan}
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Bill to address
                    </span>
                    <textarea
                      className={DOC_TEXTAREA_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("bill_to_address", event.target.value)
                      }
                      value={invoiceDetailsDraft.bill_to_address}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Ship to name
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("ship_to_name", event.target.value)
                      }
                      value={invoiceDetailsDraft.ship_to_name}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Ship to GST
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("ship_to_gst", event.target.value)
                      }
                      value={invoiceDetailsDraft.ship_to_gst}
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Ship to address
                    </span>
                    <textarea
                      className={DOC_TEXTAREA_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("ship_to_address", event.target.value)
                      }
                      value={invoiceDetailsDraft.ship_to_address}
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="mb-1 block text-kira-darkgray dark:text-gray-200">
                      Stamp image URL
                    </span>
                    <input
                      className={DOC_INPUT_CLASS}
                      onChange={(event) =>
                        updateInvoiceDetailsField("stamp_image_url", event.target.value)
                      }
                      value={invoiceDetailsDraft.stamp_image_url}
                    />
                  </label>
                </div>
              </section>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                disabled={workingKey === "invoice-defaults"}
                onClick={handleUseDefaultInvoiceDetails}
                variant="secondary"
              >
                Use defaults
              </Button>
              <Button onClick={() => setInvoiceDetailsDialogOpen(false)} variant="secondary">
                Cancel
              </Button>
              <Button
                disabled={workingKey === "invoice-details"}
                onClick={handleSaveInvoiceDetails}
              >
                {invoice ? "Save details" : "Use these details"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}

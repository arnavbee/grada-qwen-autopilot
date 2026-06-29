// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReceivedPODocumentsView } from "@/src/components/dashboard/received-po-documents-view";
import { ReceivedPOReviewView } from "@/src/components/dashboard/received-po-review-view";
import { ReceivedPOUploadView } from "@/src/components/dashboard/received-po-upload-view";
import type {
  BarcodeJob,
  Invoice,
  InvoiceDetails,
  PackingList,
  ReceivedPO,
} from "@/src/lib/received-po";
import type { MarketplaceDocumentTemplate } from "@/src/lib/marketplace-document-templates";
import type { BrandProfile, BuyerDocumentTemplate, CartonCapacityRule } from "@/src/lib/settings";

const {
  pushMock,
  uploadReceivedPOMock,
  getReceivedPOMock,
  listReceivedPOAgentEventsMock,
  confirmReceivedPOMock,
  listReceivedPOExceptionsMock,
  runReceivedPOExceptionsMock,
  resolveReceivedPOExceptionsBulkMock,
  resolveReceivedPOExceptionMock,
  updateReceivedPOHeaderMock,
  updateReceivedPOItemsMock,
  getOptionalBarcodeJobMock,
  getOptionalInvoiceMock,
  getOptionalPackingListMock,
  createBarcodeJobMock,
  createInvoiceDraftMock,
  updateInvoiceMock,
  generateInvoicePdfMock,
  createPackingListMock,
  updatePackingListCartonMock,
  generatePackingListPdfMock,
  resolveFileUrlMock,
  listStickerTemplatesMock,
  getStickerTemplateMock,
  updateStickerTemplateMock,
  uploadStickerImageMock,
  normalizeStickerAssetUrlForPdfMock,
  getBrandProfileMock,
  listBuyerDocumentTemplatesMock,
  createBuyerDocumentTemplateMock,
  parseBuyerDocumentTemplateSampleMock,
  listCartonRulesMock,
  createCartonRuleMock,
  updateCartonRuleMock,
  deleteCartonRuleMock,
  createMarketplaceDocumentTemplateMock,
  listMarketplaceDocumentTemplatesMock,
  parseMarketplaceTemplateSampleMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  uploadReceivedPOMock: vi.fn(),
  getReceivedPOMock: vi.fn(),
  listReceivedPOAgentEventsMock: vi.fn(),
  confirmReceivedPOMock: vi.fn(),
  listReceivedPOExceptionsMock: vi.fn(),
  runReceivedPOExceptionsMock: vi.fn(),
  resolveReceivedPOExceptionsBulkMock: vi.fn(),
  resolveReceivedPOExceptionMock: vi.fn(),
  updateReceivedPOHeaderMock: vi.fn(),
  updateReceivedPOItemsMock: vi.fn(),
  getOptionalBarcodeJobMock: vi.fn(),
  getOptionalInvoiceMock: vi.fn(),
  getOptionalPackingListMock: vi.fn(),
  createBarcodeJobMock: vi.fn(),
  createInvoiceDraftMock: vi.fn(),
  updateInvoiceMock: vi.fn(),
  generateInvoicePdfMock: vi.fn(),
  createPackingListMock: vi.fn(),
  updatePackingListCartonMock: vi.fn(),
  generatePackingListPdfMock: vi.fn(),
  resolveFileUrlMock: vi.fn((url: string | null | undefined) =>
    url ? `https://files.example.test${url}` : null,
  ),
  listStickerTemplatesMock: vi.fn(),
  getStickerTemplateMock: vi.fn(),
  updateStickerTemplateMock: vi.fn(),
  uploadStickerImageMock: vi.fn(),
  normalizeStickerAssetUrlForPdfMock: vi.fn(),
  getBrandProfileMock: vi.fn(),
  listBuyerDocumentTemplatesMock: vi.fn(),
  createBuyerDocumentTemplateMock: vi.fn(),
  parseBuyerDocumentTemplateSampleMock: vi.fn(),
  listCartonRulesMock: vi.fn(),
  createCartonRuleMock: vi.fn(),
  updateCartonRuleMock: vi.fn(),
  deleteCartonRuleMock: vi.fn(),
  createMarketplaceDocumentTemplateMock: vi.fn(),
  listMarketplaceDocumentTemplatesMock: vi.fn(),
  parseMarketplaceTemplateSampleMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/src/components/dashboard/dashboard-shell", () => ({
  DashboardShell: ({
    title,
    subtitle,
    children,
  }: {
    title?: string;
    subtitle?: string;
    children: ReactNode;
  }) => (
    <div data-testid="dashboard-shell">
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("@/src/lib/received-po", async () => {
  const actual =
    await vi.importActual<typeof import("@/src/lib/received-po")>("@/src/lib/received-po");
  return {
    ...actual,
    uploadReceivedPO: uploadReceivedPOMock,
    getReceivedPO: getReceivedPOMock,
    listReceivedPOAgentEvents: listReceivedPOAgentEventsMock,
    confirmReceivedPO: confirmReceivedPOMock,
    listReceivedPOExceptions: listReceivedPOExceptionsMock,
    runReceivedPOExceptions: runReceivedPOExceptionsMock,
    resolveReceivedPOExceptionsBulk: resolveReceivedPOExceptionsBulkMock,
    resolveReceivedPOException: resolveReceivedPOExceptionMock,
    updateReceivedPOHeader: updateReceivedPOHeaderMock,
    updateReceivedPOItems: updateReceivedPOItemsMock,
    getOptionalBarcodeJob: getOptionalBarcodeJobMock,
    getOptionalInvoice: getOptionalInvoiceMock,
    getOptionalPackingList: getOptionalPackingListMock,
    createBarcodeJob: createBarcodeJobMock,
    createInvoiceDraft: createInvoiceDraftMock,
    updateInvoice: updateInvoiceMock,
    generateInvoicePdf: generateInvoicePdfMock,
    createPackingList: createPackingListMock,
    updatePackingListCarton: updatePackingListCartonMock,
    generatePackingListPdf: generatePackingListPdfMock,
    resolveFileUrl: resolveFileUrlMock,
  };
});

vi.mock("@/src/lib/sticker-templates", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/sticker-templates")>(
    "@/src/lib/sticker-templates",
  );
  return {
    ...actual,
    listStickerTemplates: listStickerTemplatesMock,
    getStickerTemplate: getStickerTemplateMock,
    updateStickerTemplate: updateStickerTemplateMock,
    uploadStickerImage: uploadStickerImageMock,
  };
});

vi.mock("@/src/lib/settings", () => ({
  getBrandProfile: getBrandProfileMock,
  listBuyerDocumentTemplates: listBuyerDocumentTemplatesMock,
  createBuyerDocumentTemplate: createBuyerDocumentTemplateMock,
  parseBuyerDocumentTemplateSample: parseBuyerDocumentTemplateSampleMock,
  listCartonRules: listCartonRulesMock,
  createCartonRule: createCartonRuleMock,
  updateCartonRule: updateCartonRuleMock,
  deleteCartonRule: deleteCartonRuleMock,
}));

vi.mock("@/src/lib/marketplace-document-templates", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/marketplace-document-templates")>(
    "@/src/lib/marketplace-document-templates",
  );
  return {
    ...actual,
    createMarketplaceDocumentTemplate: createMarketplaceDocumentTemplateMock,
    listMarketplaceDocumentTemplates: listMarketplaceDocumentTemplatesMock,
    parseMarketplaceTemplateSample: parseMarketplaceTemplateSampleMock,
  };
});

vi.mock("@/src/lib/sticker-asset-pdf", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/sticker-asset-pdf")>(
    "@/src/lib/sticker-asset-pdf",
  );
  return {
    ...actual,
    normalizeStickerAssetUrlForPdf: normalizeStickerAssetUrlForPdfMock,
  };
});

const DEFAULT_INVOICE_DETAILS: InvoiceDetails = {
  marketplace_name: "Styli",
  supplier_name: "Documents Co",
  address: "123 Export Lane, Gurugram",
  gst_number: "07ABCDE1234F1Z5",
  pan_number: "ABCDE1234F",
  fbs_name: "FBS-DOCUMENTS CO",
  vendor_company_name: "Documents Co",
  supplier_city: "Gurugram",
  supplier_state: "Haryana",
  supplier_pincode: "122004",
  delivery_from_name: "Documents Co Warehouse",
  delivery_from_address: "Warehouse 4, IMT Manesar",
  delivery_from_city: "Gurugram",
  delivery_from_pincode: "122004",
  origin_country: "India",
  origin_state: "Haryana",
  origin_district: "Gurugram",
  bill_to_name: "Documents Buyer",
  bill_to_address: "Sector 44, Gurugram",
  bill_to_gst: "06ABCDE1234F1Z5",
  bill_to_pan: "ABCDE1234F",
  ship_to_name: "Documents Buyer",
  ship_to_address: "Sector 44, Gurugram",
  ship_to_gst: "06ABCDE1234F1Z5",
  stamp_image_url: "",
};

function buildBrandProfile(): BrandProfile {
  return {
    company_id: "co_1",
    supplier_name: DEFAULT_INVOICE_DETAILS.supplier_name,
    address: DEFAULT_INVOICE_DETAILS.address,
    gst_number: DEFAULT_INVOICE_DETAILS.gst_number,
    pan_number: DEFAULT_INVOICE_DETAILS.pan_number,
    fbs_name: DEFAULT_INVOICE_DETAILS.fbs_name,
    vendor_company_name: DEFAULT_INVOICE_DETAILS.vendor_company_name,
    supplier_city: DEFAULT_INVOICE_DETAILS.supplier_city,
    supplier_state: DEFAULT_INVOICE_DETAILS.supplier_state,
    supplier_pincode: DEFAULT_INVOICE_DETAILS.supplier_pincode,
    delivery_from_name: DEFAULT_INVOICE_DETAILS.delivery_from_name,
    delivery_from_address: DEFAULT_INVOICE_DETAILS.delivery_from_address,
    delivery_from_city: DEFAULT_INVOICE_DETAILS.delivery_from_city,
    delivery_from_pincode: DEFAULT_INVOICE_DETAILS.delivery_from_pincode,
    origin_country: DEFAULT_INVOICE_DETAILS.origin_country,
    origin_state: DEFAULT_INVOICE_DETAILS.origin_state,
    origin_district: DEFAULT_INVOICE_DETAILS.origin_district,
    bill_to_name: DEFAULT_INVOICE_DETAILS.bill_to_name,
    bill_to_address: DEFAULT_INVOICE_DETAILS.bill_to_address,
    bill_to_gst: DEFAULT_INVOICE_DETAILS.bill_to_gst,
    bill_to_pan: DEFAULT_INVOICE_DETAILS.bill_to_pan,
    ship_to_name: DEFAULT_INVOICE_DETAILS.ship_to_name,
    ship_to_address: DEFAULT_INVOICE_DETAILS.ship_to_address,
    ship_to_gst: DEFAULT_INVOICE_DETAILS.ship_to_gst,
    stamp_image_url: DEFAULT_INVOICE_DETAILS.stamp_image_url,
    instagram_handle: "",
    website_url: "",
    facebook_handle: "",
    snapchat_handle: "",
    invoice_prefix: "INV",
    default_igst_rate: 5,
  };
}

function buildCartonRules(): CartonCapacityRule[] {
  return [
    {
      id: "rule_1",
      company_id: "co_1",
      category: "Dresses",
      pieces_per_carton: 20,
      is_default: true,
    },
  ];
}

function buildBuyerTemplates(): BuyerDocumentTemplate[] {
  return [];
}

function buildPackingTemplates(): MarketplaceDocumentTemplate[] {
  return [];
}

function buildReceivedPO(status: ReceivedPO["status"]): ReceivedPO {
  return {
    id: "po_1",
    company_id: "co_1",
    file_url: "/static/uploads/received-pos/po_1.xlsx",
    po_number: "STY-2026-001",
    po_date: "2026-03-24T00:00:00+00:00",
    distributor: "Styli",
    status,
    raw_extracted: {},
    created_at: "2026-03-24T00:00:00+00:00",
    updated_at: "2026-03-24T00:00:00+00:00",
    items: [
      {
        id: "item_1",
        received_po_id: "po_1",
        brand_style_code: "HRDS25001",
        styli_style_id: "STY-1",
        model_number: "MOD-1",
        option_id: "OPT-BLK",
        sku_id: "HRDS25001-BLK-S",
        color: "Black",
        size: "S",
        quantity: 10,
        po_price: 499,
        created_at: "2026-03-24T00:00:00+00:00",
        updated_at: "2026-03-24T00:00:00+00:00",
      },
    ],
  };
}

function buildReceivedPOWithOverrides(
  status: ReceivedPO["status"],
  overrides: Partial<ReceivedPO["items"][number]>,
): ReceivedPO {
  const base = buildReceivedPO(status);
  return {
    ...base,
    items: base.items.map((item) => ({
      ...item,
      ...overrides,
    })),
  };
}

function buildReceivedPOExceptions() {
  return {
    received_po_id: "po_1",
    status: "parsed" as const,
    summary: {
      total: 1,
      auto_resolved: 0,
      needs_review: 1,
      human_corrected: 0,
      auto_resolve_rate: 0,
    },
    items: [
      {
        id: "item_1",
        received_po_id: "po_1",
        brand_style_code: "HRDS25001",
        styli_style_id: "STY-1",
        model_number: "MOD-1",
        option_id: "OPT-BLK",
        sku_id: "HRDS25001-BLK-S",
        color: "Black",
        size: "S",
        quantity: 10,
        po_price: 499,
        confidence_score: 0.64,
        resolution_status: "needs_review",
        exception_reason: "po_price_missing_or_zero",
        suggested_fix: {},
        created_at: "2026-03-24T00:00:00+00:00",
        updated_at: "2026-03-24T00:00:00+00:00",
      },
    ],
  };
}

function buildInvoice(status: Invoice["status"], fileUrl: string | null = null): Invoice {
  return {
    id: "inv_1",
    received_po_id: "po_1",
    company_id: "co_1",
    invoice_number: "INV-2026-001",
    invoice_date: "2026-03-24T00:00:00+00:00",
    number_of_cartons: 9,
    export_mode: "Air",
    gross_weight: 12.5,
    total_quantity: 10,
    subtotal: 4990,
    igst_rate: 5,
    igst_amount: 249.5,
    cgst_amount: 0,
    sgst_amount: 0,
    tax_mode: "interstate",
    total_amount: 5239.5,
    total_amount_words: "Five Thousand Two Hundred Thirty Nine and Fifty Paisa only",
    status,
    file_url: fileUrl,
    created_at: "2026-03-24T00:00:00+00:00",
    updated_at: "2026-03-24T00:00:00+00:00",
    buyer_template_id: null,
    buyer_template_name: null,
    layout_key: "default_v1",
    details: DEFAULT_INVOICE_DETAILS,
  };
}

function buildBarcodeJob(status: BarcodeJob["status"], fileUrl: string | null = null): BarcodeJob {
  return {
    id: "job_1",
    received_po_id: "po_1",
    status,
    template_kind: "styli",
    template_id: null,
    marketplace_template_id: null,
    marketplace_template_name: null,
    file_url: fileUrl,
    total_stickers: 1,
    total_pages: 1,
    created_at: "2026-03-24T00:00:00+00:00",
  };
}

function buildPackingList(
  status: PackingList["status"],
  fileUrl: string | null = null,
): PackingList {
  return {
    id: "pl_1",
    received_po_id: "po_1",
    company_id: "co_1",
    invoice_id: "inv_1",
    invoice_number: "INV-2026-001",
    invoice_date: "2026-03-24T00:00:00+00:00",
    template_id: null,
    template_name: null,
    layout_key: "default_v1",
    status,
    file_url: fileUrl,
    created_at: "2026-03-24T00:00:00+00:00",
    cartons: [
      {
        id: "carton_1",
        packing_list_id: "pl_1",
        carton_number: 1,
        gross_weight: 12.4,
        net_weight: 10.8,
        dimensions: "60x40x40 cm",
        total_pieces: 20,
        created_at: "2026-03-24T00:00:00+00:00",
        updated_at: "2026-03-24T00:00:00+00:00",
        items: [
          {
            id: "carton_item_1",
            carton_id: "carton_1",
            line_item_id: "item_1",
            pieces_in_carton: 20,
            created_at: "2026-03-24T00:00:00+00:00",
          },
        ],
      },
    ],
  };
}

async function openDocumentsTab(name: "Invoice" | "Packing List"): Promise<void> {
  const tabButton = screen.getByRole("button", { name: new RegExp(name, "i") });
  expect(tabButton).not.toBeNull();
  fireEvent.click(tabButton as HTMLElement);
}

describe("received PO dashboard flows", () => {
  beforeEach(() => {
    pushMock.mockReset();
    uploadReceivedPOMock.mockReset();
    getReceivedPOMock.mockReset();
    listReceivedPOAgentEventsMock.mockReset();
    listReceivedPOAgentEventsMock.mockResolvedValue({
      received_po_id: "po_1",
      items: [
        {
          id: "event_1",
          received_po_id: "po_1",
          event_type: "agent.parse_completed",
          title: "PO extracted and normalized",
          summary: "The autopilot extracted 1 line item and found 1 requiring review.",
          status: "needs_review",
          actor_type: "agent",
          tool_name: "received_po_parser",
          metadata: {},
          created_at: "2026-03-24T00:00:00+00:00",
        },
      ],
    });
    confirmReceivedPOMock.mockReset();
    listReceivedPOExceptionsMock.mockReset();
    listReceivedPOExceptionsMock.mockResolvedValue(buildReceivedPOExceptions());
    runReceivedPOExceptionsMock.mockReset();
    runReceivedPOExceptionsMock.mockResolvedValue(buildReceivedPOExceptions());
    resolveReceivedPOExceptionsBulkMock.mockReset();
    resolveReceivedPOExceptionsBulkMock.mockResolvedValue({
      received_po_id: "po_1",
      processed_count: 0,
      summary: buildReceivedPOExceptions().summary,
      items: buildReceivedPOExceptions().items,
    });
    resolveReceivedPOExceptionMock.mockReset();
    resolveReceivedPOExceptionMock.mockResolvedValue(buildReceivedPOExceptions());
    updateReceivedPOHeaderMock.mockReset();
    updateReceivedPOItemsMock.mockReset();
    getOptionalBarcodeJobMock.mockReset();
    getOptionalInvoiceMock.mockReset();
    getOptionalPackingListMock.mockReset();
    createBarcodeJobMock.mockReset();
    createInvoiceDraftMock.mockReset();
    updateInvoiceMock.mockReset();
    generateInvoicePdfMock.mockReset();
    createPackingListMock.mockReset();
    updatePackingListCartonMock.mockReset();
    generatePackingListPdfMock.mockReset();
    resolveFileUrlMock.mockClear();
    listStickerTemplatesMock.mockReset();
    listStickerTemplatesMock.mockResolvedValue([]);
    getStickerTemplateMock.mockReset();
    updateStickerTemplateMock.mockReset();
    uploadStickerImageMock.mockReset();
    normalizeStickerAssetUrlForPdfMock.mockReset();
    normalizeStickerAssetUrlForPdfMock.mockResolvedValue(
      new File(["png"], "logo.png", { type: "image/png" }),
    );
    getBrandProfileMock.mockReset();
    getBrandProfileMock.mockResolvedValue(buildBrandProfile());
    listBuyerDocumentTemplatesMock.mockReset();
    listBuyerDocumentTemplatesMock.mockResolvedValue(buildBuyerTemplates());
    createBuyerDocumentTemplateMock.mockReset();
    parseBuyerDocumentTemplateSampleMock.mockReset();
    listMarketplaceDocumentTemplatesMock.mockReset();
    listMarketplaceDocumentTemplatesMock.mockResolvedValue(buildPackingTemplates());
    createMarketplaceDocumentTemplateMock.mockReset();
    parseMarketplaceTemplateSampleMock.mockReset();
    listCartonRulesMock.mockReset();
    listCartonRulesMock.mockResolvedValue(buildCartonRules());
    createCartonRuleMock.mockReset();
    updateCartonRuleMock.mockReset();
    deleteCartonRuleMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("polls received PO parsing and redirects once parsed", async () => {
    vi.useFakeTimers();
    uploadReceivedPOMock.mockResolvedValue({ received_po_id: "po_1", status: "uploaded" });
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("parsed"));

    const { container } = render(<ReceivedPOUploadView />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    const file = new File(["po"], "styli-po.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await act(async () => {
      fireEvent.change(fileInput!, { target: { files: [file] } });
    });

    expect(uploadReceivedPOMock).toHaveBeenCalledWith(file);
    expect(screen.getByText("AI is reading your PO...")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(pushMock).toHaveBeenCalledWith("/dashboard/received-pos/po_1");
  });

  it("locks the review form after confirmation", async () => {
    getReceivedPOMock
      .mockResolvedValueOnce(buildReceivedPO("parsed"))
      .mockResolvedValueOnce(buildReceivedPO("confirmed"));
    confirmReceivedPOMock.mockResolvedValue({ id: "po_1", status: "confirmed" });

    render(<ReceivedPOReviewView receivedPoId="po_1" />);

    const poNumberInput = (await screen.findByDisplayValue("STY-2026-001")) as HTMLInputElement;
    expect(poNumberInput.disabled).toBe(false);

    await userEvent.setup().click(screen.getByRole("button", { name: "Confirm PO data" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirmed. Open documents" })).toBeTruthy();
    });
    expect((screen.getByDisplayValue("STY-2026-001") as HTMLInputElement).disabled).toBe(true);
  });

  it("allows editing line items before confirmation and saves the updated payload", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("parsed"));
    updateReceivedPOItemsMock.mockResolvedValue(
      buildReceivedPOWithOverrides("parsed", {
        model_number: "MOD-2",
        quantity: 12,
      }),
    );

    render(<ReceivedPOReviewView receivedPoId="po_1" />);

    const modelNumberInput = (await screen.findByDisplayValue("MOD-1")) as HTMLInputElement;
    const quantityInput = screen.getByDisplayValue("10") as HTMLInputElement;

    await userEvent.setup().clear(modelNumberInput);
    await userEvent.setup().type(modelNumberInput, "MOD-2");
    await userEvent.setup().clear(quantityInput);
    await userEvent.setup().type(quantityInput, "12");
    await userEvent.setup().click(screen.getByRole("button", { name: "Save line items" }));

    await waitFor(() => {
      expect(updateReceivedPOItemsMock).toHaveBeenCalledWith("po_1", [
        {
          id: "item_1",
          brand_style_code: "HRDS25001",
          styli_style_id: "STY-1",
          model_number: "MOD-2",
          option_id: "OPT-BLK",
          sku_id: "HRDS25001-BLK-S",
          color: "Black",
          size: "S",
          quantity: 12,
          po_price: 499,
        },
      ]);
    });

    expect(screen.getByDisplayValue("MOD-2")).toBeTruthy();
    expect(screen.getByDisplayValue("12")).toBeTruthy();
    expect(screen.getByText("Line items saved.")).toBeTruthy();
  });

  it("transitions the invoice document card from create to generate", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock.mockResolvedValue(null);
    getOptionalPackingListMock.mockResolvedValue(null);
    createInvoiceDraftMock.mockResolvedValue(buildInvoice("draft"));
    generateInvoicePdfMock.mockResolvedValue({
      invoice_id: "inv_1",
      status: "draft",
      file_url: null,
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await openDocumentsTab("Invoice");
    await screen.findByRole("button", { name: "Create invoice" });

    await userEvent.setup().click(screen.getByRole("button", { name: "Create invoice" }));

    await waitFor(() => {
      expect(createInvoiceDraftMock).toHaveBeenCalledWith("po_1", {
        number_of_cartons: 0,
        export_mode: "Air",
        buyer_template_id: null,
        details: DEFAULT_INVOICE_DETAILS,
      });
    });
    expect(screen.getByRole("button", { name: "Generate invoice PDF" })).toBeTruthy();
    expect(screen.getAllByText(/INV-2026-001/i).length).toBeGreaterThan(0);

    await userEvent.setup().click(screen.getByRole("button", { name: "Generate invoice PDF" }));

    await waitFor(() => {
      expect(generateInvoicePdfMock).toHaveBeenCalledWith("po_1");
    });
    expect(screen.getByText("Invoice PDF generation started.")).toBeTruthy();
  });

  it("lets users override invoice details from the documents page", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock.mockResolvedValue(buildInvoice("draft"));
    getOptionalPackingListMock.mockResolvedValue(null);
    updateInvoiceMock.mockResolvedValue({
      ...buildInvoice("draft"),
      details: {
        ...DEFAULT_INVOICE_DETAILS,
        vendor_company_name: "Modern Sanskriti",
      },
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await openDocumentsTab("Invoice");
    await screen.findByRole("button", { name: "Edit details" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Edit details" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Change invoice details" }));

    const dialog = await screen.findByRole("dialog");
    const vendorCompanyInput = within(dialog).getByLabelText("Vendor company name");
    await userEvent.setup().clear(vendorCompanyInput);
    await userEvent.setup().type(vendorCompanyInput, "Modern Sanskriti");
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Save details" }));

    await waitFor(() => {
      expect(updateInvoiceMock).toHaveBeenCalledWith("po_1", {
        gross_weight: 12.5,
        number_of_cartons: 9,
        export_mode: "Air",
        buyer_template_id: null,
        details: {
          ...DEFAULT_INVOICE_DETAILS,
          vendor_company_name: "Modern Sanskriti",
        },
      });
    });
  });

  it("can learn an invoice buyer template from a sample before saving it", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock.mockResolvedValue(null);
    getOptionalPackingListMock.mockResolvedValue(null);
    parseBuyerDocumentTemplateSampleMock.mockResolvedValue({
      document_type: "invoice",
      file_format: "pdf",
      sample_file_url: "/static/uploads/buyer-document-templates/sample.pdf",
      layout_key: "landmark_v1",
      detected_headers: ["LANDMARK COMMERCIAL INVOICE", "Bill To GST No: 29AAAAA0000A1Z5"],
      defaults: {
        ...DEFAULT_INVOICE_DETAILS,
        marketplace_name: "Landmark",
        bill_to_name: "Landmark Buying House",
        bill_to_address: "Landmark Towers, Bengaluru",
        bill_to_gst: "29AAAAA0000A1Z5",
        ship_to_name: "Landmark Warehouse",
        ship_to_address: "Landmark Logistics Park",
        ship_to_gst: "29BBBBB0000B1Z5",
      },
    });
    createBuyerDocumentTemplateMock.mockResolvedValue({
      id: "buyer_template_1",
      company_id: "co_1",
      name: "Landmark Invoice",
      buyer_key: "Landmark",
      document_type: "invoice",
      layout_key: "landmark_v1",
      defaults: {
        ...DEFAULT_INVOICE_DETAILS,
        marketplace_name: "Landmark",
        bill_to_name: "Landmark Buying House",
        bill_to_address: "Landmark Towers, Bengaluru",
        bill_to_gst: "29AAAAA0000A1Z5",
        ship_to_name: "Landmark Warehouse",
        ship_to_address: "Landmark Logistics Park",
        ship_to_gst: "29BBBBB0000B1Z5",
      },
      is_default: false,
      is_active: true,
      created_at: "2026-03-24T00:00:00+00:00",
      updated_at: "2026-03-24T00:00:00+00:00",
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await openDocumentsTab("Invoice");
    await screen.findByRole("button", { name: "Create or import template" });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Create or import template" }));

    const fileInput = screen.getByLabelText("Invoice PDF sample") as HTMLInputElement;
    const sampleFile = new File(["invoice"], "invoice.pdf", { type: "application/pdf" });
    await userEvent.setup().upload(fileInput, sampleFile);
    await userEvent.setup().click(screen.getByRole("button", { name: "Import sample" }));

    await waitFor(() => {
      expect(parseBuyerDocumentTemplateSampleMock).toHaveBeenCalledWith(sampleFile);
    });

    await userEvent.setup().click(screen.getByRole("button", { name: "Create buyer template" }));

    await waitFor(() => {
      expect(createBuyerDocumentTemplateMock).toHaveBeenCalledWith({
        name: "Landmark Invoice",
        buyer_key: "Landmark",
        document_type: "invoice",
        layout_key: "landmark_v1",
        defaults: {
          ...DEFAULT_INVOICE_DETAILS,
          marketplace_name: "Landmark",
          bill_to_name: "Landmark Buying House",
          bill_to_address: "Landmark Towers, Bengaluru",
          bill_to_gst: "29AAAAA0000A1Z5",
          ship_to_name: "Landmark Warehouse",
          ship_to_address: "Landmark Logistics Park",
          ship_to_gst: "29BBBBB0000B1Z5",
        },
        is_default: false,
        is_active: true,
      });
    });
    expect(screen.getByText("Buyer template saved.")).toBeTruthy();
  });

  it("shows CGST + SGST for intrastate invoices", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalPackingListMock.mockResolvedValue(null);
    getBrandProfileMock.mockResolvedValue(buildBrandProfile());
    getOptionalInvoiceMock.mockResolvedValue({
      ...buildInvoice("draft"),
      tax_mode: "intrastate",
      igst_amount: 0,
      cgst_amount: 124.75,
      sgst_amount: 124.75,
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await openDocumentsTab("Invoice");
    expect(await screen.findByText("CGST + SGST")).toBeTruthy();
    expect(screen.getByText("INR 249.50")).toBeTruthy();
  });

  it("uses resolved file URLs from document cards when downloads are available", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(
      buildBarcodeJob("done", "/static/generated/barcodes/po_1.pdf"),
    );
    getOptionalInvoiceMock.mockResolvedValue(
      buildInvoice("final", "/static/generated/invoices/inv_1.pdf"),
    );
    getOptionalPackingListMock.mockResolvedValue(
      buildPackingList("final", "/static/generated/packing-lists/pl_1.pdf"),
    );

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await openDocumentsTab("Invoice");
    const invoiceHeading = await screen.findByRole("heading", { name: "Invoice" });
    const invoiceCard = invoiceHeading.closest(".surface-card");
    expect(invoiceCard).not.toBeNull();

    await userEvent
      .setup()
      .click(within(invoiceCard as HTMLElement).getByRole("button", { name: "Download PDF" }));

    expect(resolveFileUrlMock).toHaveBeenCalledWith("/static/generated/invoices/inv_1.pdf");
    expect(openSpy).toHaveBeenCalledWith(
      "https://files.example.test/static/generated/invoices/inv_1.pdf",
      "_blank",
      "noopener,noreferrer",
    );

    openSpy.mockRestore();
  });

  it("tracks the newly created barcode job and clears stale downloads while regenerating", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock
      .mockResolvedValueOnce(buildBarcodeJob("done", "/static/generated/barcodes/old.pdf"))
      .mockResolvedValueOnce({
        ...buildBarcodeJob("pending"),
        id: "job_2",
        template_kind: "custom",
        template_id: "template_2",
        file_url: null,
      });
    getOptionalInvoiceMock.mockResolvedValue(null);
    getOptionalPackingListMock.mockResolvedValue(null);
    listStickerTemplatesMock.mockResolvedValue([
      {
        id: "template_2",
        company_id: "co_1",
        name: "new-one",
        width_mm: 44,
        height_mm: 74,
        border_color: "#E34A93",
        border_radius_mm: 2,
        background_color: "#FFFFFF",
        is_default: false,
        created_at: "2026-03-24T00:00:00+00:00",
        updated_at: "2026-03-24T00:00:00+00:00",
        elements: [],
      },
    ]);
    getStickerTemplateMock.mockResolvedValue({
      id: "template_2",
      company_id: "co_1",
      name: "new-one",
      width_mm: 44,
      height_mm: 74,
      border_color: "#E34A93",
      border_radius_mm: 2,
      background_color: "#FFFFFF",
      is_default: false,
      created_at: "2026-03-24T00:00:00+00:00",
      updated_at: "2026-03-24T00:00:00+00:00",
      elements: [],
    });
    createBarcodeJobMock.mockResolvedValue({
      job_id: "job_2",
      status: "pending",
      marketplace_template_id: null,
      marketplace_template_name: null,
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    expect(await screen.findByRole("button", { name: "Download PDF" })).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "Generate barcodes" }));

    await waitFor(() => {
      expect(createBarcodeJobMock).toHaveBeenCalledWith("po_1", {
        template_kind: "styli",
        marketplace_template_id: null,
      });
      expect(getOptionalBarcodeJobMock).toHaveBeenLastCalledWith("po_1", "job_2");
    });
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(screen.getByText("Barcode generation started.")).toBeTruthy();
  });

  it("stops barcode generation with a clear error when template images cannot be prepared", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock.mockResolvedValue(null);
    getOptionalPackingListMock.mockResolvedValue(null);
    listStickerTemplatesMock.mockResolvedValue([
      {
        id: "template_2",
        company_id: "co_1",
        name: "kita",
        width_mm: 45.03,
        height_mm: 60,
        border_color: "#E34A93",
        border_radius_mm: 2,
        background_color: "#FFFFFF",
        is_default: false,
        created_at: "2026-03-24T00:00:00+00:00",
        updated_at: "2026-03-24T00:00:00+00:00",
        elements: [],
      },
    ]);
    getStickerTemplateMock.mockResolvedValue({
      id: "template_2",
      company_id: "co_1",
      name: "kita",
      width_mm: 45.03,
      height_mm: 60,
      border_color: "#E34A93",
      border_radius_mm: 2,
      background_color: "#FFFFFF",
      is_default: false,
      created_at: "2026-03-24T00:00:00+00:00",
      updated_at: "2026-03-24T00:00:00+00:00",
      elements: [
        {
          id: "img_1",
          template_id: "template_2",
          element_type: "image",
          x_mm: 10,
          y_mm: 5,
          width_mm: 20,
          height_mm: 8,
          z_index: 0,
          properties: {
            asset_type: "custom",
            asset_url: "https://pub.example.test/logo.png",
            fit: "contain",
          },
          created_at: "2026-03-24T00:00:00+00:00",
          updated_at: "2026-03-24T00:00:00+00:00",
        },
      ],
    });
    normalizeStickerAssetUrlForPdfMock.mockRejectedValue(
      new Error("Unable to fetch sticker asset for PDF generation."),
    );

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Sticker template" }));
    const templateLabel = await screen.findByText("kita");
    const templateButton = templateLabel.closest("button");
    expect(templateButton).not.toBeNull();
    await userEvent.setup().click(templateButton as HTMLElement);
    await userEvent.setup().click(screen.getByRole("button", { name: "Generate barcodes" }));

    await waitFor(() => {
      expect(createBarcodeJobMock).not.toHaveBeenCalled();
    });
    expect(
      screen.getByText(
        "Template logo/image could not be prepared for PDF. Re-upload it in the sticker builder, save the template, and try again.",
      ),
    ).toBeTruthy();
  });

  it("passes the selected marketplace barcode template into barcode generation", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock.mockResolvedValue(null);
    getOptionalPackingListMock.mockResolvedValue(null);
    listMarketplaceDocumentTemplatesMock.mockImplementation(async (documentType?: string) => {
      if (documentType === "barcode") {
        return [
          {
            id: "barcode_tpl_1",
            company_id: "co_1",
            name: "Styli Barcode",
            marketplace_key: "styli",
            document_type: "barcode",
            template_kind: "sticker",
            file_format: "pdf",
            sample_file_url: null,
            sheet_name: null,
            header_row_index: 1,
            columns: [],
            layout: {
              sticker_template_kind: "styli",
              width_mm: 45.03,
              height_mm: 60,
            },
            is_default: true,
            is_active: true,
            created_at: "2026-03-24T00:00:00+00:00",
            updated_at: "2026-03-24T00:00:00+00:00",
          },
        ];
      }
      return [];
    });
    createBarcodeJobMock.mockResolvedValue({
      job_id: "job_3",
      status: "pending",
      marketplace_template_id: "barcode_tpl_1",
      marketplace_template_name: "Styli Barcode",
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await act(async () => {});
    expect((screen.getByLabelText("Marketplace barcode template") as HTMLSelectElement).value).toBe(
      "barcode_tpl_1",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Generate barcodes" }));

    await waitFor(() =>
      expect(createBarcodeJobMock).toHaveBeenCalledWith("po_1", {
        template_kind: "styli",
        marketplace_template_id: "barcode_tpl_1",
      }),
    );
  });

  it("can learn a barcode template from a sample before saving it", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock.mockResolvedValue(null);
    getOptionalPackingListMock.mockResolvedValue(null);
    parseMarketplaceTemplateSampleMock.mockResolvedValue({
      document_type: "barcode",
      template_kind: "sticker",
      file_format: "png",
      sample_file_url: "/static/uploads/marketplace-templates/sample.png",
      sheet_name: null,
      header_row_index: 1,
      detected_headers: [],
      columns: [],
      layout: {
        width_mm: 45.03,
        height_mm: 60,
        measurement_source: "image_dpi",
      },
    });
    createMarketplaceDocumentTemplateMock.mockResolvedValue({
      id: "barcode_tpl_new",
      company_id: "co_1",
      name: "Styli Barcode",
      marketplace_key: "Styli",
      document_type: "barcode",
      template_kind: "sticker",
      file_format: "png",
      sample_file_url: "/static/uploads/marketplace-templates/sample.png",
      sheet_name: null,
      header_row_index: 1,
      columns: [],
      layout: {
        sticker_template_kind: "styli",
        sticker_template_id: null,
        width_mm: 45.03,
        height_mm: 60,
      },
      is_default: false,
      is_active: true,
      created_at: "2026-03-24T00:00:00+00:00",
      updated_at: "2026-03-24T00:00:00+00:00",
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await act(async () => {});
    await userEvent.setup().click(screen.getByRole("button", { name: "Import / Create Template" }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    await userEvent
      .setup()
      .upload(fileInput, new File(["image"], "barcode.png", { type: "image/png" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Import from sample" }));

    await waitFor(() =>
      expect(parseMarketplaceTemplateSampleMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: "barcode.png" }),
        "barcode",
      ),
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Create barcode template" }));

    await waitFor(() =>
      expect(createMarketplaceDocumentTemplateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          document_type: "barcode",
          file_format: "png",
          sample_file_url: "/static/uploads/marketplace-templates/sample.png",
        }),
      ),
    );
  });

  it("stops invoice PDF polling and shows an error when generation fails", async () => {
    vi.useFakeTimers();
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock
      .mockResolvedValueOnce(buildInvoice("draft"))
      .mockResolvedValueOnce(buildInvoice("failed"));
    getOptionalPackingListMock.mockResolvedValue(null);
    generateInvoicePdfMock.mockResolvedValue({
      invoice_id: "inv_1",
      status: "draft",
      file_url: null,
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await act(async () => {});
    await openDocumentsTab("Invoice");
    fireEvent.click(screen.getByRole("button", { name: "Generate invoice PDF" }));
    await act(async () => {});
    expect(generateInvoicePdfMock).toHaveBeenCalledWith("po_1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(screen.getByText("Invoice PDF generation failed. Please try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate invoice PDF" })).toBeTruthy();
  });

  it("stops packing list PDF polling and shows an error when generation fails", async () => {
    vi.useFakeTimers();
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock.mockResolvedValue(
      buildInvoice("final", "/static/generated/invoices/inv_1.pdf"),
    );
    getOptionalPackingListMock
      .mockResolvedValueOnce(buildPackingList("draft"))
      .mockResolvedValueOnce(buildPackingList("failed"));
    createPackingListMock.mockResolvedValue({
      packing_list_id: "pl_1",
      total_cartons: 1,
      total_pieces: 20,
      template_id: null,
      template_name: null,
      layout_key: "default_v1",
    });
    generatePackingListPdfMock.mockResolvedValue({
      packing_list_id: "pl_1",
      status: "draft",
      file_url: null,
      template_id: null,
      template_name: null,
      layout_key: "default_v1",
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await act(async () => {});
    await openDocumentsTab("Packing List");
    fireEvent.click(screen.getByRole("button", { name: "Generate PDF" }));
    await act(async () => {});
    expect(generatePackingListPdfMock).toHaveBeenCalledWith("po_1", { template_id: null });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(screen.getByText("Packing list PDF generation failed. Please try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate PDF" })).toBeTruthy();
  });

  it("opens packing rules in a dialog from the packing list tab", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock.mockResolvedValue(
      buildInvoice("final", "/static/generated/invoices/inv_1.pdf"),
    );
    getOptionalPackingListMock.mockResolvedValue(null);

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await openDocumentsTab("Packing List");
    await userEvent.setup().click(screen.getByRole("button", { name: "Change packing rules" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Packing rules" })).toBeTruthy();
    expect(within(dialog).getAllByDisplayValue("Dresses").length).toBeGreaterThan(0);
    expect(listCartonRulesMock).toHaveBeenCalled();
  });

  it("passes the selected packing list template into draft creation and PDF generation", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock.mockResolvedValue(
      buildInvoice("final", "/static/generated/invoices/inv_1.pdf"),
    );
    getOptionalPackingListMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...buildPackingList("draft"),
      template_id: "tpl_pack",
      template_name: "Myntra Packing List",
      layout_key: "myntra_v1",
    });
    listMarketplaceDocumentTemplatesMock.mockResolvedValue([
      {
        id: "tpl_pack",
        company_id: "co_1",
        name: "Myntra Packing List",
        marketplace_key: "styli",
        document_type: "packing_list",
        template_kind: "pdf_layout",
        file_format: "pdf",
        sample_file_url: null,
        sheet_name: null,
        header_row_index: 1,
        columns: [],
        layout: { layout_key: "myntra_v1", title: "MYNTRA PACKING LIST" },
        is_default: true,
        is_active: true,
        created_at: "2026-03-24T00:00:00+00:00",
        updated_at: "2026-03-24T00:00:00+00:00",
      },
    ]);
    createPackingListMock.mockResolvedValue({
      packing_list_id: "pl_1",
      total_cartons: 1,
      total_pieces: 20,
      template_id: "tpl_pack",
      template_name: "Myntra Packing List",
      layout_key: "myntra_v1",
    });
    generatePackingListPdfMock.mockResolvedValue({
      packing_list_id: "pl_1",
      status: "draft",
      file_url: null,
      template_id: "tpl_pack",
      template_name: "Myntra Packing List",
      layout_key: "myntra_v1",
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await act(async () => {});
    await openDocumentsTab("Packing List");

    const templateSelect = screen.getByLabelText("Packing list template");
    expect((templateSelect as HTMLSelectElement).value).toBe("tpl_pack");

    fireEvent.click(screen.getByRole("button", { name: "Create packing list draft" }));
    await waitFor(() =>
      expect(createPackingListMock).toHaveBeenCalledWith("po_1", { template_id: "tpl_pack" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate PDF" }));
    await waitFor(() =>
      expect(generatePackingListPdfMock).toHaveBeenCalledWith("po_1", {
        template_id: "tpl_pack",
      }),
    );
  });

  it("can create a packing list template from the packing tab", async () => {
    getReceivedPOMock.mockResolvedValue(buildReceivedPO("confirmed"));
    getOptionalBarcodeJobMock.mockResolvedValue(null);
    getOptionalInvoiceMock.mockResolvedValue(
      buildInvoice("final", "/static/generated/invoices/inv_1.pdf"),
    );
    getOptionalPackingListMock.mockResolvedValue(null);
    createMarketplaceDocumentTemplateMock.mockResolvedValue({
      id: "tpl_new",
      company_id: "co_1",
      name: "Styli Packing List",
      marketplace_key: "styli",
      document_type: "packing_list",
      template_kind: "pdf_layout",
      file_format: "pdf",
      sample_file_url: null,
      sheet_name: null,
      header_row_index: 1,
      columns: [],
      layout: {
        layout_key: "default_v1",
        title: "STYLI PACKING LIST",
        meta_labels: { po_number: "STYLI PO NUMBER" },
        column_headers: { quantity: "STYLI QTY" },
      },
      is_default: false,
      is_active: true,
      created_at: "2026-03-24T00:00:00+00:00",
      updated_at: "2026-03-24T00:00:00+00:00",
    });

    render(<ReceivedPODocumentsView receivedPoId="po_1" />);

    await act(async () => {});
    await openDocumentsTab("Packing List");

    fireEvent.click(screen.getByRole("button", { name: "Import / Create Template" }));
    fireEvent.click(screen.getByRole("button", { name: "Create packing template" }));

    await waitFor(() =>
      expect(createMarketplaceDocumentTemplateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          document_type: "packing_list",
          template_kind: "pdf_layout",
          file_format: "pdf",
          marketplace_key: "Styli",
        }),
      ),
    );
    expect(screen.getByText("Packing list template saved.")).toBeTruthy();
  });
});

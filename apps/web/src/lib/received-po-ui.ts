import {
  type PackingList,
  type ReceivedPO,
  type ReceivedPOHeaderInput,
  type ReceivedPOLineItemInput,
  type ReceivedPOStatus,
} from "@/src/lib/received-po";

export interface CartonDraftState {
  gross_weight: string;
  net_weight: string;
  dimensions: string;
}

export function formatReceivedPODate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleDateString();
}

export function getReceivedPOStatusTone(status: ReceivedPOStatus): string {
  if (status === "confirmed") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "parsed" || status === "parsing") {
    return "bg-amber-100 text-amber-700";
  }
  if (status === "failed") {
    return "bg-rose-100 text-rose-700";
  }
  return "bg-stone-100 text-stone-700";
}

export function toEditableLineItems(record: ReceivedPO | null): ReceivedPOLineItemInput[] {
  if (!record) {
    return [];
  }
  return record.items.map((item) => ({
    id: item.id,
    brand_style_code: item.brand_style_code,
    styli_style_id: item.styli_style_id,
    model_number: item.model_number,
    option_id: item.option_id,
    sku_id: item.sku_id,
    color: item.color,
    size: item.size,
    quantity: item.quantity,
    po_price: item.po_price,
    resolution_status: item.resolution_status,
    exception_reason: item.exception_reason,
  }));
}

export function toHeaderDraft(record: ReceivedPO | null): ReceivedPOHeaderInput {
  if (!record) {
    return {
      po_number: "",
      po_date: "",
      distributor: "",
    };
  }
  return {
    po_number: record.po_number ?? "",
    po_date: record.po_date ? record.po_date.slice(0, 10) : "",
    distributor: record.distributor,
  };
}

export function getTotalQuantity(items: ReceivedPOLineItemInput[]): number {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

export function buildCartonDrafts(
  packingList: PackingList | null,
): Record<string, CartonDraftState> {
  if (!packingList) {
    return {};
  }
  return packingList.cartons.reduce<Record<string, CartonDraftState>>((accumulator, carton) => {
    accumulator[carton.id] = {
      gross_weight: carton.gross_weight?.toString() ?? "",
      net_weight: carton.net_weight?.toString() ?? "",
      dimensions: carton.dimensions ?? "",
    };
    return accumulator;
  }, {});
}

export function formatDocumentCurrency(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `INR ${value.toFixed(2)}`;
}

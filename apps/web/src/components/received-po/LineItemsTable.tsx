"use client";

import { ReceivedPOLineItemInput } from "@/src/lib/received-po";

interface LineItemsTableProps {
  editable: boolean;
  highlightedItemId?: string | null;
  items: ReceivedPOLineItemInput[];
  onChange: (items: ReceivedPOLineItemInput[]) => void;
  onSelectException?: (itemId: string) => void;
}

const columns: Array<{
  key: keyof ReceivedPOLineItemInput;
  label: string;
  type?: "number";
}> = [
  { key: "sku_id", label: "SKU ID" },
  { key: "brand_style_code", label: "Brand style" },
  { key: "color", label: "Color" },
  { key: "size", label: "Size" },
  { key: "quantity", label: "Qty", type: "number" },
  { key: "po_price", label: "PO price", type: "number" },
  { key: "model_number", label: "Model no" },
  { key: "option_id", label: "Option ID" },
];

function normalizeTextValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function LineItemsTable({
  editable,
  highlightedItemId,
  items,
  onChange,
  onSelectException,
}: LineItemsTableProps): JSX.Element {
  const grouped = items.reduce<Record<string, ReceivedPOLineItemInput[]>>((groups, item) => {
    const key = item.brand_style_code || "Uncategorized";
    groups[key] = groups[key] ?? [];
    groups[key].push(item);
    return groups;
  }, {});

  const handleFieldChange = (
    itemId: string,
    field: keyof ReceivedPOLineItemInput,
    value: string,
  ): void => {
    onChange(
      items.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        if (field === "quantity") {
          return { ...item, quantity: Number(value) || 0 };
        }
        if (field === "po_price") {
          return { ...item, po_price: value ? Number(value) : null };
        }
        return {
          ...item,
          [field]:
            normalizeTextValue(value) ??
            (field === "sku_id" || field === "brand_style_code" ? "" : null),
        };
      }),
    );
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-kira-warmgray/35">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-kira-warmgray/18">
          <tr>
            {columns.map((column) => (
              <th className="px-3 py-3 text-left font-semibold text-kira-darkgray" key={column.key}>
                {column.label}
              </th>
            ))}
            <th className="px-3 py-3 text-left font-semibold text-kira-darkgray">
              AI Status & Trace
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(grouped).map(([groupKey, groupItems]) => (
            <FragmentGroup
              editable={editable}
              groupItems={groupItems}
              groupKey={groupKey}
              highlightedItemId={highlightedItemId}
              key={groupKey}
              onFieldChange={handleFieldChange}
              onSelectException={onSelectException}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface FragmentGroupProps {
  editable: boolean;
  groupItems: ReceivedPOLineItemInput[];
  groupKey: string;
  highlightedItemId?: string | null;
  onFieldChange: (itemId: string, field: keyof ReceivedPOLineItemInput, value: string) => void;
  onSelectException?: (itemId: string) => void;
}

function FragmentGroup({
  editable,
  groupItems,
  groupKey,
  highlightedItemId,
  onFieldChange,
  onSelectException,
}: FragmentGroupProps): JSX.Element {
  return (
    <>
      <tr className="border-t border-kira-warmgray/30 bg-kira-offwhite/60">
        <td
          className="px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-kira-midgray"
          colSpan={columns.length + 1}
        >
          {groupKey}
        </td>
      </tr>
      {groupItems.map((item) => (
        <tr
          id={`row-${item.id}`}
          className={`border-t border-kira-warmgray/25 transition-all duration-700 ${
            item.id === highlightedItemId
              ? "bg-amber-500/30 ring-2 ring-amber-500/50 dark:bg-amber-500/40"
              : ""
          }`}
          key={item.id}
        >
          {columns.map((column) => (
            <td className="px-3 py-2 align-top" key={`${item.id}-${column.key}`}>
              {editable ? (
                <input
                  className="kira-focus-ring w-full rounded-md border border-kira-warmgray/35 bg-transparent px-2 py-2 text-sm text-kira-black"
                  min={column.type === "number" ? "0" : undefined}
                  onChange={(event) => onFieldChange(item.id, column.key, event.target.value)}
                  step={column.key === "po_price" ? "0.01" : "1"}
                  type={column.type ?? "text"}
                  value={String(item[column.key] ?? "")}
                />
              ) : (
                <span className="text-kira-black">{String(item[column.key] ?? "-")}</span>
              )}
            </td>
          ))}
          <td className="px-3 py-2 align-middle">
            <div className="flex items-center gap-2">
              {item.resolution_status === "needs_review" ? (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                    ⚠️ Needs Review
                  </span>
                  {onSelectException ? (
                    <button
                      type="button"
                      onClick={() => onSelectException(item.id)}
                      className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-500/20 dark:text-amber-200"
                    >
                      [Fix in Exception Box ↗]
                    </button>
                  ) : null}
                </>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
                  ✅ Updated & Synced
                </span>
              )}
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

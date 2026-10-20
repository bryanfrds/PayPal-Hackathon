import { describe, expect, it } from "vitest";
import type { ColDef, IRowNode } from "ag-grid-community";
import type { Debt } from "@/lib/debts";
import { formatDayIn, translator } from "@/lib/i18n";
import {
  PHONE_MAX_WIDTH,
  ROW_SELECTION,
  TABLET_MAX_WIDTH,
  SELECTION_COLUMN,
  SELECTION_COLUMN_PHONE,
  SelectCell,
  buildColumnDefs,
  type LayoutMode,
} from "./LedgerGrid";

const t = translator("en");
const TODAY = "2026-10-20";
const formatDay = (day: string, opts?: { year?: boolean }) => formatDayIn("en", day, opts);

const idOf = (col: ColDef<Debt>) => col.colId ?? String(col.field);
const shown = (mode: LayoutMode) => buildColumnDefs(mode, t, TODAY, formatDay).filter((col) => !col.hide).map(idOf);
const column = (mode: LayoutMode, id: string) => {
  const col = buildColumnDefs(mode, t, TODAY, formatDay).find((c) => idOf(c) === id);
  if (!col) throw new Error(`no ${id} column`);
  return col;
};

describe("ledger columns per layout", () => {
  it("phones show name and amount (item, date and status fold into them)", () => {
    expect(shown("phone")).toEqual(["customerName", "amountSen", "delete"]);
    expect(column("phone", "customerName").cellClass).toBe("ledger-two-line");
    expect(column("phone", "amountSen").cellClass).toBe("ledger-two-line");
  });

  it("tablets hide only the date", () => {
    expect(shown("tablet")).toEqual(["customerName", "item", "amountSen", "status", "delete"]);
  });

  it("laptops show every column", () => {
    expect(shown("desktop")).toEqual(["customerName", "item", "amountSen", "date", "status", "delete"]);
  });

  it("gives the wider layouts' minimum widths room for every column", () => {
    const total = (mode: LayoutMode) =>
      buildColumnDefs(mode, t, TODAY)
        .filter((col) => !col.hide)
        .reduce((sum, col) => sum + (col.minWidth ?? col.width ?? 0), 0) + (SELECTION_COLUMN.width ?? 0);
    // Each layout starts 1px above the previous one's maximum grid width.
    expect(total("tablet")).toBeLessThanOrEqual(PHONE_MAX_WIDTH + 1);
    expect(total("desktop")).toBeLessThanOrEqual(TABLET_MAX_WIDTH + 1);
  });

  it("finds a tab by the date words phones show, as well as the stored date", () => {
    const getText = column("phone", "date").getQuickFilterText!;
    const text = getText({ data: { date: "2026-10-20" } } as never);
    expect(text).toContain("2026-10-20");
    expect(text).toContain("20 Oct");
  });
});

describe("ledger row selection", () => {
  it("can't tick the Still owed row", () => {
    const isSelectable = ROW_SELECTION.isRowSelectable!;
    expect(isSelectable({ rowPinned: "bottom", data: { id: "OUTSTANDING" } } as IRowNode<Debt>)).toBe(false);
    expect(isSelectable({ rowPinned: undefined, data: { id: "OUTSTANDING" } } as unknown as IRowNode<Debt>)).toBe(false);
    expect(isSelectable({ rowPinned: undefined, data: { id: "d1" } } as unknown as IRowNode<Debt>)).toBe(true);
  });

  it("draws our own named row boxes; AG Grid draws only the header box", () => {
    expect(ROW_SELECTION).toMatchObject({ mode: "multiRow", checkboxes: false, headerCheckbox: true });
    expect(SELECTION_COLUMN.cellRenderer).toBe(SelectCell);
    expect(SELECTION_COLUMN_PHONE.cellRenderer).toBe(SelectCell);
    // Room for the 24px hit area on phones too.
    expect(SELECTION_COLUMN_PHONE.width).toBeGreaterThanOrEqual(40);
  });
});

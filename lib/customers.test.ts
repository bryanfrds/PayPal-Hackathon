import { describe, expect, it, vi } from "vitest";
import { customerRows, customerTotals, nameFromSlug, planAddCustomer, saveAddCustomer, type AddCustomerInput } from "./customers";
import { MAX_ITEM_LENGTH, MAX_NAME_LENGTH, outstanding, type Debt } from "./debts";

const TODAY = "2026-10-16";

const debt = (customerName: string): Debt => ({
  id: "d1",
  customerName,
  item: "Milo",
  amountSen: 1250,
  date: "2026-10-01",
  status: "unpaid",
  source: "manual",
  createdAt: "2026-10-01T00:00:00.000Z",
});

const input = (over: Partial<AddCustomerInput> = {}): AddCustomerInput => ({
  name: "Ah Hock",
  email: "ahhock@gmail.com",
  withDebt: false,
  item: "",
  amount: "",
  ...over,
});

describe("planAddCustomer", () => {
  it("accepts a new customer, with or without a first debt", () => {
    expect(planAddCustomer(input(), [], {}, TODAY)).toEqual({
      kind: "new",
      slug: "ah-hock",
      name: "Ah Hock",
      email: "ahhock@gmail.com",
      debt: undefined,
    });
    const plan = planAddCustomer(input({ withDebt: true, item: "Gula 1kg", amount: "15" }), [], {}, TODAY);
    expect(plan).toMatchObject({ kind: "new", debt: { customerName: "Ah Hock", item: "Gula 1kg", amountSen: 1500, date: TODAY } });
  });

  it("refuses an amount over RM 10,000", () => {
    const plan = planAddCustomer(input({ withDebt: true, amount: "10000.01" }), [], {}, TODAY);
    expect(plan.kind).toBe("invalid");
    if (plan.kind === "invalid") expect(plan.errors.amount).toMatch(/10000\.00/);
  });

  it("ignores the amount when no debt is being added", () => {
    expect(planAddCustomer(input({ withDebt: false, amount: "999999" }), [], {}, TODAY).kind).toBe("new");
  });

  it("refuses a missing amount when a debt is being added", () => {
    const plan = planAddCustomer(input({ withDebt: true, amount: "" }), [], {}, TODAY);
    expect(plan.kind === "invalid" && plan.errors.amount).toBeTruthy();
  });

  it("refuses a too-long name or item", () => {
    const longName = planAddCustomer(input({ name: "a".repeat(MAX_NAME_LENGTH + 1) }), [], {}, TODAY);
    expect(longName.kind === "invalid" && longName.errors.name).toBeTruthy();
    const longItem = planAddCustomer(input({ withDebt: true, amount: "5", item: "x".repeat(MAX_ITEM_LENGTH + 1) }), [], {}, TODAY);
    expect(longItem.kind === "invalid" && longItem.errors.item).toBeTruthy();
  });

  it("refuses a missing name and a bad email, both at once", () => {
    const plan = planAddCustomer(input({ name: "  ", email: "ahhock" }), [], {}, TODAY);
    expect(plan.kind).toBe("invalid");
    if (plan.kind === "invalid") expect(Object.keys(plan.errors).sort()).toEqual(["email", "name"]);
  });

  it("spots an existing customer whatever the case or punctuation, and keeps their email", () => {
    const plan = planAddCustomer(
      input({ name: "  AH-HOCK! ", email: "new@gmail.com", withDebt: true, amount: "3" }),
      [debt("Ah Hock")],
      { "ah-hock": "old@yahoo.com" },
      TODAY,
    );
    expect(plan).toMatchObject({ kind: "exists", slug: "ah-hock", existingName: "Ah Hock", existingEmail: "old@yahoo.com" });
    expect(plan).not.toHaveProperty("email");
  });

  it("treats a known customer with no saved email, or the same email, as safe to save", () => {
    expect(planAddCustomer(input(), [debt("Ah Hock")], {}, TODAY).kind).toBe("new");
    expect(planAddCustomer(input({ email: "AhHock@gmail.com" }), [], { "ah-hock": "ahhock@gmail.com" }, TODAY).kind).toBe("new");
  });
});

describe("saveAddCustomer", () => {
  const deps = () => ({ addDebt: vi.fn(), setEmail: vi.fn(), newId: () => "id-1", now: new Date("2026-10-16T08:00:00Z") });

  it("saves the debt, then the email, for a new customer", () => {
    const d = deps();
    const plan = planAddCustomer(input({ withDebt: true, amount: "2" }), [], {}, TODAY);
    if (plan.kind === "invalid") throw new Error("expected a valid plan");
    expect(saveAddCustomer(plan, d)).toEqual({ ok: true });
    expect(d.addDebt).toHaveBeenCalledWith(expect.objectContaining({ id: "id-1", amountSen: 200, status: "unpaid" }));
    expect(d.setEmail).toHaveBeenCalledWith("ah-hock", "ahhock@gmail.com");
    expect(d.addDebt.mock.invocationCallOrder[0]).toBeLessThan(d.setEmail.mock.invocationCallOrder[0]);
  });

  it("never writes the email for an existing customer", () => {
    const d = deps();
    const plan = planAddCustomer(input({ email: "new@gmail.com", withDebt: true, amount: "2" }), [], { "ah-hock": "old@yahoo.com" }, TODAY);
    if (plan.kind !== "exists") throw new Error("expected exists");
    expect(saveAddCustomer(plan, d)).toEqual({ ok: true });
    expect(d.addDebt).toHaveBeenCalledOnce();
    expect(d.setEmail).not.toHaveBeenCalled();
  });

  it("saves nothing when the debt can't be saved", () => {
    const d = deps();
    d.addDebt.mockImplementation(() => {
      throw new Error("full");
    });
    const plan = planAddCustomer(input({ withDebt: true, amount: "2" }), [], {}, TODAY);
    if (plan.kind === "invalid") throw new Error("expected a valid plan");
    expect(saveAddCustomer(plan, d)).toEqual({ ok: false, saved: "nothing" });
    expect(d.setEmail).not.toHaveBeenCalled();
  });

  it("says the debt was kept when only the email fails", () => {
    const d = deps();
    d.setEmail.mockImplementation(() => {
      throw new Error("full");
    });
    const withDebt = planAddCustomer(input({ withDebt: true, amount: "2" }), [], {}, TODAY);
    const noDebt = planAddCustomer(input(), [], {}, TODAY);
    if (withDebt.kind === "invalid" || noDebt.kind === "invalid") throw new Error("expected valid plans");
    expect(saveAddCustomer(withDebt, d)).toEqual({ ok: false, saved: "debtOnly" });
    expect(saveAddCustomer(noDebt, d)).toEqual({ ok: false, saved: "nothing" });
  });
});

describe("customerRows and customerTotals", () => {
  const mk = (id: string, name: string, status: Debt["status"], amountSen: number, date = "2026-10-01"): Debt => ({
    id, customerName: name, item: "Milo", amountSen, date, status, source: "manual", createdAt: `${date}T00:00:00.000Z`,
  });
  const debts = [
    mk("1", "Kak Lina", "sent", 2240),
    mk("2", "Kak Lina", "unpaid", 480),
    mk("3", "Puan Rosnah", "sent", 920),
    mk("4", "Mak Cik Siti", "overdue", 4850),
    mk("5", "Nurul", "paid", 1660),
  ];

  it("counts invoiced-but-unpaid tabs as owed, so the total matches Home's outstanding()", () => {
    const rows = customerRows(debts, {});
    const totals = customerTotals(rows);
    expect(totals.owedSen).toBe(outstanding(debts).totalSen);
    expect(totals.owedSen).toBe(2240 + 480 + 920 + 4850);
    expect(totals.owing).toBe(3);
    expect(rows.find((r) => r.slug === "puan-rosnah")).toMatchObject({ owedSen: 920, sentCount: 1 });
    expect(rows.find((r) => r.slug === "nurul")?.owedSen).toBe(0);
  });

  it("ready to invoice means an email and something Collect can still invoice", () => {
    const rows = customerRows(debts, { "kak-lina": "lina@x.co", "puan-rosnah": "r@x.co", nurul: "n@x.co" });
    // Kak Lina has a not-sent tab; Puan Rosnah's only tab is already invoiced; Nurul paid up.
    expect(customerTotals(rows).readyToInvoice).toBe(1);
    expect(customerTotals(rows).missingEmail).toBe(1);
  });

  it("names a customer known only by email from a known name, else from the slug", () => {
    const rows = customerRows([], { "kak-lina": "a@x.co", "uncle-tan": "b@x.co" }, new Map([["kak-lina", "Kak Lina"]]));
    expect(rows.map((r) => r.name).sort()).toEqual(["Kak Lina", "Uncle Tan"]);
    expect(nameFromSlug("pak-ali-bengkel")).toBe("Pak Ali Bengkel");
  });
});

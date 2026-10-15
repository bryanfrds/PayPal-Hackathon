import { describe, expect, it } from "vitest";
import type { InvoiceRecord } from "./collect-store";
import type { Debt } from "./debts";
import { LANGUAGES, translate, translator } from "./i18n";
import type { InvoiceStanding } from "./payments";
import { buildShareMessage, chooseLink, itemSummary, payLinkFor, plainName, unpaidItems, whatsappUrl, type ShareInput } from "./share";

const LINK = "https://www.sandbox.paypal.com/invoice/p/#INV2-K4LN-ABCD";
const FULL = { link: LINK, amountSen: 12800, full: true };

function standing(settlement: InvoiceStanding["settlement"]): InvoiceStanding {
  return { settlement, checkedAt: "2026-10-10T00:00:00.000Z" } as InvoiceStanding;
}

const base: ShareInput = {
  customerName: "Kak Lina",
  shopName: "Kedai Ah Seng",
  owedSen: 12800,
  items: ["Milo", "gula", "beras", "minyak"],
  tone: "friendly",
};

function debt(over: Partial<Debt>): Debt {
  return {
    id: "d1",
    customerName: "Kak Lina",
    item: "Milo",
    amountSen: 1000,
    date: "2026-10-02",
    status: "sent",
    source: "manual",
    createdAt: "2026-10-02T08:00:00.000Z",
    ...over,
  };
}

function invoice(over: Partial<InvoiceRecord>): InvoiceRecord {
  return {
    id: "INV2-1",
    customerName: "Kak Lina",
    slug: "kak-lina",
    email: "lina@example.com",
    debtIds: ["d1"],
    amountSen: 1000,
    sentAt: "2026-10-05T08:00:00.000Z",
    payerLink: LINK,
    ...over,
  };
}

describe("itemSummary", () => {
  it("names up to three items", () => {
    expect(itemSummary(["Milo"])).toBe("Milo");
    expect(itemSummary(["Milo", "gula"])).toBe("Milo and gula");
    expect(itemSummary(["Milo", "gula", "beras"])).toBe("Milo, gula and beras");
  });

  it("says how many more after three", () => {
    expect(itemSummary(["Milo", "gula", "beras", "minyak"])).toBe("Milo, gula, beras and 1 more");
    expect(itemSummary(["a", "b", "c", "d", "e", "f"])).toBe("a, b, c and 3 more");
  });

  it("skips blanks and is empty when there's nothing", () => {
    expect(itemSummary([])).toBe("");
    expect(itemSummary(["  ", ""])).toBe("");
    expect(itemSummary([" Milo ", ""])).toBe("Milo");
  });
});

describe("unpaidItems", () => {
  it("lists unpaid items oldest first, without blanks, repeats or paid ones", () => {
    const debts = [
      debt({ id: "a", item: "gula", date: "2026-10-05" }),
      debt({ id: "b", item: "Milo", date: "2026-10-01" }),
      debt({ id: "c", item: "milo", date: "2026-10-06" }),
      debt({ id: "d", item: "", date: "2026-10-07" }),
      debt({ id: "e", item: "roti", date: "2026-09-01", status: "paid" }),
    ];
    expect(unpaidItems(debts)).toEqual(["Milo", "gula"]);
  });
});

describe("buildShareMessage", () => {
  it("friendly: greets with name and shop, shows the amount and items, ends with thanks", () => {
    const m = buildShareMessage(base);
    expect(m.intro).toBe(
      "Hi Kak Lina, Kedai Ah Seng here 🙂 Just a friendly note: your tab is *RM 128.00* (Milo, gula, beras and 1 more).",
    );
    expect(m.text.endsWith("Thank you!")).toBe(true);
  });

  it("each tone has its own wording", () => {
    const friendly = buildShareMessage({ ...base, tone: "friendly" }).text;
    const polite = buildShareMessage({ ...base, tone: "polite" }).text;
    const firm = buildShareMessage({ ...base, tone: "firm" }).text;
    expect(new Set([friendly, polite, firm]).size).toBe(3);
    expect(polite).toContain("gentle reminder");
    expect(firm).toContain("long overdue");
    for (const text of [friendly, polite, firm]) {
      expect(text).toContain("Kak Lina");
      expect(text).toContain("Kedai Ah Seng");
      expect(text).toContain("RM 128.00");
      expect(text).toContain("Thank you!");
    }
  });

  it("adds the PayPal link when there is one", () => {
    const m = buildShareMessage({ ...base, pay: FULL });
    expect(m.link).toBe(LINK);
    expect(m.linkSen).toBe(12800);
    expect(m.payLine).toBe("Pay easily with PayPal or card:");
    expect(m.text).toBe(`${m.intro}\n\n${m.payLine} ${LINK}\n\nThank you!`);
  });

  it("says how much the link pays when its invoice covers only part of the tab", () => {
    const m = buildShareMessage({ ...base, pay: { link: LINK, amountSen: 4000, full: false } });
    expect(m.linkSen).toBe(4000);
    expect(m.payLine).toBe("RM 40.00 of this can be paid here:");
    expect(m.text).toContain(`RM 40.00 of this can be paid here: ${LINK}`);
    expect(m.intro).toContain("*RM 128.00*");
  });

  it("strips WhatsApp formatting marks from names", () => {
    expect(plainName(" *Kak* _Lina_ ~x~ ")).toBe("Kak Lina x");
    expect(plainName("Kak_Lina")).toBe("Kak Lina");
    const m = buildShareMessage({
      ...base,
      customerName: "*Kak_Lina*",
      shopName: "~Kedai~ *Ah* Seng",
      items: ["*Milo*", "gula_pasir", "~beras~"],
    });
    expect(m.intro).toBe(
      "Hi Kak Lina, Kedai Ah Seng here 🙂 Just a friendly note: your tab is *RM 128.00* (Milo, gula pasir and beras).",
    );
    expect(m.text.match(/\*/g)).toHaveLength(2);
  });

  it("leaves the link out when there's none, or when it isn't a PayPal page", () => {
    const links = ["", "https://evil.example/pay", "http://www.paypal.com/x", "/tab/kak-lina"];
    for (const pay of [undefined, ...links.map((link) => ({ link, amountSen: 12800, full: true }))]) {
      const m = buildShareMessage({ ...base, pay });
      expect(m.link).toBeUndefined();
      expect(m.payLine).toBeUndefined();
      expect(m.text).toBe(`${m.intro}\n\nThank you!`);
      expect(m.text).not.toContain("http");
    }
  });

  it("drops the brackets when no items are written", () => {
    const m = buildShareMessage({ ...base, items: [] });
    expect(m.intro).toContain("your tab is *RM 128.00*.");
    expect(m.intro).not.toContain("(");
  });
});

describe("whatsappUrl", () => {
  it("encodes the text for wa.me, with no phone number", () => {
    const text = "Hi Kak Lina & co 🙂 *RM 12.50*?\n\nPay: https://www.paypal.com/invoice/p/#INV2-1";
    const url = whatsappUrl(text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    const encoded = url.slice("https://wa.me/?text=".length);
    expect(encoded).not.toMatch(/[\s&#?]/);
    expect(encoded).toContain("%0A%0A");
    expect(decodeURIComponent(encoded)).toBe(text);
    expect(new URL(url).searchParams.get("text")).toBe(text);
  });
});

describe("payLinkFor", () => {
  const debts = [debt({ id: "d1" }), debt({ id: "d2", status: "paid" }), debt({ id: "x", customerName: "Mr Raj" })];

  it("uses the newest invoice that still covers an unpaid debt", () => {
    const older = invoice({ id: "old", sentAt: "2026-10-01T00:00:00.000Z", payerLink: "https://www.paypal.com/invoice/p/#OLD" });
    const newer = invoice({ id: "new", sentAt: "2026-10-09T00:00:00.000Z" });
    expect(payLinkFor([older, newer], debts, "kak-lina")).toEqual({ pay: { link: LINK, amountSen: 1000, full: true } });
    expect(payLinkFor([invoice({ standing: standing("open") })], debts, "kak-lina").pay?.link).toBe(LINK);
  });

  it("reason none: nothing has been invoiced", () => {
    expect(payLinkFor([], [debt({ status: "unpaid" })], "kak-lina")).toEqual({ reason: "none" });
    expect(payLinkFor([], [], "kak-lina")).toEqual({ reason: "none" });
    // An invoice left over from before a sample reset doesn't match a fresh, not-invoiced debt.
    expect(payLinkFor([invoice({})], [debt({ id: "d1", status: "unpaid" })], "kak-lina")).toEqual({ reason: "none" });
    // Another customer's invoice doesn't count.
    expect(payLinkFor([invoice({ slug: "mr-raj", customerName: "Mr Raj", debtIds: ["x"] })], [debt({ status: "unpaid" })], "kak-lina")).toEqual({
      reason: "none",
    });
  });

  it("reason not-on-device: marked as invoiced, but no usable link here", () => {
    expect(payLinkFor([], debts, "kak-lina")).toEqual({ reason: "not-on-device" });
    expect(payLinkFor([invoice({ payerLink: undefined })], debts, "kak-lina")).toEqual({ reason: "not-on-device" });
    expect(payLinkFor([invoice({ payerLink: "https://evil.example/" })], debts, "kak-lina")).toEqual({ reason: "not-on-device" });
    // The only invoice covers a paid debt, so d1's invoice isn't here.
    expect(payLinkFor([invoice({ debtIds: ["d2"] })], debts, "kak-lina")).toEqual({ reason: "not-on-device" });
  });

  it("reason over-billed: the invoice asks for more than is owed", () => {
    // d1 is RM 10 owed; the invoice asks RM 25.
    expect(payLinkFor([invoice({ amountSen: 2500 })], debts, "kak-lina")).toEqual({ reason: "over-billed" });
  });

  it("reason settled: a cancelled or paid invoice, with no fallback to an older one for the same debt", () => {
    const older = invoice({ id: "old", sentAt: "2026-10-01T00:00:00.000Z", payerLink: "https://www.paypal.com/invoice/p/#OLD" });
    const closed = invoice({ id: "new", sentAt: "2026-10-09T00:00:00.000Z", standing: standing("closed") });
    expect(payLinkFor([older, closed], debts, "kak-lina")).toEqual({ reason: "settled" });
    expect(payLinkFor([invoice({ standing: standing("paid") })], debts, "kak-lina")).toEqual({ reason: "settled" });
  });

  it("marks the link partial when the invoice doesn't cover the whole tab", () => {
    const two = [debt({ id: "d1", amountSen: 1000 }), debt({ id: "d3", amountSen: 3000, date: "2026-10-08" })];
    // Covers d1 only: RM 10 of RM 40.
    expect(payLinkFor([invoice({ debtIds: ["d1"], amountSen: 1000 })], two, "kak-lina").pay).toEqual({ link: LINK, amountSen: 1000, full: false });
    // Covers both, but asks for a different amount than is owed.
    expect(payLinkFor([invoice({ debtIds: ["d1", "d3"], amountSen: 3500 })], two, "kak-lina").pay?.full).toBe(false);
    // Covers both for exactly what's owed.
    expect(payLinkFor([invoice({ debtIds: ["d1", "d3"], amountSen: 4000 })], two, "kak-lina").pay?.full).toBe(true);
    // One debt invoiced, one not: the link is only part of the tab.
    const mixed = [debt({ id: "d1" }), debt({ id: "d4", status: "unpaid", amountSen: 500 })];
    expect(payLinkFor([invoice({ debtIds: ["d1", "d4"], amountSen: 1000 })], mixed, "kak-lina").pay).toEqual({
      link: LINK,
      amountSen: 1000,
      full: false,
    });
  });
});

describe("chooseLink", () => {
  const pay = { link: LINK, amountSen: 12800, full: true };

  it("uses the link when there is one and pay links are on", () => {
    expect(chooseLink({ pay }, true)).toEqual({ pay });
  });

  it("explains a missing link with its reason", () => {
    expect(chooseLink({ reason: "none" }, true)).toEqual({ note: "No PayPal invoice yet. Send one from Collect to add a pay link." });
    expect(chooseLink({ reason: "settled" }, true).note).toBe("PayPal shows this invoice as paid or closed, so the message has no link.");
  });

  it("leaves the link out and says so when pay links are off in Settings", () => {
    expect(chooseLink({ pay }, false)).toEqual({ note: "Pay links are turned off in Settings, so the message has no link." });
    expect(chooseLink({ reason: "none" }, false).pay).toBeUndefined();
  });
});

describe("messages in every language", () => {
  const LANGS = LANGUAGES.map((l) => l.code);
  const TONE_IDS = ["friendly", "polite", "firm"] as const;

  for (const language of LANGS) {
    for (const tone of TONE_IDS) {
      it(`${language} · ${tone}: names, amount and items as typed, with and without a link`, () => {
        const without = buildShareMessage({ ...base, tone, language });
        expect(without.intro).toContain("Kak Lina");
        expect(without.intro).toContain("Kedai Ah Seng");
        expect(without.intro).toContain("*RM 128.00*");
        for (const item of ["Milo", "gula", "beras"]) expect(without.intro).toContain(item);
        expect(without.intro).not.toMatch(/\{\w+\}/);
        expect(without.closing).toBe(translate(language, "msg.closing"));
        expect(without.text).toBe(`${without.intro}\n\n${without.closing}`);
        expect(without.text).not.toContain("http");

        const withLink = buildShareMessage({ ...base, tone, language, pay: FULL });
        expect(withLink.link).toBe(LINK);
        expect(withLink.payLine).toBe(translate(language, `msg.${tone}.payLine`));
        expect(withLink.text).toBe(`${withLink.intro}\n\n${withLink.payLine} ${LINK}\n\n${withLink.closing}`);

        const partial = buildShareMessage({ ...base, tone, language, pay: { link: LINK, amountSen: 4000, full: false } });
        expect(partial.payLine).toContain("RM 40.00");
        expect(partial.payLine).not.toMatch(/\{\w+\}/);
      });
    }
  }

  it("the tones read differently in each language", () => {
    for (const language of LANGS) {
      const texts = TONE_IDS.map((tone) => buildShareMessage({ ...base, tone, language }).intro);
      expect(new Set(texts).size).toBe(3);
    }
  });

  it("names the items with the language's own 'and N more'", () => {
    const t = translator("ms");
    const list = ["a", "b", "c"].join(translate("ms", "msg.items.sep"));
    expect(itemSummary(["a", "b", "c", "d"], 3, t)).toBe(translate("ms", "msg.items.more", { list, count: 1 }));
  });
});

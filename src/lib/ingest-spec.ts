// Shared (client + server) description of what each ingest target accepts.
// CSVs reference other records by human-readable names (owner, deal_name,
// milestone); the server resolves those to ids at commit time.
import { z } from "zod";

export const INGEST_TABLES = [
  "raw_deals",
  "invoices",
  "payments",
  "timesheets",
  "people",
  "rates",
] as const;
export type IngestTable = (typeof INGEST_TABLES)[number];

export type ColumnSpec = {
  key: string;
  required: boolean;
  hint: string;
  options?: readonly string[];
  long?: boolean;
};

// Accept "8,00,000", "₹ 50000", "1.5" etc.
const money = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/[₹,\s]/g, "") : v),
  z.coerce.number({ error: "must be a number" }).positive("must be > 0"),
);
const optionalMoney = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  money.optional(),
);
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "not a real date");
const text = z.string().trim().min(1, "required");
const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().optional(),
);

export const ROW_SCHEMAS = {
  raw_deals: z.object({
    raw_text: text,
    owner: optionalText,
  }),
  invoices: z.object({
    deal_name: text,
    milestone: text,
    amount: money,
    raised_on: isoDate,
    owner: optionalText,
    variable_pay_at_stake: optionalMoney,
  }),
  payments: z.object({
    deal_name: text,
    milestone: text,
    amount: money,
    paid_on: isoDate,
  }),
  timesheets: z.object({
    deal_name: text,
    location: z.enum(["IN", "SG"], { error: "must be IN or SG" }),
    hours: money,
    logged_on: isoDate,
  }),
  people: z.object({
    name: text,
    role: z.enum(["consulting_owner", "practice_lead", "delivery"], {
      error: "must be consulting_owner | practice_lead | delivery",
    }),
    entity: z.enum(["IN", "SG"], { error: "must be IN or SG" }),
    variable_pay_target: optionalMoney,
  }),
  rates: z.object({
    location: z.enum(["IN", "SG"], { error: "must be IN or SG" }),
    hourly_rate: money,
    currency: optionalText,
  }),
} satisfies Record<IngestTable, z.ZodType>;

export type IngestRow<T extends IngestTable> = z.infer<(typeof ROW_SCHEMAS)[T]>;

export const TABLE_SPECS: Record<
  IngestTable,
  { label: string; description: string; columns: ColumnSpec[]; example: Record<string, string> }
> = {
  raw_deals: {
    label: "Raw deals",
    description:
      "Free-text deal descriptions. Land as PENDING; only human approval in Pipeline creates real deal records.",
    columns: [
      { key: "raw_text", required: true, hint: "Deal as the rep wrote it", long: true },
      { key: "owner", required: false, hint: "Consulting owner name (must exist in people)" },
    ],
    example: {
      raw_text: "Initech: ongoing support, TBD. ~₹1L/month after pilot.",
      owner: "Priya Sharma",
    },
  },
  invoices: {
    label: "Invoices",
    description:
      "Raised invoices. Variable pay at stake defaults to 5% of amount (invented rule).",
    columns: [
      { key: "deal_name", required: true, hint: "Exact approved deal name" },
      { key: "milestone", required: true, hint: "e.g. Kickoff 40%" },
      { key: "amount", required: true, hint: "INR" },
      { key: "raised_on", required: true, hint: "YYYY-MM-DD" },
      { key: "owner", required: false, hint: "Defaults to deal owner" },
      { key: "variable_pay_at_stake", required: false, hint: "Defaults to 5% of amount" },
    ],
    example: {
      deal_name: "Wayne Enterprises - Analytics Dashboard",
      milestone: "Go-live 20%",
      amount: "200000",
      raised_on: "2026-10-01",
      owner: "",
      variable_pay_at_stake: "",
    },
  },
  payments: {
    label: "Payments",
    description: "Cash received against an invoice (deal + milestone identify the invoice).",
    columns: [
      { key: "deal_name", required: true, hint: "Exact approved deal name" },
      { key: "milestone", required: true, hint: "Invoice milestone" },
      { key: "amount", required: true, hint: "INR" },
      { key: "paid_on", required: true, hint: "YYYY-MM-DD" },
    ],
    example: {
      deal_name: "Wayne Enterprises - Analytics Dashboard",
      milestone: "UAT 40%",
      amount: "100000",
      paid_on: "2026-10-02",
    },
  },
  timesheets: {
    label: "Timesheets",
    description: "Hours logged against a deal, by delivery location.",
    columns: [
      { key: "deal_name", required: true, hint: "Exact approved deal name" },
      { key: "location", required: true, hint: "IN or SG", options: ["IN", "SG"] },
      { key: "hours", required: true, hint: "Number" },
      { key: "logged_on", required: true, hint: "YYYY-MM-DD" },
    ],
    example: {
      deal_name: "Wayne Enterprises - Analytics Dashboard",
      location: "IN",
      hours: "40",
      logged_on: "2026-09-30",
    },
  },
  people: {
    label: "People",
    description: "Owners, practice leads and delivery staff.",
    columns: [
      { key: "name", required: true, hint: "Unique" },
      {
        key: "role",
        required: true,
        hint: "consulting_owner | practice_lead | delivery",
        options: ["consulting_owner", "practice_lead", "delivery"],
      },
      { key: "entity", required: true, hint: "IN or SG", options: ["IN", "SG"] },
      { key: "variable_pay_target", required: false, hint: "Per quarter, INR" },
    ],
    example: {
      name: "Kavya Iyer",
      role: "consulting_owner",
      entity: "IN",
      variable_pay_target: "350000",
    },
  },
  rates: {
    label: "Rates",
    description: "Blended hourly cost per delivery location (upserts on location).",
    columns: [
      { key: "location", required: true, hint: "IN or SG", options: ["IN", "SG"] },
      { key: "hourly_rate", required: true, hint: "INR per hour" },
      { key: "currency", required: false, hint: "Defaults to INR" },
    ],
    example: { location: "SG", hourly_rate: "6500", currency: "INR" },
  },
};

// Tables the quick form supports (single-row entry).
export const QUICK_FORM_TABLES: IngestTable[] = ["invoices", "payments", "timesheets"];

export type RowResult = {
  index: number;
  ok: boolean;
  errors: string[];
};

export function validateRowShape(table: IngestTable, row: Record<string, unknown>) {
  const parsed = ROW_SCHEMAS[table].safeParse(row);
  if (parsed.success) return { ok: true as const, data: parsed.data, errors: [] };
  return {
    ok: false as const,
    data: null,
    errors: parsed.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`),
  };
}

export function csvTemplate(table: IngestTable) {
  const { columns, example } = TABLE_SPECS[table];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = columns.map((c) => c.key).join(",");
  const row = columns.map((c) => esc(example[c.key] ?? "")).join(",");
  return `${header}\n${row}\n`;
}

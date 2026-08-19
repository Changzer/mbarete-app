import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  // Accounts are deactivated, never deleted: products and orders point at
  // this row, and removing it would erase who did what. An inactive user
  // cannot sign in but still gets credited on everything they entered.
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nameEn: text("name_en").notNull(),
  nameZh: text("name_zh").notNull(),
});

export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sku: text("sku").notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    descriptionEn: text("description_en").notNull().default(""),
    descriptionZh: text("description_zh").notNull().default(""),
    price: real("price").notNull(),
    // Default selling price for order lines. 0 means none set: the product
    // sells at the supplier price until a price is typed on the order.
    sellPrice: real("sell_price").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    moq: integer("moq").notNull().default(1),
    qtyPerBox: integer("qty_per_box").notNull().default(1),
    // Carton figures. These are what every order calculation reads, whether
    // they were measured or estimated from a single piece.
    lengthCm: real("length_cm").notNull().default(0),
    widthCm: real("width_cm").notNull().default(0),
    heightCm: real("height_cm").notNull().default(0),
    weightKg: real("weight_kg").notNull().default(0),
    cbm: real("cbm").notNull().default(0),
    // Where the carton figures came from: "carton" when the supplier quoted
    // the export carton, "piece" when only the product itself was known and
    // the carton was estimated from it.
    dimensionSource: text("dimension_source")
      .$type<"carton" | "piece">()
      .notNull()
      .default("carton"),
    // What was entered in piece mode, kept so the form round-trips and the
    // estimate can be recalculated when pieces per carton changes.
    pieceLengthCm: real("piece_length_cm").notNull().default(0),
    pieceWidthCm: real("piece_width_cm").notNull().default(0),
    pieceHeightCm: real("piece_height_cm").notNull().default(0),
    pieceWeightKg: real("piece_weight_kg").notNull().default(0),
    packingAllowancePct: real("packing_allowance_pct").notNull().default(15),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    // Who entered this product and who last changed it. Nullable because rows
    // written before attribution existed have nobody to credit.
    createdBy: integer("created_by").references(() => users.id),
    updatedBy: integer("updated_by").references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("products_category_idx").on(table.categoryId),
    index("products_active_idx").on(table.active),
  ],
);

/**
 * One product can carry several photos (colour variants of the same item),
 * ordered by sortOrder. The first is used as the catalog thumbnail.
 */
export const productImages = sqliteTable(
  "product_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("product_images_product_idx").on(table.productId)],
);

export const exchangeRates = sqliteTable("exchange_rates", {
  currencyCode: text("currency_code").primaryKey(),
  rateToUsd: real("rate_to_usd").notNull(),
  /** "auto" rows are refreshed daily from the provider; "manual" rows were typed. */
  source: text("source", { enum: ["manual", "auto"] })
    .notNull()
    .default("manual"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/**
 * One row per currency per day, written whenever the auto-fetch succeeds.
 * The daily record backs "what was the rate when this happened" questions
 * and keeps FX history even after the live table moves on.
 */
export const exchangeRateHistory = sqliteTable(
  "exchange_rate_history",
  {
    /** ISO date, YYYY-MM-DD. */
    day: text("day").notNull(),
    currencyCode: text("currency_code").notNull(),
    rateToUsd: real("rate_to_usd").notNull(),
    source: text("source").notNull().default("auto"),
  },
  (table) => [primaryKey({ columns: [table.day, table.currencyCode] })],
);

/**
 * Mbarete's own details, as they appear at the top of a proforma invoice.
 *
 * A single row, always id 1. A key/value table would be more flexible and
 * worse to read: every field here is wanted at once, on one document.
 */
export const companyProfile = sqliteTable("company_profile", {
  id: integer("id").primaryKey().default(1),
  companyName: text("company_name").notNull().default(""),
  addressLines: text("address_lines").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  website: text("website").notNull().default(""),
  taxId: text("tax_id").notNull().default(""),
  // Payment details belong on a proforma: it is what the client pays against.
  bankName: text("bank_name").notNull().default(""),
  bankAccountName: text("bank_account_name").notNull().default(""),
  bankAccountNumber: text("bank_account_number").notNull().default(""),
  bankSwift: text("bank_swift").notNull().default(""),
  bankAddress: text("bank_address").notNull().default(""),
  // Defaults printed on every proforma unless the order says otherwise.
  paymentTerms: text("payment_terms").notNull().default(""),
  incoterms: text("incoterms").notNull().default(""),
  validityDays: integer("validity_days").notNull().default(30),
  footerNote: text("footer_note").notNull().default(""),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/**
 * Beneficiary accounts a proforma can be paid into. Different clients pay
 * through different rails — a Brazilian client wires USD, a local one
 * transfers RMB — so each order picks which of these prints on its invoice.
 * The default row is what a proforma shows when the order never chose.
 */
export const bankAccounts = sqliteTable("bank_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Short name shown in dropdowns, e.g. "Tailong Bank — RMB". */
  label: text("label").notNull(),
  bankName: text("bank_name").notNull().default(""),
  accountName: text("account_name").notNull().default(""),
  accountNumber: text("account_number").notNull().default(""),
  swift: text("swift").notNull().default(""),
  bankAddress: text("bank_address").notNull().default(""),
  /** Which currency this account receives, informational only. */
  currency: text("currency").notNull().default(""),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const contacts = sqliteTable(
  "contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: ["supplier", "client"] }).notNull(),
    companyName: text("company_name").notNull(),
    contactPerson: text("contact_person").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    whatsapp: text("whatsapp").notNull().default(""),
    wechat: text("wechat").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("contacts_type_idx").on(table.type)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderNumber: text("order_number").notNull().unique(),
    clientId: integer("client_id")
      .notNull()
      .references(() => contacts.id),
    status: text("status", {
      enum: ["draft", "confirmed", "shipped", "cancelled"],
    })
      .notNull()
      .default("draft"),
    // Quote currency (what the client is billed in) and the secondary currency
    // shown alongside it, so RMB cost and USD quote are visible together.
    displayCurrency: text("display_currency").notNull().default("USD"),
    secondaryCurrency: text("secondary_currency").notNull().default("CNY"),
    // Mbarete's margin, charged on top of the goods subtotal.
    commissionPct: real("commission_pct").notNull().default(0),
    // Rates in force when the order was saved, so a stored quote does not move
    // when the rate table is later edited. JSON: {"CNY":0.14,"USD":1}
    ratesSnapshot: text("rates_snapshot").notNull().default("{}"),
    // Which bank account the proforma shows. Null means "the default one",
    // so orders that never chose keep following whatever Settings says.
    bankAccountId: integer("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "set null",
    }),
    notes: text("notes").notNull().default(""),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: integer("updated_by").references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("orders_status_idx").on(table.status)],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    unitPriceSnapshot: real("unit_price_snapshot").notNull(),
    // The invoiced price per unit, frozen with the rest of the line. 0 on
    // rows saved before selling prices existed, which read as "at cost".
    sellPriceSnapshot: real("sell_price_snapshot").notNull().default(0),
    currencySnapshot: text("currency_snapshot").notNull(),
    moqSnapshot: integer("moq_snapshot").notNull(),
    lineTotal: real("line_total").notNull(),
    lineCbm: real("line_cbm").notNull(),
    lineWeightKg: real("line_weight_kg").notNull(),
    // Cartons this line ships as, frozen at save time. Defaults to 0 for rows
    // written before this column existed; readers fall back to the product's
    // current pack size for those.
    cartonsSnapshot: integer("cartons_snapshot").notNull().default(0),
  },
  (table) => [index("order_items_order_idx").on(table.orderId)],
);

/**
 * Files attached to an order — the supplier's invoice above all, but packing
 * lists, bills of lading and inspection reports all end up in the same file
 * in this business. Stored in the uploads volume next to product photos.
 */
export const orderDocuments = sqliteTable(
  "order_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["supplier_invoice", "packing_list", "bill_of_lading", "inspection", "other"],
    })
      .notNull()
      .default("other"),
    /** Path under /uploads, uuid-named like product photos. */
    path: text("path").notNull(),
    /** The name the file arrived with, used when downloading it back. */
    originalName: text("original_name").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    uploadedBy: integer("uploaded_by").references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("order_documents_order_idx").on(table.orderId)],
);

/**
 * Money moving on an order, in both directions: what the client pays in and
 * what goes out to the supplier. Amounts keep their own currency and are
 * converted for the summary the same way order totals are.
 */
export const orderPayments = sqliteTable(
  "order_payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    amount: real("amount").notNull(),
    currency: text("currency").notNull(),
    /** ISO date the money moved, not the date the row was typed in. */
    paidOn: text("paid_on").notNull(),
    /**
     * The rate table as it stood when this payment was recorded — the same
     * freezing orders do. What a client's dollars were worth on the day they
     * arrived must not drift when rates move later. Empty on legacy rows,
     * which fall back to the order's own snapshot.
     */
    ratesSnapshot: text("rates_snapshot").notNull().default("{}"),
    /** Which bank account the money touched, e.g. "USD" or "RMB". */
    account: text("account").notNull().default(""),
    /**
     * The payment slip: a photo or PDF of the transfer receipt, stored in the
     * uploads volume under a session-gated name. Empty when none was attached.
     */
    receiptPath: text("receipt_path").notNull().default(""),
    receiptName: text("receipt_name").notNull().default(""),
    note: text("note").notNull().default(""),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("order_payments_order_idx").on(table.orderId)],
);

/** Everything an order costs beyond the goods themselves. */
export const orderExpenses = sqliteTable(
  "order_expenses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    category: text("category", {
      enum: ["freight", "customs", "inspection", "local_transport", "bank_fees", "other"],
    })
      .notNull()
      .default("other"),
    amount: real("amount").notNull(),
    currency: text("currency").notNull(),
    spentOn: text("spent_on").notNull(),
    /** Same freezing as payments; see order_payments.rates_snapshot. */
    ratesSnapshot: text("rates_snapshot").notNull().default("{}"),
    /** Receipt for the expense, same shape as order_payments.receipt_path. */
    receiptPath: text("receipt_path").notNull().default(""),
    receiptName: text("receipt_name").notNull().default(""),
    note: text("note").notNull().default(""),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("order_expenses_order_idx").on(table.orderId)],
);

/**
 * The order's history: who did what to it, and when.
 *
 * Events store structured payloads rather than prose, so the changelog can be
 * rendered in whichever language the reader is using. Display values (names,
 * codes, amounts) are captured at write time — a later rename or deletion
 * must not rewrite what the log says happened.
 */
export const orderEvents = sqliteTable(
  "order_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id),
    kind: text("kind", {
      enum: [
        "created",
        "edited",
        "status",
        "payment_added",
        "payment_removed",
        "expense_added",
        "expense_removed",
        "document_added",
        "document_removed",
      ],
    }).notNull(),
    /** JSON payload; shape depends on kind. See src/lib/order-log.ts. */
    payload: text("payload").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("order_events_order_idx").on(table.orderId)],
);

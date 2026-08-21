import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
  type AnySQLiteColumn,
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
    // Which vendor sells this. Nullable: products registered before suppliers
    // existed have none, and a product can be catalogued before the card is.
    // Deleting a referenced contact is blocked in the action, mirroring how
    // clients with orders are protected.
    supplierId: integer("supplier_id").references(() => contacts.id),
    // The product this one was duplicated from when comparison-shopping the
    // same item across booths. Write-only lineage for now: it lets offers for
    // one item be grouped later without re-entering anything.
    duplicatedFromId: integer("duplicated_from_id").references(
      (): AnySQLiteColumn => products.id,
      { onDelete: "set null" },
    ),
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
    index("products_supplier_idx").on(table.supplierId),
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
    /** English (or latin-script) name — what the team reads day to day. */
    companyName: text("company_name").notNull(),
    /** As printed on the business card; empty when the card is latin-only. */
    companyNameZh: text("company_name_zh").notNull().default(""),
    contactPerson: text("contact_person").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    whatsapp: text("whatsapp").notNull().default(""),
    wechat: text("wechat").notNull().default(""),
    // Where to physically find the vendor again — for market suppliers the
    // booth ("一区2楼C区9街4642店"), its own field because it is the retrieval
    // key on a revisit, not a footnote.
    boothLocation: text("booth_location").notNull().default(""),
    // Bank accounts as read off the card back. Free text, one account per
    // line. Always treated as unverified: finance checks the digits against
    // the stored card photo before any payment goes out.
    bankInfo: text("bank_info").notNull().default(""),
    notes: text("notes").notNull().default(""),
    // Deactivated, never deleted: orders and supplier offers point here, and
    // removing the row would erase who a deal was actually done with. An
    // inactive contact stops appearing in pickers and keeps its history.
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("contacts_type_idx").on(table.type)],
);

/**
 * Business-card photos attached to a contact. The photos are the system of
 * record: the WeChat QR on a card back can only be scanned from the image,
 * and bank digits are re-checked against it before paying.
 */
export const contactImages = sqliteTable(
  "contact_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // "card": a business-card photo. "qr": the WeChat QR cropped out of one,
    // shown next to the WeChat field so it can be scanned straight away.
    kind: text("kind", { enum: ["card", "qr"] }).notNull().default("card"),
    path: text("path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("contact_images_contact_idx").on(table.contactId)],
);

/**
 * What one supplier will sell one product for.
 *
 * A sourcing company's real asset is this map: the same electric scooter
 * quoted by five factories at five prices. The product is the item — what it
 * is and what Mbarete invoices it at. The offer is the deal — what it costs,
 * from whom, in what quantity, quoted when. Margin is the gap between them,
 * and it differs per supplier, which is exactly the comparison this table
 * exists to make possible.
 *
 * `supplierId` is nullable on purpose: products registered before offers
 * existed carry a known price from an unrecorded source, and saying so beats
 * inventing a supplier.
 */
export const productSuppliers = sqliteTable(
  "product_suppliers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    supplierId: integer("supplier_id").references(() => contacts.id),
    price: real("price").notNull(),
    currency: text("currency").notNull().default("USD"),
    moq: integer("moq").notNull().default(1),
    // Optional: 0 means nobody recorded it. Never blocks saving an offer —
    // most China lead times are the same 30 days and not worth typing.
    leadTimeDays: integer("lead_time_days").notNull().default(0),
    /**
     * When this price was quoted, ISO date. Factory prices move, so a quote
     * has an age; the catalog ages stale ones visibly rather than letting a
     * two-year-old cost be mistaken for today's.
     */
    quotedOn: text("quoted_on").notNull(),
    note: text("note").notNull().default(""),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("product_suppliers_product_idx").on(table.productId),
    index("product_suppliers_supplier_idx").on(table.supplierId),
  ],
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

/**
 * A product photographed at a booth before it was a catalog entry.
 *
 * The agent works where the network does not: a hall at the Canton Fair, a
 * lane in Yiwu, Tailscale dropping between towers. Saving there writes the
 * capture to the phone, and the phone ships it here as soon as anything
 * resembling a connection appears. This table is where a capture stops being
 * one device's problem — once a row exists the photos are on the NAS and a
 * lost, wiped or stolen phone costs nothing.
 *
 * A draft is deliberately not a product. `products` requires a name, a
 * category, an MOQ and a pack size (see src/lib/validators.ts), and a capture
 * that is three photos and nothing else has none of them. Drafts are held
 * here, read by the AI when there is a connection to read them with, and
 * promoted into the catalog by a human who has checked the price.
 */
export const captureDrafts = sqliteTable(
  "capture_drafts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /**
     * The id the phone minted at capture time. Unique, which is the whole
     * mechanism: a delivery that succeeded but whose response never made it
     * back gets retried, and the retry lands on this constraint instead of
     * creating a second copy of the same booth.
     */
    clientId: text("client_id").notNull().unique(),
    userId: integer("user_id").references(() => users.id),
    /** What the capture will become: a catalog product, or a contact. */
    kind: text("kind", { enum: ["product", "contact"] })
      .notNull()
      .default("product"),
    status: text("status", {
      enum: [
        /** Arrived; the AI has not read the photos yet. */
        "pending",
        /** The AI read them; suggested fields are in `transcript`. */
        "read",
        /** Promoted into the catalog — `productId` says what it became. */
        "imported",
        /** Thrown away by hand. Kept so the photos can still be recovered. */
        "discarded",
      ],
    })
      .notNull()
      .default("pending"),
    /**
     * Whatever the agent had typed when they hit save, as posted by the form.
     * JSON of string values, the same names the product form uses, so a draft
     * can be poured straight back into that form for proofreading.
     */
    fields: text("fields").notNull().default("{}"),
    /** The AI's reading of the photos: JSON of TranscribedFields, or empty. */
    transcript: text("transcript").notNull().default("{}"),
    /** What the AI wanted to flag about the reading, shown with the draft. */
    transcriptNotes: text("transcript_notes").notNull().default(""),
    /** Why the last AI read failed, when one did. Empty otherwise. */
    transcriptError: text("transcript_error").notNull().default(""),
    /** The product this draft became, once someone promoted it. */
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    /** When the photo was taken, per the phone — not when it arrived here. */
    capturedAt: text("captured_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("capture_drafts_status_idx").on(table.status)],
);

/** The photos of a capture, in the order they were taken. */
export const captureDraftImages = sqliteTable(
  "capture_draft_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    draftId: integer("draft_id")
      .notNull()
      .references(() => captureDrafts.id, { onDelete: "cascade" }),
    // Which slot the photo belongs to. Products only have "image"; contacts
    // keep card photos and the cropped WeChat QR apart, mirroring
    // contact_images.kind, so promoting a draft can tell them apart too.
    role: text("role", { enum: ["image", "card", "qr"] })
      .notNull()
      .default("image"),
    path: text("path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("capture_draft_images_draft_idx").on(table.draftId)],
);

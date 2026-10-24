import type { Destination } from "@/lib/landed-cost";

/**
 * What the product form's parts share: the values a product arrives with,
 * and the small vocabulary the sections speak to each other in.
 */

export type Category = { id: number; nameEn: string; nameZh: string };

export type ProductFormValues = {
  sku: string;
  supplierCode: string;
  thumbPath: string;
  nameEn: string;
  nameZh: string;
  categoryId: number;
  descriptionEn: string;
  descriptionZh: string;
  boardText: string;
  aiNotes: string;
  hsCode: string;
  cnHsCode: string;
  declarationElements: string;
  customsUnit: "pcs" | "set" | "pair";
  exportDestination: "" | Destination;
  importDutyPctBr: number | null;
  importDutyPctPy: number | null;
  price: number;
  supplierVatPct?: number;
  sellPrice: number;
  /** "" means the cost currency (products from before selling currencies). */
  sellCurrency: string;
  currency: string;
  moq: number;
  qtyPerBox: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  dimensionSource: "carton" | "piece";
  pieceLengthCm: number;
  pieceWidthCm: number;
  pieceHeightCm: number;
  pieceWeightKg: number;
  packingAllowancePct: number;
  cbmOverride: number;
  supplierId: number;
  duplicatedFromId: number;
  active: boolean;
};

export type ExistingImage = { id: number; path: string };

/** Unmeasured fields show empty rather than a 0 nobody entered. */
export const blankIfZero = (v: number | undefined) => (v ? String(v) : "");

/** Why a photo read produced nothing; "none" is a read that found no code. */
export type AiError = "no-photos" | "failed" | "limit";
export type NcmError = AiError | "none";

/** The duty rates the model proposed per destination, kept apart until chosen. */
export type DutySuggestions = Partial<Record<Destination, number>>;

import { useState, type RefObject } from "react";
import {
  computeCbm,
  DEFAULT_PACKING_ALLOWANCE_PCT,
  estimateCartonCbm,
  estimateCartonWeightKg,
} from "@/lib/calculations";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { inputValue } from "./fill-from-reading";
import type { ProductFormValues } from "./shared";

const num = (v: string) => {
  const n = Number(normalizeDecimalInput(v));
  return Number.isFinite(n) ? n : 0;
};

const startingPiece = (d?: Partial<ProductFormValues>) => ({
  lengthCm: String(d?.pieceLengthCm ?? 0),
  widthCm: String(d?.pieceWidthCm ?? 0),
  heightCm: String(d?.pieceHeightCm ?? 0),
  weightKg: String(d?.pieceWeightKg ?? 0),
});

const startingCartonCbm = (d?: Partial<ProductFormValues>) => {
  if (!d) return 0;
  return d.cbmOverride && d.cbmOverride > 0 ? d.cbmOverride : computeCbm(d.lengthCm ?? 0, d.widthCm ?? 0, d.heightCm ?? 0);
};

/**
 * How the product is packed: pieces per carton, and the carton either as
 * the supplier measured it or estimated from one piece. Held in state so the
 * estimate and the landed cost follow the figures as they are typed.
 */
export function usePackaging(formRef: RefObject<HTMLFormElement | null>, defaults?: Partial<ProductFormValues>) {
  // Which figures the supplier actually gave us. Carton is the accurate path;
  // piece estimates a carton when only the product itself has been quoted.
  const [source, setSource] = useState<"carton" | "piece">(defaults?.dimensionSource ?? "carton");
  // Controlled so the estimate below updates as the numbers are typed.
  const [qtyPerBox, setQtyPerBox] = useState(String(defaults?.qtyPerBox ?? 1));
  // The carton figure the form would save right now (vendor override, else
  // from the dimensions) — only to warn when it cannot be a carton.
  const [cartonCbm, setCartonCbm] = useState<number>(() => startingCartonCbm(defaults));
  const [piece, setPiece] = useState(() => startingPiece(defaults));
  const [allowance, setAllowance] = useState(String(defaults?.packingAllowancePct ?? DEFAULT_PACKING_ALLOWANCE_PCT));

  const pieceDims = { lengthCm: num(piece.lengthCm), widthCm: num(piece.widthCm), heightCm: num(piece.heightCm) };
  const perBox = num(qtyPerBox);
  const allowancePct = num(allowance);

  /** Re-reads the carton fields, which stay uncontrolled so a photo reading can fill them. */
  function updateCartonCbm() {
    const form = formRef.current;
    if (!form) return;
    const read = (name: string) => num(inputValue(form, name));
    const override = read("cbmOverride");
    setCartonCbm(override > 0 ? override : computeCbm(read("lengthCm"), read("widthCm"), read("heightCm")));
  }

  /** Back to how the product arrived — after a capture is saved to the phone. */
  function reset() {
    setCartonCbm(defaults?.cbmOverride || computeCbm(defaults?.lengthCm ?? 0, defaults?.widthCm ?? 0, defaults?.heightCm ?? 0));
    setSource(defaults?.dimensionSource ?? "carton");
    setQtyPerBox(String(defaults?.qtyPerBox ?? 1));
    setPiece(startingPiece(defaults));
    setAllowance(String(defaults?.packingAllowancePct ?? DEFAULT_PACKING_ALLOWANCE_PCT));
  }

  return {
    source,
    setSource,
    qtyPerBox,
    setQtyPerBox,
    cartonCbm,
    piece,
    setPiece,
    allowance,
    setAllowance,
    perBox,
    allowancePct,
    estimatedCbm: estimateCartonCbm(pieceDims, perBox, allowancePct),
    estimatedWeight: estimateCartonWeightKg(num(piece.weightKg), perBox, allowancePct),
    bareCbm: computeCbm(pieceDims.lengthCm, pieceDims.widthCm, pieceDims.heightCm) * perBox,
    updateCartonCbm,
    reset,
  };
}

export type Packaging = ReturnType<typeof usePackaging>;

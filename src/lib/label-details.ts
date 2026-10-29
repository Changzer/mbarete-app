import { DESTINATION_COUNTRIES, type DestinationCountry } from "@/lib/customs";
import { parsePartiesSnapshot, usesFrozenParties } from "@/lib/parties-snapshot";
import { clientConsignee } from "@/lib/carton-labels";

/**
 * The final destination a carton label prints when the order names none: the
 * client as the order's documents know them — frozen at confirmation like
 * every document, live while a draft — with the destination country.
 */
export function orderClientConsignee(
  order: { status: string; partiesSnapshot: string | null; destinationCountry: string },
  client: { companyName: string; boothLocation: string } | null | undefined,
): string {
  const frozen = usesFrozenParties(order.status) ? parsePartiesSnapshot(order.partiesSnapshot) : null;
  const country = DESTINATION_COUNTRIES[order.destinationCountry as DestinationCountry];
  return clientConsignee({
    companyName: frozen?.client?.companyName ?? client?.companyName ?? "",
    // A client's "booth/address" field is their address.
    address: frozen?.client?.address ?? client?.boothLocation ?? "",
    countryEn: country?.en ?? "",
  });
}

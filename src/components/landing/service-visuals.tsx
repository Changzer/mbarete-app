import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { ArrowUpRight, ClipboardList, PackageCheck } from "lucide-react";
import styles from "./landing.module.css";

// Existing illustrative artwork, never presented as a client order or as
// proof of factory visits. No invented quotes, approval states, or quantities.
const bottle = "/landing/01-insulated-bottle.webp";

export async function HeroVisual() {
  const t = await getTranslations("landing.visual");
  return (
    <figure className={styles.heroVisual}>
      <div className={styles.heroImage}>
        <Image src={bottle} alt={t("bottleAlt")} fill sizes="(min-width: 1100px) 540px, (min-width: 768px) 46vw, 100vw" className={styles.productImage} preload />
        <div className={styles.imageTopline}><span>{t("heroLabel")}</span><ArrowUpRight size={21} aria-hidden /></div>
        <div className={styles.imageCaption}><span>{t("heroCaption")}</span><span>01 — 03</span></div>
      </div>
      <figcaption>{t("illustrative")}</figcaption>
    </figure>
  );
}

export async function ServiceVisual({ chapter }: { chapter: "sourcing" | "sampling" | "export" }) {
  const t = await getTranslations("landing.visual");
  if (chapter === "sourcing") return (
    <figure className={styles.sourcingVisual}>
      <div className={styles.productPair}>
        <div><Image src="/landing/06-preschool-backpack.webp" alt={t("backpackAlt")} fill sizes="(min-width: 768px) 270px, 50vw" className={styles.productImage} /></div>
        <div><Image src="/landing/03-rechargeable-mini-fan.webp" alt={t("fanAlt")} fill sizes="(min-width: 768px) 220px, 45vw" className={styles.productImage} /></div>
      </div>
      <figcaption className={styles.briefCard}>
        <p className={styles.documentLabel}><ClipboardList size={17} aria-hidden />{t("sourcingTitle")}</p>
        <ul>{["supplierOptions", "orderMinimum", "leadTime"].map((key) => <li key={key}>{t(key)}</li>)}</ul>
      </figcaption>
    </figure>
  );
  if (chapter === "sampling") return (
    <figure className={styles.sampleVisual}>
      <div className={styles.sampleImage}><Image src={bottle} alt={t("bottleAlt")} fill sizes="(min-width: 768px) 480px, 90vw" className={styles.productImage} /></div>
      <figcaption className={styles.sampleNote}>
        <span className={styles.documentLabel}>{t("sampleTitle")}</span><p>{t("sampleBody")}</p><div>{t("sampleFollowup")}</div>
      </figcaption>
    </figure>
  );
  return (
    <div className={styles.exportVisual}>
      <div className={styles.exportHeading}><PackageCheck size={30} strokeWidth={1.3} aria-hidden /><span>{t("shipmentTitle")}</span></div>
      <ul className={styles.shipmentList}>
        {["inspectionScope", "packingList", "exportDocuments", "freightCoordination"].map((key, i) => (
          <li key={key}><span>{String(i + 1).padStart(2, "0")}</span>{t(key)}</li>
        ))}
      </ul>
      <div className={styles.route}><span>{t("origin")}</span><ArrowUpRight size={26} aria-hidden /><span>{t("destination")}</span></div>
      <p>{t("shipmentNote")}</p>
    </div>
  );
}

/**
 * The filing-number footer a mainland deployment is required to display:
 * ICP 备案 linking to the MIIT registry, 公安备案 linking to the public
 * security registry. Entirely env-driven (ICP_BEIAN / GONGAN_BEIAN) and
 * absent when unset, so non-mainland deployments render nothing.
 */
export function BeianFooter() {
  const icp = process.env.ICP_BEIAN || "";
  const gongan = process.env.GONGAN_BEIAN || "";
  if (!icp && !gongan) return null;
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pb-4 text-[11px] text-faint">
      {icp ? (
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noreferrer"
          className="hover:text-sub"
        >
          {icp}
        </a>
      ) : null}
      {gongan ? (
        <a
          href={`https://beian.mps.gov.cn/#/query/webSearch?code=${encodeURIComponent(
            gongan.replace(/\D/g, ""),
          )}`}
          target="_blank"
          rel="noreferrer"
          className="hover:text-sub"
        >
          {gongan}
        </a>
      ) : null}
    </footer>
  );
}

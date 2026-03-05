import Skeleton from "../../components/Skeleton";

function SkeletonCatalogBlock({ showDivider }: { showDivider: boolean }) {
  return (
    <div>
      <div className="card" style={{ marginTop: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "nowrap" }}>
          <Skeleton style={{ width: 120, height: 20 }} />
          <Skeleton style={{ width: 72, height: 16 }} />
        </div>
        <div
          style={{
            marginTop: "var(--space-md)",
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "var(--space-md)"
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={`homepage-skeleton-card-${i}`}>
              <Skeleton style={{ width: "100%", aspectRatio: "3/4" }} />
              <Skeleton style={{ width: "82%", height: 14, marginTop: "var(--space-sm)" }} />
              <Skeleton style={{ width: "56%", height: 12, marginTop: "var(--space-sm)" }} />
            </div>
          ))}
        </div>
      </div>
      {showDivider ? <hr className="om-hr" /> : null}
    </div>
  );
}

export default function HomepageSkeleton() {
  return (
    <main className="container" aria-hidden="true">
      <div style={{ marginTop: "var(--space-16)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <div className="row" style={{ justifyContent: "space-between", margin: 0 }}>
          <div className="om-stat-line">
            <span className="om-stat-pair">
              <Skeleton style={{ width: 62, height: 16 }} />
              <Skeleton style={{ width: 14, height: 16 }} />
            </span>
            <span className="om-stat-pair">
              <Skeleton style={{ width: 42, height: 16 }} />
              <Skeleton style={{ width: 14, height: 16 }} />
            </span>
          </div>
        </div>

        <div className="row" style={{ width: "100%", margin: 0, alignItems: "baseline", justifyContent: "space-between", flexWrap: "nowrap" }}>
          <div className="row" style={{ flex: "1 1 auto", gap: "var(--space-md)", alignItems: "baseline", minWidth: 0, flexWrap: "nowrap", margin: 0 }}>
            <Skeleton style={{ width: 360, height: 18, flex: "1 1 auto" }} />
            <Skeleton style={{ width: 22, height: 16 }} />
            <Skeleton style={{ width: 52, height: 16 }} />
          </div>
          <Skeleton style={{ width: 50, height: 16 }} />
        </div>
      </div>

      <div style={{ height: "var(--catalog-top-gap)" }} />

      <SkeletonCatalogBlock showDivider />
      <SkeletonCatalogBlock showDivider={false} />
    </main>
  );
}


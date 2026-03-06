import Skeleton from "./Skeleton";

type OverviewSkeletonProps = {
  showToolbar?: boolean;
  catalogCount?: number;
};

export default function OverviewSkeleton({ showToolbar = true, catalogCount = 2 }: OverviewSkeletonProps) {
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

        {showToolbar ? (
          <div className="row" style={{ width: "100%", margin: 0, alignItems: "baseline", justifyContent: "space-between", flexWrap: "nowrap" }}>
            <div className="row" style={{ flex: "1 1 auto", gap: "var(--space-md)", alignItems: "baseline", minWidth: 0, flexWrap: "nowrap", margin: 0 }}>
              <Skeleton style={{ width: 52, height: 16 }} />
              <Skeleton style={{ width: 52, height: 16 }} />
            </div>
            <Skeleton style={{ width: 220, height: 18 }} />
          </div>
        ) : null}
      </div>

      <div style={{ height: "var(--catalog-top-gap)" }} />

      {Array.from({ length: Math.max(1, catalogCount) }).map((_, blockIdx) => (
        <div key={`overview-skeleton-block-${blockIdx}`}>
          <div className="card" style={{ marginTop: 0 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "nowrap" }}>
              <Skeleton style={{ width: 120, height: 20 }} />
              <Skeleton style={{ width: 72, height: 16 }} />
            </div>
            <div
              className="om-skeleton-card-grid"
              style={{
                marginTop: "var(--space-md)"
              }}
            >
              {Array.from({ length: 4 }).map((__, i) => (
                <div key={`overview-skeleton-card-${blockIdx}-${i}`}>
                  <Skeleton style={{ width: "100%", aspectRatio: "3/4" }} />
                  <Skeleton style={{ width: "82%", height: 14, marginTop: "var(--space-sm)" }} />
                  <Skeleton style={{ width: "56%", height: 12, marginTop: "var(--space-sm)" }} />
                </div>
              ))}
            </div>
          </div>
          {blockIdx < Math.max(1, catalogCount) - 1 ? <hr className="om-hr" /> : null}
        </div>
      ))}
    </main>
  );
}

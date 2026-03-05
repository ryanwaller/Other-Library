import type { CSSProperties } from "react";

type SkeletonProps = {
  className?: string;
  style?: CSSProperties;
};

export default function Skeleton({ className = "", style }: SkeletonProps) {
  const cls = className ? `skeleton ${className}` : "skeleton";
  return <div className={cls} style={style} aria-hidden="true" />;
}


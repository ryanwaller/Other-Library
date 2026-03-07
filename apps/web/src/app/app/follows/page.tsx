"use client";

import FollowsPanel from "./FollowsPanel";
import usePageTitle from "../../../hooks/usePageTitle";

export default function FollowsPage() {
  usePageTitle("Follows");
  return <FollowsPanel />;
}

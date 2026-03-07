"use client";

import BorrowRequestsPanel from "./BorrowRequestsPanel";
import usePageTitle from "../../../hooks/usePageTitle";

export default function BorrowRequestsPage() {
  usePageTitle("Borrow Requests");
  return <BorrowRequestsPanel />;
}

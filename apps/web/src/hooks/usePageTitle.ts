"use client";

import { useEffect } from "react";
import { formatPageTitle } from "../lib/pageTitle";

export default function usePageTitle(context?: string | null) {
  useEffect(() => {
    document.title = formatPageTitle(context);
  }, [context]);
}

"use client";

import { useState, useCallback } from "react";

export function useBookScanner() {
  const [scannerOpen, setScannerOpen] = useState(false);
  const openScanner = useCallback(() => setScannerOpen(true), []);
  const closeScanner = useCallback(() => setScannerOpen(false), []);
  return { scannerOpen, openScanner, closeScanner };
}

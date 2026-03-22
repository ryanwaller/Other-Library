"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type MouseEvent, type KeyboardEvent } from "react";
import { supabase } from "../lib/supabaseClient";

const EXPLORE_LOCK_STATE_EVENT = "om:explore-lock-state";
const EXPLORE_LOCK_CLOSE_EVENT = "om:explore-lock-close";

function dispatchExploreLockState(open: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EXPLORE_LOCK_STATE_EVENT, { detail: { open } }));
}

function buildSignInHref(targetHref: string): string {
  return `/signin?next=${encodeURIComponent(targetHref || "/")}`;
}

export default function ExploreSignInLock({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<"checking" | "locked" | "unlocked">("checking");
  const [open, setOpen] = useState(false);
  const [targetHref, setTargetHref] = useState<string>("/");

  useEffect(() => {
    if (!supabase) {
      setAuthState("locked");
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setAuthState(data.session?.user?.id ? "unlocked" : "locked");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const unlocked = Boolean(session?.user?.id);
      setAuthState(unlocked ? "unlocked" : "locked");
      if (unlocked) setOpen(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onClose = () => setOpen(false);
    window.addEventListener(EXPLORE_LOCK_CLOSE_EVENT, onClose);
    return () => window.removeEventListener(EXPLORE_LOCK_CLOSE_EVENT, onClose);
  }, []);

  useEffect(() => {
    if (authState !== "locked" && open) setOpen(false);
  }, [authState, open]);

  useEffect(() => {
    document.body.classList.toggle("om-explore-lock-open", open);
    dispatchExploreLockState(open);
    return () => {
      document.body.classList.remove("om-explore-lock-open");
      dispatchExploreLockState(false);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const signInHref = useMemo(() => buildSignInHref(targetHref), [targetHref]);

  function maybeOpenLock(href: string) {
    if (authState !== "locked") return false;
    if (!href || href.startsWith("#") || href.startsWith("/signin")) return false;
    if (!href.startsWith("/")) return false;
    setTargetHref(href);
    setOpen(true);
    return true;
  }

  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (authState !== "locked") return;
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target as HTMLElement | null;
    if (!target || target.closest("[data-explore-lock-allow='true']")) return;
    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    if (anchor.target && anchor.target !== "_self") return;

    const href = anchor.getAttribute("href")?.trim() ?? "";
    if (!maybeOpenLock(href)) return;

    event.preventDefault();
    event.stopPropagation();
  }

  function handleKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (authState !== "locked") return;
    if (event.defaultPrevented) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    const target = event.target as HTMLElement | null;
    if (!target || target.closest("[data-explore-lock-allow='true']")) return;
    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;

    const href = anchor.getAttribute("href")?.trim() ?? "";
    if (!maybeOpenLock(href)) return;

    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      className="om-explore-signin-lock"
      data-state={open ? "open" : "closed"}
      onClickCapture={handleClickCapture}
      onKeyDownCapture={handleKeyDownCapture}
    >
      {children}
      <div className="om-explore-lock-overlay" aria-hidden={open ? "false" : "true"}>
        <button
          type="button"
          className="om-explore-lock-backdrop"
          onClick={() => setOpen(false)}
          aria-label="Close sign-in prompt"
          tabIndex={open ? 0 : -1}
          data-explore-lock-allow="true"
        />
        <div className="om-explore-lock-modal" data-explore-lock-allow="true">
          <Link
            href={signInHref}
            className="om-filter-control om-explore-lock-signin"
            data-explore-lock-allow="true"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

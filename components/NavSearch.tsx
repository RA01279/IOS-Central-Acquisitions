"use client";
// components/NavSearch.tsx
//
// Global search box in the nav. Submits to /search; pressing "/" anywhere
// (outside a form field) jumps focus here.

import { useEffect, useRef } from "react";

export default function NavSearch({ initial }: { initial?: string }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      e.preventDefault();
      ref.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form action="/search" method="get" className="nav-search">
      <input
        ref={ref}
        name="q"
        placeholder="Search everything…  ( / )"
        defaultValue={initial ?? ""}
        autoComplete="off"
      />
    </form>
  );
}

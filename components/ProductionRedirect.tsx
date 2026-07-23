"use client";
// components/ProductionRedirect.tsx
//
// If this page is being viewed on a deployment-specific *.vercel.app URL
// (the immutable per-build snapshots Vercel mints), bounce to the production
// domain, preserving the path. Team members repeatedly ended up on frozen
// snapshot URLs -- served with whatever env was baked in at build time --
// and mistook them for the live app. localhost and any future custom domain
// are left alone.

import { useEffect } from "react";

const PROD_HOST = "ios-central-acquisitions.vercel.app";

export default function ProductionRedirect() {
  useEffect(() => {
    const h = window.location.hostname;
    if (h !== PROD_HOST && h.endsWith(".vercel.app")) {
      window.location.replace(
        `https://${PROD_HOST}${window.location.pathname}${window.location.search}`
      );
    }
  }, []);
  return null;
}

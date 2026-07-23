"use client";
// components/BackButton.tsx
//
// Browser-style back button, rendered at the top of every page. Uses
// history.back() so it always returns to wherever the user actually came
// from, regardless of how they got here.

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();
  return (
    <button type="button" className="back-btn" onClick={() => router.back()}>
      ← Back
    </button>
  );
}

"use client";
// components/PrintButton.tsx -- opens the browser's print dialog ("Save as PDF").

export default function PrintButton({ label = "Save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="secondary no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}

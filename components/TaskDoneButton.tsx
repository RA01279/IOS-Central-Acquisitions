"use client";
// components/TaskDoneButton.tsx

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TaskDoneButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function done() {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="task-done" onClick={done} disabled={busy} title="Mark done">
      {busy ? "…" : "✓ Done"}
    </button>
  );
}

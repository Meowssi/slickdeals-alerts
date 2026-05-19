"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export function DealActions({ dealId, saved, dismissed }: {
  dealId: number; saved: boolean; dismissed: boolean;
}) {
  const router = useRouter();
  const [isSaved, setIsSaved] = useState(saved);
  const [isDismissed, setIsDismissed] = useState(dismissed);

  async function toggle(field: "saved" | "dismissed") {
    const supa = supabaseBrowser();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return;
    const next = field === "saved" ? !isSaved : !isDismissed;
    await supa.from("deal_state").upsert({
      user_id: user.id,
      deal_id: dealId,
      [field]: next,
    });
    if (field === "saved") setIsSaved(next);
    else setIsDismissed(next);
    router.refresh();
  }

  return (
    <>
      <button className="btn-secondary" onClick={() => toggle("saved")}>
        {isSaved ? "★ Saved" : "☆ Save"}
      </button>
      <button className="btn-secondary" onClick={() => toggle("dismissed")}>
        {isDismissed ? "Dismissed" : "Dismiss"}
      </button>
    </>
  );
}

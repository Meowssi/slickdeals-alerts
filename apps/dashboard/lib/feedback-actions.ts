"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { adminEmails } from "@/lib/admin-auth";

type Category = "bug" | "feature" | "question" | "other";
type Status = "open" | "in_progress" | "resolved";

const CATEGORIES: ReadonlyArray<Category> = ["bug", "feature", "question", "other"];
const STATUSES: ReadonlyArray<Status> = ["open", "in_progress", "resolved"];

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

async function requireAdmin(): Promise<void> {
  // Layout-level TOTP gate already covers /admin/* — this is the email
  // double-check for actions invoked from those pages.
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  const email = (user?.email ?? "").toLowerCase();
  if (!adminEmails().includes(email)) {
    throw new Error("Forbidden");
  }
}

export async function submitFeedbackAction(formData: FormData): Promise<void> {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");

  const category = str(formData.get("category")) as Category;
  const subject  = str(formData.get("subject"));
  const message  = str(formData.get("message"));

  if (!CATEGORIES.includes(category)) {
    redirect("/feedback?err=category");
  }
  if (subject.length < 1 || subject.length > 200) {
    redirect("/feedback?err=subject");
  }
  if (message.length < 1 || message.length > 5000) {
    redirect("/feedback?err=message");
  }

  const { error } = await supa.from("feedback").insert({
    user_id: user.id,
    user_email: user.email ?? "",
    category,
    subject,
    message,
  });
  if (error) {
    console.error("submitFeedbackAction insert failed", error);
    redirect("/feedback?err=save");
  }

  revalidatePath("/feedback");
  revalidatePath("/admin/feedback");
  redirect("/feedback?ok=1");
}

export async function updateFeedbackStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const id     = str(formData.get("id"));
  const status = str(formData.get("status")) as Status;
  if (!id || !STATUSES.includes(status)) return;

  const supa = supabaseAdmin();
  await supa.from("feedback").update({ status }).eq("id", id);
  revalidatePath("/admin/feedback");
}

export async function respondFeedbackAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const id       = str(formData.get("id"));
  const response = str(formData.get("admin_response"));
  if (!id) return;

  const supa = supabaseAdmin();
  await supa.from("feedback").update({
    admin_response: response.length > 0 ? response : null,
  }).eq("id", id);
  revalidatePath("/admin/feedback");
}

export async function deleteFeedbackAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = str(formData.get("id"));
  if (!id) return;
  const supa = supabaseAdmin();
  await supa.from("feedback").delete().eq("id", id);
  revalidatePath("/admin/feedback");
}

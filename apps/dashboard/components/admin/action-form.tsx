"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/admin-actions";

interface Field {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "email";
  required?: boolean;
  help?: string;
  defaultValue?: string;
}

interface ActionFormProps {
  title: string;
  description?: string;
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  fields: Field[];
  submitLabel: string;
  /** When true, the form has no fields and is a single button. */
  singleButton?: boolean;
  /** Optional hint shown next to the button on success. */
  successHint?: string;
}

export function ActionForm({
  title,
  description,
  action,
  fields,
  submitLabel,
  singleButton,
  successHint,
}: ActionFormProps) {
  // useFormState is the React 18 / react-dom equivalent of React 19's useActionState.
  // It returns [state, formAction]; pending state is read via useFormStatus inside the form.
  const [result, formAction] = useFormState<ActionResult | null, FormData>(action, null);

  return (
    <section className="card p-5 space-y-3">
      <header>
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="text-sm text-neutral-600 mt-1">{description}</p>}
      </header>

      <form action={formAction} className="space-y-3">
        {fields.map((f) => (
          <div key={f.name}>
            <label className="block text-xs font-medium text-neutral-700 mb-1" htmlFor={f.name}>
              {f.label}
              {f.required && <span className="text-red-600 ml-0.5">*</span>}
            </label>
            <input
              id={f.name}
              name={f.name}
              type={f.type ?? "text"}
              placeholder={f.placeholder}
              required={f.required}
              defaultValue={f.defaultValue}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-mono placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none"
            />
            {f.help && <p className="text-[11px] text-neutral-500 mt-1">{f.help}</p>}
          </div>
        ))}

        <div className="flex items-center gap-3 flex-wrap">
          <SubmitButton label={submitLabel} />

          {result && (
            <span className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
              {result.ok ? "✓" : "✗"} {result.message}
            </span>
          )}
          {!result && successHint && !singleButton && (
            <span className="text-xs text-neutral-500">{successHint}</span>
          )}
        </div>
      </form>
    </section>
  );
}

// useFormStatus must be used inside a <form>, so we read pending state via a child component.
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-neutral-900 text-white text-sm font-medium px-4 py-1.5 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? "Working…" : label}
    </button>
  );
}

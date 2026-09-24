"use client";
import { useRef, useState } from "react";
import { flyPath } from "@/config/site";
import { track } from "@/lib/track";

/**
 * "Paste a SuperSplat link" → /{locale}/fly/?scene=<encoded raw value>. The simulator validates
 * the value. Without JS the same thing happens through a plain GET form.
 */
export default function ScenePaste({ locale, label, placeholder, button, hint, empty }: { locale: string; label: string; placeholder: string; button: string; hint: string; empty: string }) {
  const input = useRef<HTMLInputElement>(null);
  // an empty submit says so in the page (the native "required" bubble is easy to miss on phones)
  const [missing, setMissing] = useState(false);

  function go(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = input.current?.value.trim() ?? "";
    if (!value) {
      setMissing(true);
      input.current?.focus();
      return;
    }
    track("scene_open", "paste");
    window.location.assign(`${flyPath(locale)}?scene=${encodeURIComponent(value)}`);
  }

  return (
    <form action={flyPath(locale)} method="get" onSubmit={go} className="w-full max-w-xl">
      <label htmlFor="scene-link" className="mb-2 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={input}
          id="scene-link"
          name="scene"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
          placeholder={placeholder}
          aria-describedby="scene-link-hint"
          aria-invalid={missing || undefined}
          onInvalid={(e) => {
            e.preventDefault();
            setMissing(true);
            input.current?.focus();
          }}
          onInput={() => setMissing(false)}
          className={`field min-w-0 flex-1${missing ? " border-warn" : ""}`}
        />
        <button type="submit" className="btn-secondary min-h-12 shrink-0 px-5">
          {button}
        </button>
      </div>
      <p id="scene-link-hint" role={missing ? "alert" : undefined} className={`mt-2 text-sm ${missing ? "text-warn" : "text-muted"}`}>
        {missing ? empty : hint}
      </p>
    </form>
  );
}

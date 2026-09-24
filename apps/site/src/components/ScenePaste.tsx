"use client";
import { useRef } from "react";
import { flyPath } from "@/config/site";
import { track } from "@/lib/track";

/**
 * "Paste a SuperSplat link" → /{locale}/fly/?scene=<encoded raw value>. The simulator validates
 * the value. Without JS the same thing happens through a plain GET form.
 */
export default function ScenePaste({ locale, label, placeholder, button, hint }: { locale: string; label: string; placeholder: string; button: string; hint: string }) {
  const input = useRef<HTMLInputElement>(null);

  function go(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = input.current?.value.trim() ?? "";
    if (!value) {
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
          className="field min-w-0 flex-1"
        />
        <button type="submit" className="btn-secondary min-h-12 shrink-0 px-5">
          {button}
        </button>
      </div>
      <p id="scene-link-hint" className="mt-2 text-sm text-muted">
        {hint}
      </p>
    </form>
  );
}

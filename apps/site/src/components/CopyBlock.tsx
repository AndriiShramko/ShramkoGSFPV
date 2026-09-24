"use client";
import { useRef, useState } from "react";

/** Prompt block with a real copy button: one click copies, the label turns into "Copied". */
export default function CopyBlock({ text, label, copied, caption, id }: { text: string; label: string; copied: string; caption: string; id: string }) {
  const [ok, setOk] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function selectText() {
    const el = document.getElementById(id);
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  async function copy() {
    let done = false;
    try {
      await navigator.clipboard.writeText(text);
      done = true;
    } catch {
      // Older browsers / blocked clipboard API: fall back to a selection + execCommand.
      try {
        selectText();
        done = document.execCommand("copy");
      } catch {
        done = false;
      }
    }
    if (!done) {
      selectText();
      return;
    }
    setOk(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOk(false), 2500);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <span className="font-mono text-xs uppercase tracking-wider text-muted">{caption}</span>
        <button type="button" onClick={copy} className="btn-secondary min-h-11 px-4 text-sm" aria-describedby={id}>
          <span aria-live="polite">{ok ? copied : label}</span>
        </button>
      </div>
      <pre id={id} lang="en" className="whitespace-pre-wrap break-words p-4 font-mono text-sm leading-relaxed text-ink">
        {text}
      </pre>
    </div>
  );
}

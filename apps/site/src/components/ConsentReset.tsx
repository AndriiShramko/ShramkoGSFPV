"use client";
import { useState } from "react";
import { GA_ID } from "@/lib/track";

/** Lets a visitor change the analytics choice. Rendered only when GA is configured at all. */
export default function ConsentReset({ label, done }: { label: string; done: string }) {
  const [reset, setReset] = useState(false);
  if (!GA_ID) return null;
  return (
    <p className="mt-4">
      <button
        type="button"
        className="btn-secondary min-h-11 px-4 text-sm"
        onClick={() => {
          try {
            localStorage.removeItem("gsfpv_consent");
          } catch {
            /* ignore */
          }
          setReset(true);
          window.location.reload();
        }}
      >
        {reset ? done : label}
      </button>
    </p>
  );
}

"use client";
import { useState } from "react";
import { openConsent } from "@/lib/track";

/** Lets a visitor change the analytics choice: opens the consent banner again (Decline withdraws, lib/track.ts). */
export default function ConsentReset({ label, done }: { label: string; done: string }) {
  const [reset, setReset] = useState(false);
  return (
    <p id="cookies" className="mt-4 scroll-mt-20">
      <button
        type="button"
        className="btn-secondary min-h-11 px-4 text-sm"
        onClick={() => {
          setReset(true);
          openConsent();
        }}
      >
        {reset ? done : label}
      </button>
    </p>
  );
}

/** Brand mark: a quad seen from above (four ducts around a body). Decorative. */
export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="shrink-0">
      <g fill="none" stroke="#4ade80" strokeWidth="1.8">
        <circle cx="6" cy="6" r="4" />
        <circle cx="18" cy="6" r="4" />
        <circle cx="6" cy="18" r="4" />
        <circle cx="18" cy="18" r="4" />
      </g>
      <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#e8eaed" />
    </svg>
  );
}

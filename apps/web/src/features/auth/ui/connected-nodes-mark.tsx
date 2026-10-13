export function ConnectedNodesMark({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 48 48" fill="none">
      <path d="M13 14.5 24 24m0 0 12-10M24 24l-9 12m9-12 12 11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="13" r="5" fill="#0f766e" />
      <circle cx="36" cy="12" r="5" fill="#5eead4" />
      <circle cx="24" cy="24" r="6" fill="#0f766e" />
      <circle cx="14" cy="37" r="5" fill="#99f6e4" />
      <circle cx="37" cy="36" r="5" fill="#0f766e" />
    </svg>
  );
}

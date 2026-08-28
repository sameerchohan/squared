// Inline SVG icons in a single visual language: 24×24 grid, 1.75 stroke,
// round caps. Emoji are never used as icons — they render differently on
// every platform and can't inherit color or size from the design system.

type IconProps = { className?: string };

function Svg({
  children,
  className = "h-4 w-4",
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const UsersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4M12 16h.01" />
  </Svg>
);

export const CardIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
  </Svg>
);

export const ReceiptIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2Z" />
    <path d="M9 8h6M9 12h6" />
  </Svg>
);

export const ScalesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18M8 21h8M3 8l4-4 4 4M3 8a4 4 0 0 0 8 0M13 8l4-4 4 4M13 8a4 4 0 0 0 8 0" />
  </Svg>
);

export const LogOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Svg>
);

export const SpinnerIcon = ({ className = "h-4 w-4" }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    className={`animate-spin ${className}`}
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      strokeWidth={2.5}
      fill="none"
      opacity={0.25}
    />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

export const SquaredMark = ({ className = "h-7 w-7" }: IconProps) => (
  // Two ledger rules with a balanced third: the mark is the idea of the app —
  // entries above, the settled line beneath.
  <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="var(--brand)" />
    <path
      d="M10 12h12M10 16h8"
      stroke="var(--on-brand)"
      strokeWidth={2}
      strokeLinecap="round"
      opacity={0.45}
    />
    <path
      d="M10 21h12"
      stroke="var(--on-brand)"
      strokeWidth={2.5}
      strokeLinecap="round"
    />
  </svg>
);

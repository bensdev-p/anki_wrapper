export const APP_NAME = 'Rounds'

/** A card with a gap in it: a lacuna, as in a cloze deletion. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="logo-mark">
      <rect x="2.5" y="4" width="19" height="16" rx="4" fill="var(--accent)" />
      <rect x="6" y="9" width="5" height="2" rx="1" fill="var(--text-on-accent)" />
      <rect x="13" y="9" width="5" height="2" rx="1" fill="var(--text-on-accent)" opacity=".45" />
      <rect x="6" y="13" width="12" height="2" rx="1" fill="var(--text-on-accent)" />
    </svg>
  )
}

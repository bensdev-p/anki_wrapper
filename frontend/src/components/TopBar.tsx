import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { modKey } from '../lib/platform'
import { Kbd } from './Kbd'
import { SyncButton } from './SyncButton'
import { ThemeMenu } from './ThemeMenu'

interface Props {
  left: ReactNode
  center?: ReactNode
  right?: ReactNode
  onOpenPalette(): void
}

export function TopBar({ left, center, right, onOpenPalette }: Props) {
  return (
    <header className="topbar">
      <div className="topbar__left">{left}</div>
      <div className="topbar__center">{center}</div>
      <div className="topbar__right">
        {right}
        <SyncButton />
        <button className="palette-trigger" onClick={onOpenPalette} aria-label="Open command palette">
          <Search size={15} strokeWidth={2} />
          <span className="palette-trigger__text">Jump to…</span>
          <Kbd className="palette-trigger__kbd">{modKey}K</Kbd>
        </button>
        <ThemeMenu />
      </div>
    </header>
  )
}

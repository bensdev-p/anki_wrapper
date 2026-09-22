import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose(): void
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

/** Side panel on desktop, bottom sheet on phones. Native <dialog> for focus + Escape. */
export function Sheet({ open, onClose, title, subtitle, children, footer, wide = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className={`sheet ${wide ? 'sheet--wide' : ''}`}
      aria-labelledby="sheet-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet__panel">
        <header className="sheet__head">
          <div className="sheet__titles">
            <h2 id="sheet-title" className="sheet__title">
              {title}
            </h2>
            {subtitle && <p className="sheet__sub">{subtitle}</p>}
          </div>
          <button className="sheet__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="sheet__body">{open && children}</div>
        {footer && <footer className="sheet__foot">{footer}</footer>}
      </div>
    </dialog>
  )
}

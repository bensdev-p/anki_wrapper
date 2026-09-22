import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose(): void
  title: string
  children: ReactNode
  actions: ReactNode
  /** Blocking dialogs can't be dismissed with Escape or a backdrop click. */
  blocking?: boolean
}

/** Native <dialog> (focus trap + Escape for free) in our visual language. */
export function Dialog({ open, onClose, title, children, actions, blocking = false }: Props) {
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
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!blocking) onClose()
      }}
      onClick={(e) => {
        if (!blocking && e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dialog__body">
        <h2 id="dialog-title" className="dialog__title">
          {title}
        </h2>
        <div className="dialog__content">{children}</div>
        <div className="dialog__actions">{actions}</div>
      </div>
    </dialog>
  )
}

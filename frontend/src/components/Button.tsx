import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  iconOnly?: boolean
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'md', iconOnly = false, className = '', type = 'button', ...rest },
  ref,
) {
  const cls = ['btn', `btn--${variant}`, `btn--${size}`, iconOnly ? 'btn--icon' : '', className]
    .filter(Boolean)
    .join(' ')
  return <button ref={ref} type={type} className={cls} {...rest} />
})

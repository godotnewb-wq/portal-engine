import type { ButtonHTMLAttributes } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'md' | 'sm'
}

/** The one button for actions; never a raw <button>. */
export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ')} {...rest} />
}

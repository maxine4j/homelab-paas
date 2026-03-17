import { type ButtonHTMLAttributes, forwardRef } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'default' | 'sm' | 'lg'
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${size === 'lg' ? 'btn-lg' : ''} ${className || ''}`}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export default Button
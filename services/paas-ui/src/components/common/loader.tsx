interface LoaderProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Loader({ size = 'md', className }: LoaderProps) {
  const sizes = {
    sm: 'loader-sm',
    md: 'loader-md',
    lg: 'loader-lg',
  }

  return (
    <div className={`loader-container ${className || ''}`}>
      <svg
        className={`loader ${sizes[size]}`}
        viewBox="0 0 24 24"
      />
    </div>
  )
}
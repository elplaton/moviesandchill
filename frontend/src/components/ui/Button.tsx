import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'light' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children?: ReactNode;
}

/** Un solo botón para toda la interfaz: antes cada pantalla escribía el suyo. */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-nf-red text-white hover:bg-nf-red-dark',
  light: 'bg-white text-black hover:bg-white/85',
  ghost: 'bg-white/10 text-white hover:bg-white/20',
  danger: 'bg-nf-red/15 text-red-300 hover:bg-nf-red/30',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-base gap-2',
  lg: 'h-12 px-6 text-md gap-2.5 font-semibold',
};

export default function Button({ variant = 'ghost', size = 'md', icon, children, className = '', ...rest }: Props) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center rounded font-medium whitespace-nowrap
        transition-colors disabled:opacity-40 disabled:pointer-events-none
        ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {icon && <span className={size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'}>{icon}</span>}
      {children}
    </button>
  );
}

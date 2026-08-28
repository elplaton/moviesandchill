import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

interface FocusableLinkProps {
  to: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}

export default function FocusableLink({ to, className, children, onClick }: FocusableLinkProps) {
  const { ref, focused } = useFocusable({
    onEnterPress: () => onClick?.(),
  });

  return (
    <Link
      ref={ref as any}
      to={to}
      onClick={onClick}
      className={className}
      style={{
        outline: focused ? '2px solid #E50914' : 'none',
        outlineOffset: '2px',
      }}
    >
      {children}
    </Link>
  );
}

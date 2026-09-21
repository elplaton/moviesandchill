import { type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFocusItem } from '../focus/react';

interface FocusableLinkProps {
  to: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  focusKey?: string;
  index?: number;
}

export default function FocusableLink({
  to, className, children, onClick, focusKey, index,
}: FocusableLinkProps) {
  const navigate = useNavigate();
  const { ref } = useFocusItem<HTMLAnchorElement>({
    focusKey, index,
    onEnter: () => {
      onClick?.();
      navigate(to);
    },
  });

  return (
    <Link
      ref={ref}
      to={to}
      onClick={onClick}
      className={`tv-focusable ${className || ''}`}
    >
      {children}
    </Link>
  );
}

import { useRef, useState, useEffect, type ReactNode } from 'react';

interface MovieRowProps {
  title: string;
  children: ReactNode;
}

export default function MovieRow({ title, children }: MovieRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(true);

  const checkArrows = () => {
    const el = rowRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 20);
    setShowRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 20);
  };

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkArrows, { passive: true });
    checkArrows();
    return () => el.removeEventListener('scroll', checkArrows);
  }, [children]);

  const scroll = (direction: 'left' | 'right') => {
    const el = rowRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.7;
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <div className="relative group/row mb-10">
      <h2 className="text-white text-lg md:text-xl font-medium mb-3 px-6 md:px-14">{title}</h2>
      <div className="relative">
        {showLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-0 bottom-0 w-14 z-20 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity duration-300"
          >
            <div className="w-10 h-10 rounded-full bg-netflix-dark/80 backdrop-blur-sm flex items-center justify-center shadow-xl hover:bg-netflix-dark/95 transition-all hover:scale-110">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </div>
          </button>
        )}

        <div
          ref={rowRef}
          className="movie-row flex gap-2 overflow-x-auto scroll-smooth px-6 md:px-14 pb-3"
        >
          {children}
        </div>

        {showRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-0 bottom-0 w-14 z-20 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity duration-300"
          >
            <div className="w-10 h-10 rounded-full bg-netflix-dark/80 backdrop-blur-sm flex items-center justify-center shadow-xl hover:bg-netflix-dark/95 transition-all hover:scale-110">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

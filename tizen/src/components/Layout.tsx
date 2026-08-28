import type { ReactNode } from 'react';
import NavBar from './NavBar';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-netflix-dark">
      <NavBar />
      <main className="pt-16">
        {children}
      </main>
    </div>
  );
}

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

/** Envoltorio sin barra ni margen: para incrustar una pagina dentro del panel de administracion. */
export function Embedded({ children }: LayoutProps) {
  return <div>{children}</div>;
}

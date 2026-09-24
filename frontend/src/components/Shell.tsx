import type { ReactNode } from 'react';
import TopBar from './TopBar';
import ActivityDock from './ActivityDock';

interface Props {
  children: ReactNode;
  /** La portada mete su destacado debajo de la barra; el resto empieza más abajo. */
  flush?: boolean;
}

/** Armazón común: barra superior, contenido y el panel de actividad. */
export default function Shell({ children, flush }: Props) {
  return (
    <div className="min-h-screen bg-nf-bg">
      <TopBar />
      <main className={flush ? '' : 'pt-[calc(var(--nav-h)+32px)]'}>{children}</main>
      <ActivityDock />
    </div>
  );
}

/** Envoltorio sin barra ni margen: para incrustar una página dentro del panel de administración. */
export function Embedded({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

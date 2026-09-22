import type { ReactNode } from 'react';

export default function Row({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between px-4 mb-2">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {action}
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 snap-row">{children}</div>
    </section>
  );
}

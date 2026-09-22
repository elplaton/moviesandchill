import { useToasts } from '../tv/toast';
import Overlay from './Overlay';

export default function Toasts() {
  const list = useToasts();
  if (!list.length) return null;
  return (
    <Overlay>
    <div className="fixed top-[40px] right-[96px] z-[90] flex flex-col space-y-3 pointer-events-none">
      {list.map((t) => (
        <div key={t.id}
          className={`px-7 py-4 rounded-xl text-body font-medium shadow-2xl bg-[#1F1F1F] border ${
            t.kind === 'ok' ? 'border-tv-ok/40' : t.kind === 'error' ? 'border-tv-red/50' : 'border-white/15'
          }`}
          style={{ animation: 'slideUp 240ms ease-out' }}
        >
          <span className={`inline-block w-3 h-3 rounded-full mr-4 align-middle ${t.kind === 'ok' ? 'bg-tv-ok' : t.kind === 'error' ? 'bg-tv-red' : 'bg-white/60'}`} />
          {t.text}
        </div>
      ))}
    </div>
    </Overlay>
  );
}

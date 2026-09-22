import { FocusScope, useBackHandler } from '../focus/react';
import Overlay from './Overlay';
import TvButton from './TvButton';

export interface DialogAction { label: string; onSelect: () => void; primary?: boolean }

interface Props {
  title: string;
  text?: string;
  actions: DialogAction[];
  onClose: () => void;
}

/**
 * Cuadro de confirmacion. Atrapa el foco; Atras lo cierra sin hacer nada.
 * Sin desenfoque de fondo: un velo solido es gratis para la GPU de la TV.
 */
export default function Dialog({ title, text, actions, onClose }: Props) {
  useBackHandler(() => { onClose(); }, true);
  return (
    <Overlay>
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80">
      <FocusScope trap orientation="vertical" className="w-[860px] bg-[#1F1F1F] rounded-2xl p-12 shadow-2xl border border-white/10">
        <h2 className="text-h1 font-bold mb-4">{title}</h2>
        {text && <p className="text-body text-tv-text2 mb-10 leading-relaxed">{text}</p>}
        <FocusScope orientation="horizontal" index={0} className="flex space-x-4 justify-end">
          {actions.map((a, i) => (
            <TvButton key={a.label} index={i} primary={a.primary} autoFocus={i === 0} onClick={a.onSelect}>
              {a.label}
            </TvButton>
          ))}
        </FocusScope>
      </FocusScope>
    </div>
    </Overlay>
  );
}

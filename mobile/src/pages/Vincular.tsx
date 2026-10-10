import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../services/api';

type Fase =
  | { tipo: 'escribir' }
  | { tipo: 'mirando' }
  | { tipo: 'confirmar'; codigo: string; aparato: string }
  | { tipo: 'enviando'; codigo: string; aparato: string }
  | { tipo: 'hecho'; aparato: string }
  | { tipo: 'rechazado' }
  | { tipo: 'error'; mensaje: string };

/**
 * Entrar en la tele con el movil: lo que se abre al escanear el QR de la tele.
 *
 * Llega con el codigo en la URL (`/m/vincular?c=ABC123`). Sin el, se pide
 * escrito: desde la app instalada no hay camara que abra enlaces (iOS abre
 * los QR en Safari, no en la app de la pantalla de inicio), asi que el
 * perfil lleva aqui y basta con teclear las seis letras que salen en la tele.
 *
 * **Siempre se pide confirmar**, aunque se llegue desde el QR: aprobar mete
 * a quien tenga esa tele delante en tu cuenta, y un QR puede habertelo puesto
 * delante otra persona. Por eso se dice en que aparato se va a entrar.
 */
export default function Vincular() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const delQr = params.get('c') || '';
  const [escrito, setEscrito] = useState('');
  const [fase, setFase] = useState<Fase>(delQr ? { tipo: 'mirando' } : { tipo: 'escribir' });

  const mirar = async (codigo: string) => {
    setFase({ tipo: 'mirando' });
    try {
      const r = await apiFetch(`/auth/qr/info?codigo=${encodeURIComponent(codigo)}`);
      const d = await r.json();
      if (!r.ok) { setFase({ tipo: 'error', mensaje: d.detail || 'Ese código no vale.' }); return; }
      setFase({ tipo: 'confirmar', codigo: d.codigo, aparato: d.aparato });
    } catch {
      setFase({ tipo: 'error', mensaje: 'Sin conexión con el servidor.' });
    }
  };

  useEffect(() => { if (delQr) mirar(delQr); }, [delQr]);

  const responder = async (aprobar: boolean) => {
    if (fase.tipo !== 'confirmar') return;
    const { codigo, aparato } = fase;
    setFase({ tipo: 'enviando', codigo, aparato });
    try {
      const r = await apiFetch('/auth/qr/approve', { method: 'POST', body: JSON.stringify({ codigo, aprobar }) });
      const d = await r.json();
      if (!r.ok) { setFase({ tipo: 'error', mensaje: d.detail || 'No se pudo confirmar.' }); return; }
      setFase(aprobar ? { tipo: 'hecho', aparato } : { tipo: 'rechazado' });
    } catch {
      setFase({ tipo: 'error', mensaje: 'Sin conexión con el servidor.' });
    }
  };

  const boton = 'w-full h-12 rounded-xl font-semibold text-[16px] disabled:opacity-40';
  const volver = <Link to="/" replace className={`${boton} mt-3 bg-white/10 flex items-center justify-center`}>Volver al inicio</Link>;

  return (
    <div className="px-5 pb-8" style={{ paddingTop: 'calc(var(--safe-t) + 28px)' }}>
      <h1 className="text-[26px] font-bold leading-tight mb-2">Entrar en la tele</h1>

      {fase.tipo === 'escribir' && (
        <form onSubmit={(e) => { e.preventDefault(); if (escrito.trim()) mirar(escrito); }}>
          <p className="text-[15px] text-nf-text2 leading-relaxed mb-6">
            Escribe el código que sale en la pantalla de la tele, debajo del QR.
          </p>
          <input value={escrito} onChange={e => setEscrito(e.target.value.toUpperCase())}
            placeholder="ABC 123" autoCapitalize="characters" autoCorrect="off" autoComplete="off" maxLength={8}
            className="w-full h-16 rounded-xl bg-white/10 border border-white/10 px-4 text-center text-[30px] font-bold tracking-[0.25em] outline-none focus:border-white/40" />
          <button disabled={escrito.replace(/\W/g, '').length < 6} className={`${boton} mt-4 bg-nf-red active:bg-nf-reddeep`}>Seguir</button>
        </form>
      )}

      {(fase.tipo === 'mirando') && <p className="text-[15px] text-nf-text2">Comprobando el código…</p>}

      {(fase.tipo === 'confirmar' || fase.tipo === 'enviando') && (
        <>
          <p className="text-[16px] leading-relaxed mb-2">
            ¿Entrar en <b>{fase.aparato}</b> con tu cuenta, <b>{me?.username}</b>?
          </p>
          <p className="text-[13px] text-nf-text3 leading-relaxed mb-6">
            Confirma solo si tienes esa pantalla delante: quien la esté usando verá tu cuenta,
            tus descargas y lo que estás viendo.
          </p>
          <button onClick={() => responder(true)} disabled={fase.tipo === 'enviando'}
            className={`${boton} bg-nf-red active:bg-nf-reddeep`}>
            {fase.tipo === 'enviando' ? 'Confirmando…' : 'Sí, entrar'}
          </button>
          <button onClick={() => responder(false)} disabled={fase.tipo === 'enviando'}
            className={`${boton} mt-3 bg-white/10`}>No, no soy yo</button>
        </>
      )}

      {fase.tipo === 'hecho' && (
        <>
          <p className="text-[16px] leading-relaxed mb-6">Listo. En unos segundos se abrirá tu cuenta en {fase.aparato}.</p>
          {volver}
        </>
      )}

      {fase.tipo === 'rechazado' && (
        <>
          <p className="text-[16px] leading-relaxed mb-6">Hecho, no se ha entrado. La tele enseñará un código nuevo.</p>
          {volver}
        </>
      )}

      {fase.tipo === 'error' && (
        <>
          <p className="text-[16px] leading-relaxed mb-6">{fase.mensaje}</p>
          <button onClick={() => { setEscrito(''); setFase({ tipo: 'escribir' }); }}
            className={`${boton} bg-white/10`}>Escribir el código a mano</button>
          {volver}
        </>
      )}
    </div>
  );
}

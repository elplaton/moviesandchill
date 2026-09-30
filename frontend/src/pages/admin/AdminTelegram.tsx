import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';

interface Status {
  configured: boolean;
  authorized: boolean;
  code_sent: boolean;
  phone: string;
  channels_resolved: number;
  detail?: string;
}

/**
 * Inicio de sesión en Telegram desde la web.
 *
 * Antes esto solo se podía hacer con `python main.py setup`, que pide el
 * código por consola. Dentro de un contenedor no hay consola: Telethon lo
 * pedía, se encontraba con un EOF y el backend se quedaba con un cliente sin
 * autenticar, así que todo fallaba con «The key is not registered in the
 * system» y la indexación no encontraba ni un mensaje.
 */
export default function AdminTelegram({ onToast }: { onToast: (m: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await apiFetch('/admin/telegram/status');
      setStatus(await res.json());
    } catch {
      setError('No se ha podido consultar el estado de la sesión.');
    }
  };

  useEffect(() => { load(); }, []);

  const detailOf = async (res: Response, fallback: string) => {
    try {
      const data = await res.json();
      return data.detail || fallback;
    } catch {
      return fallback;
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/admin/telegram/send-code', { method: 'POST' });
      if (!res.ok) {
        setError(await detailOf(res, 'Telegram no ha querido mandar el código.'));
      } else {
        const data = await res.json();
        onToast(data.detail || 'Código enviado');
        setNeedsPassword(false);
        setCode('');
        await load();
      }
    } catch {
      setError('No se ha podido contactar con el servidor.');
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/admin/telegram/sign-in', {
        method: 'POST',
        body: JSON.stringify({ code, password: password || null }),
      });
      if (res.status === 428) {
        // Verificación en dos pasos: el código valía, falta la contraseña.
        setNeedsPassword(true);
        setError(await detailOf(res, 'Hace falta tu contraseña de dos pasos.'));
      } else if (!res.ok) {
        setError(await detailOf(res, 'No se ha podido iniciar sesión.'));
      } else {
        const data = await res.json();
        onToast(data.indexing
          ? 'Sesión iniciada. Indexando el catálogo.'
          : 'Sesión iniciada.');
        setCode('');
        setPassword('');
        setNeedsPassword(false);
        await load();
      }
    } catch {
      setError('No se ha podido contactar con el servidor.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return <div className="text-nf-dim text-sm">Consultando la sesión de Telegram…</div>;
  }

  const card = 'bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl';
  const input = 'w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-nf-dim focus:outline-none focus:border-nf-red transition-colors';
  const primary = 'bg-nf-red hover:bg-nf-red-dark text-white px-6 py-3 rounded-xl font-medium text-sm transition-all hover:scale-105 shadow-lg shadow-nf-red/20 disabled:opacity-40 disabled:hover:scale-100';

  if (!status.configured) {
    return (
      <div className={card}>
        <h2 className="text-white text-lg font-semibold mb-2">Sesión de Telegram</h2>
        <p className="text-nf-dim text-sm">
          {status.detail || 'Falta configurar las credenciales de Telegram.'}
        </p>
      </div>
    );
  }

  if (status.authorized) {
    return (
      <div className={card}>
        <div className="flex items-center gap-3 mb-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-lg shadow-green-500/40" />
          <h2 className="text-white text-lg font-semibold">Sesión de Telegram activa</h2>
        </div>
        <p className="text-nf-dim text-sm">
          Conectado como <span className="text-nf-text">{status.phone}</span>
          {' · '}
          {status.channels_resolved === 1
            ? '1 canal resuelto'
            : `${status.channels_resolved} canales resueltos`}
        </p>
        {status.channels_resolved === 0 && (
          <p className="text-amber-400/90 text-sm mt-3">
            La sesión vale, pero no se ha resuelto ningún canal. Revísalos en la pestaña Canales.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={card}>
      <div className="flex items-center gap-3 mb-2">
        <span className="w-2.5 h-2.5 rounded-full bg-nf-red shadow-lg shadow-nf-red/40" />
        <h2 className="text-white text-lg font-semibold">Sin sesión de Telegram</h2>
      </div>
      <p className="text-nf-dim text-sm mb-6 leading-relaxed">
        El servidor no puede leer los canales hasta que inicies sesión con{' '}
        <span className="text-nf-text">{status.phone}</span>. Telegram te mandará un código
        a la app; escríbelo aquí. Solo hay que hacerlo una vez: la sesión queda guardada.
      </p>

      {error && (
        <div className="bg-nf-red/10 border border-nf-red/30 text-nf-text text-sm rounded-xl px-4 py-3 mb-5">
          {error}
        </div>
      )}

      {!status.code_sent ? (
        <button onClick={sendCode} disabled={busy} className={primary}>
          {busy ? 'Enviando…' : 'Enviar código a mi Telegram'}
        </button>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-nf-dim text-xs uppercase tracking-wide mb-2">
              Código de verificación
            </label>
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') signIn(); }}
              placeholder="12345"
              inputMode="numeric"
              autoFocus
              className={input}
            />
          </div>

          {needsPassword && (
            <div>
              <label className="block text-nf-dim text-xs uppercase tracking-wide mb-2">
                Contraseña de verificación en dos pasos
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') signIn(); }}
                className={input}
              />
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button onClick={signIn} disabled={busy || !code.trim()} className={primary}>
              {busy ? 'Comprobando…' : 'Iniciar sesión'}
            </button>
            <button
              onClick={sendCode}
              disabled={busy}
              className="text-nf-dim hover:text-nf-text text-sm transition-colors disabled:opacity-40">
              Mandar otro código
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

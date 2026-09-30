import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';

interface Credentials {
  api_id: number;
  api_hash: string;
  phone: string;
}

interface Status {
  configured: boolean;
  authorized: boolean;
  code_sent: boolean;
  phone: string;
  channels_resolved: number;
  credentials?: Credentials;
  detail?: string;
}

const CARD = 'bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl';
const INPUT = 'w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-nf-dim focus:outline-none focus:border-nf-red transition-colors';
const PRIMARY = 'bg-nf-red hover:bg-nf-red-dark text-white px-6 py-3 rounded-xl font-medium text-sm transition-all hover:scale-105 shadow-lg shadow-nf-red/20 disabled:opacity-40 disabled:hover:scale-100';
const GHOST = 'text-nf-dim hover:text-nf-text text-sm transition-colors disabled:opacity-40';
const LABEL = 'block text-nf-dim text-xs uppercase tracking-wide mb-2';

const EMPTY: Credentials = { api_id: 0, api_hash: '', phone: '' };

async function detailOf(res: Response, fallback: string) {
  try {
    const data = await res.json();
    return data.detail || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Sesión de Telegram y sus credenciales, desde la web.
 *
 * Antes esto solo se podía hacer con `python main.py setup`, que lo pregunta
 * todo por consola. Dentro de un contenedor no hay consola: Telethon pedía el
 * código, se encontraba con un EOF y el backend se quedaba con un cliente sin
 * autenticar, así que todo fallaba con «The key is not registered in the
 * system» y la indexación no encontraba ni un mensaje.
 *
 * Las credenciales se guardan en la base de datos y no en el .env, porque en
 * un despliegue tipo Coolify el .env lo regenera la plataforma en cada
 * redespliegue y lo escrito aquí se perdería.
 */
export default function AdminTelegram({ onToast }: { onToast: (m: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Credentials>(EMPTY);
  const [credError, setCredError] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);

  const load = async () => {
    try {
      const res = await apiFetch('/admin/telegram/status');
      const data: Status = await res.json();
      setStatus(data);
      setForm(data.credentials || EMPTY);
      // Sin credenciales no hay nada que hacer salvo escribirlas: el
      // formulario se abre solo para no obligar a buscar el botón.
      if (!data.configured) setEditing(true);
    } catch {
      setError('No se ha podido consultar el estado de la sesión.');
    }
  };

  useEffect(() => { load(); }, []);

  const saveCredentials = async () => {
    setSavingCreds(true);
    setCredError('');
    try {
      const res = await apiFetch('/admin/telegram/credentials', {
        method: 'POST',
        body: JSON.stringify({
          api_id: Number(form.api_id) || 0,
          api_hash: form.api_hash,
          phone: form.phone,
        }),
      });
      if (!res.ok) {
        setCredError(await detailOf(res, 'No se han podido guardar las credenciales.'));
      } else {
        const data = await res.json();
        onToast(data.detail || 'Credenciales guardadas');
        if (data.session_reset) {
          setCode('');
          setPassword('');
          setNeedsPassword(false);
        }
        setEditing(false);
        await load();
      }
    } catch {
      setCredError('No se ha podido contactar con el servidor.');
    } finally {
      setSavingCreds(false);
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
        onToast(data.indexing ? 'Sesión iniciada. Indexando el catálogo.' : 'Sesión iniciada.');
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

  const creds = status.credentials || EMPTY;

  return (
    <div className="space-y-6">
      {/* ---------- Estado de la sesión ---------- */}
      <div className={CARD}>
        {!status.configured ? (
          <>
            <div className="flex items-center gap-3 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-lg shadow-amber-400/40" />
              <h2 className="text-white text-lg font-semibold">Falta configurar Telegram</h2>
            </div>
            <p className="text-nf-dim text-sm">
              {status.detail || 'Escribe abajo el API ID, el API Hash y tu teléfono.'}
            </p>
          </>
        ) : status.authorized ? (
          <>
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
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-nf-red shadow-lg shadow-nf-red/40" />
              <h2 className="text-white text-lg font-semibold">Sin sesión de Telegram</h2>
            </div>
            <p className="text-nf-dim text-sm mb-6 leading-relaxed">
              El servidor no puede leer los canales hasta que inicies sesión con{' '}
              <span className="text-nf-text">{status.phone}</span>. El código llega como un
              mensaje del propio Telegram dentro de la app, no por SMS, si tienes la sesión
              abierta en otro dispositivo. Escríbelo aquí; solo hay que hacerlo una vez.
            </p>

            {error && (
              <div className="bg-nf-red/10 border border-nf-red/30 text-nf-text text-sm rounded-xl px-4 py-3 mb-5">
                {error}
              </div>
            )}

            {!status.code_sent ? (
              <button onClick={sendCode} disabled={busy} className={PRIMARY}>
                {busy ? 'Enviando…' : 'Enviar código a mi Telegram'}
              </button>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className={LABEL}>Código de verificación</label>
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') signIn(); }}
                    placeholder="12345"
                    inputMode="numeric"
                    autoFocus
                    className={INPUT}
                  />
                </div>

                {needsPassword && (
                  <div>
                    <label className={LABEL}>Contraseña de verificación en dos pasos</label>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') signIn(); }}
                      className={INPUT}
                    />
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button onClick={signIn} disabled={busy || !code.trim()} className={PRIMARY}>
                    {busy ? 'Comprobando…' : 'Iniciar sesión'}
                  </button>
                  <button onClick={sendCode} disabled={busy} className={GHOST}>
                    Mandar otro código
                  </button>
                </div>
                <p className="text-nf-dim text-xs leading-relaxed">
                  Si el código no llega, espera unos minutos antes de pedir otro: Telegram
                  limita los envíos por número y acaba rechazándolos.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ---------- Credenciales ---------- */}
      <div className={CARD}>
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="text-white text-lg font-semibold">Credenciales de Telegram</h2>
          {!editing && (
            <button onClick={() => setEditing(true)} className={GHOST}>Editar</button>
          )}
        </div>

        {!editing ? (
          <p className="text-nf-dim text-sm">
            API ID <span className="text-nf-text">{creds.api_id || '—'}</span>
            {' · '}Hash <span className="text-nf-text">{creds.api_hash || '—'}</span>
            {' · '}Teléfono <span className="text-nf-text">{creds.phone || '—'}</span>
          </p>
        ) : (
          <>
            <p className="text-nf-dim text-sm mb-6 leading-relaxed">
              Se sacan de <span className="text-nf-text">my.telegram.org/apps</span>. Se guardan en
              la base de datos, no en el <span className="text-nf-text">.env</span>: así sobreviven
              a los redespliegues, y lo que pongas aquí manda sobre las variables de entorno.
            </p>

            {credError && (
              <div className="bg-nf-red/10 border border-nf-red/30 text-nf-text text-sm rounded-xl px-4 py-3 mb-5">
                {credError}
              </div>
            )}

            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>API ID</label>
                  <input
                    value={form.api_id || ''}
                    onChange={e => setForm({ ...form, api_id: Number(e.target.value.replace(/\D/g, '')) })}
                    placeholder="12345678"
                    inputMode="numeric"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>Teléfono</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="+34600112233"
                    className={INPUT}
                  />
                </div>
              </div>
              <div>
                <label className={LABEL}>API Hash</label>
                <input
                  value={form.api_hash}
                  onChange={e => setForm({ ...form, api_hash: e.target.value })}
                  placeholder="0123456789abcdef0123456789abcdef"
                  className={INPUT}
                />
              </div>

              <p className="text-nf-dim text-xs leading-relaxed">
                Cambiar el API ID o el API Hash invalida la sesión actual: la clave guardada
                pertenece a la aplicación anterior y habría que volver a iniciar sesión.
              </p>

              <div className="flex items-center gap-3 pt-1">
                <button onClick={saveCredentials} disabled={savingCreds} className={PRIMARY}>
                  {savingCreds ? 'Guardando…' : 'Guardar credenciales'}
                </button>
                {status.configured && (
                  <button
                    onClick={() => { setEditing(false); setForm(creds); setCredError(''); }}
                    disabled={savingCreds}
                    className={GHOST}>
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

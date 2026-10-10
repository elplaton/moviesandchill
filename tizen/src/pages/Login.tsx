import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FocusScope, useFocusItem } from '../focus/react';
import { applyFocus } from '../focus/engine';
import { apiFetch, getApiOrigin } from '../services/api';
import { plataforma } from '../tv/platform';
import Keyboard from '../components/Keyboard';
import TvButton from '../components/TvButton';
import Qr from '../components/Qr';

/** Con que nombre sale esta tele en el movil al confirmar. */
const NOMBRE_APARATO: Record<string, string> = {
  tizen: 'la tele Samsung', webos: 'la tele LG', firetv: 'el Fire TV',
  playstation: 'la PlayStation', web: 'un navegador',
};

interface CodigoQr { codigo: string; secreto: string; url: string; intervalo: number }

/**
 * La entrada con el movil, desde el lado de la tele.
 *
 * Pide un codigo, lo enseña y pregunta cada pocos segundos si ya lo han
 * aprobado. Cuando caduca (cinco minutos) o lo rechazan, pide otro solo: una
 * tele puede quedarse horas en esta pantalla y el QR tiene que seguir valiendo
 * cuando alguien por fin coja el movil. Solo corre mientras se enseña.
 */
function useEntradaQr(activa: boolean, alEntrar: (d: { access_token: string; refresh_token: string; username: string }) => void) {
  const [qr, setQr] = useState<CodigoQr | null>(null);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const luego = (fn: () => void, ms: number) => { if (vivo) reloj = setTimeout(fn, ms); };

    const pedir = async () => {
      try {
        const r = await apiFetch('/auth/qr/start', {
          method: 'POST',
          body: JSON.stringify({ aparato: NOMBRE_APARATO[plataforma()] || 'una tele' }),
        });
        if (!r.ok) throw new Error();
        const d: CodigoQr = await r.json();
        if (!vivo) return;
        setQr(d);
        luego(() => preguntar(d), d.intervalo * 1000);
      } catch {
        if (!vivo) return;
        setQr(null);
        setAviso('No se puede contactar con el servidor. Se vuelve a intentar sola.');
        luego(pedir, 5000);
      }
    };

    const preguntar = async (actual: CodigoQr) => {
      try {
        const r = await apiFetch(`/auth/qr/poll?secreto=${encodeURIComponent(actual.secreto)}`);
        const d = await r.json();
        if (!vivo) return;
        if (d.estado === 'aprobado') { alEntrar(d); return; }
        if (d.estado === 'rechazado') { setAviso('Se ha rechazado desde el móvil. Aquí tienes otro código.'); pedir(); return; }
        if (d.estado === 'caducado') { pedir(); return; }
        setAviso('');
      } catch { /* un corte puntual: se vuelve a preguntar */ }
      luego(() => preguntar(actual), actual.intervalo * 1000);
    };

    pedir();
    return () => { vivo = false; if (reloj) clearTimeout(reloj); };
    // alEntrar cambia en cada render y no debe reiniciar el codigo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa]);

  return { qr, aviso };
}

function Field({ label, value, secret, index, active, onSelect }: {
  label: string; value: string; secret?: boolean; index: number; active: boolean; onSelect: () => void;
}) {
  const { ref, focusKey: id } = useFocusItem<HTMLDivElement>({ index, onEnter: onSelect, onFocus: onSelect });
  return (
    <div ref={ref} onMouseEnter={() => applyFocus(id)} onClick={onSelect}
      className={`tv-field flex flex-col justify-center h-[84px] px-6 rounded-lg mb-4 ${active ? 'ring-2 ring-tv-red' : ''}`}>
      <span className="text-caption text-tv-text3">{label}</span>
      <span className={`text-lead font-semibold ${value ? 'text-white' : 'text-tv-text3'}`}>
        {value ? (secret ? '•'.repeat(value.length) : value) : '—'}
      </span>
    </div>
  );
}

function Recuerdame({ index, value, onToggle }: { index: number; value: boolean; onToggle: () => void }) {
  const { ref, focusKey: id } = useFocusItem<HTMLDivElement>({ index, onEnter: onToggle });
  return (
    <div ref={ref} onMouseEnter={() => applyFocus(id)} onClick={onToggle}
      className="tv-field flex items-center h-[84px] px-6 rounded-lg mb-4 cursor-pointer">
      <span className={`w-9 h-9 mr-5 shrink-0 rounded-md flex items-center justify-center text-[22px] font-bold ${
        value ? 'bg-tv-red text-white' : 'border-2 border-tv-text3 text-transparent'}`}>✓</span>
      <span className="flex flex-col">
        <span className="text-lead font-semibold text-white">Recuerdame</span>
        <span className="text-caption text-tv-text3">
          {value ? 'No habra que volver a entrar en esta tele.' : 'Habra que entrar cada vez que se abra la app.'}
        </span>
      </span>
    </div>
  );
}

/**
 * Inicio de sesion pensado para el mando.
 *
 * Lo primero que sale es el QR: escanearlo con el movil y confirmar es mucho
 * menos tedioso que teclear con las flechas. Quien prefiera (o no tenga movil
 * a mano) entra con usuario y contraseña: los campos son botones y se escribe
 * con el teclado en pantalla de la derecha. Con «Recuerdame» la sesion queda
 * guardada en la tele (el token de refresco vive 7 dias y se renueva al usar
 * la app); sin el, se pierde al cerrar la aplicacion.
 */
export default function Login() {
  // El nombre no se recuerda en la tele: era el de quien entró la última vez,
  // y una tele la usa toda la casa. Lo único que se guarda al entrar es la
  // sesión, y para eso está «Recuérdame».
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [field, setField] = useState<'user' | 'pass'>('user');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [modo, setModo] = useState<'qr' | 'teclado'>('qr');
  const { login, entrarConTokens } = useAuth();
  const navigate = useNavigate();
  const { qr, aviso } = useEntradaQr(modo === 'qr', async (d) => {
    await entrarConTokens(d.access_token, d.refresh_token, d.username, remember);
    navigate('/');
  });
  const servidor = (getApiOrigin() || window.location.origin).replace(/^https?:\/\//, '');

  const submit = async () => {
    if (loading || !username || !password) return;
    setError('');
    setLoading(true);
    const err = await login(username, password, remember);
    setLoading(false);
    if (err) { setError(err); return; }
    navigate('/');
  };

  const value = field === 'user' ? username : password;
  const setValue = field === 'user' ? setUsername : setPassword;

  const fondo = (
    <div className="absolute inset-0 opacity-30" style={{
      background: 'radial-gradient(ellipse 70% 60% at 25% 45%, rgba(229,9,20,0.45) 0%, transparent 55%), radial-gradient(ellipse 50% 50% at 75% 60%, rgba(150,5,15,0.3) 0%, transparent 50%)',
    }} />
  );
  const cabecera = (
    <>
      <h1 className="text-tv-red font-bold text-[72px] tracking-tighter leading-none mb-3">MOVIES&amp;CHILL</h1>
      <p className="text-body text-tv-text2 mb-14">Tu Telegram, en la tele.</p>
    </>
  );
  const pie = <p className="mt-16 text-caption text-tv-text3">Servidor: {servidor}</p>;

  if (modo === 'qr') {
    return (
      <div className="absolute inset-0 bg-tv-deep overflow-hidden">
        {fondo}
        <FocusScope orientation="vertical" className="absolute left-[200px] top-[200px] w-[640px]">
          {cabecera}
          <h2 className="text-h1 font-bold text-white mb-6">Entra con el móvil</h2>
          <ol className="text-lead text-tv-text2 mb-10 space-y-3">
            <li><span className="text-white font-semibold">1.</span> Apunta la cámara del móvil al código.</li>
            <li><span className="text-white font-semibold">2.</span> Abre el enlace y confirma.</li>
          </ol>
          <TvButton index={0} autoFocus onClick={() => { setError(''); setModo('teclado'); }}>
            Entrar con usuario y contraseña
          </TvButton>
          <div className="mt-6"><Recuerdame index={1} value={remember} onToggle={() => setRemember(v => !v)} /></div>
          {pie}
        </FocusScope>

        <div className="absolute left-[1100px] top-[170px] w-[620px] flex flex-col items-center">
          <div className="w-[460px] h-[460px] flex items-center justify-center">
            {qr ? <Qr texto={qr.url} lado={460} /> : (
              <div className="w-[460px] h-[460px] rounded-xl bg-tv-surface flex items-center justify-center text-body text-tv-text3">
                {aviso ? '' : 'Preparando el código…'}
              </div>
            )}
          </div>
          {qr && (
            <>
              <p className="mt-8 text-caption text-tv-text3">O en la app del móvil: Perfil → Vincular una tele</p>
              <p className="mt-2 text-[56px] leading-none font-bold tracking-[0.2em] pl-[0.2em] text-white">
                {qr.codigo.slice(0, 3)} {qr.codigo.slice(3)}
              </p>
            </>
          )}
          {aviso && <p className="mt-6 text-body text-tv-text2 text-center">{aviso}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-tv-deep overflow-hidden">
      {fondo}
      <FocusScope orientation="horizontal" as="none">
        <FocusScope index={0} orientation="vertical" className="absolute left-[200px] top-[200px] w-[620px]">
          {cabecera}

          {error && (
            <div className="mb-6 px-5 py-4 rounded-lg bg-tv-red/15 border border-tv-red/40 text-body text-white">{error}</div>
          )}

          <Field label="Usuario" value={username} index={0} active={field === 'user'} onSelect={() => setField('user')} />
          <Field label="Contraseña" value={password} secret index={1} active={field === 'pass'} onSelect={() => setField('pass')} />

          <Recuerdame index={2} value={remember} onToggle={() => setRemember(v => !v)} />

          <FocusScope index={3} orientation="horizontal" className="mt-6 flex space-x-4">
            <TvButton index={0} primary onClick={submit} disabled={!username || !password || loading}>
              {loading ? 'Entrando…' : 'Entrar'}
            </TvButton>
            <TvButton index={1} onClick={() => setModo('qr')}>Entrar con el móvil</TvButton>
          </FocusScope>
          {pie}
        </FocusScope>

        <div className="absolute left-[1060px] top-[220px]">
          <Keyboard index={1} value={value} onChange={setValue} autoFocus secret={field === 'pass'}
            placeholder={field === 'user' ? 'Usuario' : 'Contraseña'}
            onDone={() => { if (field === 'user') setField('pass'); else submit(); }} />
        </div>
      </FocusScope>
    </div>
  );
}

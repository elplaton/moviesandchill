import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FocusScope, useFocusItem } from '../focus/react';
import { applyFocus } from '../focus/engine';
import { getApiBase } from '../services/api';
import Keyboard from '../components/Keyboard';
import TvButton from '../components/TvButton';

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
 * Inicio de sesion pensado para el mando: los campos son botones y se escribe
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
  const { login } = useAuth();
  const navigate = useNavigate();

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

  return (
    <div className="absolute inset-0 bg-tv-deep overflow-hidden">
      <div className="absolute inset-0 opacity-30" style={{
        background: 'radial-gradient(ellipse 70% 60% at 25% 45%, rgba(229,9,20,0.45) 0%, transparent 55%), radial-gradient(ellipse 50% 50% at 75% 60%, rgba(150,5,15,0.3) 0%, transparent 50%)',
      }} />
      <FocusScope orientation="horizontal" as="none">
        <FocusScope index={0} orientation="vertical" className="absolute left-[200px] top-[200px] w-[620px]">
          <h1 className="text-tv-red font-bold text-[72px] tracking-tighter leading-none mb-3">MOVIES&amp;CHILL</h1>
          <p className="text-body text-tv-text2 mb-14">Tu Telegram, en la tele.</p>

          {error && (
            <div className="mb-6 px-5 py-4 rounded-lg bg-tv-red/15 border border-tv-red/40 text-body text-white">{error}</div>
          )}

          <Field label="Usuario" value={username} index={0} active={field === 'user'} onSelect={() => setField('user')} />
          <Field label="Contraseña" value={password} secret index={1} active={field === 'pass'} onSelect={() => setField('pass')} />

          <Recuerdame index={2} value={remember} onToggle={() => setRemember(v => !v)} />

          <div className="mt-6">
            <TvButton index={3} primary onClick={submit} disabled={!username || !password || loading}>
              {loading ? 'Entrando…' : 'Entrar'}
            </TvButton>
          </div>
          <p className="mt-16 text-caption text-tv-text3">Servidor: {getApiBase().replace(/\/api$/, '') || 'este equipo'}</p>
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

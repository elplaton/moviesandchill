import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FocusScope, useFocusItem } from '../focus/react';
import { getApiBase } from '../services/api';
import Keyboard from '../components/Keyboard';
import TvButton from '../components/TvButton';

function Field({ label, value, secret, index, active, onSelect }: {
  label: string; value: string; secret?: boolean; index: number; active: boolean; onSelect: () => void;
}) {
  const { ref } = useFocusItem<HTMLDivElement>({ index, onEnter: onSelect, onFocus: onSelect });
  return (
    <div ref={ref} onClick={onSelect}
      className={`tv-field flex flex-col justify-center h-[84px] px-6 rounded-lg mb-4 ${active ? 'ring-2 ring-tv-red' : ''}`}>
      <span className="text-caption text-tv-text3">{label}</span>
      <span className={`text-lead font-semibold ${value ? 'text-white' : 'text-tv-text3'}`}>
        {value ? (secret ? '•'.repeat(value.length) : value) : '—'}
      </span>
    </div>
  );
}

/**
 * Inicio de sesion pensado para el mando: los campos son botones y se escribe
 * con el teclado en pantalla de la derecha. La sesion se recuerda siempre (el
 * token de refresco vive 7 dias y se renueva al usar la app).
 */
export default function Login() {
  const [username, setUsername] = useState(localStorage.getItem('saved_user') || '');
  const [password, setPassword] = useState('');
  const [field, setField] = useState<'user' | 'pass'>('user');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => { if (username) setField('pass'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (loading || !username || !password) return;
    setError('');
    setLoading(true);
    const err = await login(username, password);
    setLoading(false);
    if (err) { setError(err); return; }
    localStorage.setItem('saved_user', username);
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

          <div className="mt-6">
            <TvButton index={2} primary onClick={submit} disabled={!username || !password || loading}>
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

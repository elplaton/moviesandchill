import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';

/** Entrada a la aplicación: una sola tarjeta sobre el rojo de la marca. */
export default function Login() {
  const [username, setUsername] = useState(localStorage.getItem('saved_user') || '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(!!localStorage.getItem('saved_user'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(''); setBusy(true);
    const err = await login(username.trim(), password);
    setBusy(false);
    if (err) { setError(err); return; }
    if (remember) localStorage.setItem('saved_user', username.trim());
    else localStorage.removeItem('saved_user');
    navigate('/');
  };

  const field = 'h-12 w-full rounded border border-nf-line bg-white/10 px-4 text-md outline-none transition-colors focus:border-white/45';

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-nf-deep px-6">
      <div className="pointer-events-none absolute inset-0 opacity-45" style={{
        background: 'radial-gradient(ellipse 70% 55% at 28% 38%, rgba(229,9,20,0.45), transparent 58%), radial-gradient(ellipse 55% 50% at 74% 62%, rgba(140,5,14,0.32), transparent 55%)',
      }} />

      <div className="relative w-full max-w-[420px] animate-slide-up">
        <h1 className="text-center text-hero font-bold leading-none tracking-tighter text-nf-red">
          MOVIES<span className="text-white">&amp;</span>CHILL
        </h1>
        <p className="mb-10 mt-3 text-center text-md text-nf-dim">Tu Telegram, ordenado y listo para ver.</p>

        <form onSubmit={submit} className="rounded-panel border border-nf-line bg-black/70 p-8 shadow-panel">
          <h2 className="mb-6 text-title font-semibold">Iniciar sesión</h2>

          {error && (
            <p className="mb-5 rounded border border-nf-red/40 bg-nf-red/15 px-4 py-3 text-base">{error}</p>
          )}

          <label className="mb-1.5 block text-xs font-medium text-nf-dim">Usuario</label>
          <input className={`${field} mb-4`} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus />

          <label className="mb-1.5 block text-xs font-medium text-nf-dim">Contraseña</label>
          <input className={field} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />

          <label className="mt-5 flex cursor-pointer items-center gap-2.5 text-base text-nf-dim">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="h-4 w-4 accent-nf-red" />
            Recordar mi usuario
          </label>

          <Button type="submit" variant="primary" size="lg" disabled={busy || !username.trim() || !password} className="mt-6 w-full">
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  );
}

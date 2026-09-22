import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [u, setU] = useState(localStorage.getItem('saved_user') || '');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const r = await login(u.trim(), p); setBusy(false);
    if (r) { setErr(r); return; }
    localStorage.setItem('saved_user', u.trim()); navigate('/', { replace: true });
  };
  const input = 'w-full h-12 rounded-xl bg-white/10 border border-white/10 px-4 text-[16px] outline-none focus:border-white/40';
  return (
    <div className="min-h-screen flex flex-col justify-center px-6" style={{ paddingTop: 'var(--safe-t)' }}>
      <div className="absolute inset-0 -z-10 opacity-40" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 20%, rgba(229,9,20,0.45), transparent 60%)' }} />
      <h1 className="text-nf-red font-bold text-[40px] tracking-tighter leading-none mb-1">MOVIES&amp;CHILL</h1>
      <p className="text-nf-text2 text-[15px] mb-10">Tu Telegram, en el móvil.</p>
      <form onSubmit={submit} className="space-y-3">
        <input className={input} placeholder="Usuario" autoCapitalize="none" autoCorrect="off" value={u} onChange={e => setU(e.target.value)} />
        <input className={input} placeholder="Contraseña" type="password" value={p} onChange={e => setP(e.target.value)} />
        {err && <p className="text-[13px] text-red-400">{err}</p>}
        <button disabled={busy || !u || !p} className="w-full h-12 rounded-xl bg-nf-red disabled:opacity-40 font-semibold text-[16px] active:bg-nf-reddeep">
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="mt-10 text-[12px] text-nf-text3 text-center">Añádela a la pantalla de inicio para usarla como una app.</p>
    </div>
  );
}

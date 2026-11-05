import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * La primera vez que se entra (o después de que el admin restablezca la
 * contraseña) hay que poner una propia: la que se usó para entrar la conoce
 * el admin. No se pide la actual, que se acaba de escribir, y no hay forma de
 * saltársela: el servidor no deja hacer nada más con esta sesión.
 */
export default function CambiarPassword() {
  const { pendiente, cambiarPassword, logout } = useAuth();
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const distintas = repetida.length > 0 && nueva !== repetida;
  const corta = nueva.length > 0 && nueva.length < 4;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || distintas || corta || !nueva) return;
    setErr(''); setBusy(true);
    const r = await cambiarPassword(nueva);
    setBusy(false);
    if (r) setErr(r);
  };

  const input = 'w-full h-12 rounded-xl bg-white/10 border border-white/10 px-4 text-[16px] outline-none focus:border-white/40';
  return (
    <div className="min-h-screen flex flex-col justify-center px-6" style={{ paddingTop: 'var(--safe-t)' }}>
      <div className="absolute inset-0 -z-10 opacity-40" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 20%, rgba(229,9,20,0.45), transparent 60%)' }} />
      <h1 className="text-nf-red font-bold text-[40px] tracking-tighter leading-none mb-6">MOVIES&amp;CHILL</h1>
      <h2 className="text-[22px] font-semibold mb-1">Elige tu contraseña</h2>
      <p className="text-nf-text2 text-[15px] mb-6">
        Hola, {pendiente}. Has entrado con una contraseña provisional: pon una tuya para seguir.
      </p>
      <form onSubmit={submit} className="space-y-3">
        {/* Para que el llavero la guarde con su usuario. */}
        <input type="text" autoComplete="username" value={pendiente || ''} readOnly hidden />
        <input className={input} placeholder="Contraseña nueva" type="password" autoComplete="new-password"
          value={nueva} onChange={e => setNueva(e.target.value)} />
        <input className={input} placeholder="Repítela" type="password" autoComplete="new-password"
          value={repetida} onChange={e => setRepetida(e.target.value)} />
        {corta && <p className="text-[13px] text-nf-text3">Al menos 4 caracteres.</p>}
        {distintas && <p className="text-[13px] text-nf-text3">No coinciden.</p>}
        {err && <p className="text-[13px] text-red-400">{err}</p>}
        <button disabled={busy || !nueva || nueva !== repetida || corta}
          className="w-full h-12 rounded-xl bg-nf-red disabled:opacity-40 font-semibold text-[16px] active:bg-nf-reddeep">
          {busy ? 'Guardando…' : 'Guardar y entrar'}
        </button>
      </form>
      <button onClick={logout} className="mt-6 text-[14px] text-nf-text3 text-center active:text-white">
        No soy {pendiente}: salir
      </button>
    </div>
  );
}

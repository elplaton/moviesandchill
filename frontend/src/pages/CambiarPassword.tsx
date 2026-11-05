import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';

/**
 * La primera vez que se entra (o después de que el admin restablezca la
 * contraseña) hay que poner una propia: la que se usó para entrar la conoce
 * el admin. No se pide la actual, que se acaba de escribir, y no hay forma de
 * saltársela: el servidor no deja hacer nada más con esta sesión.
 */
export default function CambiarPassword() {
  const { username, cambiarPassword, logout } = useAuth();
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const distintas = repetida.length > 0 && nueva !== repetida;
  const corta = nueva.length > 0 && nueva.length < 4;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || distintas || corta || !nueva) return;
    setError(''); setBusy(true);
    const err = await cambiarPassword(nueva);
    setBusy(false);
    if (err) setError(err);
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

        <form onSubmit={submit} className="mt-10 rounded-panel border border-nf-line bg-black/70 p-8 shadow-panel">
          <h2 className="mb-2 text-title font-semibold">Elige tu contraseña</h2>
          <p className="mb-6 text-base text-nf-dim">
            Hola, {username}. Has entrado con una contraseña provisional: pon una tuya para seguir.
          </p>

          {error && (
            <p className="mb-5 rounded border border-nf-red/40 bg-nf-red/15 px-4 py-3 text-base">{error}</p>
          )}

          {/* Para que el gestor de contraseñas la guarde con su usuario. */}
          <input type="text" autoComplete="username" value={username || ''} readOnly hidden />

          <label className="mb-1.5 block text-xs font-medium text-nf-dim">Contraseña nueva</label>
          <input className={`${field} mb-1`} type="password" value={nueva} onChange={e => setNueva(e.target.value)}
            autoComplete="new-password" autoFocus />
          <p className="mb-4 h-4 text-xs text-nf-faint">{corta ? 'Al menos 4 caracteres.' : ''}</p>

          <label className="mb-1.5 block text-xs font-medium text-nf-dim">Repítela</label>
          <input className={`${field} mb-1`} type="password" value={repetida} onChange={e => setRepetida(e.target.value)}
            autoComplete="new-password" />
          <p className="h-4 text-xs text-nf-faint">{distintas ? 'No coinciden.' : ''}</p>

          <Button type="submit" variant="primary" size="lg" disabled={busy || !nueva || nueva !== repetida || corta}
            className="mt-6 w-full">
            {busy ? 'Guardando…' : 'Guardar y entrar'}
          </Button>
          <button type="button" onClick={logout} className="mt-4 w-full text-center text-base text-nf-dim hover:text-white">
            No soy {username}: salir
          </button>
        </form>
      </div>
    </div>
  );
}

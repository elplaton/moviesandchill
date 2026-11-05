import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { FocusScope } from '../focus/react';
import Keyboard from '../components/Keyboard';
import TvButton from '../components/TvButton';
import { Field } from './Login';

/**
 * La primera vez que se entra (o después de que el admin restablezca la
 * contraseña) hay que poner una propia: la que se usó para entrar la conoce
 * el admin. Igual que el login con teclado: los campos a la izquierda y el
 * teclado en pantalla a la derecha. No se pide la actual, que se acaba de
 * escribir, y no hay forma de saltársela: el servidor no deja hacer nada más.
 */
export default function CambiarPassword() {
  const { username, cambiarPassword, logout } = useAuth();
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [field, setField] = useState<'nueva' | 'repetida'>('nueva');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const corta = nueva.length > 0 && nueva.length < 4;
  const distintas = repetida.length > 0 && nueva !== repetida;
  const lista = !!nueva && nueva === repetida && !corta;

  const submit = async () => {
    if (loading) return;
    if (!lista) { setError(corta ? 'Tiene que tener al menos 4 caracteres.' : 'Las dos no coinciden.'); return; }
    setError('');
    setLoading(true);
    const err = await cambiarPassword(nueva);
    setLoading(false);
    if (err) setError(err);
  };

  const value = field === 'nueva' ? nueva : repetida;
  const setValue = field === 'nueva' ? setNueva : setRepetida;
  const aviso = error || (corta ? 'Al menos 4 caracteres.' : distintas ? 'No coinciden.' : '');

  return (
    <div className="absolute inset-0 bg-tv-deep overflow-hidden">
      <div className="absolute inset-0 opacity-30" style={{
        background: 'radial-gradient(ellipse 70% 60% at 25% 45%, rgba(229,9,20,0.45) 0%, transparent 55%), radial-gradient(ellipse 50% 50% at 75% 60%, rgba(150,5,15,0.3) 0%, transparent 50%)',
      }} />
      <FocusScope orientation="horizontal" as="none">
        <FocusScope index={0} orientation="vertical" className="absolute left-[200px] top-[160px] w-[620px]">
          <h1 className="text-tv-red font-bold text-[72px] tracking-tighter leading-none mb-8">MOVIES&amp;CHILL</h1>
          <h2 className="text-h1 font-bold text-white mb-3">Elige tu contraseña</h2>
          <p className="text-body text-tv-text2 mb-8">
            Hola, {username}. Has entrado con una contraseña provisional: pon una tuya para seguir.
          </p>

          {aviso && (
            <div className="mb-6 px-5 py-4 rounded-lg bg-tv-red/15 border border-tv-red/40 text-body text-white">{aviso}</div>
          )}

          <Field label="Contraseña nueva" value={nueva} secret index={0} active={field === 'nueva'} onSelect={() => setField('nueva')} />
          <Field label="Repítela" value={repetida} secret index={1} active={field === 'repetida'} onSelect={() => setField('repetida')} />

          <FocusScope index={2} orientation="horizontal" className="mt-6 flex space-x-4">
            <TvButton index={0} primary onClick={submit} disabled={!lista || loading}>
              {loading ? 'Guardando…' : 'Guardar y entrar'}
            </TvButton>
            <TvButton index={1} onClick={logout}>Salir</TvButton>
          </FocusScope>
        </FocusScope>

        <div className="absolute left-[1060px] top-[220px]">
          <Keyboard index={1} value={value} onChange={setValue} autoFocus secret
            placeholder={field === 'nueva' ? 'Contraseña nueva' : 'Repítela'}
            onDone={() => { if (field === 'nueva') setField('repetida'); else submit(); }} />
        </div>
      </FocusScope>
    </div>
  );
}

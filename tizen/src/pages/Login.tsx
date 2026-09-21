import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { focusById as setFocus } from '../focus/react';
import FocusableInput from '../components/FocusableInput';
import FocusableButton from '../components/FocusableButton';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const savedUser = localStorage.getItem('saved_user');
    const savedPass = localStorage.getItem('saved_pass');
    const savedRemember = localStorage.getItem('saved_remember') === '1';
    if (savedUser) setUsername(savedUser);
    if (savedPass) setPassword(savedPass);
    if (savedRemember) setRemember(true);
    setTimeout(() => setFocus('login-username'), 200);
  }, []);

  const handleSubmit = async () => {
    if (loading) return;
    setError('');
    setLoading(true);
    const err = await login(username, password);
    setLoading(false);
    if (err) { setError(err); return; }
    if (remember) {
      localStorage.setItem('saved_user', username);
      localStorage.setItem('saved_pass', password);
      localStorage.setItem('saved_remember', '1');
    } else {
      localStorage.removeItem('saved_user');
      localStorage.removeItem('saved_pass');
      localStorage.removeItem('saved_remember');
    }
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-netflix-darker flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-netflix-darker" />
        <div className="absolute inset-0 opacity-25"
          style={{
            background: 'radial-gradient(ellipse 80% 60% at 30% 40%, rgba(229,9,20,0.4) 0%, transparent 55%), radial-gradient(ellipse 60% 50% at 70% 60%, rgba(180,5,15,0.3) 0%, transparent 50%), radial-gradient(ellipse 40% 40% at 50% 30%, rgba(80,5,10,0.2) 0%, transparent 50%)',
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md px-6 animate-fade-in">
        <div className="mb-12 text-center">
          <h1 className="text-netflix-red font-bold text-5xl tracking-tighter mb-3 drop-shadow-2xl">MOVIES&CHILL</h1>
          <p className="text-gray-400 text-sm">Descarga peliculas y series desde Telegram</p>
        </div>

        <div className="bg-black/90 rounded-2xl p-8 md:p-10 shadow-2xl shadow-black/50 border border-white/10">
          <h2 className="text-white text-2xl font-medium mb-7">Iniciar sesion</h2>

          {error && (
            <div className="bg-netflix-red/15 border border-netflix-red/30 rounded-xl px-4 py-3.5 mb-6 animate-scale-in">
              <p className="text-netflix-red text-sm font-medium">{error}</p>
            </div>
          )}

          <FocusableInput
            index={0}
            focusKey="login-username"
            type="text"
            value={username}
            onChange={setUsername}
            label="Usuario"
          />

          <FocusableInput
            index={1}
            focusKey="login-password"
            type="password"
            value={password}
            onChange={setPassword}
            label="Contrasena"
          />

          <FocusableButton
            index={2}
            focusKey="login-remember"
            onClick={() => setRemember(!remember)}
            className="flex items-center gap-2 mb-6 text-sm text-gray-400"
          >
            <span className={`w-5 h-5 rounded border flex items-center justify-center ${remember ? 'bg-netflix-red border-netflix-red' : 'border-gray-500'}`}>
              {remember && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            Recordar usuario y contrasena
          </FocusableButton>

          <FocusableButton
            index={3}
            focusKey="login-submit"
            onClick={handleSubmit}
            className="w-full bg-netflix-red hover:bg-netflix-red-hover text-white font-semibold rounded-xl py-3.5 transition-all duration-200 disabled:opacity-50 text-sm shadow-lg shadow-netflix-red/20 hover:shadow-netflix-red/30"
          >
            {loading ? 'Ingresando...' : 'Iniciar sesion'}
          </FocusableButton>
        </div>
      </div>

      <p className="relative z-10 mt-10 text-gray-600 text-xs">
        Inicia sesion para acceder a tu coleccion
      </p>
    </div>
  );
}

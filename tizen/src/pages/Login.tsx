import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const err = await login(username, password);
    setLoading(false);
    if (err) setError(err);
    else navigate('/');
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

        <form onSubmit={handleSubmit} className="bg-black/70 backdrop-blur-xl rounded-2xl p-8 md:p-10 shadow-2xl shadow-black/50 border border-white/10">
          <h2 className="text-white text-2xl font-medium mb-7">Iniciar sesion</h2>

          {error && (
            <div className="bg-netflix-red/15 backdrop-blur-sm border border-netflix-red/30 rounded-xl px-4 py-3.5 mb-6 animate-scale-in">
              <p className="text-netflix-red text-sm font-medium">{error}</p>
            </div>
          )}

          <div className="relative mb-5">
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              placeholder=" "
              className="peer w-full bg-white/5 backdrop-blur-sm rounded-xl px-4 pt-6 pb-2.5 text-white text-sm outline-none border border-white/10 focus:border-white/30 transition-all duration-300"
            />
            <label htmlFor="username" className="absolute left-4 top-2 text-gray-500 text-xs transition-all duration-200 peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-focus:top-2 peer-focus:text-xs">
              Usuario
            </label>
          </div>

          <div className="relative mb-8">
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder=" "
              className="peer w-full bg-white/5 backdrop-blur-sm rounded-xl px-4 pt-6 pb-2.5 text-white text-sm outline-none border border-white/10 focus:border-white/30 transition-all duration-300"
            />
            <label htmlFor="password" className="absolute left-4 top-2 text-gray-500 text-xs transition-all duration-200 peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-focus:top-2 peer-focus:text-xs">
              Contrasena
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-netflix-red hover:bg-netflix-red-hover text-white font-semibold rounded-xl py-3.5 transition-all duration-200 disabled:opacity-50 text-sm shadow-lg shadow-netflix-red/20 hover:shadow-netflix-red/30"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Ingresando...
              </span>
            ) : 'Iniciar sesion'}
          </button>
        </form>
      </div>

      <p className="relative z-10 mt-10 text-gray-600 text-xs">
        Inicia sesion para acceder a tu coleccion
      </p>
    </div>
  );
}

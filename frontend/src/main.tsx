import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { LibraryProvider } from './contexts/LibraryContext';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { FollowsProvider } from './contexts/FollowsContext';
import './index.css';

// El service worker de la web no cachea nada: esta solo para los avisos de
// episodios nuevos, que necesitan a alguien escuchando cuando la pestaña no
// esta abierta. Sin esto, `pushManager` no existe y el interruptor de avisos
// no podria encenderse.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <LibraryProvider>
          <FavoritesProvider>
            <FollowsProvider>
              <App />
            </FollowsProvider>
          </FavoritesProvider>
        </LibraryProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

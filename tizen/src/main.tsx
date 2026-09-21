import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { FocusRoot } from './focus/react';
import './index.css';

// Sin StrictMode: en desarrollo monta y desmonta cada efecto dos veces, lo que
// con un motor de foco imperativo confunde mas de lo que ayuda. En produccion
// no hacia nada de todos modos.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <AuthProvider>
      <FocusRoot>
        <App />
      </FocusRoot>
    </AuthProvider>
  </BrowserRouter>
);

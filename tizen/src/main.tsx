import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import './index.css';

init({ debug: false, visualDebug: false, shouldUseNativeEvents: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { apiFetch } from '../services/api';
import type { AppConfig } from '../types';

export default function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    apiFetch('/config').then(r => r.json()).then(d => setConfig(d.config));
  }, []);

  const update = (key: string, value: any) => {
    setConfig(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const save = async () => {
    if (!config) return;
    await apiFetch('/config', { method: 'POST', body: JSON.stringify(config) });
    setToast('Configuracion guardada');
    setTimeout(() => setToast(''), 2000);
  };

  if (!config) {
    return (
      <Layout>
        <div className="px-6 md:px-14 pt-24 flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-3 border-netflix-red border-t-transparent rounded-full" />
        </div>
      </Layout>
    );
  }

  const field = (label: string, key: string, type: string = 'text') => (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-4 border-b border-white/5 last:border-0">
      <label className="text-gray-300 text-sm sm:w-48 shrink-0">{label}</label>
      <input
        type={type}
        value={(config as any)[key] ?? ''}
        onChange={e => update(key, type === 'number' ? (parseInt(e.target.value) || 0) : e.target.value)}
        className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-white/25 transition-all"
      />
    </div>
  );

  const toggle = (label: string, key: string) => (
    <div className="flex items-center justify-between py-4 border-b border-white/5 last:border-0">
      <span className="text-gray-300 text-sm">{label}</span>
      <button onClick={() => update(key, !(config as any)[key])}
        className={`w-14 h-7 rounded-full transition-all duration-300 relative ${(config as any)[key] ? 'bg-netflix-red shadow-lg shadow-netflix-red/30' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300 ${(config as any)[key] ? 'translate-x-7' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );

  return (
    <Layout>
      <div className="px-6 md:px-14 pt-24 pb-20 max-w-2xl mx-auto">
        {toast && (
          <div className="fixed top-24 right-6 z-50 bg-green-600/90 backdrop-blur-xl border border-green-400/20 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium animate-slide-up">
            {toast}
          </div>
        )}

        <h1 className="text-white text-4xl font-bold mb-2 tracking-tight animate-fade-in">Ajustes</h1>
        <p className="text-gray-400 text-sm mb-10 animate-fade-in">Configuracion de la aplicacion</p>

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
          <h2 className="text-white font-semibold mb-3">Telegram API</h2>
          {field('API ID', 'api_id', 'number')}
          {field('API Hash', 'api_hash')}
          {field('Telefono', 'phone')}
        </div>

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
          <h2 className="text-white font-semibold mb-3">Almacenamiento</h2>
          {field('Ruta descargas', 'download_path')}
          {field('Ruta extraccion', 'extract_path')}
        </div>

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
          <h2 className="text-white font-semibold mb-3">Servidor</h2>
          {field('Host', 'server_host')}
          {field('Puerto', 'server_port', 'number')}
        </div>

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
          <h2 className="text-white font-semibold mb-3">Comportamiento</h2>
          {field('Descargas paralelas', 'download_parallel', 'number')}
          {toggle('Borrar archivos tras extraer', 'delete_archives_after_extract')}
          {toggle('Convertir DTS a AC3', 'convert_dts_to_ac3')}
        </div>

        <button onClick={save} className="bg-netflix-red hover:bg-netflix-red-hover text-white px-8 py-3.5 rounded-xl font-semibold transition-all hover:scale-105 shadow-lg shadow-netflix-red/20">
          Guardar configuracion
        </button>
      </div>
    </Layout>
  );
}

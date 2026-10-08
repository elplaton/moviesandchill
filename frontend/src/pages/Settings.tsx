import { useState, useEffect } from 'react';
import Shell from '../components/Shell';
import { Embedded } from '../components/Shell';
import { apiFetch } from '../services/api';
import type { AppConfig } from '../types';

interface CacheEstado {
  activa: boolean;
  url: string;
  aciertos: number;
  fallos: number;
  errores: number;
  tasa: number;
  claves?: number;
  memoria?: string;
  error?: string;
}

export default function Settings({ embedded = false }: { embedded?: boolean } = {}) {
  const Wrap = embedded ? Embedded : Shell;
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [toast, setToast] = useState('');
  /**
   * Estado de la cache. Existe porque una cache es invisible cuando va bien
   * y tambien cuando no va: sin un sitio donde mirarlo, la unica forma de
   * saber si Redis esta conectado era cronometrar la portada.
   */
  const [cache, setCache] = useState<CacheEstado | null>(null);

  const leerCache = () => {
    apiFetch('/admin/cache').then(r => r.json()).then(setCache).catch(() => setCache(null));
  };

  useEffect(() => {
    apiFetch('/config').then(r => r.json()).then(d => setConfig(d.config));
    leerCache();
  }, []);

  const vaciarCache = async () => {
    await apiFetch('/admin/cache', { method: 'DELETE' });
    setToast('Caché vaciada');
    setTimeout(() => setToast(''), 2000);
    leerCache();
  };

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
      <Wrap>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-3 border-nf-red border-t-transparent rounded-full" />
        </div>
      </Wrap>
    );
  }

  const field = (label: string, key: string, type: string = 'text') => (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-4 border-b border-white/5 last:border-0">
      <label className="text-nf-dim text-sm sm:w-48 shrink-0">{label}</label>
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
      <span className="text-nf-dim text-sm">{label}</span>
      <button onClick={() => update(key, !(config as any)[key])}
        className={`w-14 h-7 rounded-full transition-all duration-300 relative ${(config as any)[key] ? 'bg-nf-red shadow-lg shadow-nf-red/30' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300 ${(config as any)[key] ? 'translate-x-7' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );

  return (
    <Wrap>
      <div className={embedded ? "max-w-2xl" : "px-6 md:px-14 pt-24 pb-20 max-w-2xl mx-auto"}>
        {toast && (
          <div className="fixed top-24 right-6 z-50 bg-green-600/90 backdrop-blur-xl border border-green-400/20 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium animate-slide-up">
            {toast}
          </div>
        )}

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

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
          <h2 className="text-white font-semibold mb-1">Caché</h2>
          <p className="text-nf-faint text-xs mb-4">
            La portada, las fichas y las pistas de cada archivo se guardan en Redis.
            Es lo que hace que aparezcan de golpe en vez de recalcularse en cada visita.
          </p>
          {!cache ? (
            <p className="text-nf-dim text-sm py-2">Consultando…</p>
          ) : !cache.activa ? (
            <p className="text-nf-dim text-sm py-2">
              Desactivada. Se enciende poniendo <code className="text-white">TMD_REDIS_URL</code>;
              sin ella todo funciona igual, solo más lento.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 py-2">
                {[['Acierto', `${cache.tasa} %`],
                  ['Consultas', String(cache.aciertos + cache.fallos)],
                  ['Entradas', cache.claves != null ? String(cache.claves) : '—'],
                  ['Memoria', cache.memoria || '—']].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-nf-faint text-micro uppercase tracking-wide">{k}</p>
                    <p className="text-white text-md font-semibold tabular-nums">{v}</p>
                  </div>
                ))}
              </div>
              <p className="text-nf-faint text-xs mt-2">
                {cache.url}
                {cache.errores > 0 && ` · ${cache.errores} errores`}
              </p>
            </>
          )}
          <div className="flex gap-3 mt-4">
            <button onClick={leerCache}
              className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
              Actualizar
            </button>
            {cache?.activa && (
              <button onClick={vaciarCache}
                className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Vaciar caché
              </button>
            )}
          </div>
        </div>

        <button onClick={save} className="bg-nf-red hover:bg-nf-red-dark text-white px-8 py-3.5 rounded-xl font-semibold transition-all hover:scale-105 shadow-lg shadow-nf-red/20">
          Guardar configuracion
        </button>
      </div>
    </Wrap>
  );
}

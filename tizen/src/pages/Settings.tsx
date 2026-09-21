import { useRef, useState, useEffect } from 'react';
import Layout from '../components/Layout';
import FocusableButton from '../components/FocusableButton';
import { setPaused } from '../focus/engine';
import { FocusScope, useFocusItem } from '../focus/react';
import { apiFetch } from '../services/api';
import type { AppConfig } from '../types';

/**
 * Campo de texto navegable con el mando: Enter entrega el foco real al input,
 * que es lo que abre el teclado de Tizen. Mientras se escribe se pausa la
 * navegacion para que las flechas muevan el cursor; arriba y abajo salen del
 * campo (lo resuelve el gestor de teclas).
 */
function SettingField({ label, value, type, index, onChange }: {
  label: string; value: string | number; type: string; index: number;
  onChange: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref } = useFocusItem<HTMLDivElement>({
    index,
    onEnter: () => inputRef.current?.focus(),
    onBlur: () => inputRef.current?.blur(),
  });

  return (
    <div ref={ref} className="tv-focusable flex flex-col sm:flex-row sm:items-center gap-3 py-4 border-b border-white/5 last:border-0 rounded-xl">
      <label className="text-gray-300 text-sm sm:w-48 shrink-0">{label}</label>
      <input
        ref={inputRef}
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-white/25"
      />
    </div>
  );
}

function SettingToggle({ label, value, index, onToggle }: {
  label: string; value: boolean; index: number; onToggle: () => void;
}) {
  const { ref } = useFocusItem<HTMLDivElement>({ index, onEnter: onToggle });
  return (
    <div ref={ref} onClick={onToggle}
      className="tv-focusable flex items-center justify-between py-4 border-b border-white/5 last:border-0 rounded-xl cursor-pointer">
      <span className="text-gray-300 text-sm">{label}</span>
      <span className={`w-14 h-7 rounded-full relative ${value ? 'bg-netflix-red shadow-lg shadow-netflix-red/30' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md ${value ? 'translate-x-7' : 'translate-x-0.5'}`} />
      </span>
    </div>
  );
}

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

  const cfg = config as any;
  const field = (label: string, key: string, index: number, type: string = 'text') => (
    <SettingField
      label={label} value={cfg[key]} type={type} index={index}
      onChange={(v) => update(key, type === 'number' ? (parseInt(v) || 0) : v)}
    />
  );
  const toggle = (label: string, key: string, index: number) => (
    <SettingToggle label={label} value={!!cfg[key]} index={index} onToggle={() => update(key, !cfg[key])} />
  );

  return (
    <Layout>
      <div className="px-6 md:px-14 pt-24 pb-20 max-w-2xl mx-auto">
        {toast && (
          <div className="fixed top-24 right-6 z-50 bg-green-600/95 border border-green-400/20 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium animate-slide-up">
            {toast}
          </div>
        )}

        <h1 className="text-white text-4xl font-bold mb-2 tracking-tight">Ajustes</h1>
        <p className="text-gray-400 text-sm mb-10">Configuracion de la aplicacion</p>

        <FocusScope orientation="vertical" index={1} as="none">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
            <h2 className="text-white font-semibold mb-3">Telegram API</h2>
            {field('API ID', 'api_id', 0, 'number')}
            {field('API Hash', 'api_hash', 1)}
            {field('Telefono', 'phone', 2)}
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
            <h2 className="text-white font-semibold mb-3">Almacenamiento</h2>
            {field('Ruta descargas', 'download_path', 3)}
            {field('Ruta extraccion', 'extract_path', 4)}
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
            <h2 className="text-white font-semibold mb-3">Servidor</h2>
            {field('Host', 'server_host', 5)}
            {field('Puerto', 'server_port', 6, 'number')}
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
            <h2 className="text-white font-semibold mb-3">Comportamiento</h2>
            {field('Descargas paralelas', 'download_parallel', 7, 'number')}
            {toggle('Borrar archivos tras extraer', 'delete_archives_after_extract', 8)}
            {toggle('Convertir DTS a AC3', 'convert_dts_to_ac3', 9)}
          </div>

          <FocusableButton index={10} onClick={save} autoFocus
            className="bg-netflix-red text-white px-8 py-3.5 rounded-xl font-semibold shadow-lg shadow-netflix-red/20">
            Guardar configuracion
          </FocusableButton>
        </FocusScope>
      </div>
    </Layout>
  );
}

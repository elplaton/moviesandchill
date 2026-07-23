import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { apiFetch } from '../services/api';
import type { Channel } from '../types';

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [url, setUrl] = useState('');
  const [urlFeedback, setUrlFeedback] = useState('');
  const [toast, setToast] = useState('');

  const loadChannels = async () => {
    try {
      const res = await apiFetch('/channels');
      const data = await res.json();
      const list: Channel[] = data.channels || [];
      setChannels(list);
      setActiveIds(new Set(list.map(c => c.id)));
    } catch {}
  };

  useEffect(() => { loadChannels(); }, []);

  const toggle = (id: number) => {
    setActiveIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const saveChannels = async () => {
    const selected = channels.filter(c => activeIds.has(c.id)).map(c => ({ id: c.id, name: c.name }));
    await apiFetch('/config', { method: 'POST', body: JSON.stringify({ channels: selected }) });
    setToast('Guardado');
    setTimeout(() => setToast(''), 2000);
  };

  const addByUrl = async () => {
    if (!url.trim()) return;
    setUrlFeedback('Resolviendo...');
    try {
      const res = await apiFetch('/channels/add', { method: 'POST', body: JSON.stringify({ url: url.trim() }) });
      const data = await res.json();
      if (data.error) {
        setUrlFeedback(data.error);
      } else {
        setUrlFeedback(`${data.status === 'added' ? 'Anadido' : 'Actualizado'}: ${data.channel.name}`);
        setUrl('');
        setActiveIds(prev => new Set([...prev, data.channel.id]));
        await loadChannels();
      }
    } catch {
      setUrlFeedback('Error de conexion');
    }
  };

  const active = channels.filter(c => activeIds.has(c.id));
  const inactive = channels.filter(c => !activeIds.has(c.id));

  return (
    <Layout>
      <div className="px-6 md:px-14 pt-24 pb-20 max-w-4xl mx-auto">
        {toast && (
          <div className="fixed top-24 right-6 z-50 bg-green-600/90 backdrop-blur-xl border border-green-400/20 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium animate-slide-up">
            {toast}
          </div>
        )}

        <h1 className="text-white text-4xl font-bold mb-2 tracking-tight animate-fade-in">Canales</h1>
        <p className="text-gray-400 text-sm mb-10 animate-fade-in">Canales de Telegram donde se busca contenido</p>

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
          <h2 className="text-white text-lg font-medium mb-4">Anadir canal por URL</h2>
          <div className="flex gap-3">
            <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addByUrl()}
              placeholder="https://t.me/c/123456789 o https://t.me/NombreCanal"
              className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-white/25 transition-all placeholder-gray-500" />
            <button onClick={addByUrl}
              className="bg-netflix-red hover:bg-netflix-red-hover text-white px-6 py-3 rounded-xl font-medium text-sm transition-all hover:scale-105 shadow-lg shadow-netflix-red/20">
              Anadir
            </button>
          </div>
          {urlFeedback && (
            <p className={`mt-3 text-xs ${urlFeedback.includes('Error') || urlFeedback.includes('URL') ? 'text-red-400' : 'text-green-400'}`}>
              {urlFeedback}
            </p>
          )}
        </div>

        {active.length > 0 && (
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
            <h2 className="text-white text-lg font-medium mb-4">Activos ({active.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {active.map(c => (
                <button key={c.id} onClick={() => toggle(c.id)}
                  className="flex items-center gap-3 bg-netflix-red/10 border border-netflix-red/20 rounded-xl px-4 py-3 hover:bg-netflix-red/15 transition-all text-left">
                  <span className="text-white text-sm truncate font-medium">{c.name}</span>
                  <span className="text-gray-400 text-[10px] shrink-0 ml-auto">{c.id}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {inactive.length > 0 && (
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
            <h2 className="text-white text-lg font-medium mb-4">Inactivos ({inactive.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {inactive.map(c => (
                <button key={c.id} onClick={() => toggle(c.id)}
                  className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-all text-left">
                  <span className="text-gray-400 text-sm truncate">{c.name}</span>
                  <span className="text-gray-500 text-[10px] shrink-0 ml-auto">{c.id}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={saveChannels}
          className="bg-netflix-red hover:bg-netflix-red-hover text-white px-8 py-3.5 rounded-xl font-semibold transition-all hover:scale-105 shadow-lg shadow-netflix-red/20">
          Guardar
        </button>
      </div>
    </Layout>
  );
}

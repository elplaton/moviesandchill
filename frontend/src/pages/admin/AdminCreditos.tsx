import { useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '../../services/api';
import { botonPasada, cuantoQueda, estadoPasada, leerPasada, mandarPasada, resultadosPasada, type Pasada } from '../../services/pasadaCreditos';

// Punto de miles también con cuatro cifras («6.429», no «6429»): el español
// no lo pone por debajo de 10.000 y en las cifras del panel, unas con punto y
// otras sin él, parecía un error.
const MILES = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;

/**
 * Pestaña «Créditos» del panel: dónde empiezan los créditos de cada título
 * (services/creditos.py). Cuatro cosas: usarlos o no (el interruptor general,
 * `creditos_activos`), averiguarlos al ver (TMD_CREDITOS_ANALIZAR), la pasada
 * completa del catálogo (services/pasada_creditos.py) y cuánto se sabe ya. Los
 * dos interruptores se guardan en la base de datos y mandan sobre el .env.
 */
export default function AdminCreditos({ onToast }: { onToast: (m: string) => void }) {
  const [conf, setConf] = useState<{ activos: boolean; alVer: boolean } | null>(null);
  useEffect(() => {
    apiFetch('/config').then(r => r.json())
      .then(d => setConf({ activos: d.config?.creditos_activos !== false, alVer: !!d.config?.creditos_analizar }))
      .catch(() => setConf(null));
  }, []);
  const cambiar = async (clave: 'creditos_activos' | 'creditos_analizar', nuevo: boolean, ok: string) => {
    const campo = clave === 'creditos_activos' ? 'activos' : 'alVer';
    setConf(c => c && { ...c, [campo]: nuevo });
    const r = await apiFetch('/config', { method: 'POST', body: JSON.stringify({ [clave]: nuevo }) }).catch(() => null);
    if (!r || !r.ok) { setConf(c => c && { ...c, [campo]: !nuevo }); onToast('No se ha podido guardar'); return; }
    onToast(ok);
  };
  const activos = !!conf?.activos;
  return (
    <div className="max-w-2xl">
      <div className={CAJA}>
        <Interruptor titulo="Usar los créditos" on={activos} disabled={!conf}
          onClick={() => cambiar('creditos_activos', !activos, !activos ? 'Créditos activados' : 'Créditos desactivados')}>
          Al empezar los créditos sale la tarjeta del siguiente episodio (o «Más títulos como este») y lo que se
          estaba viendo se da por visto. Apagado, eso pasa siempre 45 s antes del final, como si no se supieran, y
          no se mide nada al ver. Lo ya medido no se borra.
        </Interruptor>
        <div className={`mt-5 pt-5 border-t border-white/10 transition-opacity ${activos ? '' : 'opacity-40'}`}>
          <Interruptor titulo="Averiguar los créditos al ver" on={!!conf?.alVer} disabled={!conf || !activos}
            onClick={() => cambiar('creditos_analizar', !conf?.alVer,
              !conf?.alVer ? 'Se averiguarán los créditos al ver' : 'Ya no se averiguan al ver')}>
            Si alguien abre algo cuyos créditos no se saben, se miden mientras lo ve (los últimos fotogramas, en
            Telegram) y la tarjeta del siguiente episodio sale a tiempo.
          </Interruptor>
        </div>
      </div>
      <PasadaCreditos />
      <Resumen />
    </div>
  );
}

const CAJA = 'bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-6 shadow-xl';

function Interruptor({ titulo, on, disabled, onClick, children }: {
  titulo: string; on: boolean; disabled: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h2 className="text-white font-semibold">{titulo}</h2>
        <p className="text-nf-faint text-xs mt-1">{children}</p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={titulo}
        disabled={disabled} onClick={onClick}
        className={`w-14 h-7 shrink-0 rounded-full transition-colors duration-300 relative disabled:cursor-not-allowed ${on ? 'bg-nf-red shadow-lg shadow-nf-red/30' : 'bg-white/10'}`}>
        <span className={`absolute left-0 top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-300 ${on ? 'translate-x-[30px]' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

/**
 * La pasada completa de créditos: lanzarla, pausarla y ver cómo va. Se
 * pregunta cada diez segundos mientras la página está a la vista.
 */
function PasadaCreditos() {
  const [p, setP] = useState<Pasada | null>(null);
  const [mandando, setMandando] = useState(false);
  useEffect(() => {
    let vivo = true;
    const leer = () => { if (!document.hidden) leerPasada().then(r => { if (vivo && r) setP(r); }); };
    leer();
    const t = setInterval(leer, 10_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  const mandar = async (accion: 'lanzar' | 'pausar') => {
    setMandando(true);
    const r = await mandarPasada(accion);
    if (r) setP(r);
    setMandando(false);
  };
  const total = p?.total || 0;
  const hechos = p?.hechos || 0;
  const pct = total ? Math.min(100, Math.round((hechos / total) * 100)) : 0;
  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
      <h2 className="text-white font-semibold mb-1">Pasada completa de créditos</h2>
      <p className="text-nf-faint text-xs mb-4">
        Mide dónde empiezan los créditos de todo el catálogo de una vez (uno o dos días), lo más visto primero.
        Va de tres en tres, se para mientras hay una descarga y va más despacio si alguien está viendo algo.
        Si el servidor se reinicia, sigue sola.
      </p>
      {!p ? (
        <p className="text-nf-dim text-sm py-2">Consultando…</p>
      ) : (
        <>
          <p className="text-white text-sm font-semibold">{estadoPasada(p)}</p>
          {total > 0 && (
            <>
              <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-nf-red transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-nf-dim text-xs mt-2 tabular-nums">
                {hechos.toLocaleString('es-ES', MILES)} de {total.toLocaleString('es-ES', MILES)} películas y temporadas ({pct} %)
                {p.lanzada && p.segundos_restantes ? ` · ${cuantoQueda(p.segundos_restantes)}` : ''}
              </p>
            </>
          )}
          {!!p.actuales?.length && <p className="text-nf-faint text-xs mt-2">Midiendo: {p.actuales.join(' · ')}</p>}
          {resultadosPasada(p) && <p className="text-nf-faint text-xs mt-1">Esta tanda: {resultadosPasada(p)}</p>}
        </>
      )}
      <div className="flex gap-3 mt-4">
        <button disabled={!p || mandando} onClick={() => mandar(p?.lanzada ? 'pausar' : 'lanzar')}
          className="bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
          {botonPasada(p)}
        </button>
      </div>
    </div>
  );
}

interface Resumen {
  titulos?: { tmdb_type: string; fuente: string; n: number }[];
  enlaces?: { estado: string; fuente: string; n: number }[];
}

const FUENTE: Record<string, string> = { manual: 'a mano', capitulos: 'por capítulos', imagen: 'por la imagen' };

/** Cuánto se sabe ya, y de dónde ha salido. */
function Resumen() {
  const [r, setR] = useState<Resumen | null>(null);
  useEffect(() => { apiFetch('/admin/creditos/resumen').then(x => x.json()).then(setR).catch(() => setR(null)); }, []);
  const de = (tipo: string) => (r?.titulos || []).filter(t => t.tmdb_type === tipo);
  const linea = (filas: { fuente: string; n: number }[]) => {
    const total = filas.reduce((a, f) => a + f.n, 0);
    const partes = filas.map(f => `${f.n.toLocaleString('es-ES', MILES)} ${FUENTE[f.fuente] || f.fuente}`).join(' · ');
    return `${total.toLocaleString('es-ES', MILES)}${partes ? ` (${partes})` : ''}`;
  };
  const medidos = (r?.enlaces || []).reduce((a, e) => a + e.n, 0);
  return (
    <div className={CAJA}>
      <h2 className="text-white font-semibold mb-3">Lo que ya se sabe</h2>
      {!r ? <p className="text-nf-dim text-sm">Consultando…</p> : (
        <div className="grid grid-cols-3 gap-3">
          {[['Películas', linea(de('movie'))], ['Series', linea(de('tv'))], ['Enlaces medidos', medidos.toLocaleString('es-ES', MILES)]].map(([k, v]) => (
            <div key={k}>
              <p className="text-nf-faint text-micro uppercase tracking-wide">{k}</p>
              <p className="text-white text-sm font-semibold">{v}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-nf-faint text-xs mt-3">
        Series cuenta referencias (por temporada o de la serie entera). Con una referencia, el resto de enlaces del
        título se prevé sin medirlos.
      </p>
    </div>
  );
}

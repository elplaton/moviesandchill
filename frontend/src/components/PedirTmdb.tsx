import { useEffect, useRef, useState } from 'react';
import Button from './ui/Button';
import { avisoAlPedir, buscarEnTmdb, estaPedida, pedir, type ResultadoTmdb } from '../services/peticiones';

/**
 * Pedir lo que no está, desde el buscador.
 *
 * No se busca en TMDB solo: se ofrece. Si el catálogo no encuentra nada, sale
 * un botón «Pedir "lo buscado"»; si encuentra algo, un enlace discreto al
 * final (salió «Dune» pero no la que querías). Al pulsar se busca en TMDB
 * con el mismo texto y se elige cuál pedir. Cambiar lo escrito cierra la
 * lista: era la de otra búsqueda.
 */
export default function PedirTmdb({ termino, sinResultados }: { termino: string; sinResultados: boolean }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [items, setItems] = useState<ResultadoTmdb[] | null>(null);
  const [estado, setEstado] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const ultima = useRef(0);
  const t = termino.trim();

  // Lo abierto era para otro término: se cierra al cambiarlo.
  useEffect(() => {
    if (abierto !== null && abierto !== t) { setAbierto(null); setItems(null); setEstado({}); }
  }, [t, abierto]);

  const buscar = () => {
    const mia = ++ultima.current;
    setAbierto(t);
    setItems(null);
    buscarEnTmdb(t)
      .then(r => { if (mia === ultima.current) setItems(r.filter(x => !x.en_catalogo)); })
      .catch(() => { if (mia === ultima.current) setItems([]); });
  };

  const clave = (r: ResultadoTmdb) => `${r.media_type}-${r.tmdb_id}`;

  const enviar = async (r: ResultadoTmdb) => {
    const k = clave(r);
    setOcupado(k);
    try {
      const res = await pedir(r);
      // El botón pasa a «Pedida» ya; el texto con el puesto llega después.
      setItems(lista => (lista || []).map(x => clave(x) === k ? { ...x, peticion: { estado: res.estado, mia: true } } : x));
      const texto = await avisoAlPedir(res);
      setEstado(e => ({ ...e, [k]: texto }));
    } catch (e) {
      setEstado(s => ({ ...s, [k]: e instanceof Error ? e.message : 'No se ha podido pedir' }));
    } finally {
      setOcupado(null);
    }
  };

  if (t.length < 2) return null;

  if (abierto === null) {
    return sinResultados ? (
      <div className="mb-10">
        <Button variant="light" onClick={buscar}>Pedir «{t}»</Button>
        <p className="mt-2 text-sm text-nf-faint">Se busca en TMDB con ese nombre, eliges cuál y entra en la cola de Telegram. Te llega un aviso cuando esté.</p>
      </div>
    ) : (
      <p className="mb-10 text-sm text-nf-faint">
        ¿No está lo que buscas? <button onClick={buscar} className="text-white hover:underline">Pídelo</button>
      </p>
    );
  }

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-semibold">Pedir «{abierto}»</h2>
      <p className="mb-4 text-sm text-nf-faint">Elige cuál. Entra en la cola de Telegram (sale una cada hora) y te llega un aviso cuando esté.</p>
      {items === null && <p className="text-base text-nf-faint">Buscando en TMDB…</p>}
      {items?.length === 0 && <p className="text-base text-nf-faint">TMDB no conoce nada con ese nombre que no tengamos ya.</p>}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {items?.map(r => {
          const k = clave(r);
          const p = r.peticion;
          const mia = estaPedida(p?.estado) && !!p?.mia;
          const deOtro = estaPedida(p?.estado) && !p?.mia;
          return (
            <div key={k} className="flex gap-3 rounded-lg border border-nf-line bg-nf-surface p-3">
              <div className="h-[108px] w-[72px] shrink-0 overflow-hidden rounded bg-white/5">
                {r.poster && <img src={r.poster} alt="" loading="lazy" className="h-full w-full object-cover" />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate font-semibold">{r.title}</p>
                <p className="text-sm text-nf-faint">{[r.year, r.media_type === 'series' ? 'Serie' : 'Película'].filter(Boolean).join(' · ')}</p>
                {r.overview && <p className="mt-1 line-clamp-2 text-xs text-nf-dim">{r.overview}</p>}
                <div className="mt-auto pt-2">
                  <Button variant={mia ? 'ghost' : 'light'} size="sm" disabled={mia || ocupado === k}
                    onClick={() => enviar(r)}>
                    {mia ? 'Pedida' : deOtro ? 'Avisarme' : ocupado === k ? 'Pidiendo…' : 'Pedir'}
                  </Button>
                  {estado[k] && <p className="mt-1.5 text-xs text-nf-dim">{estado[k]}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ESTADO_TEXTO, dejarDeEsperar, duracionAprox, estaPedida, misPeticiones, segundosHastaPuesto,
  type Peticion, type RitmoCola,
} from '../services/peticiones';

/** Lo que esta cuenta ha pedido y en qué está. Va en Mi cuenta. */
export default function MisPeticiones() {
  const [lista, setLista] = useState<Peticion[] | null>(null);
  const [quedan, setQuedan] = useState<number | null>(null);
  const [ritmo, setRitmo] = useState<RitmoCola | null>(null);

  const cargar = useCallback(() => {
    misPeticiones().then(d => {
      setLista(d.peticiones);
      setQuedan(d.quedan_hoy);
      setRitmo({ segundos_para_siguiente: d.segundos_para_siguiente, minutos_entre_envios: d.minutos_entre_envios });
    }).catch(() => setLista([]));
  }, []);

  // Lo que se lee debajo del título. En cola se dice el puesto y cuándo sale
  // más o menos: «En cola» a secas no deja saber si son minutos o días.
  const linea = (p: Peticion) => {
    if (p.estado !== 'en_cola' || !p.puesto) return ESTADO_TEXTO[p.estado];
    const partes = [ESTADO_TEXTO.en_cola, `puesto ${p.puesto}`];
    if (ritmo) partes.push(`sale en ~${duracionAprox(segundosHastaPuesto(p.puesto, ritmo))}`);
    return partes.join(' · ');
  };
  useEffect(() => { cargar(); }, [cargar]);

  const quitar = async (p: Peticion) => {
    // Se quita de la vista antes de que conteste: una lista que tarda en
    // reaccionar parece rota, y si falla la siguiente lectura la devuelve.
    setLista(l => (l || []).filter(x => x.id !== p.id));
    dejarDeEsperar(p.id).catch(cargar);
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 shadow-xl">
      <h2 className="text-white font-semibold mb-1">Mis peticiones</h2>
      <p className="text-nf-dim text-sm mb-4">
        Lo que has pedido desde el buscador. Las peticiones esperan en una cola y sale una cada hora; te llega un aviso cuando está.
        {quedan !== null && ` Te quedan ${quedan} ${quedan === 1 ? 'petición' : 'peticiones'} hoy.`}
      </p>
      {lista === null && <p className="text-nf-faint text-sm">Cargando…</p>}
      {lista?.length === 0 && <p className="text-nf-faint text-sm">Todavía no has pedido nada. Busca un título y, si no lo tenemos, aparecerá abajo para pedirlo.</p>}
      <ul className="space-y-2">
        {lista?.map(p => (
          <li key={p.id} className="flex items-center gap-3">
            <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-white/5">
              {p.poster && <img src={p.poster} alt="" loading="lazy" className="h-full w-full object-cover" />}
            </div>
            <div className={`min-w-0 flex-1 ${p.estado === 'descartada' ? 'opacity-60' : ''}`}>
              <p className="truncate text-sm text-white">{p.titulo}{p.year ? ` (${p.year})` : ''}</p>
              <p className={`text-xs ${p.estado === 'conseguida' ? 'text-green-400' : p.estado === 'fallida' ? 'text-nf-red' : 'text-nf-faint'}`}>
                {linea(p)}
              </p>
            </div>
            {p.estado === 'conseguida' && (
              <Link to={`/?ficha=${p.media_type === 'series' ? 's' : 'm'}${p.tmdb_id}`}
                className="text-sm text-white hover:underline">Ver ficha</Link>
            )}
            {/* En cola se puede quitar igual que mandada: deja de esperarla
                esta cuenta, y sin ella no le llega el aviso. */}
            {estaPedida(p.estado) && (
              <button onClick={() => quitar(p)} className="text-sm text-nf-dim hover:text-white">Ya no me interesa</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

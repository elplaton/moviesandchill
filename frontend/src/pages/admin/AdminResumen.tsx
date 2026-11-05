import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../services/api';

// Punto de miles también con cuatro cifras («6.429», no «6429»): el español
// no lo pone por debajo de 10.000 y en las cifras del panel, unas con punto y
// otras sin él, parecía un error.
const MILES = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;

/**
 * La portada del panel: el estado de todo de un vistazo (`GET
 * /api/admin/resumen`). Arriba lo que pide atención, cada aviso llevando a la
 * sección que lo arregla; debajo una tarjeta por área. Antes había que entrar
 * pestaña por pestaña para saber si Telegram estaba conectado o si las
 * peticiones estaban en pausa.
 *
 * Cualquier parte puede venir a null (ha fallado o se está calculando): se
 * pinta «—» y el resto sigue, porque esta página es justo la que se abre
 * cuando algo va mal.
 */

interface Resumen {
  avisos: { nivel: 'error' | 'aviso'; texto: string; seccion: string }[];
  telegram: { conectado: boolean; autorizado: boolean; premium: boolean | null; canales: number; canales_activos: number } | null;
  catalogo: { total: number; con_ficha: number; peliculas: number; series: number; escaneando: number; releyendo: boolean } | null;
  revision: { archivos: number; grupos: number } | null;
  descargas: { activas: number; disco_libre: number } | null;
  peticiones: { en_cola: number; pausadas: boolean; chat: string | null } | null;
  creditos: { activos?: boolean; al_ver: boolean; pasada: { estado: string; lanzada: boolean; hechos: number | null; total: number | null; cediendo: string | null } } | null;
  comprimidos: { revisados: number; ver: number } | null;
  usuarios: { total: number; activos: number; en_linea?: number } | null;
}

const n = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('es-ES', MILES));

export function tamano(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1024 ? `${(gb / 1024).toFixed(1).replace('.', ',')} TB` : `${Math.round(gb)} GB`;
}

type Estado = 'ok' | 'aviso' | 'error' | 'nada';
const PUNTO: Record<Estado, string> = {
  ok: 'bg-nf-ok', aviso: 'bg-nf-warn', error: 'bg-nf-red', nada: 'bg-white/20',
};

function Tarjeta({ titulo, cifra, linea, estado, onClick }: {
  titulo: string; cifra: string; linea: string; estado: Estado; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="group text-left bg-white/5 hover:bg-white/[0.08] border border-white/10 rounded-2xl p-5 transition-colors">
      <div className="flex items-center justify-between">
        <p className="text-nf-dim text-xs font-semibold uppercase tracking-wide">{titulo}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${PUNTO[estado]}`} />
      </div>
      <p className="mt-3 text-white text-3xl font-bold tabular-nums">{cifra}</p>
      <p className="mt-1 text-nf-dim text-sm">{linea}</p>
      <p className="mt-3 text-nf-faint text-xs group-hover:text-white transition-colors">Abrir →</p>
    </button>
  );
}

export default function AdminResumen() {
  const navigate = useNavigate();
  const [r, setR] = useState<Resumen | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vivo = true;
    const leer = () => {
      if (document.hidden) return;
      apiFetch('/admin/resumen').then(x => x.json())
        .then(d => { if (vivo) { setR(d); setFallo(false); } })
        .catch(() => { if (vivo) setFallo(true); });
    };
    leer();
    const t = setInterval(leer, 20_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const ir = (seccion: string) => navigate(`/admin/${seccion}`);

  if (!r) {
    return <p className="text-nf-dim text-sm py-6">{fallo ? 'El servidor no ha contestado.' : 'Consultando…'}</p>;
  }

  const tg = r.telegram, cat = r.catalogo, rev = r.revision, des = r.descargas;
  const pet = r.peticiones, cre = r.creditos, com = r.comprimidos, usu = r.usuarios;
  const pas = cre?.pasada;
  const pctPasada = pas?.total ? Math.round(((pas.hechos || 0) / pas.total) * 100) : 0;

  return (
    <div>
      {r.avisos.length > 0 && (
        <div className="mb-6 space-y-2">
          {r.avisos.map((a, i) => (
            <button key={i} onClick={() => ir(a.seccion)}
              className={`w-full flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-left text-sm border transition-colors
                ${a.nivel === 'error' ? 'bg-nf-red/15 border-nf-red/40 hover:bg-nf-red/25' : 'bg-nf-warn/10 border-nf-warn/30 hover:bg-nf-warn/20'}`}>
              <span className="text-white">{a.texto}</span>
              <span className="text-nf-dim shrink-0">Ver →</span>
            </button>
          ))}
        </div>
      )}
      {r.avisos.length === 0 && (
        <p className="mb-6 rounded-xl px-4 py-3 text-sm bg-nf-ok/10 border border-nf-ok/30 text-white">Todo en orden: nada pide atención.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Tarjeta titulo="Telegram" onClick={() => ir('telegram')}
          estado={!tg ? 'nada' : !tg.conectado || !tg.autorizado ? 'error' : tg.canales < tg.canales_activos ? 'aviso' : 'ok'}
          cifra={!tg ? '—' : tg.conectado ? (tg.autorizado ? 'Conectado' : 'Sin sesión') : 'Desconectado'}
          linea={tg ? `${tg.canales} de ${tg.canales_activos} canales${tg.premium ? ' · Premium' : ''}` : ''} />
        <Tarjeta titulo="Catálogo" onClick={() => ir('canales')}
          estado={!cat ? 'nada' : 'ok'}
          cifra={n(cat?.total)}
          linea={!cat ? '' : `${cat.total ? Math.round((cat.con_ficha / cat.total) * 100) : 0} % con ficha · `
            + (cat.escaneando ? `escaneando ${cat.escaneando} ${cat.escaneando === 1 ? 'canal' : 'canales'}` : cat.releyendo ? 'releyendo' : 'al día')} />
        <Tarjeta titulo="Revisión" onClick={() => ir('revision')}
          estado={!rev ? 'nada' : rev.archivos ? 'aviso' : 'ok'}
          cifra={rev ? n(rev.archivos) : '…'}
          linea={rev ? `archivos por revisar, en ${n(rev.grupos)} títulos` : 'Calculando…'} />
        <Tarjeta titulo="Descargas" onClick={() => ir('descargas')}
          estado={!des ? 'nada' : 'ok'}
          cifra={n(des?.activas)}
          linea={des ? `en marcha · ${tamano(des.disco_libre)} libres` : ''} />
        <Tarjeta titulo="Peticiones" onClick={() => ir('peticiones')}
          estado={!pet ? 'nada' : pet.pausadas && pet.en_cola ? 'aviso' : 'ok'}
          cifra={n(pet?.en_cola)}
          linea={!pet ? '' : `en cola · ${pet.pausadas ? 'publicación en pausa' : pet.chat ? `salen en ${pet.chat}` : 'sin chat elegido'}`} />
        <Tarjeta titulo="Créditos" onClick={() => ir('creditos')}
          estado={!pas ? 'nada' : pas.estado === 'error' ? 'aviso' : 'ok'}
          cifra={pas?.total ? `${pctPasada} %` : '—'}
          linea={!cre ? '' : cre.activos === false ? 'desactivados' : `pasada ${pas?.lanzada ? 'en marcha' : pas?.estado === 'terminada' ? 'terminada' : 'parada'} · al ver ${cre.al_ver ? 'sí' : 'no'}`} />
        <Tarjeta titulo="Comprimidos" onClick={() => ir('canales')}
          estado={!com ? 'nada' : 'ok'}
          cifra={n(com?.ver)}
          linea={com ? `con «Ver» de ${n(com.revisados)} revisados` : ''} />
        <Tarjeta titulo="Usuarios" onClick={() => ir('usuarios')}
          estado={!usu ? 'nada' : 'ok'}
          cifra={n(usu?.activos)}
          linea={usu ? `activos de ${n(usu.total)}${usu.en_linea ? ` · ${n(usu.en_linea)} en línea` : ''}` : ''} />
      </div>
    </div>
  );
}

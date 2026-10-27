import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ESTADO_TEXTO, chatsTelegram, guardarAjustes, peticionesAdmin, probarPeticion, temasDe, vistaPrevia,
  type AjustesPeticiones, type ChatTelegram, type Peticion, type TemaForo,
} from '../../services/peticiones';

const CARD = 'bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl mb-6';
const BOTON = 'bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white px-4 py-2 rounded-xl font-medium text-sm transition-all';
const TIPO: Record<ChatTelegram['tipo'], string> = { canal: 'Canal', grupo: 'Grupo', bot: 'Bot', persona: 'Persona' };

function fecha(iso: string | null) {
  if (!iso) return '';
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Peticiones: a qué chat de Telegram van, con qué texto, y todo lo pedido.
 *
 * El mensaje sale de la cuenta de Telegram del servidor, así que el chat se
 * elige entre los de esa cuenta, y solo los que dejan escribir: en un canal
 * publican sus admins, y hay grupos que lo tienen cerrado. La lista tarda
 * unos segundos (se recorren todos los chats), por eso no se pide al entrar.
 */
export default function AdminPeticiones({ onToast }: { onToast: (m: string) => void }) {
  const [ajustes, setAjustes] = useState<AjustesPeticiones | null>(null);
  const [peticiones, setPeticiones] = useState<Peticion[]>([]);
  const [chats, setChats] = useState<ChatTelegram[] | null>(null);
  const [cargandoChats, setCargandoChats] = useState(false);
  const [filtro, setFiltro] = useState('');
  // Por defecto solo los canales del catálogo y sus grupos: es ahí donde se
  // pide, y la cuenta puede estar en cientos de chats.
  const [soloCatalogo, setSoloCatalogo] = useState(true);
  // El grupo elegido es un foro: falta decir en qué tema se escribe.
  const [foro, setForo] = useState<{ chat: ChatTelegram; temas: TemaForo[] | null } | null>(null);
  const [probando, setProbando] = useState(false);
  const [plantilla, setPlantilla] = useState('');
  const [previa, setPrevia] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cargar = useCallback(() => {
    peticionesAdmin().then(d => {
      setPeticiones(d.peticiones);
      setAjustes(d.ajustes);
      setPlantilla(p => p || d.ajustes.plantilla);
      setPrevia(p => p || d.ajustes.ejemplo);
    }).catch(e => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  // Vista previa con retardo: una por pausa, no una por tecla.
  useEffect(() => {
    if (!ajustes) return;
    if (espera.current) clearTimeout(espera.current);
    espera.current = setTimeout(() => { vistaPrevia(plantilla).then(setPrevia).catch(() => {}); }, 350);
    return () => { if (espera.current) clearTimeout(espera.current); };
  }, [plantilla, ajustes]);

  const verChats = async () => {
    setCargandoChats(true);
    setError('');
    try { setChats(await chatsTelegram()); } catch (e) { setError(e instanceof Error ? e.message : 'No se han podido leer los chats'); }
    setCargandoChats(false);
  };

  const guardarDestino = async (c: ChatTelegram, tema?: TemaForo) => {
    try {
      setAjustes(await guardarAjustes({
        chat_id: c.id, chat_nombre: c.nombre,
        tema_id: tema && !tema.general ? tema.id : null, tema_nombre: tema && !tema.general ? tema.titulo : '',
      }));
      setChats(null);
      setForo(null);
      onToast(`Las peticiones irán a «${c.nombre}${tema && !tema.general ? ` › ${tema.titulo}` : ''}»`);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido guardar'); }
  };

  const elegir = async (c: ChatTelegram) => {
    if (!c.foro) { await guardarDestino(c); return; }
    // Un grupo con temas: se elige el tema antes de guardar nada.
    setForo({ chat: c, temas: null });
    try { setForo({ chat: c, temas: await temasDe(c.id) }); }
    catch (e) { setForo(null); setError(e instanceof Error ? e.message : 'No se han podido leer los temas'); }
  };

  const probar = async () => {
    setProbando(true);
    setError('');
    try {
      await probarPeticion(plantilla);
      onToast('Enviada a tus Mensajes guardados de Telegram');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido mandar la prueba'); }
    setProbando(false);
  };

  const guardarPlantilla = async () => {
    setGuardando(true);
    setError('');
    try {
      const a = await guardarAjustes({ plantilla });
      setAjustes(a);
      setPlantilla(a.plantilla);
      onToast('Plantilla guardada');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido guardar'); }
    setGuardando(false);
  };

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return (chats || []).filter(c => (!soloCatalogo || c.del_catalogo)
      && (!f || c.nombre.toLowerCase().includes(f) || (c.usuario || '').toLowerCase().includes(f)));
  }, [chats, filtro, soloCatalogo]);

  if (!ajustes) return <p className="text-nf-dim text-sm">{error || 'Cargando…'}</p>;
  const cambiada = plantilla.trim() !== ajustes.plantilla.trim();

  return (
    <div>
      {error && <p className="mb-4 text-sm text-nf-red">{error}</p>}

      <div className={CARD}>
        <h2 className="text-white font-semibold mb-1">A dónde van</h2>
        <p className="text-nf-dim text-sm mb-4">
          El mensaje sale de la cuenta de Telegram del servidor. Cada cuenta puede pedir {ajustes.limite_dia} al día (tú, sin límite),
          y lo que ya está pedido no se vuelve a mandar.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            {ajustes.chat_id
              ? <>Chat: <span className="font-semibold text-white">{ajustes.chat_nombre || ajustes.chat_id}</span>
                  {ajustes.tema_nombre && <span className="text-white"> › {ajustes.tema_nombre}</span>}</>
              : <span className="text-nf-red">Sin elegir: nadie puede pedir todavía</span>}
          </p>
          <button onClick={verChats} disabled={cargandoChats} className={BOTON}>
            {cargandoChats ? 'Leyendo los chats…' : ajustes.chat_id ? 'Cambiar' : 'Elegir chat'}
          </button>
        </div>

        {foro && (
          <div className="mt-5">
            <p className="mb-2 text-sm text-nf-dim">
              «{foro.chat.nombre}» tiene temas: elige en cuál se escriben las peticiones.
              <button onClick={() => setForo(null)} className="ml-3 text-nf-dim hover:text-white">Volver</button>
            </p>
            {foro.temas === null && <p className="text-sm text-nf-faint">Leyendo los temas…</p>}
            <ul className="max-h-[420px] overflow-y-auto divide-y divide-white/5 rounded-xl border border-white/10">
              {foro.temas?.map(t => (
                <li key={t.id}>
                  <button onClick={() => guardarDestino(foro.chat, t)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/5 ${t.id === ajustes.tema_id ? 'bg-white/10' : ''}`}>
                    <span className="min-w-0 flex-1 truncate text-white">{t.titulo}</span>
                    {t.general && <span className="shrink-0 text-xs text-nf-faint">el general</span>}
                    {t.cerrado && <span className="shrink-0 text-xs text-nf-faint">cerrado: solo escriben los admins</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {chats && !foro && (
          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar un chat"
                className="min-w-[220px] flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-white/25" />
              <label className="flex items-center gap-2 text-sm text-nf-dim">
                <input type="checkbox" checked={soloCatalogo} onChange={e => setSoloCatalogo(e.target.checked)} />
                Solo los del catálogo
              </label>
            </div>
            <ul className="max-h-[420px] overflow-y-auto divide-y divide-white/5 rounded-xl border border-white/10">
              {visibles.map(c => (
                <li key={c.id}>
                  <button disabled={!c.puede_escribir} onClick={() => elegir(c)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm ${c.puede_escribir ? 'hover:bg-white/5' : 'opacity-40 cursor-not-allowed'} ${c.id === ajustes.chat_id ? 'bg-white/10' : ''}`}>
                    <span className="min-w-0 flex-1 truncate text-white">{c.nombre}{c.usuario ? <span className="text-nf-faint"> · @{c.usuario}</span> : null}</span>
                    {c.grupo_de
                      ? <span className="shrink-0 rounded bg-nf-red/20 px-2 py-0.5 text-xs text-nf-red">grupo de {c.grupo_de}</span>
                      : c.del_catalogo && <span className="shrink-0 rounded bg-nf-red/20 px-2 py-0.5 text-xs text-nf-red">canal del catálogo</span>}
                    {c.foro && <span className="shrink-0 text-xs text-nf-faint">con temas</span>}
                    <span className="shrink-0 text-xs text-nf-faint">{TIPO[c.tipo]}</span>
                    {!c.puede_escribir && <span className="shrink-0 text-xs text-nf-faint">no deja escribir</span>}
                  </button>
                </li>
              ))}
              {!visibles.length && <li className="px-4 py-3 text-sm text-nf-faint">
                {soloCatalogo ? 'Ningún chat del catálogo con ese nombre. Quita «Solo los del catálogo» para ver todos.' : 'Ningún chat con ese nombre.'}
              </li>}
            </ul>
          </div>
        )}
      </div>

      <div className={CARD}>
        <h2 className="text-white font-semibold mb-1">El mensaje</h2>
        <p className="text-nf-dim text-sm mb-3">
          Cada grupo tiene su formato. Los huecos entre llaves se rellenan con los datos del título:
        </p>
        <ul className="mb-4 grid gap-1 sm:grid-cols-2">
          {Object.entries(ajustes.huecos).map(([h, que]) => (
            <li key={h} className="text-xs text-nf-dim">
              <button onClick={() => setPlantilla(p => `${p}{${h}}`)} className="font-mono text-white hover:underline">{`{${h}}`}</button> · {que}
            </li>
          ))}
        </ul>
        <textarea value={plantilla} onChange={e => setPlantilla(e.target.value)} rows={4}
          className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono outline-none focus:border-white/25" />
        <p className="mt-4 mb-1 text-xs uppercase tracking-wide text-nf-faint">Así se verá</p>
        <pre className="whitespace-pre-wrap rounded-xl bg-black/30 border border-white/10 px-4 py-3 text-sm text-white font-sans">{previa}</pre>
        <div className="mt-4 flex gap-3">
          <button onClick={guardarPlantilla} disabled={!cambiada || guardando} className={BOTON}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          <button onClick={() => setPlantilla(ajustes.plantilla_por_defecto)} className="text-nf-dim hover:text-white text-sm">Restaurar la de por defecto</button>
          {/* Lo mismo que saldría en el grupo, carátula incluida, pero a los
              Mensajes guardados: se ve cómo queda sin escribir a nadie. */}
          <button onClick={probar} disabled={probando} className="ml-auto text-nf-dim hover:text-white text-sm disabled:opacity-40">
            {probando ? 'Enviando…' : 'Enviarme una prueba'}
          </button>
        </div>
      </div>

      <div className={CARD}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-white font-semibold">Pedidas</h2>
          <button onClick={cargar} className="text-nf-dim hover:text-white text-sm">Recargar</button>
        </div>
        {!peticiones.length && <p className="text-nf-faint text-sm">Nadie ha pedido nada todavía.</p>}
        <ul className="space-y-3">
          {peticiones.map(p => (
            <li key={p.id} className="flex gap-3">
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-white/5">
                {p.poster && <img src={p.poster} alt="" loading="lazy" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate text-white">
                  {p.titulo}{p.year ? ` (${p.year})` : ''}
                  <span className="text-nf-faint"> · {p.media_type === 'series' ? 'Serie' : 'Película'}</span>
                </p>
                <p className={p.estado === 'conseguida' ? 'text-green-400' : p.estado === 'fallida' ? 'text-nf-red' : 'text-nf-dim'}>
                  {ESTADO_TEXTO[p.estado]}
                  {p.estado === 'conseguida' ? ` · ${fecha(p.conseguida_en)}` : ` · ${fecha(p.creada_en)}`}
                  {p.usuarios?.length ? ` · ${p.usuarios.join(', ')}` : ''}
                </p>
                {p.estado === 'fallida' && p.error && <p className="text-xs text-nf-faint">{p.error}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

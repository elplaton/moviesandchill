import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ESTADO_TEXTO, chatsTelegram, cuandoSale, duracionAprox, enviarYa, guardarAjustes, moverEnCola, peticionesAdmin,
  probarPeticion, quitarDeCola, segundosHastaPuesto, temasDe, vistaPrevia, volverACola,
  type AjustesPeticiones, type ChatTelegram, type ColaAdmin, type Peticion, type TemaForo,
} from '../../services/peticiones';

const CARD = 'bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl mb-6';
const BOTON = 'bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white px-4 py-2 rounded-xl font-medium text-sm transition-all';
const MINI = 'bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded-lg text-xs font-medium transition-all';
const TIPO: Record<ChatTelegram['tipo'], string> = { canal: 'Canal', grupo: 'Grupo', bot: 'Bot', persona: 'Persona' };

/** «cada hora» o «cada 30 min»: el ritmo lo pone el servidor, no se da por hecho. */
function cada(min: number) {
  return min === 60 ? 'cada hora' : min % 60 === 0 ? `cada ${min / 60} horas` : `cada ${min} min`;
}

function fecha(iso: string | null | undefined) {
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
  const [cola, setCola] = useState<ColaAdmin | null>(null);
  // Qué acción está en vuelo («12:arriba»). Mientras hay una, todos los
  // botones de la cola se apagan, no solo el pulsado: mover dos a la vez
  // cambia los puestos por debajo de la otra y el orden acaba sin sentido.
  const [accion, setAccion] = useState<string | null>(null);
  const [pausando, setPausando] = useState(false);
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
      setCola(d.cola);
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

  const alternarPausa = async () => {
    if (!cola) return;
    setPausando(true);
    setError('');
    try {
      const a = await guardarAjustes({ pausadas: !cola.pausadas });
      setAjustes(a);
      cargar();
      onToast(cola.pausadas ? 'Publicación reanudada' : 'Publicación en pausa');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido cambiar'); }
    setPausando(false);
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

  /** Una acción sobre una petición: con su botón apagado mientras va, el
   *  error en la cabecera y la lista recargada al acabar (bien o mal: tras un
   *  fallo el servidor puede haberla movido igualmente). */
  const hacer = async (p: Peticion, que: string, fn: () => Promise<string | void>) => {
    if (accion) return;
    setAccion(`${p.id}:${que}`);
    setError('');
    try {
      const aviso = await fn();
      if (aviso) onToast(aviso);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido hacer'); }
    try {
      const d = await peticionesAdmin();
      setPeticiones(d.peticiones);
      setCola(d.cola);
    } catch { /* se queda la lista de antes; «Recargar» lo reintenta */ }
    setAccion(null);
  };

  const mandarYa = (p: Peticion) => hacer(p, 'enviar', async () => {
    const r = await enviarYa(p.id);
    return r.estado === 'fallida'
      ? `«${p.titulo}» no ha salido${r.error ? `: ${r.error}` : ''}`
      : `«${p.titulo}» enviada a Telegram`;
  });

  // Las en cola, en su orden; el resto va en «Pedidas». El servidor ya las
  // manda primero y ordenadas, pero se ordena aquí por si acaso: el puesto es
  // lo que se enseña y tiene que cuadrar con la posición en la lista.
  const enCola = useMemo(() => peticiones.filter(p => p.estado === 'en_cola')
    .sort((a, b) => (a.puesto ?? Infinity) - (b.puesto ?? Infinity)), [peticiones]);
  const pedidas = useMemo(() => peticiones.filter(p => p.estado !== 'en_cola'), [peticiones]);

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

      {cola && (
        <div className={CARD}>
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="text-white font-semibold">Cola</h2>
            {/* Pausar no cierra las peticiones: se sigue pidiendo y la cola se
                llena, pero no sale nada a Telegram hasta reanudar. */}
            <button onClick={alternarPausa} disabled={pausando}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all disabled:opacity-40 ${
                cola.pausadas ? 'bg-nf-ok/20 text-nf-ok hover:bg-nf-ok/30' : 'bg-white/10 text-white hover:bg-white/20'}`}>
              {pausando ? 'Guardando…' : cola.pausadas ? 'Reanudar publicación' : 'Pausar publicación'}
            </button>
          </div>
          {cola.pausadas ? (
            <p className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              Publicación en pausa: lo que se pide entra en la cola, pero no sale nada a Telegram hasta que la reanudes.
              «Enviar ya» sigue funcionando.
            </p>
          ) : (
            <p className="text-nf-dim text-sm mb-4">
              Sale una {cada(cola.minutos_entre_envios)}
              {enCola.length > 0 && <> · la siguiente {cuandoSale(cola.segundos_para_siguiente)}</>}.
              Así no se llena el grupo de mensajes nuestros.
            </p>
          )}
          {enCola.length >= cola.aviso_a_partir_de && (
            // A una por hora, una cola larga son horas de espera para el
            // último que pidió: mejor verlo aquí que enterarse por él.
            <p className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              La cola está creciendo: hay {enCola.length} esperando y la última saldría en unas{' '}
              {duracionAprox(segundosHastaPuesto(enCola.length, cola))}. Quita lo que no haga falta o manda alguna ya.
            </p>
          )}
          {!enCola.length && <p className="text-nf-faint text-sm">No hay nada esperando.</p>}
          <ul className="space-y-3">
            {enCola.map((p, i) => {
              const ocupada = (que: string) => accion === `${p.id}:${que}`;
              return (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="w-6 shrink-0 text-right text-sm font-semibold tabular-nums text-nf-dim">{p.puesto ?? i + 1}</span>
                  <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-white/5">
                    {p.poster && <img src={p.poster} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate text-white">
                      {p.titulo}{p.year ? ` (${p.year})` : ''}
                      <span className="text-nf-faint"> · {p.media_type === 'series' ? 'Serie' : 'Película'}</span>
                    </p>
                    <p className="truncate text-xs text-nf-dim">
                      {p.usuarios?.length ? p.usuarios.join(', ') : 'Nadie la espera ya'}
                      {` · sale en ~${duracionAprox(segundosHastaPuesto(p.puesto ?? i + 1, cola))}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <button aria-label="Subir un puesto" title="Subir un puesto" disabled={!!accion || i === 0}
                      onClick={() => hacer(p, 'arriba', () => moverEnCola(p.id, 'arriba'))} className={MINI}>↑</button>
                    <button aria-label="Bajar un puesto" title="Bajar un puesto" disabled={!!accion || i === enCola.length - 1}
                      onClick={() => hacer(p, 'abajo', () => moverEnCola(p.id, 'abajo'))} className={MINI}>↓</button>
                    <button disabled={!!accion || i === 0}
                      onClick={() => hacer(p, 'primera', () => moverEnCola(p.id, 'primera'))} className={MINI}>Primera</button>
                    <button disabled={!!accion} onClick={() => mandarYa(p)} className={MINI}>
                      {ocupada('enviar') ? 'Enviando…' : 'Enviar ya'}
                    </button>
                    <button disabled={!!accion}
                      onClick={() => hacer(p, 'quitar', async () => { await quitarDeCola(p.id); return `«${p.titulo}» fuera de la cola`; })}
                      className={MINI}>
                      {ocupada('quitar') ? 'Quitando…' : 'Quitar'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
        {!pedidas.length && <p className="text-nf-faint text-sm">
          {enCola.length ? 'Todavía no ha salido ninguna: están todas en la cola.' : 'Nadie ha pedido nada todavía.'}
        </p>}
        <ul className="space-y-3">
          {pedidas.map(p => (
            <li key={p.id} className="flex gap-3">
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-white/5">
                {p.poster && <img src={p.poster} alt="" loading="lazy" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate text-white">
                  {p.titulo}{p.year ? ` (${p.year})` : ''}
                  <span className="text-nf-faint"> · {p.media_type === 'series' ? 'Serie' : 'Película'}</span>
                </p>
                <p className={p.estado === 'conseguida' ? 'text-green-400' : p.estado === 'fallida' ? 'text-nf-red' : p.estado === 'descartada' ? 'text-nf-faint' : 'text-nf-dim'}>
                  {ESTADO_TEXTO[p.estado]}
                  {p.estado === 'conseguida' ? ` · ${fecha(p.conseguida_en)}`
                    : p.estado === 'fallida' && p.intento_en ? ` · ${fecha(p.intento_en)}` : ` · ${fecha(p.creada_en)}`}
                  {p.usuarios?.length ? ` · ${p.usuarios.join(', ')}` : ''}
                </p>
                {p.estado === 'fallida' && p.error && <p className="text-xs text-nf-faint">{p.error}</p>}
              </div>
              {/* Lo que no salió (o se quitó) puede volver: entra al final,
                  como si se pidiera ahora. */}
              {(p.estado === 'fallida' || p.estado === 'descartada') && (
                <button disabled={!!accion}
                  onClick={() => hacer(p, 'a-la-cola', async () => { await volverACola(p.id); return `«${p.titulo}» vuelve a la cola`; })}
                  className={`${MINI} self-center shrink-0`}>
                  {accion === `${p.id}:a-la-cola` ? 'Encolando…' : 'Volver a la cola'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

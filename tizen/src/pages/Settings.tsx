import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { FocusScope } from '../focus/react';
import { exitApp } from '../focus/keys';
import { apiFetch, getApiBase } from '../services/api';
import { useDownloadsCtx } from '../contexts/DownloadsContext';
import Screen from '../components/Screen';
import TvButton from '../components/TvButton';
import Dialog from '../components/Dialog';
import { IconLogout } from '../components/Icons';

/**
 * Ajustes minimos para la tele: quien eres, a que servidor hablas y como esta.
 * La configuracion de Telegram, canales y rutas se hace desde la web.
 */
export default function Settings() {
  const { username, isAdmin, logout } = useAuth();
  const { batches, total } = useDownloadsCtx();
  const [disk, setDisk] = useState('');
  const [confirm, setConfirm] = useState<'logout' | 'exit' | null>(null);

  useEffect(() => {
    apiFetch('/status').then((r) => r.json()).then((d) => setDisk(d.disk_free || '')).catch(() => {});
  }, []);

  const rows: [string, string][] = [
    ['Usuario', `${username || ''}${isAdmin ? ' · administrador' : ''}`],
    ['Servidor', getApiBase().replace(/\/api$/, '') || 'este equipo'],
    ['Espacio libre en el servidor', disk || '—'],
    ['Archivos en la biblioteca', String(total)],
    ['Descargas activas', String(batches.filter((b) => b.status === 'downloading').length)],
  ];

  return (
    <Screen heading="Ajustes" ready firstFocusId="settings-actions" scroll={false}>
      <div style={{ paddingLeft: 'var(--content-x)' }} className="w-[1100px] pt-4">
        <div className="rounded-xl bg-white/5 border border-white/10 divide-y divide-white/10 mb-10">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between h-[76px] px-7">
              <span className="text-body text-tv-text2">{k}</span>
              <span className="text-body font-semibold truncate max-w-[600px]">{v}</span>
            </div>
          ))}
        </div>
        <FocusScope id="settings-actions" index={0} orientation="horizontal" className="flex gap-4">
          <TvButton index={0} icon={<IconLogout />} onClick={() => setConfirm('logout')}>Cerrar sesión</TvButton>
          <TvButton index={1} onClick={() => setConfirm('exit')}>Salir de la app</TvButton>
        </FocusScope>
        <p className="mt-12 text-caption text-tv-text3 max-w-[820px] leading-relaxed">
          Los canales de Telegram, la clasificación del catálogo y la configuración del servidor se gestionan desde la versión web.
        </p>
      </div>
      {confirm === 'logout' && (
        <Dialog title="¿Cerrar sesión?" text="Tendrás que volver a escribir usuario y contraseña con el mando."
          onClose={() => setConfirm(null)}
          actions={[{ label: 'Cancelar', onSelect: () => setConfirm(null), primary: true }, { label: 'Cerrar sesión', onSelect: () => { setConfirm(null); logout(); } }]} />
      )}
      {confirm === 'exit' && (
        <Dialog title="¿Salir de Movies & Chill?" onClose={() => setConfirm(null)}
          actions={[{ label: 'Cancelar', onSelect: () => setConfirm(null), primary: true }, { label: 'Salir', onSelect: exitApp }]} />
      )}
    </Screen>
  );
}

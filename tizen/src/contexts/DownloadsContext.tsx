import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useDownloads } from '../hooks/useDownloads';
import { useLibrary } from '../hooks/useLibrary';
import { onProgress } from '../services/ws';
import { toast } from '../tv/toast';

type Downloads = ReturnType<typeof useDownloads> & ReturnType<typeof useLibrary>;

const Ctx = createContext<Downloads | null>(null);

/**
 * Un solo estado de descargas y de biblioteca para toda la app. Antes cada
 * pantalla montaba el suyo y se suscribia al WebSocket por su cuenta.
 */
export function DownloadsProvider({ children }: { children: ReactNode }) {
  const downloads = useDownloads();
  const library = useLibrary();
  const { recargar } = library;

  useEffect(() => {
    downloads.loadStatus();
    downloads.loadPaused();
    // Al terminar una descarga hay un archivo nuevo en disco: se recarga el
    // indice para que la ficha ofrezca "Reproducir" sin reiniciar la app.
    return onProgress((data: any) => {
      if (data?.type === 'batch_status') {
        if (data.status === 'done') { recargar(); toast(`Descarga completada: ${data.folder_name || ''}`, 'ok'); }
        if (data.status === 'error') toast(`Error en la descarga: ${data.folder_name || ''}`, 'error', 5000);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={{ ...downloads, ...library }}>{children}</Ctx.Provider>;
}

export function useDownloadsCtx(): Downloads {
  const v = useContext(Ctx);
  if (!v) throw new Error('DownloadsProvider ausente');
  return v;
}

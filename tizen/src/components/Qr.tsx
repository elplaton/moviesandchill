import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * Un QR dibujado como SVG, con un solo trazo.
 *
 * SVG y no canvas: escala sin emborronarse cuando `main.tsx` encoge el lienzo
 * de 1920 (en el Fire TV va a la mitad) y pinta igual en Chromium 68 y en el
 * WebKit de la PS4. Negro sobre blanco y con margen blanco alrededor, que es
 * lo que necesita la camara del movil para encontrarlo: un QR claro sobre el
 * fondo oscuro de la app no lo lee ningun telefono.
 */
export default function Qr({ texto, lado }: { texto: string; lado: number }) {
  const { n, d } = useMemo(() => {
    // Nivel M: aguanta algo de reflejo en la pantalla sin hacer el QR enorme.
    const qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let fila = 0; fila < n; fila++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(fila, col)) d += `M${col} ${fila}h1v1h-1z`;
      }
    }
    return { n, d };
  }, [texto]);

  const margen = 4;
  return (
    <svg width={lado} height={lado} viewBox={`${-margen} ${-margen} ${n + margen * 2} ${n + margen * 2}`}
      shapeRendering="crispEdges" className="block rounded-xl">
      <rect x={-margen} y={-margen} width={n + margen * 2} height={n + margen * 2} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

# Logotipo

El logotipo de Movies&Chill no era un fichero: vive escrito como texto en la
interfaz (`TopBar.tsx`, `Login.tsx` y la pantalla de entrada de la tele). Estos
PNG son ese mismo texto rasterizado, con la misma tipografía, el mismo rojo y
el mismo interletrado, para cuando hace falta una imagen de verdad.

| Fichero | Para qué |
|---|---|
| `logo-oscuro-*.png` | Fondos oscuros. El `&` va en blanco, como en la app. |
| `logo-claro-*.png` | Fondos claros. El `&` va en `#141414`, porque en blanco no se vería. |

Tres tamaños de cada uno: 91, 180 y 359 px de alto (832, 1662 y 3322 de ancho).
Fondo transparente y recorte ajustado al trazo, sin margen: el espacio que
necesite alrededor lo pone quien lo coloque.

El icono cuadrado de la PWA y de la tele es otra cosa y tiene su propio diseño
a dos líneas («MOVIES» en blanco sobre «AND CHILL» en rojo). Vive en
`mobile/public/icons/` y `tizen/icons/`, y no se toca desde aquí.

## Cómo se generaron

Rasterizando el mismo HTML y CSS que usa la interfaz, con Chrome en modo sin
ventana, y recortando después lo transparente. Así el PNG no es una versión
*parecida* al logo: es el logo.

- Tipografía: `Helvetica Neue` → `Helvetica` → `Arial`, peso 700
- Interletrado: `-0.05em` (el `tracking-tighter` de Tailwind)
- Rojo de marca: `#E50914` (`nf-red` en `frontend/tailwind.config.js`)

Si cambia la tipografía o el color en `tailwind.config.js`, estos ficheros
dejan de cuadrar y hay que volver a generarlos.

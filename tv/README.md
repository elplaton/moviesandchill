# La app de TV, servida desde el servidor

Aquí no hay código: es la carpeta donde cae el build de `tizen/src` que **sirve
nginx** en `/tv/`, igual que `ps4/` para la PlayStation.

## Para qué

Las apps de televisión se instalan a mano (un `.wgt` por Tizen Studio, un
`.ipk` con `ares-install`, un `.apk` por `adb`), y cada arreglo obligaba a
levantarse del sofá. Con la interfaz servida desde casa, el paquete instalado
pasa a ser **solo el arranque**: comprueba si el servidor tiene la app y la
carga desde ahí, así que al abrir la tele ya tienes la última versión. El
paquete solo hay que volver a instalarlo si cambia la parte nativa, que casi
nunca cambia.

Es lo mismo que se hizo con la PS4 por obligación (Sony no deja instalar nada),
aquí por comodidad.

## Cómo encaja

```
tizen/src  ──┬─ modo tv      → tv/dist     → nginx /tv/    ← las teles lo cargan de aquí
             ├─ modo ps4     → ps4/dist    → nginx /ps4/   (WebKit de la consola)
             ├─ modo tizen   → tizen/dist  → MoviesChill.wgt   \
             ├─ modo webos   → webos/dist  → MoviesChill.ipk    } solo el arranque
             └─ modo firetv  → firetv      → MoviesChill.apk   /
```

El build de `/tv/` es el único **sin `VITE_API_BASE`**: se sirve del mismo
nginx que la API, así que las peticiones van a `/api` relativo y son del mismo
origen. Los paquetes instalados sí llevan la dirección del servidor dentro
(`tizen/.env.*`), porque desde `file://` no hay origen al que ser relativo.

## Qué pasa si el servidor no contesta

Se carga la copia que viene dentro del paquete. Puede estar vieja, pero una
interfaz vieja que funciona es mejor que una pantalla en negro.

## Una nota sobre la sesión

Al pasar de la copia empaquetada a la servida **cambia el origen**
(`file://` o `appassets.androidplatform.net` → `http://<servidor>`), y la
sesión se guarda por origen: hay que entrar una vez más. Solo la primera.

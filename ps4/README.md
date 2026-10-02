# Movies & Chill — App para PlayStation 4

Es **la misma app que `../tizen`**: mismo código, mismas pantallas, mismos carriles. Aquí no hay empaquetado porque en una PlayStation no se puede instalar nada: Sony solo admite aplicaciones de socios con *dev kit* aprobado, y no existe ni *sideload* ni modo desarrollador en una consola de tienda. La única puerta que queda abierta es el navegador, así que la app se **sirve por web** y la consola la abre como una página.

Lo que vive en esta carpeta es la documentación y `build.sh`. El paquete lo genera `tizen/` en modo `ps4` y lo publica el nginx del frontend en `/ps4/`.

## Abrirla en la consola

1. En el PS4, abre **Navegador de Internet** (el icono «WWW» de la biblioteca).
2. Escribe la dirección del servidor, la de siempre: `http://192.168.1.44`. El redirector de la web manda la consola a `/ps4/` sola, igual que manda los teléfonos a `/m/`.
3. Guárdala en favoritos (botón △ → Favoritos). Es la única vez que hay que escribir algo con el teclado en pantalla.

Para forzar la web de escritorio en la consola: `http://192.168.1.44/?desktop=1`.

## Cómo se maneja

El navegador del PS4 **no expone la Gamepad API**: el mando mueve un cursor y ✕ hace clic, pero ni las flechas ni el botón Atrás llegan a la página como teclas. Por eso toda la app es clicable (ya lo era por el Magic Remote de LG) y en el reproductor y la ficha se dibujan en pantalla los botones que en una tele están en el mando:

| En la tele | En la consola |
|---|---|
| Flechas mueven el foco | El cursor enfoca al pasar por encima |
| OK | ✕ (clic) |
| Atrás | Botón **Volver** en pantalla |
| ⏯ y saltos del mando | Clic en el vídeo, botones **−30 s / +30 s**, y la barra de progreso se puede pulsar |
| ▲ idioma y subtítulos | Botón **Idioma y subtítulos** |

Si se conecta un **teclado USB** a la consola, las flechas, Enter y Esc funcionan como en una tele: `focus/keys.ts` los recibe tal cual.

«Salir de la app» no aparece en Ajustes: una página no puede cerrar el navegador.

## Qué se puede reproducir

El navegador del PS4 decodifica **MP4 con H.264 de 8 bits en 4:2:0, hasta 1080p y 20 Mbps, con audio AAC**. No lleva HEVC, ni 10 bits, ni VP9, ni AV1.

Esto importa porque `make_compatible()` deja pasar el HEVC tal cual (a un iPhone le vale), así que parte de la biblioteca es correcta en todas partes menos aquí. Y el fallo es el de siempre: el vídeo **se oye pero no se ve**, sin ningún error. Para no repetir el diagnóstico a ciegas que costó cuatro intentos con AirPlay, el servidor lo dice de antemano (`video_apto_ps4()` en `services/tracks.py`) y el reproductor avisa antes de empezar, con la opción de intentarlo igualmente.

Para que uno de esos títulos se vea en la consola hay que reconvertirlo a H.264 de 8 bits.

## Compilar

```bash
./build.sh                       # genera ps4/dist
```

En producción no hace falta: `frontend/Dockerfile` compila el modo `ps4` dentro de la imagen y nginx lo sirve en `/ps4/`. Un `docker compose up -d --build frontend` lo deja publicado.

## Si algo va mal

- **Pantalla en blanco o en negro**: es sintaxis que ese WebKit no entiende. El modo `ps4` compila para `safari11` (el WebKit 605 de los firmwares que se ven hoy); en una consola con firmware muy antiguo baja a `safari10` en `tizen/vite.config.ts`. Si aun así no arranca, ese navegador no entiende `<script type="module">` y no hay arreglo barato.
- **Va a tirones o se recarga sola**: el navegador de la consola tiene poca memoria y la portada monta muchas carátulas. Se nota antes aquí que en cualquier tele.
- **No pruebes con `npm run dev`**: el servidor de desarrollo sirve el código sin transpilar (con `?.` y demás), así que puede fallar en la consola algo que en el paquete compilado funciona. Prueba siempre contra una compilación.

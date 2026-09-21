# tools

## make-icon.py

Genera los tiles de la app (`icons/icon-320.png` y `icons/icon-1920.png`) a
partir del wordmark, para no depender de un editor de imagenes.

Mantiene la identidad de la app: rojo `#E50914` sobre `#141414`, Helvetica Neue
Bold con tracking cerrado y la misma veladura roja del fondo del login. Se
dibuja a 4x y se reduce con LANCZOS para que los bordes queden limpios.

```sh
python3 -m venv /tmp/imgvenv && /tmp/imgvenv/bin/pip install Pillow
cd tizen && /tmp/imgvenv/bin/python tools/make-icon.py
```

Pillow solo hace falta para regenerar los iconos; no es dependencia de la app
ni del backend, por eso va en un entorno aparte.

## tv-debug.py

Consola remota de la app en la television. Tizen expone el mismo protocolo de
depuracion que Chrome, asi que se puede leer la consola y evaluar expresiones
sin abrir un navegador.

```sh
npm run tv:console                  # sigue la consola y los errores
npm run tv:focus                    # imprime el arbol de foco de la TV
../venv/bin/python tools/tv-debug.py --eval "location.href"
../venv/bin/python tools/tv-debug.py --attach   # sin relanzar la app
```

`__focus()` lo expone la propia app (`src/focus/react.tsx`) y devuelve el arbol
de foco, el elemento enfocado y una lista de problemas detectados: contenedores
sin hijos, nodos con un padre inexistente o varios elementos con la clase de
foco a la vez.

Usa `websockets`, que ya esta en el venv del backend, por eso se invoca con
`../venv/bin/python`.

## deploy.sh

En la raiz de `tizen/`. Compila, firma, instala y arranca en un solo comando:

```sh
npm run deploy                  # despliegue completo
npm run deploy:debug            # despliega y abre la consola remota
TV_IP=192.168.1.50 ./deploy.sh
./deploy.sh --no-launch
```

Distingue el caso de "la TV esta en reposo" (responde al ping pero tiene
cerrado el 26101) del de "IP equivocada", que es facil de confundir porque el
DHCP mueve las direcciones.

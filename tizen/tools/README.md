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

## debug-server.py

Consola remota de la app en la television.

**Por que no el inspector de Tizen:** esta TV lleva `secure_protocol:enabled`,
que bloquea `sdb shell`. Sin shell no se puede lanzar la app en modo depuracion,
y sin eso la television no abre ningun puerto de inspector (comprobados 7011,
9222, 9998 y 9999: cerrados). Asi que el canal va al reves: la app se conecta a
este servidor y le manda lo que pasa.

```sh
./deploy.sh --debug                 # despliega con el canal y abre la consola
./deploy.sh --debug --no-console    # despliega pero no arranca el servidor
npm run tv:console                  # consola en directo
npm run tv:focus                    # arbol de foco de la TV
../venv/bin/python tools/debug-server.py --eval "location.href"
```

`__focus()` lo expone la app (`src/focus/react.tsx`) y devuelve el arbol de
foco, el elemento enfocado y los problemas detectados: contenedores sin hijos,
nodos con padre inexistente o varios elementos con la clase de foco a la vez.

El canal **solo existe en compilaciones hechas con `--debug`**: define
`VITE_DEBUG_HOST`, y sin esa variable la condicion de `main.tsx` es
constante-falsa y Vite elimina el modulo entero, incluida la evaluacion de
expresiones. Comprobado sobre el paquete: cero ocurrencias en una compilacion
normal.

Usa `websockets`, que ya esta en el venv del backend, de ahi el
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

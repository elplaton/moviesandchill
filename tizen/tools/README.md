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

# Desplegar en Coolify

Usa `docker-compose.coolify.yml`, no `docker-compose.yml`. El de la raiz es
para casa: publica los puertos 80 y 8000 en el host y levanta su propio
PostgreSQL. En Coolify eso no vale — el 80 lo tiene el proxy de Coolify y la
base de datos ya existe.

## 1. Crear el recurso

Nuevo recurso → **Docker Compose** → este repositorio, rama `main`.
En *Docker Compose Location* pon `/docker-compose.coolify.yml`.

## 2. Red

Ajustes de la aplicacion → **Connect To Predefined Network: ON**.

Sin esto el contenedor vive en una red propia y el hostname interno del
PostgreSQL (`s7ydgwa0uz7peksfcamaercm`) no resuelve: el backend reintenta diez
veces, aborta el arranque y el contenedor se queda reiniciando.

## 3. Variables de entorno

| Variable | Valor |
|---|---|
| `TMD_API_ID` | el de https://my.telegram.org/apps |
| `TMD_API_HASH` | idem |
| `TMD_PHONE` | `+34...` |
| `TMD_JWT_SECRET` | 48+ caracteres aleatorios (`python -c "import secrets; print(secrets.token_urlsafe(48))"`) |
| `TMD_ADMIN_PASSWORD` | la que quieras para el usuario `admin` |
| `TMD_DATABASE_URL` | `postgres://postgres:...@s7ydgwa0uz7peksfcamaercm:5432/postgres` |
| `TMD_TMBD_API_KEY` | clave de TMDB (ojo: `TMBD`, la errata es intencionada) |
| `TMD_TMDB_ENABLED` | `true` |
| `TMD_CHANNELS` | JSON con los canales, p.ej. `[{"id": 2229558644, "name": "Las Cositas 3"}]` |

`TMD_JWT_SECRET` es obligatorio: si falta, mide menos de 16 caracteres o es uno
de los de ejemplo, el arranque aborta a proposito. Es la otra causa clasica del
bucle de reinicio.

Las tablas se crean solas en la base de datos que indiques. `TMD_CHANNELS` solo
se lee si la tabla `channels` esta vacia: en el primer arranque contra una BD
nueva siembra los canales y a partir de ahi manda la BD (y el panel de admin).
Ojo: una BD nueva significa reindexar el catalogo entero desde cero.

## 4. Sesion de Telegram

El contenedor no puede pedirte el codigo de Telegram por consola. Sube la
sesion que ya tienes en local al volumen `session`:

```bash
# En tu maquina
scp session/user.session usuario@servidor:/tmp/user.session

# En el servidor, con el contenedor ya arrancado
docker cp /tmp/user.session $(docker ps --filter name=backend --format '{{.Names}}' | head -1):/app/session/user.session
```

Luego reinicia el backend desde Coolify. Sin este fichero la aplicacion arranca
igual (veras `No se pudo conectar a Telegram` en los logs) pero no indexa ni
descarga nada.

## 5. Almacenamiento

Los volumenes `downloads` y `movies` son volumenes Docker gestionados por
Coolify. Si quieres que el material vaya a otro disco, cambia esas dos lineas
en `docker-compose.coolify.yml` por rutas del host:

```yaml
      - /mnt/media/downloads:/app/downloads
      - /mnt/media/movies:/app/movies
```

## Si sigue sin arrancar

- **Restarting**: mira los logs del *backend*. `TMD_JWT_SECRET` ausente y
  PostgreSQL inalcanzable son las dos unicas cosas que tumban el arranque a
  proposito; las dos lo dicen en claro en el log.
- **Health pendiente**: el healthcheck vive en el compose (`/health` en el
  backend, `/` en el frontend). Si Coolify tiene ademas su propio healthcheck
  activado en la pestaña *Health Checks*, desactivalo: usa `curl`, que no esta
  en ninguna de las dos imagenes.
- **502 en `/api/`**: el frontend arranca aunque el backend no este listo (es
  deliberado). Espera a que el backend pase a *healthy*.

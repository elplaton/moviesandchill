# Despliegue automático al hacer push

Coolify vive en el homelab, dentro de la VPN, y su puerto 8000 **no está
abierto a internet**. El webhook que la GitHub App de Coolify crea por su
cuenta apunta a `http://80.29.131.182:8000`, así que todas las entregas fallan
en silencio: por eso durante mucho tiempo todos los despliegues del historial
decían «Manual».

La solución no es abrir el puerto, es invertir la dirección: **el runner de
GitHub entra en la tailnet** y llama al despliegue por la IP privada. Nada
queda expuesto y el tráfico va cifrado por Tailscale.

```
push a main  →  runner de GitHub  →  (Tailscale)  →  100.97.138.49:8000  →  despliegue
```

## Lo que hay que configurar una vez

### 1. Habilitar la API de Coolify

**Viene desactivada de serie**, y sin esto no se puede ni crear un token.

En Coolify: **Settings → Advanced → API and MCP**.

- **API access**: `Enabled`
- **Allowed API IPs**: `100.64.0.0/10`

Ese rango es el CGNAT que usa Tailscale para toda la tailnet, así que la API
solo acepta peticiones que lleguen por la VPN. El runner de GitHub recibe una
IP de ese rango al unirse, de modo que entra; cualquier otra cosa no. Es una
segunda cerradura además de tener el puerto 8000 cerrado al exterior: si algún
día se abriera por error, la API seguiría sin estar accesible.

### 2. Token de la API de Coolify

En Coolify: **Keys & Tokens → API Tokens → Create Token**.

Permisos: hay que marcar **`Deploy` y `Read`**, los dos. Con `Deploy` a secas
la API responde `403 {"message":"You are not allowed to access the API."}`
aunque el token sea válido y se autentique (se ve en *Last used*): la guarda
general de Coolify exige `read` para cualquier petición. No hace falta `Root`
ni `Read sensitive data`.

*Expires in*: `Never`, o habrá que renovarlo.

Se enseña una sola vez; cópialo en el momento.

### 3. Cliente OAuth de Tailscale

**Primero el tag, después el cliente**: el desplegable de tags del cliente
OAuth solo ofrece tags que ya existan en las ACL, así que hay que declararlo
antes o no habrá nada que elegir.

En **Access controls** (https://login.tailscale.com/admin/acls/file):

```jsonc
{
  "tagOwners": {
    "tag:ci": ["autogroup:admin"],
  },
  "acls": [
    // El runner solo necesita el puerto de Coolify del homelab, nada más.
    {
      "action": "accept",
      "src":    ["tag:ci"],
      "dst":    ["100.97.138.49:8000"],
    },
  ],
}
```

Y después, en **Settings → OAuth clients → Generate**
(https://login.tailscale.com/admin/settings/oauth):

- Ámbito **`auth_keys`** con permiso de **escritura** (es el único que hace
  falta; el action genera una clave de un solo uso con él).
- Tag: **`tag:ci`**.

Al generarlo enseña el **Client ID** y el **Secret** una sola vez: ese par es
`TS_OAUTH_CLIENT_ID` y `TS_OAUTH_SECRET`.

Se usa OAuth y no una *auth key* normal porque las auth keys caducan a los 90
días como máximo y el despliegue dejaría de funcionar sin avisar, probablemente
en el peor momento.

### 4. Secretos en GitHub

En el repositorio: **Settings → Secrets and variables → Actions → New
repository secret**.

| Secreto | Valor |
|---|---|
| `TS_OAUTH_CLIENT_ID` | el ID del cliente OAuth de Tailscale |
| `TS_OAUTH_SECRET` | el secreto del cliente OAuth |
| `COOLIFY_URL` | `http://100.97.138.49:8000` (la IP de Tailscale, no la pública) |
| `COOLIFY_TOKEN` | el token de la API de Coolify |
| `COOLIFY_APP_UUID` | `yr9vmtzommhtoj42841xxoqy` |

La URL y el UUID no son secretos de verdad, pero van ahí para que no quede la
topología de la red escrita en un fichero público.

## Dos cosas que cuestan un intento cada una

**«Allowed API IPs» tiene que quedar vacío.** Se probó con `100.64.0.0/10`, el
rango de la tailnet, y Coolify sigue respondiendo
`403 You are not allowed to access the API` aunque el token sea válido y se
autentique. Y no hay alternativa: el runner recibe **una IP distinta en cada
ejecución**, así que una lista de IPs exactas no puede funcionar nunca aquí.
Vacío tampoco es un agujero: el puerto 8000 está cerrado a internet, así que
solo llegan la LAN y la tailnet, y sigue exigiendo token.

**El endpoint de despliegue es POST.** La pantalla de *Webhooks* de Coolify
muestra la URL como si fuera para abrirla en el navegador, pero con GET
responde `405 This endpoint has changed to a POST request`.

## Cómo se comporta

- **Solo `main`.** También se puede lanzar a mano desde la pestaña *Actions*
  (`workflow_dispatch`).
- **Espera a que el despliegue acabe** y falla si acaba mal. Sin eso el
  workflow saldría verde por haber *pedido* el despliegue aunque la
  compilación hubiera fallado, que es justo lo que no interesa saber tarde.
- **Dos commits seguidos**: `concurrency` los serializa; no se pisan.
- El webhook que Coolify tiene puesto en GitHub se puede dejar como está: sigue
  fallando, pero no molesta. Si algún día se abriera el puerto 8000, entonces
  sí convendría quitar uno de los dos para no desplegar dos veces.

## Si falla

- **`tailscale up` falla**: casi siempre es el `tag:ci` sin declarar en
  `tagOwners`, o el cliente OAuth sin el ámbito `auth_keys`.
- **403 en la API**: el token de Coolify no tiene permiso de despliegue.
- **Se queda esperando**: mira el despliegue en Coolify. Si ahí sale bien pero
  aquí no, es que la API devuelve un estado que el `case` del workflow no
  conoce todavía.

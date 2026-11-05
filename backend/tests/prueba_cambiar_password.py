"""La contraseña provisional: quien entra con la que le dio el admin solo puede
ver quien es y cambiarla; todo lo demas contesta 403 hasta que la cambia.

Sin base de datos: las cuentas viven en un diccionario.

    PYTHONPATH=backend venv/bin/python backend/tests/prueba_cambiar_password.py
"""
import asyncio
import os
import sys

os.environ["TMD_JWT_SECRET"] = "secreto-de-pruebas-bastante-largo"

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import dependencies, router, service
from app.database import users

fallos = []


def comprueba(nombre, esperado, obtenido):
    if esperado == obtenido:
        print(f"  ok  {nombre}")
    else:
        fallos.append(nombre)
        print(f"  MAL {nombre}: esperado {esperado!r}, obtenido {obtenido!r}")


cuentas = {}


async def get_user_by_username(nombre):
    return cuentas.get(nombre)


async def update_password_hash(nombre, h, must_change=None):
    cuentas[nombre]["password_hash"] = h
    if must_change is not None:
        cuentas[nombre]["must_change_password"] = must_change


users.get_user_by_username = get_user_by_username
users.update_password_hash = update_password_hash
service.get_user_by_username = get_user_by_username


def credenciales(token):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


async def codigo(coro):
    try:
        r = await coro
        return r
    except HTTPException as e:
        return e.status_code


async def main():
    cuentas["ana"] = {"username": "ana", "password_hash": service.hash_password("provisional"),
                      "active": True, "must_change_password": True}
    cuentas["luis"] = {"username": "luis", "password_hash": service.hash_password("suya"),
                       "active": True, "must_change_password": False}

    print("Entrar con la provisional")
    t = await router.login(router.LoginRequest(username="ana", password="provisional"))
    comprueba("el login lo dice", True, t.must_change_password)
    c = credenciales(t.access_token)
    comprueba("el resto de la API contesta 403", 403, await codigo(dependencies.get_current_user(credentials=c)))
    comprueba("tambien lo de admin", 403, await codigo(dependencies.get_current_admin(credentials=c)))
    comprueba("y la cuenta completa", 403, await codigo(dependencies.get_current_account(credentials=c)))
    comprueba("el video no se sirve con el token en la URL", 401,
              await codigo(dependencies.get_stream_user(path="x.mp4", token=t.access_token)))
    comprueba("ni el WebSocket", None, await dependencies.get_current_user_ws(None, token=t.access_token))
    comprueba("pero /me y /password si dejan pasar", "ana", await dependencies.get_user_pendiente(credentials=c))
    renovado = await router.refresh(router.RefreshRequest(refresh_token=t.refresh_token))
    comprueba("renovar el token no se la salta", True, renovado.must_change_password)

    print("Cambiarla")
    comprueba("no vale la misma", 400, await codigo(router.change_password(
        router.PasswordChangeRequest(new_password="provisional"), "ana")))
    comprueba("ni una demasiado corta", 400, await codigo(router.change_password(
        router.PasswordChangeRequest(new_password="abc"), "ana")))
    r = await router.change_password(router.PasswordChangeRequest(new_password="la-mia"), "ana")
    comprueba("sin pedir la actual (se acaba de escribir)", "ok", r["status"])
    comprueba("devuelve tokens que ya no llevan la marca", False, r["must_change_password"])
    comprueba("y con ellos se entra en todo", "ana",
              await dependencies.get_current_user(credentials=credenciales(r["access_token"])))
    comprueba("la marca queda quitada", False, cuentas["ana"]["must_change_password"])
    comprueba("la provisional ya no sirve", None, await service.authenticate("ana", "provisional"))
    comprueba("la nueva si", "ana", await service.authenticate("ana", "la-mia"))

    print("Una cuenta normal")
    t = await router.login(router.LoginRequest(username="luis", password="suya"))
    comprueba("no tiene que cambiar nada", False, t.must_change_password)
    comprueba("entra en todo", "luis", await dependencies.get_current_user(credentials=credenciales(t.access_token)))
    comprueba("y para cambiarla sigue pidiendo la actual", 400, await codigo(router.change_password(
        router.PasswordChangeRequest(current_password="mal", new_password="otra"), "luis")))
    r = await router.change_password(router.PasswordChangeRequest(current_password="suya", new_password="otra"), "luis")
    comprueba("con la actual bien, se cambia", "ok", r["status"])

    print("El admin restablece la de alguien con la sesion abierta")
    viejo = await router.login(router.LoginRequest(username="luis", password="otra"))
    cuentas["luis"]["password_hash"] = service.hash_password("nueva-del-admin")
    cuentas["luis"]["must_change_password"] = True
    renovado = await router.refresh(router.RefreshRequest(refresh_token=viejo.refresh_token))
    comprueba("al renovar el token pasa a tener que cambiarla", True, renovado.must_change_password)


asyncio.run(main())
print()
print(f"{len(fallos)} fallidas" if fallos else "todas correctas")
sys.exit(1 if fallos else 0)

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    # La contraseña es provisional: el access_token solo sirve para cambiarla.
    must_change_password: bool = False


class RefreshRequest(BaseModel):
    refresh_token: str

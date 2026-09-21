"""
Tile de la app para Samsung TV.

Mantiene la identidad que ya usa la app: rojo #E50914 sobre #141414, Helvetica
Neue Bold con tracking cerrado, igual que el wordmark del NavBar y del login.
Se dibuja a 4x y se reduce, que es la forma barata de tener antialiasing bueno.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

DARK = (20, 20, 20)
RED = (229, 9, 20)
WHITE = (255, 255, 255)
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
BOLD_INDEX = 1  # Helvetica Neue Bold dentro del .ttc

SS = 4  # supersampling


def load(size):
    return ImageFont.truetype(FONT, size, index=BOLD_INDEX)


def text_width(draw, text, font, tracking):
    w = sum(draw.textlength(ch, font=font) for ch in text)
    return w + tracking * (len(text) - 1)


def draw_tracked(draw, xy, text, font, fill, tracking):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking


def fit_font(draw, text, target_width, tracking_ratio):
    """Busca el cuerpo que hace que la linea ocupe exactamente el ancho dado."""
    lo, hi = 10, 4000
    while lo < hi:
        mid = (lo + hi + 1) // 2
        f = load(mid)
        if text_width(draw, text, f, -mid * tracking_ratio) <= target_width:
            lo = mid
        else:
            hi = mid - 1
    return load(lo), -lo * tracking_ratio


def render(width, height, path):
    W, H = width * SS, height * SS
    img = Image.new("RGB", (W, H), DARK)
    d = ImageDraw.Draw(img)

    # Veladura roja muy tenue, del mismo tono que el fondo del login. Va
    # desenfocada a lo bestia: sin el blur se ve el borde de la elipse y
    # parece un error de render, no una luz.
    glow = Image.new("RGB", (W, H), DARK)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-W * 0.30, -H * 0.70, W * 0.70, H * 0.85], fill=(58, 14, 18))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=W * 0.16))
    img = Image.blend(img, glow, 0.85)
    d = ImageDraw.Draw(img)

    target = W * 0.74            # ancho util del wordmark
    tracking_ratio = 0.055       # tracking cerrado, como tracking-tighter

    f_top, tr_top = fit_font(d, "MOVIES", target, tracking_ratio)
    f_bot, tr_bot = fit_font(d, "AND CHILL", target, tracking_ratio)

    asc_top = f_top.getbbox("M")[3] - f_top.getbbox("M")[1]
    asc_bot = f_bot.getbbox("A")[3] - f_bot.getbbox("A")[1]
    gap = asc_top * 0.16
    block = asc_top + gap + asc_bot
    y = (H - block) / 2

    w_top = text_width(d, "MOVIES", f_top, tr_top)
    w_bot = text_width(d, "AND CHILL", f_bot, tr_bot)

    y_top = y - f_top.getbbox("M")[1]
    draw_tracked(d, ((W - w_top) / 2, y_top), "MOVIES", f_top, WHITE, tr_top)

    y_bot = y + asc_top + gap - f_bot.getbbox("A")[1]
    draw_tracked(d, ((W - w_bot) / 2, y_bot), "AND CHILL", f_bot, RED, tr_bot)

    img = img.resize((width, height), Image.LANCZOS)
    img.save(path, "PNG", optimize=True)
    print(f"  {path} -> {width}x{height}")


render(320, 180, "icons/icon-320.png")
render(1920, 1080, "icons/icon-1920.png")

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_PNG = ROOT / "src-tauri" / "icons" / "icon.png"
OUT_ICO = ROOT / "src-tauri" / "icons" / "icon.ico"
PREVIEW = ROOT / "work" / "bighub-icon-preview.png"
SIZE = 1024


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size=size)


def rounded_gradient(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * 0.23)
    inset = int(size * 0.075)
    rect = (inset, inset, size - inset, size - inset)

    for y in range(size):
        t = y / (size - 1)
        r = int(15 + (29 - 15) * t)
        g = int(23 + (78 - 23) * t)
        b = int(42 + (216 - 42) * t)
        draw.line((0, y, size, y), fill=(r, g, b, 255))

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(rect, radius=radius, fill=255)
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg.alpha_composite(img, (0, 0))
    bg.putalpha(mask)

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (inset + 10, inset + 26, size - inset + 10, size - inset + 26),
        radius=radius,
        fill=(15, 23, 42, 70),
    )
    shadow.alpha_composite(bg)
    return shadow


def make_icon(size: int = SIZE) -> Image.Image:
    img = rounded_gradient(size)
    draw = ImageDraw.Draw(img)
    bold = font(r"C:\Windows\Fonts\seguibl.ttf", int(size * 0.52))
    semibold = font(r"C:\Windows\Fonts\seguisb.ttf", int(size * 0.145))

    draw.text((int(size * 0.215), int(size * 0.282)), "B", font=bold, fill=(248, 250, 252, 255))
    draw.text((int(size * 0.565), int(size * 0.512)), "hub", font=semibold, fill=(191, 219, 254, 255))

    cx = int(size * 0.782)
    cy = int(size * 0.25)
    rr = int(size * 0.073)
    draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=(34, 197, 94, 255))
    dot = int(size * 0.024)
    draw.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=(248, 250, 252, 160))
    return img


def main() -> None:
    icon = make_icon()
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUT_PNG)
    icon.resize((512, 512), Image.Resampling.LANCZOS).save(PREVIEW)
    icon.save(
        OUT_ICO,
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()

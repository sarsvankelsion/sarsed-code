import os
from PIL import Image, ImageDraw

def make_png(size, dark=True, with_bg=False):
    scale = 4
    w, h = size * scale, size * scale
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background rounded rect
    if with_bg:
        bg_color = (13, 17, 23, 255) if dark else (248, 249, 250, 255)
        r = int(70 * (w / 512))
        draw.rounded_rectangle([0, 0, w, h], radius=r, fill=bg_color)

    # Coordinates scaled to 512 base
    def S(x, y):
        return (x * w / 512, y * h / 512)

    # Outer shield
    shield_pts = [S(256, 45), S(440, 115), S(440, 275), S(256, 465), S(72, 275), S(72, 115)]
    shield_color = (255, 42, 85, 255) if dark else (220, 38, 38, 255)
    draw.polygon(shield_pts, fill=shield_color)

    # Inner shield
    inner_pts = [S(256, 75), S(412, 135), S(412, 265), S(256, 435), S(100, 265), S(100, 135)]
    inner_bg = (22, 27, 34, 255) if dark else (255, 255, 255, 255)
    draw.polygon(inner_pts, fill=inner_bg)

    # Clean geometric "S" shape
    # S upper loop
    draw.polygon([
        S(160, 160), S(352, 160), S(352, 220), S(235, 220),
        S(235, 250), S(352, 290), S(352, 355), S(160, 355),
        S(160, 295), S(277, 295), S(277, 265), S(160, 225)
    ], fill=(255, 255, 255, 255) if dark else (15, 23, 42, 255))

    # Red cyber accent
    accent_pts = [S(270, 160), S(352, 160), S(352, 220), S(270, 220)]
    accent_color = (255, 42, 85, 255) if dark else (220, 38, 38, 255)
    draw.polygon(accent_pts, fill=accent_color)

    accent_pts_bot = [S(160, 295), S(242, 295), S(242, 355), S(160, 355)]
    draw.polygon(accent_pts_bot, fill=accent_color)

    # Downsample with high quality Lanczos filter
    img = img.resize((size, size), Image.Resampling.LANCZOS)
    return img

icons_dir = "packages/kilo-vscode/assets/icons"
os.makedirs(icons_dir, exist_ok=True)

make_png(128, dark=True, with_bg=False).save(os.path.join(icons_dir, "kilo-dark.png"))
make_png(128, dark=False, with_bg=False).save(os.path.join(icons_dir, "kilo-light.png"))
make_png(128, dark=True, with_bg=True).save(os.path.join(icons_dir, "logo-outline-black.png"))
print("Done generating PNG icons")

"""Generate bot avatar + description picture for a Telegram bot.

Outputs:
  bot-pic.png         512x512  — upload as bot's profile picture (/setuserpic)
  description-pic.png 640x360  — upload as description picture (/setdescriptionpic)
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).parent

ORANGE = (255, 110, 20)
DARK   = (24, 28, 38)
WHITE  = (255, 255, 255)
SUB    = (200, 205, 215)


def _font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/seguibl.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def text_size(draw: ImageDraw.ImageDraw, text: str, font) -> tuple[int, int]:
    """Visual width/height using the anchor-aware bbox."""
    bbox = draw.textbbox((0, 0), text, font=font, anchor="lt")
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def make_bot_pic():
    """512x512 square avatar — orange field, white rounded card, big '$'."""
    s = 512
    img = Image.new("RGB", (s, s), ORANGE)
    draw = ImageDraw.Draw(img)

    # White rounded card centered
    card = 360
    cx0 = (s - card) // 2
    cy0 = (s - card) // 2
    draw.rounded_rectangle(
        [cx0, cy0, cx0 + card, cy0 + card],
        radius=80,
        fill=WHITE,
    )

    # Big "$" anchored at middle-middle of the canvas
    font = _font(280)
    draw.text((s / 2, s / 2), "$", font=font, fill=DARK, anchor="mm")

    img.save(OUT / "bot-pic.png", "PNG", optimize=True)
    print("wrote", OUT / "bot-pic.png")


def make_description_pic():
    """640x360 banner — dark field, orange '$' badge on left, white title/subtitle on right."""
    w, h = 640, 360
    img = Image.new("RGB", (w, h), DARK)
    draw = ImageDraw.Draw(img)

    # Slim orange accent at bottom
    draw.rectangle([(0, h - 4), (w, h)], fill=ORANGE)

    # Orange "$" badge on the left, vertically centered
    badge = 180
    badge_x = 40
    badge_y = (h - badge) // 2
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge, badge_y + badge],
        radius=42, fill=ORANGE,
    )
    # Centered "$" on the badge
    badge_cx = badge_x + badge / 2
    badge_cy = badge_y + badge / 2
    draw.text((badge_cx, badge_cy), "$", font=_font(135), fill=WHITE, anchor="mm")

    # Title + subtitle block, centered vertically, left-aligned to the right of the badge
    title = "Slickdeals Alerts"
    sub   = "Real-time deal notifications"
    text_x = badge_x + badge + 28
    text_avail_w = w - text_x - 24

    # Auto-fit title font size to available width
    title_size = 48
    while title_size > 18:
        f = _font(title_size)
        if text_size(draw, title, f)[0] <= text_avail_w:
            break
        title_size -= 2
    title_font = _font(title_size)
    sub_font   = _font(max(14, int(title_size * 0.46)))

    # Measure both lines
    tw, th = text_size(draw, title, title_font)
    sw, sh = text_size(draw, sub, sub_font)
    gap = 14
    block_h = th + gap + sh

    # Vertical center of canvas for the block's center
    block_cy = h / 2
    title_cy = block_cy - block_h / 2 + th / 2
    sub_cy   = block_cy + block_h / 2 - sh / 2

    draw.text((text_x, title_cy), title, font=title_font, fill=WHITE, anchor="lm")
    draw.text((text_x, sub_cy),   sub,   font=sub_font,   fill=SUB,   anchor="lm")

    img.save(OUT / "description-pic.png", "PNG", optimize=True)
    print("wrote", OUT / "description-pic.png")


if __name__ == "__main__":
    make_bot_pic()
    make_description_pic()

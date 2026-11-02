from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFont

W, H = 480, 270
SS = 2
BG = (255, 255, 255)
ORANGE = (240, 128, 40)
DARK = (60, 40, 30)
WHITE = (255, 255, 255)

OUT = Path(__file__).resolve().parents[1] / "app" / "static" / "img" / "foxly.gif"

WAG_FRAMES = 30
TEXT_FRAMES = 15
RUN_FRAMES = 35
HOLD_FRAMES = 20
FRAME_MS = 60
FINAL_MS = 1500

FOX_START_X = 310
FOX_BODY_Y = 130
RUN_DISTANCE = 300


def load_font(size):
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size * SS)
        except OSError:
            continue
    return ImageFont.load_default()


def p(x, y):
    return (x * SS, y * SS)


def ellipse(d, cx, cy, rx, ry, fill):
    d.ellipse([p(cx - rx, cy - ry), p(cx + rx, cy + ry)], fill=fill)


def circle(d, cx, cy, r, fill):
    ellipse(d, cx, cy, r, r, fill)


def thick_line(d, x1, y1, x2, y2, width, fill):
    d.line([p(x1, y1), p(x2, y2)], fill=fill, width=int(width * SS))
    circle(d, x1, y1, width / 2, fill)
    circle(d, x2, y2, width / 2, fill)


def tail_points(base_x, base_y, angle_deg, length):
    a1 = math.radians(angle_deg)
    a2 = math.radians(angle_deg + 25)
    mid = (base_x + length * 0.55 * math.cos(a1), base_y - length * 0.55 * math.sin(a1))
    tip = (mid[0] + length * 0.5 * math.cos(a2), mid[1] - length * 0.5 * math.sin(a2))
    return (base_x, base_y), mid, tip


def draw_fox(d, cx, cy, tail_angle, leg_phase, leg_amp):
    tail_base = (cx - 62, cy - 5)
    base, mid, tip = tail_points(tail_base[0], tail_base[1], tail_angle, 80)
    thick_line(d, base[0], base[1], mid[0], mid[1], 22, ORANGE)
    thick_line(d, mid[0], mid[1], tip[0], tip[1], 20, ORANGE)
    circle(d, tip[0], tip[1], 11, WHITE)

    for hip_x, phase in ((cx - 40, leg_phase), (cx - 22, leg_phase + math.pi),
                         (cx + 22, leg_phase + math.pi), (cx + 40, leg_phase)):
        foot_x = hip_x + leg_amp * math.sin(phase)
        thick_line(d, hip_x, cy + 30, foot_x, cy + 70, 12, DARK)

    ellipse(d, cx, cy, 70, 42, ORANGE)
    ellipse(d, cx + 30, cy + 12, 28, 22, WHITE)

    head_x, head_y = cx + 58, cy - 30
    circle(d, head_x, head_y, 32, ORANGE)
    d.polygon([p(cx + 44, cy - 50), p(cx + 50, cy - 88), p(cx + 68, cy - 58)], fill=ORANGE)
    d.polygon([p(cx + 60, cy - 56), p(cx + 72, cy - 90), p(cx + 82, cy - 52)], fill=ORANGE)
    d.polygon([p(cx + 50, cy - 56), p(cx + 54, cy - 78), p(cx + 63, cy - 60)], fill=DARK)
    d.polygon([p(cx + 64, cy - 58), p(cx + 72, cy - 80), p(cx + 78, cy - 56)], fill=DARK)

    ellipse(d, cx + 80, cy - 22, 18, 12, WHITE)
    circle(d, cx + 93, cy - 24, 5, DARK)
    circle(d, cx + 64, cy - 38, 4, DARK)


def make_frame(fox_x, tail_angle, leg_phase, leg_amp, text_alpha, text_x, font):
    img = Image.new("RGBA", (W * SS, H * SS), BG + (255,))
    d = ImageDraw.Draw(img)
    if fox_x is not None:
        draw_fox(d, fox_x, FOX_BODY_Y, tail_angle, leg_phase, leg_amp)
    if text_alpha > 0:
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.text(p(text_x, 60), "Foxly", font=font, fill=ORANGE + (text_alpha,), anchor="mm")
        img = Image.alpha_composite(img, layer)
    return img.convert("RGB").resize((W, H), Image.LANCZOS)


def build_frames():
    font = load_font(60)
    frames, durations = [], []
    text_x = 110

    for i in range(WAG_FRAMES):
        angle = 140 + 22 * math.sin(2 * math.pi * 3 * i / WAG_FRAMES)
        frames.append(make_frame(FOX_START_X, angle, 0, 0, 0, text_x, font))
        durations.append(FRAME_MS)

    for i in range(TEXT_FRAMES):
        t = (i + 1) / TEXT_FRAMES
        angle = 140 + 40 * math.sin(math.pi * t)
        alpha = int(255 * t)
        frames.append(make_frame(FOX_START_X, angle, 0, 0, alpha, text_x, font))
        durations.append(FRAME_MS)

    for i in range(RUN_FRAMES):
        t = (i + 1) / RUN_FRAMES
        fox_x = FOX_START_X + RUN_DISTANCE * t
        angle = 140 + 15 * math.sin(2 * math.pi * 2 * i / RUN_FRAMES)
        frames.append(make_frame(fox_x, angle, i * 1.2, 12, 255, text_x, font))
        durations.append(FRAME_MS)

    for _ in range(HOLD_FRAMES):
        frames.append(make_frame(None, 0, 0, 0, 255, text_x, font))
        durations.append(FRAME_MS)
    durations[-1] = FINAL_MS

    return frames, durations


def main():
    frames, durations = build_frames()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
    )
    print(f"Saved {OUT} ({len(frames)} frames)")


if __name__ == "__main__":
    main()

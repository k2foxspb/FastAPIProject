"""
Обработка медиафайлов (сжатие изображений и видео) перед сохранением в хранилище.

Вынесено из app/utils/storage.py без изменения логики - эта часть не зависит
от конкретной реализации хранилища (S3/локально) и может использоваться с
любым storage-драйвером.
"""
import io
import os
from typing import IO, Optional, Tuple

IMAGE_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"}
VIDEO_CONTENT_TYPES = {"video/mp4", "video/mpeg", "video/quicktime", "video/x-msvideo", "video/webm", "video/3gpp"}
VIDEO_MAX_HEIGHT = 720       # максимальная высота видео (px)
VIDEO_CRF = 28               # качество H.264 (18=лучше, 51=хуже)
IMAGE_MAX_SIZE = (1920, 1920)   # максимальное разрешение
IMAGE_QUALITY = 82              # качество JPEG/WebP (0-100)


def compress_image(fileobj: IO[bytes], content_type: Optional[str]) -> Tuple[IO[bytes], str]:
    """
    Сжимает изображение: уменьшает разрешение до IMAGE_MAX_SIZE и снижает качество.
    Возвращает (новый fileobj, итоговый content_type).
    Если файл не является изображением — возвращает оригинал без изменений.
    """
    ct = (content_type or "").lower()
    if ct not in IMAGE_CONTENT_TYPES:
        return fileobj, content_type or "application/octet-stream"

    try:
        from PIL import Image
        img = Image.open(fileobj)
        img = img.convert("RGB")
        img.thumbnail(IMAGE_MAX_SIZE, Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=IMAGE_QUALITY, optimize=True)
        buf.seek(0)
        return buf, "image/jpeg"
    except Exception:
        # если что-то пошло не так — возвращаем оригинал
        fileobj.seek(0)
        return fileobj, content_type or "application/octet-stream"


def compress_video(fileobj: IO[bytes], content_type: Optional[str], filename_hint: str = "video.mp4") -> Tuple[IO[bytes], str, str]:
    """
    Сжимает видео через ffmpeg: масштаб до VIDEO_MAX_HEIGHT, кодек H.264/AAC.
    Возвращает (новый fileobj, итоговый content_type, новое имя файла).
    Если ffmpeg недоступен или произошла ошибка — возвращает оригинал без изменений.
    """
    import shutil
    import tempfile
    import subprocess

    ct = (content_type or "").lower()
    if ct not in VIDEO_CONTENT_TYPES:
        return fileobj, content_type or "application/octet-stream", filename_hint

    if not shutil.which("ffmpeg"):
        return fileobj, content_type or "application/octet-stream", filename_hint

    tmp_in_path = None
    tmp_out_path = None
    try:
        suffix_in = os.path.splitext(filename_hint)[1] or ".mp4"
        with tempfile.NamedTemporaryFile(suffix=suffix_in, delete=False) as tmp_in:
            tmp_in.write(fileobj.read())
            tmp_in_path = tmp_in.name

        tmp_out_path = tmp_in_path + "_out.mp4"
        cmd = [
            "ffmpeg", "-y", "-i", tmp_in_path,
            "-vf", f"scale=-2:'min({VIDEO_MAX_HEIGHT},ih)'",
            "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", "fast",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            tmp_out_path
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode(errors="replace"))

        with open(tmp_out_path, "rb") as f:
            buf = io.BytesIO(f.read())
        buf.seek(0)

        new_name = os.path.splitext(filename_hint)[0] + ".mp4"
        return buf, "video/mp4", new_name
    except Exception:
        fileobj.seek(0)
        return fileobj, content_type or "application/octet-stream", filename_hint
    finally:
        for p in (tmp_in_path, tmp_out_path):
            try:
                if p and os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass

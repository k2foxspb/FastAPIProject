import io
import os
from typing import Tuple, Optional, IO
from datetime import datetime
from . import storage_s3

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


MEDIA_STORAGE = os.getenv("MEDIA_STORAGE", "local").lower()


def _timestamped_name(filename_hint: str) -> str:
    base = filename_hint.strip().replace(" ", "_") or "file"
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    return f"{ts}_{base}"


def build_key(category: str, filename_hint: str) -> str:
    name = _timestamped_name(filename_hint)
    category = (category or "misc").strip("/")
    return f"{category}/{name}"


def save_file(category: str, filename_hint: str, fileobj: IO[bytes], content_type: Optional[str] = None, private: bool = False) -> Tuple[str, str]:
    """
    Saves file and returns a tuple (url_or_path, key_or_path).
    - If MEDIA_STORAGE == 's3', uploads to S3 and returns (public_url_or_s3url, key)
    - Else saves under MEDIA_ROOT and returns ("/media/...", fs_path)
    Images are automatically compressed before saving.
    """
    fileobj, content_type = compress_image(fileobj, content_type)

    # Обновляем расширение имени файла для изображений, сохранённых как JPEG
    if content_type == "image/jpeg" and not filename_hint.lower().endswith((".jpg", ".jpeg")):
        filename_hint = os.path.splitext(filename_hint)[0] + ".jpg"

    # Сжимаем видео если применимо
    ct_check = (content_type or "").lower()
    if ct_check in VIDEO_CONTENT_TYPES:
        fileobj, content_type, filename_hint = compress_video(fileobj, content_type, filename_hint)

    if MEDIA_STORAGE == "s3":
        key = build_key(category, filename_hint)
        acl = "private" if private else None  # None -> default ACL from env
        url = storage_s3.upload_fileobj(fileobj, key, content_type, acl=acl)
        return url, key

    # local
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    media_root = os.getenv("MEDIA_ROOT", os.path.join(project_root, "media"))
    os.makedirs(os.path.join(media_root, category), exist_ok=True)
    name = _timestamped_name(filename_hint)
    fs_path = os.path.join(media_root, category, name)
    with open(fs_path, "wb") as out:
        out.write(fileobj.read())
    rel_url = f"/media/{category}/{name}"
    return rel_url, fs_path


def delete(category_or_key: str, key_or_path: str) -> None:
    if MEDIA_STORAGE == "s3":
        storage_s3.delete_object(key_or_path)
        return
    # local
    try:
        if os.path.exists(key_or_path):
            os.remove(key_or_path)
    except Exception:
        pass

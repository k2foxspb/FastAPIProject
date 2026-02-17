import os
from typing import Tuple, Optional, IO
from datetime import datetime
from . import storage_s3

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
    """
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

"""Определение кодировки текстовых банковских выписок."""


def decode_text(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1251", "cp866", "utf-16"):
        try:
            text = raw.decode(encoding)
            if text.strip():
                return text
        except UnicodeDecodeError:
            continue
    raise ValueError("Не удалось определить кодировку выписки")
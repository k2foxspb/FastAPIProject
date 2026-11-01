"""Определение кодировки текстовых банковских выписок."""


def decode_text(raw: bytes) -> str:
    if raw.startswith((b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff")):
        for encoding in ("utf-8-sig", "utf-16"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        pass

    candidates = []
    for encoding in ("cp1251", "cp866"):
        try:
            text = raw.decode(encoding)
            if text.strip():
                cyrillic = sum("а" <= char.lower() <= "я" or char.lower() == "ё" for char in text)
                box_drawing = sum(char in "╔═║╞╟╚╩╦╠╬" for char in text)
                candidates.append((cyrillic - box_drawing * 3, text))
        except UnicodeDecodeError:
            continue
    if candidates:
        return max(candidates, key=lambda candidate: candidate[0])[1]
    raise ValueError("Не удалось определить кодировку выписки")
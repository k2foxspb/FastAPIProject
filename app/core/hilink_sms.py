"""
Модуль для отправки SMS через Huawei HiLink-модем (например, E3372).

Модем подключается к серверу как сетевой интерфейс и предоставляет HTTP API
по адресу HILINK_BASE_URL (по умолчанию http://192.168.8.1). Отправка SMS
работает без логина в веб-интерфейс модема.

Рабочая схема:
    1. GET  {HILINK_BASE_URL}/api/webserver/SesTokInfo -> SessionID + __RequestVerificationToken
    2. POST {HILINK_BASE_URL}/api/sms/send-sms с заголовками Cookie/__RequestVerificationToken

Модуль не раскрывает код подтверждения в логах - в случае ошибки логируется
только номер телефона и причина сбоя.
"""

import re
import xml.etree.ElementTree as ElementTree
from xml.sax.saxutils import escape as xml_escape

import httpx
from loguru import logger

from app.core.config import HILINK_BASE_URL, HILINK_SMS_ENABLED, HILINK_SMS_TIMEOUT

SES_TOK_INFO_URL = f"{HILINK_BASE_URL}/api/webserver/SesTokInfo"
SEND_SMS_URL = f"{HILINK_BASE_URL}/api/sms/send-sms"


class HiLinkSmsError(Exception):
    """Ошибка взаимодействия с HiLink-модемом при отправке SMS."""


async def _get_session_and_token(client: httpx.AsyncClient) -> tuple[str, str]:
    """
    Получает SessionID и __RequestVerificationToken (TokInfo) у модема.
    """
    try:
        response = await client.get(SES_TOK_INFO_URL)
        response.raise_for_status()
    except httpx.HTTPError as e:
        raise HiLinkSmsError(f"Не удалось получить SessionID/Token у модема: {e}") from e

    try:
        root = ElementTree.fromstring(response.text)
    except ElementTree.ParseError as e:
        raise HiLinkSmsError(f"Некорректный XML-ответ модема (SesTokInfo): {e}") from e

    ses_info = root.findtext("SesInfo")
    tok_info = root.findtext("TokInfo")

    if not ses_info or not tok_info:
        raise HiLinkSmsError("Ответ модема не содержит SesInfo/TokInfo")

    # SesInfo имеет вид "SessionID=xxxxxxxx"
    session_id = ses_info.split("=", 1)[1] if "=" in ses_info else ses_info

    return session_id, tok_info


def _build_sms_payload(phone: str, text: str) -> str:
    """
    Формирует XML-тело запроса на отправку SMS с корректным экранированием
    номера телефона и текста сообщения, а также правильным подсчётом Length.
    """
    safe_phone = xml_escape(phone)
    safe_text = xml_escape(text)
    length = len(text)

    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<request>"
        "<Index>-1</Index>"
        "<Phones>"
        f"<Phone>{safe_phone}</Phone>"
        "</Phones>"
        "<Sca></Sca>"
        f"<Content>{safe_text}</Content>"
        f"<Length>{length}</Length>"
        "<Reserved>1</Reserved>"
        "<Date>-1</Date>"
        "</request>"
    )


def _parse_send_sms_response(response_text: str) -> None:
    """
    Разбирает ответ модема на отправку SMS.
    Бросает HiLinkSmsError, если ответ не является <response>OK</response>.
    """
    try:
        root = ElementTree.fromstring(response_text)
    except ElementTree.ParseError as e:
        raise HiLinkSmsError(f"Некорректный XML-ответ модема (send-sms): {e}") from e

    if root.tag == "response" and (root.text or "").strip().upper() == "OK":
        return

    if root.tag == "error":
        code = root.findtext("code") or "unknown"
        message = root.findtext("message") or ""
        raise HiLinkSmsError(f"Модем вернул ошибку отправки SMS: code={code} message={message}")

    raise HiLinkSmsError(f"Непредвиденный ответ модема на отправку SMS: {response_text!r}")


async def send_sms(phone: str, text: str) -> bool:
    """
    Отправляет SMS через Huawei HiLink-модем.

    Возвращает True, если модем подтвердил отправку (<response>OK</response>).
    Возвращает False, если отправка отключена через HILINK_SMS_ENABLED или
    произошла ошибка взаимодействия с модемом. Код подтверждения в логи не попадает.

    :param phone: номер телефона получателя, например "+79992346479"
    :param text: текст SMS-сообщения
    """
    if not HILINK_SMS_ENABLED:
        logger.warning("[HiLink] Отправка SMS отключена (HILINK_SMS_ENABLED=false)")
        return False

    # Для логов используем номер телефона с маскировкой последних цифр,
    # чтобы не раскрывать лишние данные, но и не терять контекст ошибки.
    masked_phone = re.sub(r"\d(?=\d{2})", "*", phone)

    try:
        async with httpx.AsyncClient(timeout=HILINK_SMS_TIMEOUT) as client:
            session_id, token = await _get_session_and_token(client)

            headers = {
                "Content-Type": "application/xml",
                "Cookie": f"SessionID={session_id}",
                "__RequestVerificationToken": token,
            }
            payload = _build_sms_payload(phone, text)

            response = await client.post(SEND_SMS_URL, content=payload, headers=headers)
            response.raise_for_status()

            _parse_send_sms_response(response.text)
    except HiLinkSmsError as e:
        logger.error(f"[HiLink] Ошибка отправки SMS на {masked_phone}: {e}")
        return False
    except httpx.TimeoutException:
        logger.error(f"[HiLink] Таймаут при отправке SMS на {masked_phone}")
        return False
    except httpx.HTTPError as e:
        logger.error(f"[HiLink] HTTP-ошибка при отправке SMS на {masked_phone}: {e}")
        return False
    except Exception as e:
        logger.error(f"[HiLink] Непредвиденная ошибка при отправке SMS на {masked_phone}: {e}")
        return False

    logger.info(f"[HiLink] SMS успешно отправлена на {masked_phone}")
    return True

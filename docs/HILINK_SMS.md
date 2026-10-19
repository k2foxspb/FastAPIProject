# SMS-регистрация и SMS-авторизация через Huawei HiLink-модем

Этот документ описывает, как настроен и используется SMS-провайдер на базе
Huawei E3372 HiLink для эндпоинтов `/users/request-phone-code` и
`/users/verify-phone-code`.

## Схема работы

1. Модем Huawei E3372 подключён к серверу как сетевой интерфейс
   (например, `enx0c5b8f279a64`) и получает адрес `192.168.8.100/24`,
   сам модем доступен по адресу `http://192.168.8.1`.
2. Вход по паролю в веб-интерфейсе модема отключён, поэтому отправка SMS
   работает без авторизации - достаточно получить `SessionID`/`Token`.
3. Модуль `app/core/hilink_sms.py` реализует функцию `send_sms(phone, text) -> bool`:
   - `GET /api/webserver/SesTokInfo` - получение `SessionID` и `__RequestVerificationToken`;
   - `POST /api/sms/send-sms` - отправка SMS с этими данными в заголовках;
   - XML запроса экранируется (`xml.sax.saxutils.escape`), `Length` считается
     по длине текста сообщения;
   - таймаут HTTP-запросов задаётся через `HILINK_SMS_TIMEOUT`;
   - успешный ответ модема `<response>OK</response>` обрабатывается, ошибка
     `<error><code>...</code></error>` логируется без раскрытия кода подтверждения.

## Настройки (`app/core/config.py` / `.env`)

| Переменная            | Назначение                                             | По умолчанию           |
|-----------------------|---------------------------------------------------------|-------------------------|
| `HILINK_SMS_ENABLED`  | Включить/выключить отправку SMS через HiLink            | `true`                  |
| `HILINK_BASE_URL`     | Базовый URL модема                                       | `http://192.168.8.1`    |
| `HILINK_SMS_TIMEOUT`  | Таймаут HTTP-запросов к модему (сек)                     | `10`                    |
| `SMS_FALLBACK_ENABLED`| Разрешить резервную отправку через SMS.RU/SMSC          | `false`                 |
| `SMS_RU_API_KEY`      | Ключ SMS.RU (используется только если fallback включён)  | -                       |
| `SMS_CENTER_LOGIN`    | Логин SMSC.ru (используется только если fallback включён)| -                       |
| `SMS_CENTER_PASSWORD` | Пароль SMSC.ru (используется только если fallback включён)| -                      |

HiLink является основным SMS-провайдером. SMS.RU/SMSC используются только как
резерв, если `SMS_FALLBACK_ENABLED=true` и отправка через модем завершилась
неудачей.

## Эндпоинты

### `POST /users/request-phone-code`

- принимает `phone_number`;
- нормализует номер (оставляет только цифры, `8...` -> `7...`);
- генерирует 4-значный код подтверждения и сохраняет его в Redis на 10 минут
  (ключ `phone_code:<номер>`);
- отправляет SMS вида `Kod podtverzhdeniya: 1234` через Huawei HiLink;
- **не возвращает код в ответе** и не логирует его в production
  (`ENVIRONMENT=production`);
- лимиты на номер:
  - не чаще 1 SMS в 60 секунд;
  - не более 5 SMS за 15 минут;
- если отправка через модем (и резерв, если включён) не удалась -
  возвращается `HTTP 502 Bad Gateway`;
- если превышен лимит частоты - `HTTP 429 Too Many Requests`.

### `POST /users/verify-phone-code`

- принимает `phone_number` и `code`;
- нормализует номер так же, как в `request-phone-code`;
- проверяет код в Redis, удаляет его после успешной проверки;
- ограничивает количество попыток ввода кода (5 попыток на один
  запрошенный код, после чего нужно запросить код заново - `HTTP 429`);
- если пользователь с таким номером уже существует - авторизует его,
  если нет - создаёт нового;
- возвращает `access_token` и `refresh_token`.

## Примеры curl

```bash
curl -X POST http://SERVER/users/request-phone-code \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+79992346479"}'

curl -X POST http://SERVER/users/verify-phone-code \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+79992346479","code":"1234"}'
```

## Автоматический подъём модема на сервере (systemd)

Чтобы модем Huawei E3372 автоматически поднимался как сетевой интерфейс
после перезагрузки сервера, рекомендуется настроить systemd-сервис
`hilink-up.service`, который поднимает интерфейс (например,
`enx0c5b8f279a64`) и ждёт готовности модема перед стартом приложения.

Пример `/etc/systemd/system/hilink-up.service`:

```ini
[Unit]
Description=Bring up Huawei HiLink modem network interface
After=network-pre.target
Before=network.target
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/sbin/ip link set enx0c5b8f279a64 up
ExecStart=/sbin/ip addr add 192.168.8.100/24 dev enx0c5b8f279a64
ExecStartPost=/bin/sleep 2

[Install]
WantedBy=multi-user.target
```

Активация сервиса:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hilink-up.service
```

Убедитесь, что приложение (или systemd unit самого FastAPI-сервиса) стартует
после `hilink-up.service` (директива `After=hilink-up.service` в его unit-файле),
чтобы модем был доступен на момент первого запроса на отправку SMS.

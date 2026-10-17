FROM python:3.12-slim

# устанавливаем переменные окружения
ENV HOME=/home/fast \
    APP_HOME=/home/fast/app \
    PYTHONPATH="$PYTHONPATH:/home/fast" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# создаем домашнюю директорию для пользователя(/home/fast) и директорию для проекта(/home/fast/app)
# создаем группу fast
# создаем отдельного пользователя fast
RUN mkdir -p $APP_HOME \
  && groupadd --system fast \
  && useradd --system --gid fast --home-dir $HOME --create-home fast

# устанавливаем рабочую директорию
WORKDIR $HOME

# копирование проекта FastAPI в рабочую директорию
COPY app app
COPY requirements.txt alembic.ini .env* firebase-service-account.json* ./

# обновление pip
# установка зависимостей из списка requirements.txt
# изменение владельца, для всех директорий и файлов проекта, на пользователя fast
RUN pip install --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt \
 && chown -R fast:fast .

# изменение рабочего пользователя на fast
USER fast
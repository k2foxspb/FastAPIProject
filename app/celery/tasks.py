import time
from celery import shared_task

from app.celery.celery_app import celery


@celery.task()
def call_background_task(message: str = 'нет сообщений'):
    time.sleep(10)
    print(f"Background Task called!")
    print(message)


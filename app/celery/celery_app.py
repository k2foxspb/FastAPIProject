from celery import Celery

celery = Celery(
    'app',
    broker='redis://127.0.0.1:6379/0',
    backend='redis://localhost:6379/1',
    broker_connection_retry_on_startup=True,
    include=['app.celery.tasks'],
)
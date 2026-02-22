FROM cr.yandex/mirror/nginx:1.25

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

RUN rm /etc/nginx/conf.d/default.conf
COPY fastapi_ecommerce.conf /etc/nginx/conf.d/
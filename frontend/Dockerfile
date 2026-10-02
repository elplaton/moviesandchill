# Se construye desde la raiz del repo (context: .) para incluir tambien la PWA
# de movil (/m/) y la app de TV compilada para el navegador de la PS4 (/ps4/),
# que se sirven desde el mismo nginx.
FROM node:20-alpine AS builder
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm install
COPY mobile/package.json mobile/package-lock.json* ./mobile/
RUN cd mobile && npm install
COPY tizen/package.json tizen/package-lock.json* ./tizen/
RUN cd tizen && npm install

COPY frontend ./frontend
COPY mobile ./mobile
COPY tizen ./tizen
RUN cd frontend && npm run build
RUN cd mobile && npm run build
# El mismo codigo de la app de TV, compilado para WebKit en vez de Chromium.
RUN cd tizen && npm run build:ps4


FROM nginx:alpine
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY --from=builder /app/mobile/dist /usr/share/nginx/html/m
COPY --from=builder /app/ps4/dist /usr/share/nginx/html/ps4
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

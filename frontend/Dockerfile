# Se construye desde la raiz del repo (context: .) para incluir tambien la PWA
# de movil (/m/), la app de television (/tv/, que es de donde la cargan las
# teles para actualizarse solas) y la misma compilada para el navegador de la
# PS4 (/ps4/). Todo se sirve desde el mismo nginx.
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
# La app de TV que cargan las teles (Samsung, LG, Fire TV) para actualizarse
# solas: el paquete instalado en cada una es solo el arranque.
RUN cd tizen && npm run build:tv
# El mismo codigo, compilado para WebKit en vez de Chromium, para la PS4.
RUN cd tizen && npm run build:ps4


FROM nginx:alpine
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY --from=builder /app/mobile/dist /usr/share/nginx/html/m
COPY --from=builder /app/tv/dist /usr/share/nginx/html/tv
COPY --from=builder /app/ps4/dist /usr/share/nginx/html/ps4
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

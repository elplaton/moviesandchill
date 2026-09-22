# Se construye desde la raiz del repo (context: .) para incluir tambien la PWA
# de movil, que se sirve bajo /m/ desde el mismo nginx.
FROM node:20-alpine AS builder
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm install
COPY mobile/package.json mobile/package-lock.json* ./mobile/
RUN cd mobile && npm install

COPY frontend ./frontend
COPY mobile ./mobile
RUN cd frontend && npm run build
RUN cd mobile && npm run build


FROM nginx:alpine
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY --from=builder /app/mobile/dist /usr/share/nginx/html/m
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

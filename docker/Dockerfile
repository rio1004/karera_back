FROM node:22-alpine3.22 AS builder

WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=3 CMD wget --spider -q http://127.0.0.1:8000/health || exit 1

CMD ["npm", "run", "serve"]

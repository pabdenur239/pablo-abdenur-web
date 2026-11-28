FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-spa
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3210
CMD ["node", "server.js"]

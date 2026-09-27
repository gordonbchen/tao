FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
EXPOSE 6283
CMD ["npm", "run", "dev"]

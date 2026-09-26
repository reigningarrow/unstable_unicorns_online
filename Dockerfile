FROM node:20-alpine

WORKDIR /app

# Install server deps
COPY server/package*.json ./server/
RUN cd server && npm install --production

# Install and build client
COPY client/package*.json ./client/
RUN cd client && npm install

COPY client/ ./client/
RUN cd client && npm run build

# Copy server source
COPY server/ ./server/


EXPOSE 3001
ENV PORT=3001
ENV NODE_ENV=production

CMD ["node", "server/index.js"]

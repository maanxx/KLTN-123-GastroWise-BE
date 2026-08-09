FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Cài đặt dependencies (chỉ production)
RUN npm ci --only=production

# Copy source code
COPY . .

EXPOSE 5000

CMD ["npm", "run", "start:prod"]
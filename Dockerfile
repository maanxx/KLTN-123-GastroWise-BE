FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Cài đặt dependencies 
RUN npm install

# Copy source code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
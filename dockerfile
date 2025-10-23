FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install Python and pip
RUN apk update && apk add --no-cache python3 py3-pip jq

RUN python3 -m venv /opt/venv \
  && . /opt/venv/bin/activate \
  && pip install --no-cache-dir instaloader

ENV PATH="/opt/venv/bin:$PATH"

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "main.js"]

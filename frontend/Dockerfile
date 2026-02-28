FROM node:22

WORKDIR /app

COPY package.json yarn.lock jsconfig.json index.html eslint.config.js ./
RUN yarn install --frozen-lockfile

#USER node
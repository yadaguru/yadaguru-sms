FROM node:4
RUN mkdir -p /usr/src/app
RUN useradd -s /bin/bash -d /usr/src/app yadaguru
RUN chown -R yadaguru /usr/src/app/
USER yadaguru
WORKDIR /usr/src/app
COPY package.json /usr/src/app/
RUN npm install
COPY . /usr/src/app

CMD ["npm", "start"]
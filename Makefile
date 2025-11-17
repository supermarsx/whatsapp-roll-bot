# Makefile for common tasks

.PHONY: build run start test lint format docker-build docker-up clean

build:
	npm run build

run: build
	node dist/bot.js

start: run

test:
	npm test

lint:
	npm run lint

format:
	npm run format

docker-build:
	docker build -t whatsapp-roll-bot:latest .

docker-up:
	docker-compose up -d

clean:
	rm -rf dist node_modules .cache

# Backend image: runs the API (default), the scraper worker, or the digest worker.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install uv for fast, reproducible installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml ./
COPY core ./core
COPY api ./api
COPY scraper ./scraper
COPY digest ./digest

RUN uv pip install --system -e .

EXPOSE 8000

# Default command runs the API. Override CMD for the worker services:
#   docker run ... nwf-scraper
#   docker run ... nwf-digest
CMD ["nwf-api"]

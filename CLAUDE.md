# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HeatSync is an application that converts swim meet heat sheets into calendar events. The goal is to eliminate the manual process of printing heat sheets, highlighting events, and manually adding them to calendars. Users can find their events and sync them directly to their calendar.

## Current State

This is a new project in early development. The repository currently contains:

- `openapi.json`: OpenAPI 3.1.0 specification for an AI Builder backend API (potential integration point)
- `spec/`: Directory for specifications (currently empty)

## API Integration

The `openapi.json` defines an AI Builder Space Backend with endpoints for:

- Chat completions (multi-model orchestrator with web search capabilities)
- Embeddings generation
- Audio transcription
- Web search (Tavily)
- Image generation/editing
- Deployment management

Authentication uses Bearer tokens. Base URL: `/backend`

## Code Style Guide

- Always use arrow function in TypeScript/JavaScript

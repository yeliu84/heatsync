# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HeatSync is an application that converts swim meet heat sheets into calendar events. The goal is to eliminate the manual process of printing heat sheets, highlighting events, and manually adding them to calendars. Users can find their events and sync them directly to their calendar.

**Production URL:** https://heatsync.ai-builders.space/

## Git Workflow

- **Never commit directly to main** - the app is running in production
- Always create a feature branch and open a PR for changes
- Branch naming: `feature/<description>` or `fix/<description>`

## Code Style Guide

- Always use arrow function in TypeScript/JavaScript

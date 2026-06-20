# ViMax Web Management Interface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web management interface for the ViMax AI short drama generation platform with 4-column layout, 5-step creation wizard, real-time generation monitoring, and AI-powered dialogue assistance.

**Architecture:** FastAPI backend wraps existing ViMax pipeline classes (Idea2VideoPipeline, Script2VideoPipeline, SessionIndex) and exposes REST + WebSocket APIs. React frontend with 4-column layout: collapsible system nav, pipeline progress panel, main workspace, and AI dialogue panel. Claude Agent SDK powers the AI assistant.

**Tech Stack:** FastAPI + uvicorn (Python), React + Vite + TypeScript + shadcn/ui + TailwindCSS (Frontend), WebSocket (real-time), Claude Agent SDK (AI dialogue)

## Global Constraints

- Python >= 3.12, Node.js >= 20
- All backend code in `/home/admin/ViMax/web/backend/`
- All frontend code in `/home/admin/ViMax/web/frontend/`
- Run backend from ViMax root: `uvicorn web.backend.main:app`
- Run frontend from `web/frontend/`: `npm run dev`
- Single user, no authentication
- Reuse existing ViMax modules via direct import, no subprocess
- Working directory: `.working_dir/<session_id>/`
- Session storage: `.vimax/sessions.json` (existing SessionIndex)

---

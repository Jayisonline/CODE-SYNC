# CodeSync - Collaborative Code Editor PRD

## Problem Statement
Build a collaborative code editor with audio features like Discord where users can join a voice channel and see live code editing. Include role-based authorization (Owner, Editor, Viewer) for controlling code edit permissions.

## Architecture
- **Frontend**: React 19 + Tailwind CSS + Shadcn/UI + CodeMirror 6 + WebRTC
- **Backend**: FastAPI + MongoDB (Motor async driver) + WebSocket
- **AI**: OpenAI GPT-5.2 via Emergent Integrations (EMERGENT_LLM_KEY)
- **Auth**: JWT-based (bcrypt + PyJWT)
- **Real-time**: WebSocket for code sync + WebRTC for P2P voice

## User Personas
1. **Room Owner**: Creates rooms, invites members, manages roles, full edit access
2. **Editor**: Can edit code in real-time, join voice channels
3. **Viewer**: Read-only access to code, can join voice channels

## Core Requirements
- [x] JWT Authentication (register/login)
- [x] Room CRUD with role-based access control
- [x] Real-time collaborative code editing via WebSocket
- [x] WebRTC peer-to-peer voice channels with speaking detection
- [x] Syntax highlighting (JavaScript, Python, HTML, CSS, JSON)
- [x] AI code suggestions (GPT-5.2)
- [x] Role management (Owner/Editor/Viewer)
- [x] Member invitation system
- [x] User presence indicators
- [x] Dark theme optimized for coding

## What's Been Implemented (March 12, 2026)
### Backend
- JWT auth system (register, login, me endpoints)
- Room CRUD with member management
- WebSocket for real-time code editing with role enforcement
- WebSocket for WebRTC voice signaling (offer/answer/ICE relay)
- AI code suggestion endpoint via Emergent Integrations GPT-5.2
- Role-based authorization on all endpoints

### Frontend
- Auth page (login/register with form validation)
- Dashboard with room cards (bento grid, create/delete rooms)
- Editor room with CodeMirror 6 (syntax highlighting, line numbers)
- Voice panel with WebRTC P2P audio, mute/unmute, speaking indicators
- User presence panel with online status and role badges
- Role management UI (invite, change role, remove member)
- AI assist button for code suggestions
- Language selector, copy code, collapsible panel
- Dark theme with glassmorphic design, Syne + Instrument Sans + JetBrains Mono fonts

## Testing Results
- Backend: 100% pass rate
- Frontend: 95% pass rate (dev-only console warnings)
- WebSocket Real-time Sync: 100% pass rate
- Overall: 98% success

## Bug Fixes (March 12, 2026 - Iteration 2)
### Root Cause: WebSocket Race Condition
- **Problem**: React StrictMode double-mount caused disconnect to remove the active 2nd connection
- **Fix**: Connection manager now tracks individual WebSocket instances with `conn_id`; only removes the specific connection that disconnected
### Root Cause: Code Sync Echo Loop
- **Problem**: `isRemoteUpdate` flag had timing issues with React's async state batching
- **Fix**: Replaced with `remoteCodeRef` comparison - only sends code if different from last remote update
### Root Cause: K8s Ingress 60s Timeout
- **Problem**: Kubernetes ingress terminated idle WebSocket connections after 60 seconds
- **Fix**: Client-side heartbeat every 15s + server-side ping every 20s keeps connections alive

## Prioritized Backlog
### P0 (Critical)
- All core features implemented

### P1 (Important)
- File/tab system for multi-file projects
- Code execution environment (run code)
- Chat/messaging within rooms
- Cursor presence (show other users' cursors in editor)

### P2 (Nice to Have)
- Room sharing via public links
- Code diff/version history
- Themes selector for code editor
- Mobile responsive editor view
- Export/import code files
- Notification system for invites

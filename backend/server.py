from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone
import bcrypt
import jwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'fallback_secret')
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ─── Models ──────────────────────────────────────────────
class UserRegister(BaseModel):
    email: str
    username: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class RoomCreate(BaseModel):
    name: str
    language: str = "javascript"

class RoleUpdate(BaseModel):
    user_id: str
    role: str

class AIRequest(BaseModel):
    code: str
    language: str
    prompt: str = ""

class InviteRequest(BaseModel):
    email: str
    role: str = "viewer"

# ─── Helpers ─────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: str, username: str, email: str) -> str:
    return jwt.encode({"user_id": user_id, "username": username, "email": email}, JWT_SECRET, algorithm="HS256")

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(token: str = Query(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Token required")
    return decode_token(token)

# ─── Auth Routes ─────────────────────────────────────────
@api_router.post("/auth/register")
async def register(data: UserRegister):
    existing = await db.users.find_one({"email": data.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": data.email,
        "username": data.username,
        "password_hash": hash_password(data.password),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    token = create_token(user_id, data.username, data.email)
    return {"token": token, "user": {"id": user_id, "email": data.email, "username": data.username}}

@api_router.post("/auth/login")
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"], user["username"], user["email"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "username": user["username"]}}

@api_router.get("/auth/me")
async def get_me(token: str = Query(...)):
    payload = decode_token(token)
    user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user["id"], "email": user["email"], "username": user["username"]}

# ─── Room Routes ─────────────────────────────────────────
@api_router.post("/rooms")
async def create_room(data: RoomCreate, token: str = Query(...)):
    payload = decode_token(token)
    room_id = str(uuid.uuid4())
    room_doc = {
        "id": room_id,
        "name": data.name,
        "language": data.language,
        "code": get_default_code(data.language),
        "owner_id": payload["user_id"],
        "members": [{
            "user_id": payload["user_id"],
            "username": payload["username"],
            "role": "owner"
        }],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    await db.rooms.insert_one(room_doc)
    room_doc.pop("_id", None)
    return room_doc

@api_router.get("/rooms")
async def list_rooms(token: str = Query(...)):
    payload = decode_token(token)
    rooms = await db.rooms.find(
        {"members.user_id": payload["user_id"]},
        {"_id": 0}
    ).to_list(100)
    return rooms

@api_router.get("/rooms/{room_id}")
async def get_room(room_id: str, token: str = Query(...)):
    payload = decode_token(token)
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    member = next((m for m in room["members"] if m["user_id"] == payload["user_id"]), None)
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this room")
    return room

@api_router.post("/rooms/{room_id}/invite")
async def invite_to_room(room_id: str, data: InviteRequest, token: str = Query(...)):
    payload = decode_token(token)
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    caller = next((m for m in room["members"] if m["user_id"] == payload["user_id"]), None)
    if not caller or caller["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only owner can invite")
    if data.role not in ["editor", "viewer"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    invited_user = await db.users.find_one({"email": data.email}, {"_id": 0, "password_hash": 0})
    if not invited_user:
        raise HTTPException(status_code=404, detail="User not found")
    already = next((m for m in room["members"] if m["user_id"] == invited_user["id"]), None)
    if already:
        raise HTTPException(status_code=400, detail="User already a member")
    new_member = {"user_id": invited_user["id"], "username": invited_user["username"], "role": data.role}
    await db.rooms.update_one({"id": room_id}, {"$push": {"members": new_member}})
    return {"message": "User invited", "member": new_member}

@api_router.put("/rooms/{room_id}/role")
async def update_role(room_id: str, data: RoleUpdate, token: str = Query(...)):
    payload = decode_token(token)
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    caller = next((m for m in room["members"] if m["user_id"] == payload["user_id"]), None)
    if not caller or caller["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only owner can change roles")
    if data.role not in ["editor", "viewer", "owner"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    await db.rooms.update_one(
        {"id": room_id, "members.user_id": data.user_id},
        {"$set": {"members.$.role": data.role}}
    )
    return {"message": "Role updated"}

@api_router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, token: str = Query(...)):
    payload = decode_token(token)
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["owner_id"] != payload["user_id"]:
        raise HTTPException(status_code=403, detail="Only owner can delete")
    await db.rooms.delete_one({"id": room_id})
    return {"message": "Room deleted"}

@api_router.delete("/rooms/{room_id}/members/{user_id}")
async def remove_member(room_id: str, user_id: str, token: str = Query(...)):
    payload = decode_token(token)
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    caller = next((m for m in room["members"] if m["user_id"] == payload["user_id"]), None)
    if not caller or caller["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only owner can remove members")
    if user_id == room["owner_id"]:
        raise HTTPException(status_code=400, detail="Cannot remove the owner")
    await db.rooms.update_one({"id": room_id}, {"$pull": {"members": {"user_id": user_id}}})
    return {"message": "Member removed"}

# ─── AI Route ────────────────────────────────────────────
@api_router.post("/ai/suggest")
async def ai_suggest(data: AIRequest, token: str = Query(...)):
    decode_token(token)
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"code-assist-{uuid.uuid4()}",
            system_message=f"You are an expert {data.language} programmer. Provide concise, helpful code suggestions. Return only code with brief comments. No markdown formatting."
        )
        chat.with_model("openai", "gpt-5.2")
        prompt = data.prompt if data.prompt else "Suggest improvements or complete the following code"
        user_msg = UserMessage(text=f"{prompt}:\n\n```{data.language}\n{data.code}\n```")
        response = await chat.send_message(user_msg)
        return {"suggestion": response}
    except Exception as e:
        logger.error(f"AI suggestion error: {e}")
        raise HTTPException(status_code=500, detail=f"AI service error: {str(e)}")

# ─── WebSocket Connection Manager (Fixed Race Condition) ──
class EditorConnectionManager:
    """Manages editor WebSocket connections with instance-level tracking
    to prevent race conditions from React StrictMode double-mounts."""
    
    def __init__(self):
        # rooms[room_id][user_id] = list of {ws, username, role, conn_id}
        self.rooms: Dict[str, Dict[str, list]] = {}

    async def connect(self, room_id: str, user_id: str, username: str, role: str, ws: WebSocket, conn_id: str):
        await ws.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        if user_id not in self.rooms[room_id]:
            self.rooms[room_id][user_id] = []
        # Add this specific connection
        self.rooms[room_id][user_id].append({
            "ws": ws, "username": username, "role": role, "conn_id": conn_id
        })
        logger.info(f"[Editor] Connected: room={room_id} user={username} conn={conn_id} (total conns for user: {len(self.rooms[room_id][user_id])})")
        await self.broadcast_presence(room_id)

    def disconnect(self, room_id: str, user_id: str, conn_id: str):
        """Only remove the specific connection instance, not all connections for the user."""
        if room_id not in self.rooms or user_id not in self.rooms[room_id]:
            return
        conns = self.rooms[room_id][user_id]
        self.rooms[room_id][user_id] = [c for c in conns if c["conn_id"] != conn_id]
        logger.info(f"[Editor] Disconnected: room={room_id} user_id={user_id} conn={conn_id} (remaining: {len(self.rooms[room_id][user_id])})")
        if not self.rooms[room_id][user_id]:
            del self.rooms[room_id][user_id]
        if not self.rooms[room_id]:
            del self.rooms[room_id]

    def get_active_users(self, room_id: str):
        if room_id not in self.rooms:
            return []
        users = []
        seen = set()
        for user_id, conns in self.rooms[room_id].items():
            if conns and user_id not in seen:
                seen.add(user_id)
                users.append({
                    "user_id": user_id,
                    "username": conns[0]["username"],
                    "role": conns[0]["role"]
                })
        return users

    async def broadcast_presence(self, room_id: str):
        users = self.get_active_users(room_id)
        msg = json.dumps({"type": "presence", "users": users})
        await self._send_to_all(room_id, msg)

    async def broadcast_code(self, room_id: str, sender_id: str, sender_conn_id: str, data: dict):
        if room_id not in self.rooms:
            return
        msg = json.dumps({**data, "sender_id": sender_id})
        for user_id, conns in list(self.rooms[room_id].items()):
            for conn in list(conns):
                # Send to everyone except the specific sender connection
                if conn["conn_id"] == sender_conn_id:
                    continue
                try:
                    await conn["ws"].send_text(msg)
                except Exception as e:
                    logger.debug(f"[Editor] Send failed to {user_id}: {e}")

    async def _send_to_all(self, room_id: str, msg: str):
        if room_id not in self.rooms:
            return
        for user_id, conns in list(self.rooms[room_id].items()):
            for conn in list(conns):
                try:
                    await conn["ws"].send_text(msg)
                except Exception:
                    pass


class VoiceConnectionManager:
    """Manages voice WebSocket connections with instance-level tracking."""
    
    def __init__(self):
        self.rooms: Dict[str, Dict[str, list]] = {}

    async def connect(self, room_id: str, user_id: str, username: str, ws: WebSocket, conn_id: str):
        await ws.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        if user_id not in self.rooms[room_id]:
            self.rooms[room_id][user_id] = []
        self.rooms[room_id][user_id].append({
            "ws": ws, "username": username, "conn_id": conn_id
        })
        logger.info(f"[Voice] Connected: room={room_id} user={username} conn={conn_id}")
        await self.broadcast_voice_presence(room_id)

    def disconnect(self, room_id: str, user_id: str, conn_id: str):
        if room_id not in self.rooms or user_id not in self.rooms[room_id]:
            return
        conns = self.rooms[room_id][user_id]
        self.rooms[room_id][user_id] = [c for c in conns if c["conn_id"] != conn_id]
        logger.info(f"[Voice] Disconnected: room={room_id} user_id={user_id} conn={conn_id}")
        if not self.rooms[room_id][user_id]:
            del self.rooms[room_id][user_id]
        if not self.rooms[room_id]:
            del self.rooms[room_id]

    def get_active_users(self, room_id: str):
        if room_id not in self.rooms:
            return []
        users = []
        seen = set()
        for user_id, conns in self.rooms[room_id].items():
            if conns and user_id not in seen:
                seen.add(user_id)
                users.append({"user_id": user_id, "username": conns[0]["username"]})
        return users

    async def broadcast_voice_presence(self, room_id: str):
        users = self.get_active_users(room_id)
        msg = json.dumps({"type": "voice_presence", "users": users})
        await self._send_to_all(room_id, msg)

    async def relay(self, room_id: str, sender_id: str, target_id: str, data: dict):
        if room_id not in self.rooms or target_id not in self.rooms[room_id]:
            return
        msg = json.dumps({**data, "sender_id": sender_id})
        for conn in list(self.rooms[room_id][target_id]):
            try:
                await conn["ws"].send_text(msg)
            except Exception:
                pass

    async def broadcast(self, room_id: str, sender_id: str, sender_conn_id: str, data: dict):
        if room_id not in self.rooms:
            return
        msg = json.dumps({**data, "sender_id": sender_id})
        for user_id, conns in list(self.rooms[room_id].items()):
            for conn in list(conns):
                if conn["conn_id"] == sender_conn_id:
                    continue
                try:
                    await conn["ws"].send_text(msg)
                except Exception:
                    pass

    async def _send_to_all(self, room_id: str, msg: str):
        if room_id not in self.rooms:
            return
        for user_id, conns in list(self.rooms[room_id].items()):
            for conn in list(conns):
                try:
                    await conn["ws"].send_text(msg)
                except Exception:
                    pass


editor_manager = EditorConnectionManager()
voice_manager = VoiceConnectionManager()

# ─── WebSocket Keepalive ──────────────────────────────────
async def ws_keepalive(ws: WebSocket, interval: int = 10):
    """Send periodic pings to keep the WebSocket connection alive through K8s ingress."""
    try:
        while True:
            await asyncio.sleep(interval)
            await ws.send_text(json.dumps({"type": "ping"}))
    except Exception:
        pass

# ─── WebSocket Endpoints ─────────────────────────────────
@app.websocket("/api/ws/editor/{room_id}")
async def editor_ws(ws: WebSocket, room_id: str, token: str = Query(...)):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        await ws.close(code=4001)
        return
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        await ws.close(code=4004)
        return
    member = next((m for m in room["members"] if m["user_id"] == payload["user_id"]), None)
    if not member:
        await ws.close(code=4003)
        return

    user_id = payload["user_id"]
    username = payload["username"]
    role = member["role"]
    conn_id = str(uuid.uuid4())

    await editor_manager.connect(room_id, user_id, username, role, ws, conn_id)
    
    # Start keepalive task
    keepalive_task = asyncio.create_task(ws_keepalive(ws))
    
    try:
        # Send initial state - fetch fresh from DB
        fresh_room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
        await ws.send_text(json.dumps({
            "type": "init",
            "code": fresh_room["code"] if fresh_room else room["code"],
            "language": fresh_room["language"] if fresh_room else room["language"],
            "role": role
        }))
        
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            
            if data.get("type") == "pong":
                continue
            elif data.get("type") == "code_change" and role in ("owner", "editor"):
                code_content = data.get("code", "")
                await db.rooms.update_one(
                    {"id": room_id},
                    {"$set": {"code": code_content, "updated_at": datetime.now(timezone.utc).isoformat()}}
                )
                await editor_manager.broadcast_code(room_id, user_id, conn_id, data)
                logger.info(f"[Editor] Code change from {username} in room {room_id} (len={len(code_content)})")
            elif data.get("type") == "cursor_move":
                await editor_manager.broadcast_code(room_id, user_id, conn_id, {
                    "type": "cursor_move",
                    "cursor": data.get("cursor"),
                    "username": username
                })
            elif data.get("type") == "language_change" and role in ("owner", "editor"):
                await db.rooms.update_one(
                    {"id": room_id},
                    {"$set": {"language": data.get("language")}}
                )
                await editor_manager.broadcast_code(room_id, user_id, conn_id, data)
    except WebSocketDisconnect:
        logger.info(f"[Editor] WebSocket disconnected: {username} conn={conn_id}")
    except Exception as e:
        logger.error(f"[Editor] WS error for {username}: {e}")
    finally:
        keepalive_task.cancel()
        editor_manager.disconnect(room_id, user_id, conn_id)
        await editor_manager.broadcast_presence(room_id)

@app.websocket("/api/ws/voice/{room_id}")
async def voice_ws(ws: WebSocket, room_id: str, token: str = Query(...)):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        await ws.close(code=4001)
        return
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        await ws.close(code=4004)
        return
    member = next((m for m in room["members"] if m["user_id"] == payload["user_id"]), None)
    if not member:
        await ws.close(code=4003)
        return

    user_id = payload["user_id"]
    username = payload["username"]
    conn_id = str(uuid.uuid4())

    await voice_manager.connect(room_id, user_id, username, ws, conn_id)
    
    # Start keepalive task
    keepalive_task = asyncio.create_task(ws_keepalive(ws))
    
    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            
            if data.get("type") == "pong":
                continue
            elif data.get("type") in ("offer", "answer", "ice_candidate"):
                target = data.get("target_id")
                if target:
                    await voice_manager.relay(room_id, user_id, target, data)
                else:
                    await voice_manager.broadcast(room_id, user_id, conn_id, data)
                logger.info(f"[Voice] Signal {data['type']} from {username} target={target or 'broadcast'}")
            elif data.get("type") == "speaking":
                # Throttle speaking broadcasts - only forward to reduce WS traffic
                await voice_manager.broadcast(room_id, user_id, conn_id, {
                    "type": "speaking",
                    "speaking": data.get("speaking", False),
                    "user_id": user_id,
                    "username": username
                })
    except WebSocketDisconnect:
        logger.info(f"[Voice] WebSocket disconnected: {username} conn={conn_id}")
    except Exception as e:
        logger.error(f"[Voice] WS error for {username}: {e}")
    finally:
        keepalive_task.cancel()
        voice_manager.disconnect(room_id, user_id, conn_id)
        await voice_manager.broadcast_voice_presence(room_id)

# ─── Helpers ─────────────────────────────────────────────
def get_default_code(language: str) -> str:
    defaults = {
        "javascript": '// Welcome to the collaborative editor!\nconsole.log("Hello, World!");\n',
        "python": '# Welcome to the collaborative editor!\nprint("Hello, World!")\n',
        "html": '<!DOCTYPE html>\n<html>\n<head>\n  <title>Hello</title>\n</head>\n<body>\n  <h1>Hello, World!</h1>\n</body>\n</html>',
        "css": '/* Welcome to the collaborative editor! */\nbody {\n  margin: 0;\n  padding: 0;\n}\n',
        "json": '{\n  "message": "Hello, World!"\n}'
    }
    return defaults.get(language, f"// Welcome! Language: {language}\n")

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

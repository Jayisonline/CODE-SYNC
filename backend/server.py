from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
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

# ─── WebSocket Connection Manager ────────────────────────
class EditorConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Dict[str, dict]] = {}

    async def connect(self, room_id: str, user_id: str, username: str, role: str, ws: WebSocket):
        await ws.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        self.rooms[room_id][user_id] = {"ws": ws, "username": username, "role": role}
        await self.broadcast_presence(room_id)

    def disconnect(self, room_id: str, user_id: str):
        if room_id in self.rooms:
            self.rooms[room_id].pop(user_id, None)
            if not self.rooms[room_id]:
                del self.rooms[room_id]

    async def broadcast_presence(self, room_id: str):
        if room_id not in self.rooms:
            return
        users = [{"user_id": uid, "username": c["username"], "role": c["role"]}
                 for uid, c in self.rooms[room_id].items()]
        msg = json.dumps({"type": "presence", "users": users})
        for uid, c in list(self.rooms[room_id].items()):
            try:
                await c["ws"].send_text(msg)
            except Exception:
                pass

    async def broadcast_code(self, room_id: str, sender_id: str, data: dict):
        if room_id not in self.rooms:
            return
        msg = json.dumps({**data, "sender_id": sender_id})
        for uid, c in list(self.rooms[room_id].items()):
            if uid != sender_id:
                try:
                    await c["ws"].send_text(msg)
                except Exception:
                    pass

class VoiceConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Dict[str, dict]] = {}

    async def connect(self, room_id: str, user_id: str, username: str, ws: WebSocket):
        await ws.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        self.rooms[room_id][user_id] = {"ws": ws, "username": username}
        await self.broadcast_voice_presence(room_id)

    def disconnect(self, room_id: str, user_id: str):
        if room_id in self.rooms:
            self.rooms[room_id].pop(user_id, None)
            if not self.rooms[room_id]:
                del self.rooms[room_id]

    async def broadcast_voice_presence(self, room_id: str):
        if room_id not in self.rooms:
            return
        users = [{"user_id": uid, "username": c["username"]}
                 for uid, c in self.rooms[room_id].items()]
        msg = json.dumps({"type": "voice_presence", "users": users})
        for uid, c in list(self.rooms[room_id].items()):
            try:
                await c["ws"].send_text(msg)
            except Exception:
                pass

    async def relay(self, room_id: str, sender_id: str, target_id: str, data: dict):
        if room_id in self.rooms and target_id in self.rooms[room_id]:
            msg = json.dumps({**data, "sender_id": sender_id})
            try:
                await self.rooms[room_id][target_id]["ws"].send_text(msg)
            except Exception:
                pass

    async def broadcast(self, room_id: str, sender_id: str, data: dict):
        if room_id not in self.rooms:
            return
        msg = json.dumps({**data, "sender_id": sender_id})
        for uid, c in list(self.rooms[room_id].items()):
            if uid != sender_id:
                try:
                    await c["ws"].send_text(msg)
                except Exception:
                    pass

editor_manager = EditorConnectionManager()
voice_manager = VoiceConnectionManager()

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

    await editor_manager.connect(room_id, user_id, username, role, ws)
    try:
        await ws.send_text(json.dumps({
            "type": "init",
            "code": room["code"],
            "language": room["language"],
            "role": role
        }))
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            if data["type"] == "code_change" and role in ("owner", "editor"):
                await db.rooms.update_one(
                    {"id": room_id},
                    {"$set": {"code": data["code"], "updated_at": datetime.now(timezone.utc).isoformat()}}
                )
                await editor_manager.broadcast_code(room_id, user_id, data)
            elif data["type"] == "cursor_move":
                await editor_manager.broadcast_code(room_id, user_id, {
                    "type": "cursor_move",
                    "cursor": data["cursor"],
                    "username": username
                })
            elif data["type"] == "language_change" and role in ("owner", "editor"):
                await db.rooms.update_one(
                    {"id": room_id},
                    {"$set": {"language": data["language"]}}
                )
                await editor_manager.broadcast_code(room_id, user_id, data)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Editor WS error: {e}")
    finally:
        editor_manager.disconnect(room_id, user_id)
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

    await voice_manager.connect(room_id, user_id, username, ws)
    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            if data["type"] in ("offer", "answer", "ice_candidate"):
                target = data.get("target_id")
                if target:
                    await voice_manager.relay(room_id, user_id, target, data)
                else:
                    await voice_manager.broadcast(room_id, user_id, data)
            elif data["type"] == "speaking":
                await voice_manager.broadcast(room_id, user_id, {
                    "type": "speaking",
                    "speaking": data["speaking"],
                    "username": username
                })
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Voice WS error: {e}")
    finally:
        voice_manager.disconnect(room_id, user_id)
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

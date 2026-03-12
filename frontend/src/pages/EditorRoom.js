import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CodeEditor } from '../components/CodeEditor';
import { VoicePanel } from '../components/VoicePanel';
import { UserPresence } from '../components/UserPresence';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from '../components/ui/tooltip';
import { Separator } from '../components/ui/separator';
import {
  Code2, ArrowLeft, Sparkles, PanelRightOpen, PanelRightClose,
  Crown, Pencil, Eye, Loader2, Copy, Check, Wifi, WifiOff
} from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const WS_BASE = process.env.REACT_APP_BACKEND_URL.replace(/^http/, 'ws');

export default function EditorRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();

  const [room, setRoom] = useState(null);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [myRole, setMyRole] = useState('viewer');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const wsRef = useRef(null);
  const codeRef = useRef(code);
  // Track the last code received from remote to avoid echo loops
  const remoteCodeRef = useRef('');
  const reconnectTimer = useRef(null);
  const heartbeatTimer = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => { codeRef.current = code; }, [code]);
  
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchRoom = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/rooms/${roomId}?token=${token}`);
      setRoom(res.data);
      setLanguage(res.data.language);
      const member = res.data.members?.find(m => m.user_id === user?.id);
      if (member) setMyRole(member.role);
    } catch (err) {
      toast.error('Failed to load room');
      navigate('/');
    } finally {
      setLoading(false);
    }
  }, [roomId, token, user, navigate]);

  useEffect(() => { fetchRoom(); }, [fetchRoom]);

  // WebSocket connection with reconnection logic
  const connectWs = useCallback(() => {
    if (!roomId || !token || !mountedRef.current) return;
    
    // Clean up existing connection
    if (wsRef.current) {
      try { wsRef.current.close(); } catch(e) {}
      wsRef.current = null;
    }
    
    const ws = new WebSocket(`${WS_BASE}/api/ws/editor/${roomId}?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setWsConnected(true);
      // Clear any pending reconnect
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      // Start client-side heartbeat to keep connection alive through K8s ingress
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'pong' })); } catch(e) {}
        }
      }, 15000);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(event.data);
      
      if (data.type === 'ping') {
        // Respond to keepalive pings from server
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch(e) {}
        return;
      }
      
      if (data.type === 'init') {
        const initCode = data.code || '';
        remoteCodeRef.current = initCode;
        setCode(initCode);
        setLanguage(data.language || 'javascript');
        setMyRole(data.role);
      } else if (data.type === 'code_change') {
        const remoteCode = data.code || '';
        remoteCodeRef.current = remoteCode;
        setCode(remoteCode);
      } else if (data.type === 'language_change') {
        setLanguage(data.language);
      } else if (data.type === 'presence') {
        setOnlineUsers(data.users || []);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setWsConnected(false);
      if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
      // Auto-reconnect after 2 seconds
      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current) {
          connectWs();
        }
      }, 2000);
    };
  }, [roomId, token]);

  useEffect(() => {
    connectWs();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch(e) {}
        wsRef.current = null;
      }
    };
  }, [connectWs]);

  const handleCodeChange = useCallback((newCode) => {
    setCode(newCode);
    // Only send if different from the last remote update (prevents echo loops)
    if (newCode !== remoteCodeRef.current) {
      if (wsRef.current?.readyState === WebSocket.OPEN && myRole !== 'viewer') {
        wsRef.current.send(JSON.stringify({ type: 'code_change', code: newCode }));
      }
    }
  }, [myRole]);

  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    if (wsRef.current?.readyState === WebSocket.OPEN && myRole !== 'viewer') {
      wsRef.current.send(JSON.stringify({ type: 'language_change', language: newLang }));
    }
  };

  const handleAISuggest = async () => {
    setAiLoading(true);
    try {
      const res = await axios.post(`${API}/ai/suggest?token=${token}`, {
        code: codeRef.current,
        language,
        prompt: 'Improve, optimize, or complete this code. Add helpful comments.'
      });
      if (res.data.suggestion) {
        const suggestion = res.data.suggestion;
        const newCode = codeRef.current + '\n\n// === AI Suggestion ===\n' + suggestion;
        setCode(newCode);
        remoteCodeRef.current = ''; // Force send
        if (wsRef.current?.readyState === WebSocket.OPEN && myRole !== 'viewer') {
          wsRef.current.send(JSON.stringify({ type: 'code_change', code: newCode }));
        }
        toast.success('AI suggestion added!');
      }
    } catch (err) {
      toast.error('AI suggestion failed');
    } finally {
      setAiLoading(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Code copied!');
  };

  const RoleIcon = myRole === 'owner' ? Crown : myRole === 'editor' ? Pencil : Eye;
  const roleColor = myRole === 'owner' ? '#FF3B30' : myRole === 'editor' ? '#007AFF' : '#A1A1AA';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <div className="w-6 h-6 border-2 border-[#FF3B30] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col bg-[#09090b]" data-testid="editor-room-page">
        {/* Top Bar */}
        <header className="h-12 glass border-b border-white/5 flex items-center px-4 gap-3 shrink-0 z-50">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="back-to-dashboard"
                variant="ghost"
                size="sm"
                onClick={() => navigate('/')}
                className="h-8 w-8 p-0 text-[#A1A1AA] hover:text-white hover:bg-white/5"
              >
                <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p className="text-xs">Back to Dashboard</p></TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-5 bg-white/10" />

          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-[#FF3B30]" strokeWidth={1.5} />
            <span className="heading-font text-sm font-semibold truncate max-w-[200px]" data-testid="room-name">
              {room?.name}
            </span>
          </div>

          <Badge
            variant="outline"
            className="text-[10px] font-medium border ml-2"
            style={{ borderColor: `${roleColor}33`, color: roleColor, backgroundColor: `${roleColor}15` }}
            data-testid="my-role-badge"
          >
            <RoleIcon className="w-2.5 h-2.5 mr-1" strokeWidth={1.5} />
            {myRole}
          </Badge>

          <div className="flex-1" />

          <Select value={language} onValueChange={handleLanguageChange} disabled={myRole === 'viewer'}>
            <SelectTrigger
              data-testid="language-selector"
              className="w-[130px] h-8 text-xs bg-white/5 border-white/10 hover:bg-white/10 transition-colors"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#121214] border-white/10">
              <SelectItem value="javascript">JavaScript</SelectItem>
              <SelectItem value="python">Python</SelectItem>
              <SelectItem value="html">HTML</SelectItem>
              <SelectItem value="css">CSS</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="copy-code-button"
                variant="ghost"
                size="sm"
                onClick={copyCode}
                className="h-8 w-8 p-0 text-[#A1A1AA] hover:text-white hover:bg-white/5"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" strokeWidth={1.5} /> : <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p className="text-xs">Copy code</p></TooltipContent>
          </Tooltip>

          {myRole !== 'viewer' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-testid="ai-suggest-button"
                  variant="ghost"
                  size="sm"
                  onClick={handleAISuggest}
                  disabled={aiLoading}
                  className="h-8 px-3 text-xs text-[#F59E0B] hover:text-[#F59E0B] hover:bg-[#F59E0B]/10 transition-colors gap-1.5"
                >
                  {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} /> : <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} />}
                  AI Assist
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">Get AI code suggestions</p></TooltipContent>
            </Tooltip>
          )}

          <Separator orientation="vertical" className="h-5 bg-white/10" />

          <div className="flex items-center gap-1.5">
            {onlineUsers.slice(0, 4).map(u => (
              <Tooltip key={u.user_id}>
                <TooltipTrigger>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium border-2 border-[#09090b]
                    ${u.user_id === user?.id ? 'bg-[#FF3B30]/20 text-[#FF3B30]' : 'bg-white/10 text-[#A1A1AA]'}`}
                  >
                    {u.username?.[0]?.toUpperCase() || '?'}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p className="text-xs">{u.username}</p></TooltipContent>
              </Tooltip>
            ))}
            {onlineUsers.length > 4 && (
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium bg-white/5 text-[#A1A1AA]">
                +{onlineUsers.length - 4}
              </div>
            )}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="toggle-right-panel"
                variant="ghost"
                size="sm"
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                className="h-8 w-8 p-0 text-[#A1A1AA] hover:text-white hover:bg-white/5"
              >
                {rightPanelOpen ? <PanelRightClose className="w-4 h-4" strokeWidth={1.5} /> : <PanelRightOpen className="w-4 h-4" strokeWidth={1.5} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p className="text-xs">{rightPanelOpen ? 'Hide' : 'Show'} panel</p></TooltipContent>
          </Tooltip>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Code Editor */}
          <div className="flex-1 overflow-hidden" data-testid="editor-area">
            <CodeEditor
              code={code}
              language={language}
              readOnly={myRole === 'viewer'}
              onChange={handleCodeChange}
            />
          </div>

          {/* Right Panel */}
          {rightPanelOpen && (
            <div className="w-64 glass-heavy border-l border-white/5 flex flex-col shrink-0" data-testid="right-panel">
              <div className="flex-1 border-b border-white/5 overflow-hidden">
                <UserPresence
                  roomId={roomId}
                  token={token}
                  members={room?.members}
                  onlineUsers={onlineUsers}
                  myRole={myRole}
                  onMembersChange={fetchRoom}
                />
              </div>
              <div className="h-[280px] shrink-0 overflow-hidden">
                <VoicePanel
                  roomId={roomId}
                  token={token}
                  userId={user?.id}
                  username={user?.username}
                />
              </div>
            </div>
          )}
        </div>

        {/* Status Bar */}
        <footer className="h-7 bg-[#121214] border-t border-white/5 flex items-center px-4 gap-4 shrink-0">
          <div className="flex items-center gap-1.5">
            {wsConnected ? (
              <Wifi className="w-3 h-3 text-[#10B981]" strokeWidth={1.5} />
            ) : (
              <WifiOff className="w-3 h-3 text-[#EF4444]" strokeWidth={1.5} />
            )}
            <span className={`text-[10px] ${wsConnected ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
              {wsConnected ? 'Connected' : 'Reconnecting...'}
            </span>
          </div>
          <span className="text-[10px] text-[#52525B] uppercase tracking-wider">
            {language}
          </span>
          <span className="text-[10px] text-[#52525B]">
            {code.split('\n').length} lines
          </span>
          <div className="flex-1" />
          <span className="text-[10px] text-[#52525B]">
            {onlineUsers.length} online
          </span>
          {myRole === 'viewer' && (
            <span className="text-[10px] text-[#F59E0B] uppercase tracking-wider font-medium">
              Read Only
            </span>
          )}
        </footer>
      </div>
    </TooltipProvider>
  );
}

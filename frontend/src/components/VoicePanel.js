import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { Mic, MicOff, PhoneOff, Phone, Volume2 } from 'lucide-react';
import { toast } from 'sonner';

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
  ],
  iceCandidatePoolSize: 10,
};

const WS_BASE = process.env.REACT_APP_BACKEND_URL.replace(/^http/, 'ws');
const HEARTBEAT_MS = 10000;
const RECONNECT_DELAY = 1500;

export function VoicePanel({ roomId, token, userId, username }) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [speakingUsers, setSpeakingUsers] = useState({});
  const [connecting, setConnecting] = useState(false);

  const wsRef = useRef(null);
  const peersRef = useRef({});
  const localStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const speakingTimerRef = useRef(null);
  const heartbeatRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const audioContainerRef = useRef(null);
  const joinedRef = useRef(false);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      leaveAndCleanup();
    };
  }, []);

  // ─── Utilities ───────────────────────────────────────
  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
  }, []);

  const startHeartbeat = useCallback((ws) => {
    clearHeartbeat();
    heartbeatRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch(e) {/* noop */}
      }
    }, HEARTBEAT_MS);
  }, [clearHeartbeat]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
  }, []);

  // ─── Peer Management ─────────────────────────────────
  const destroyPeer = useCallback((peerId) => {
    const pc = peersRef.current[peerId];
    if (pc) { try { pc.close(); } catch(e) {/* noop */} delete peersRef.current[peerId]; }
    if (audioContainerRef.current) {
      const el = audioContainerRef.current.querySelector(`[data-peer="${peerId}"]`);
      if (el) { try { el.pause(); el.srcObject = null; } catch(e) {/* noop */} el.remove(); }
    }
  }, []);

  const destroyAllPeers = useCallback(() => {
    Object.keys(peersRef.current).forEach(destroyPeer);
    peersRef.current = {};
  }, [destroyPeer]);

  const isPeerAlive = useCallback((peerId) => {
    const pc = peersRef.current[peerId];
    if (!pc) return false;
    const state = pc.iceConnectionState;
    return state === 'connected' || state === 'completed' || state === 'checking' || state === 'new';
  }, []);

  // Who initiates: lexicographically smaller userId sends offer
  const shouldInitiate = useCallback((myId, theirId) => myId < theirId, []);

  const createPeer = useCallback((targetId, initiator) => {
    destroyPeer(targetId);
    console.log(`[Voice] createPeer ${targetId} initiator=${initiator}`);

    const pc = new RTCPeerConnection(ICE_CONFIG);
    peersRef.current[targetId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ice_candidate', target_id: targetId, candidate: e.candidate.toJSON() }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      console.log(`[Voice] ICE ${targetId}: ${s}`);
      if (s === 'failed' && initiator && pc.restartIce) pc.restartIce();
    };

    pc.ontrack = (e) => {
      console.log(`[Voice] ontrack from ${targetId}`);
      if (!audioContainerRef.current) return;
      // Remove old audio element
      const old = audioContainerRef.current.querySelector(`[data-peer="${targetId}"]`);
      if (old) { old.pause(); old.srcObject = null; old.remove(); }
      // Create new audio element in DOM (prevents GC)
      const audioEl = document.createElement('audio');
      audioEl.setAttribute('data-peer', targetId);
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.srcObject = e.streams[0];
      audioContainerRef.current.appendChild(audioEl);
      const tryPlay = () => audioEl.play().catch(() => setTimeout(tryPlay, 500));
      tryPlay();
    };

    if (initiator) {
      pc.createOffer({ offerToReceiveAudio: true })
        .then(o => pc.setLocalDescription(o))
        .then(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'offer', target_id: targetId, sdp: pc.localDescription.sdp }));
            console.log(`[Voice] Sent offer to ${targetId}`);
          }
        })
        .catch(err => console.error('[Voice] Offer error:', err));
    }
    return pc;
  }, [destroyPeer]);

  // ─── WebSocket Message Handler ────────────────────────
  const onWsMessage = useCallback((event) => {
    if (!mountedRef.current) return;
    const data = JSON.parse(event.data);

    if (data.type === 'ping') {
      try { wsRef.current?.send(JSON.stringify({ type: 'pong' })); } catch(e) {/* noop */}
      return;
    }

    if (data.type === 'voice_presence') {
      const users = data.users || [];
      setVoiceUsers(users);
      const myId = userIdRef.current;
      const remoteIds = new Set(users.filter(u => u.user_id !== myId).map(u => u.user_id));

      // Create peers for new users (skip if already have a live peer)
      remoteIds.forEach(theirId => {
        if (!isPeerAlive(theirId)) {
          createPeer(theirId, shouldInitiate(myId, theirId));
        }
      });
      // Destroy peers for users who left
      Object.keys(peersRef.current).forEach(pid => {
        if (!remoteIds.has(pid)) destroyPeer(pid);
      });
    } else if (data.type === 'offer') {
      console.log(`[Voice] Got offer from ${data.sender_id}`);
      const pc = createPeer(data.sender_id, false);
      pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }))
        .then(() => pc.createAnswer({ offerToReceiveAudio: true }))
        .then(a => pc.setLocalDescription(a))
        .then(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'answer', target_id: data.sender_id, sdp: pc.localDescription.sdp }));
            console.log(`[Voice] Sent answer to ${data.sender_id}`);
          }
        })
        .catch(err => console.error('[Voice] Answer error:', err));
    } else if (data.type === 'answer') {
      console.log(`[Voice] Got answer from ${data.sender_id}`);
      const pc = peersRef.current[data.sender_id];
      if (pc && pc.signalingState === 'have-local-offer') {
        pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }))
          .catch(err => console.error('[Voice] setRemoteDescription error:', err));
      }
    } else if (data.type === 'ice_candidate') {
      const pc = peersRef.current[data.sender_id];
      if (pc && data.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      }
    } else if (data.type === 'speaking') {
      const who = data.user_id || data.sender_id;
      setSpeakingUsers(prev => ({ ...prev, [who]: data.speaking }));
    }
  }, [createPeer, destroyPeer, isPeerAlive, shouldInitiate]);

  // ─── Connect Signaling WS (called on join + on auto-reconnect) ──
  const connectSignaling = useCallback(() => {
    if (!mountedRef.current || !joinedRef.current) return;
    clearReconnectTimer();

    // Close existing WS cleanly
    if (wsRef.current) {
      try { wsRef.current.onclose = null; wsRef.current.close(); } catch(e) {/* noop */}
    }

    const ws = new WebSocket(`${WS_BASE}/api/ws/voice/${roomId}?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      console.log('[Voice] Signaling WS open');
      startHeartbeat(ws);
    };

    ws.onmessage = onWsMessage;

    ws.onerror = (err) => console.error('[Voice] WS error:', err);

    ws.onclose = () => {
      console.log('[Voice] Signaling WS closed');
      clearHeartbeat();
      if (!mountedRef.current) return;

      if (joinedRef.current && localStreamRef.current) {
        // Auto-reconnect: keep mic + peers alive, just reconnect signaling
        console.log('[Voice] Scheduling signaling reconnect...');
        // Destroy all peers since other users will also see us disconnect
        destroyAllPeers();
        reconnectTimerRef.current = setTimeout(connectSignaling, RECONNECT_DELAY);
      } else {
        // User left or component unmounted
        leaveAndCleanup();
      }
    };
  }, [roomId, token, onWsMessage, startHeartbeat, clearHeartbeat, clearReconnectTimer, destroyAllPeers]);

  // ─── Full Cleanup (leave voice) ───────────────────────
  const leaveAndCleanup = useCallback(() => {
    clearHeartbeat();
    clearReconnectTimer();
    if (speakingTimerRef.current) { clearInterval(speakingTimerRef.current); speakingTimerRef.current = null; }
    if (audioContextRef.current) { try { audioContextRef.current.close(); } catch(e) {/* noop */} audioContextRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    destroyAllPeers();
    if (wsRef.current) {
      try { wsRef.current.onclose = null; wsRef.current.close(); } catch(e) {/* noop */}
      wsRef.current = null;
    }
    joinedRef.current = false;
    if (mountedRef.current) { setJoined(false); setVoiceUsers([]); setSpeakingUsers({}); setConnecting(false); }
  }, [clearHeartbeat, clearReconnectTimer, destroyAllPeers]);

  // ─── Speaking Detection ───────────────────────────────
  const setupSpeakingDetection = useCallback((stream) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      speakingTimerRef.current = setInterval(() => {
        if (!mountedRef.current || !joinedRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'speaking', speaking: avg > 20 }));
        }
      }, 300);
    } catch (e) {
      console.error('[Voice] Speaking detection error:', e);
    }
  }, []);

  // ─── Join / Leave ─────────────────────────────────────
  const joinVoice = async () => {
    if (connecting || joinedRef.current) return;
    setConnecting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;
      joinedRef.current = true;
      setJoined(true);
      setConnecting(false);

      setupSpeakingDetection(stream);
      connectSignaling();

      toast.success('Joined voice channel');
    } catch (err) {
      console.error('[Voice] Mic access failed:', err);
      toast.error('Microphone access denied. Please allow mic permission.');
      setConnecting(false);
      leaveAndCleanup();
    }
  };

  const leaveVoice = () => {
    leaveAndCleanup();
    toast.success('Left voice channel');
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) { track.enabled = !track.enabled; setMuted(!track.enabled); }
    }
  };

  // ─── Render ───────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" data-testid="voice-panel">
      <div ref={audioContainerRef} style={{ display: 'none' }} />

      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-[#10B981]" strokeWidth={1.5} />
          <span className="text-xs font-medium uppercase tracking-wider text-[#A1A1AA]">Voice Channel</span>
        </div>
        {joined && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
            <span className="text-[10px] text-[#10B981]">Connected</span>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        {joined && voiceUsers.length > 0 ? (
          <div className="flex flex-col gap-2">
            {voiceUsers.map(u => (
              <div key={u.user_id} data-testid={`voice-user-${u.user_id}`}
                className="flex items-center gap-3 p-2 rounded-md bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-150
                  ${speakingUsers[u.user_id] ? 'bg-[#10B981]/20 text-[#10B981] speaking-ring' : 'bg-white/10 text-[#A1A1AA]'}`}>
                  {u.username?.[0]?.toUpperCase() || '?'}
                </div>
                <span className="text-sm truncate flex-1">{u.username}{u.user_id === userId ? ' (you)' : ''}</span>
                {u.user_id === userId && muted && <MicOff className="w-3.5 h-3.5 text-[#EF4444]" strokeWidth={1.5} />}
              </div>
            ))}
          </div>
        ) : !joined ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-3">
              <Mic className="w-5 h-5 text-[#A1A1AA]" strokeWidth={1.5} />
            </div>
            <p className="text-xs text-[#52525B] max-w-[140px]">Join voice to talk with collaborators</p>
          </div>
        ) : (
          <p className="text-xs text-[#52525B] text-center py-4">No one else in voice yet</p>
        )}
      </ScrollArea>

      <div className="px-4 py-3 border-t border-white/5">
        {joined ? (
          <div className="flex gap-2">
            <Button data-testid="toggle-mute-button" variant="ghost" size="sm" onClick={toggleMute}
              className={`flex-1 h-9 text-xs ${muted ? 'bg-[#EF4444]/10 text-[#EF4444] hover:bg-[#EF4444]/20' : 'bg-white/5 text-white hover:bg-white/10'}`}>
              {muted ? <MicOff className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} /> : <Mic className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />}
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button data-testid="leave-voice-button" variant="ghost" size="sm" onClick={leaveVoice}
              className="h-9 w-9 p-0 bg-[#EF4444]/10 text-[#EF4444] hover:bg-[#EF4444]/20">
              <PhoneOff className="w-3.5 h-3.5" strokeWidth={1.5} />
            </Button>
          </div>
        ) : (
          <Button data-testid="join-voice-button" onClick={joinVoice} disabled={connecting}
            className="w-full h-9 text-xs bg-[#10B981] hover:bg-[#10B981]/90 text-white transition-all active:scale-[0.98]">
            {connecting
              ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />
              : <Phone className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />}
            {connecting ? 'Connecting...' : 'Join Voice'}
          </Button>
        )}
      </div>
    </div>
  );
}

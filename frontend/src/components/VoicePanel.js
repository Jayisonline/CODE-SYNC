import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { Mic, MicOff, PhoneOff, Phone, Volume2 } from 'lucide-react';
import { toast } from 'sonner';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

const WS_BASE = process.env.REACT_APP_BACKEND_URL.replace(/^http/, 'ws');

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
  const heartbeatTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const remoteAudiosRef = useRef({});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, []);

  const cleanup = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (speakingTimerRef.current) {
      clearInterval(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch(e) {}
      audioContextRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    Object.values(peersRef.current).forEach(pc => {
      try { pc.close(); } catch(e) {}
    });
    peersRef.current = {};
    // Clean up audio elements
    Object.values(remoteAudiosRef.current).forEach(audio => {
      try { audio.pause(); audio.srcObject = null; } catch(e) {}
    });
    remoteAudiosRef.current = {};
    if (wsRef.current) {
      try { wsRef.current.close(); } catch(e) {}
      wsRef.current = null;
    }
    if (mountedRef.current) {
      setVoiceUsers([]);
      setSpeakingUsers({});
    }
  }, []);

  const createPeer = useCallback((targetId, initiator) => {
    // Close existing peer if any
    if (peersRef.current[targetId]) {
      try { peersRef.current[targetId].close(); } catch(e) {}
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current[targetId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice_candidate',
          target_id: targetId,
          candidate: e.candidate.toJSON()
        }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Voice] ICE state for ${targetId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        // Try to restart ICE
        if (initiator && pc.restartIce) {
          pc.restartIce();
        }
      }
    };

    pc.ontrack = (e) => {
      console.log(`[Voice] Got remote track from ${targetId}`);
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = e.streams[0];
      audio.play().catch(err => console.error('[Voice] Audio play error:', err));
      remoteAudiosRef.current[targetId] = audio;
    };

    if (initiator) {
      pc.createOffer({ offerToReceiveAudio: true })
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'offer',
              target_id: targetId,
              sdp: pc.localDescription.sdp
            }));
          }
        })
        .catch(err => console.error('[Voice] Offer error:', err));
    }

    return pc;
  }, []);

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
        if (!mountedRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const isSpeaking = avg > 20;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'speaking', speaking: isSpeaking }));
        }
      }, 250);
    } catch (e) {
      console.error('[Voice] Speaking detection error:', e);
    }
  }, []);

  const joinVoice = async () => {
    if (connecting) return;
    setConnecting(true);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      localStreamRef.current = stream;
      setupSpeakingDetection(stream);

      const ws = new WebSocket(`${WS_BASE}/api/ws/voice/${roomId}?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        console.log('[Voice] WebSocket connected');
        setJoined(true);
        setConnecting(false);
        toast.success('Joined voice channel');
        // Start heartbeat
        heartbeatTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'pong' })); } catch(e) {}
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        const data = JSON.parse(event.data);

        if (data.type === 'ping') {
          try { ws.send(JSON.stringify({ type: 'pong' })); } catch(e) {}
          return;
        }

        if (data.type === 'voice_presence') {
          setVoiceUsers(data.users || []);
          // Create peer connections with new users
          (data.users || []).forEach(u => {
            if (u.user_id !== userId && !peersRef.current[u.user_id]) {
              console.log(`[Voice] Creating peer for ${u.username}`);
              createPeer(u.user_id, true);
            }
          });
          // Clean up peers for disconnected users
          const currentUserIds = new Set((data.users || []).map(u => u.user_id));
          Object.keys(peersRef.current).forEach(peerId => {
            if (!currentUserIds.has(peerId)) {
              console.log(`[Voice] Cleaning up peer for ${peerId}`);
              try { peersRef.current[peerId].close(); } catch(e) {}
              delete peersRef.current[peerId];
              if (remoteAudiosRef.current[peerId]) {
                try { remoteAudiosRef.current[peerId].pause(); } catch(e) {}
                delete remoteAudiosRef.current[peerId];
              }
            }
          });
        } else if (data.type === 'offer') {
          console.log(`[Voice] Received offer from ${data.sender_id}`);
          const pc = createPeer(data.sender_id, false);
          pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }))
            .then(() => pc.createAnswer({ offerToReceiveAudio: true }))
            .then(answer => pc.setLocalDescription(answer))
            .then(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'answer',
                  target_id: data.sender_id,
                  sdp: pc.localDescription.sdp
                }));
              }
            })
            .catch(err => console.error('[Voice] Answer error:', err));
        } else if (data.type === 'answer') {
          console.log(`[Voice] Received answer from ${data.sender_id}`);
          const pc = peersRef.current[data.sender_id];
          if (pc && pc.signalingState === 'have-local-offer') {
            pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }))
              .catch(err => console.error('[Voice] Set remote desc error:', err));
          }
        } else if (data.type === 'ice_candidate') {
          const pc = peersRef.current[data.sender_id];
          if (pc && data.candidate) {
            pc.addIceCandidate(new RTCIceCandidate(data.candidate))
              .catch(err => console.error('[Voice] ICE candidate error:', err));
          }
        } else if (data.type === 'speaking') {
          setSpeakingUsers(prev => ({ ...prev, [data.sender_id]: data.speaking }));
        }
      };

      ws.onerror = (err) => {
        console.error('[Voice] WebSocket error:', err);
        setConnecting(false);
      };

      ws.onclose = () => {
        console.log('[Voice] WebSocket closed');
        if (mountedRef.current) {
          cleanup();
          setJoined(false);
          setConnecting(false);
        }
      };
    } catch (err) {
      console.error('[Voice] Failed to join:', err);
      toast.error('Failed to access microphone. Please allow mic permission.');
      setConnecting(false);
      cleanup();
    }
  };

  const leaveVoice = () => {
    cleanup();
    setJoined(false);
    toast.success('Left voice channel');
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMuted(!audioTrack.enabled);
      }
    }
  };

  return (
    <div className="flex flex-col h-full" data-testid="voice-panel">
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
              <div
                key={u.user_id}
                data-testid={`voice-user-${u.user_id}`}
                className="flex items-center gap-3 p-2 rounded-md bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium
                  ${speakingUsers[u.user_id] ? 'bg-[#10B981]/20 text-[#10B981] speaking-ring' : 'bg-white/10 text-[#A1A1AA]'}
                  transition-all duration-150`}
                >
                  {u.username?.[0]?.toUpperCase() || '?'}
                </div>
                <span className="text-sm truncate flex-1">
                  {u.username}{u.user_id === userId ? ' (you)' : ''}
                </span>
                {u.user_id === userId && muted && (
                  <MicOff className="w-3.5 h-3.5 text-[#EF4444]" strokeWidth={1.5} />
                )}
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
            <Button
              data-testid="toggle-mute-button"
              variant="ghost"
              size="sm"
              onClick={toggleMute}
              className={`flex-1 h-9 text-xs ${muted ? 'bg-[#EF4444]/10 text-[#EF4444] hover:bg-[#EF4444]/20' : 'bg-white/5 text-white hover:bg-white/10'}`}
            >
              {muted ? <MicOff className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} /> : <Mic className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />}
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button
              data-testid="leave-voice-button"
              variant="ghost"
              size="sm"
              onClick={leaveVoice}
              className="h-9 w-9 p-0 bg-[#EF4444]/10 text-[#EF4444] hover:bg-[#EF4444]/20"
            >
              <PhoneOff className="w-3.5 h-3.5" strokeWidth={1.5} />
            </Button>
          </div>
        ) : (
          <Button
            data-testid="join-voice-button"
            onClick={joinVoice}
            disabled={connecting}
            className="w-full h-9 text-xs bg-[#10B981] hover:bg-[#10B981]/90 text-white transition-all active:scale-[0.98]"
          >
            {connecting ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />
            ) : (
              <Phone className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
            )}
            {connecting ? 'Connecting...' : 'Join Voice'}
          </Button>
        )}
      </div>
    </div>
  );
}

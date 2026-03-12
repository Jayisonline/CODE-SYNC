import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { Mic, MicOff, PhoneOff, Phone, Volume2 } from 'lucide-react';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function VoicePanel({ roomId, token, userId, username }) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [speakingUsers, setSpeakingUsers] = useState({});
  const wsRef = useRef(null);
  const peersRef = useRef({});
  const localStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const speakingTimerRef = useRef(null);

  const cleanup = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    Object.values(peersRef.current).forEach(pc => pc.close());
    peersRef.current = {};
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
    wsRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (speakingTimerRef.current) {
      clearInterval(speakingTimerRef.current);
    }
    setVoiceUsers([]);
    setSpeakingUsers({});
  }, []);

  const createPeer = useCallback((targetId, initiator) => {
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

    pc.ontrack = (e) => {
      const audio = new Audio();
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
    };

    if (initiator) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'offer',
            target_id: targetId,
            sdp: offer.sdp
          }));
        }
      });
    }

    return pc;
  }, []);

  const setupSpeakingDetection = useCallback((stream) => {
    try {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 512;
      source.connect(analyserRef.current);

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      speakingTimerRef.current = setInterval(() => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const isSpeaking = avg > 20;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'speaking', speaking: isSpeaking }));
        }
      }, 200);
    } catch (e) {
      console.error('Speaking detection error:', e);
    }
  }, []);

  const joinVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setupSpeakingDetection(stream);

      const wsUrl = process.env.REACT_APP_BACKEND_URL.replace(/^http/, 'ws');
      const ws = new WebSocket(`${wsUrl}/api/ws/voice/${roomId}?token=${token}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'voice_presence') {
          setVoiceUsers(data.users);
          data.users.forEach(u => {
            if (u.user_id !== userId && !peersRef.current[u.user_id]) {
              createPeer(u.user_id, true);
            }
          });
        } else if (data.type === 'offer') {
          const pc = createPeer(data.sender_id, false);
          pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
          pc.createAnswer().then(answer => {
            pc.setLocalDescription(answer);
            ws.send(JSON.stringify({
              type: 'answer',
              target_id: data.sender_id,
              sdp: answer.sdp
            }));
          });
        } else if (data.type === 'answer') {
          const pc = peersRef.current[data.sender_id];
          if (pc) pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
        } else if (data.type === 'ice_candidate') {
          const pc = peersRef.current[data.sender_id];
          if (pc && data.candidate) {
            pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } else if (data.type === 'speaking') {
          setSpeakingUsers(prev => ({ ...prev, [data.sender_id]: data.speaking }));
        }
      };

      ws.onclose = () => {
        cleanup();
        setJoined(false);
      };

      setJoined(true);
    } catch (err) {
      console.error('Failed to join voice:', err);
    }
  };

  const leaveVoice = () => {
    cleanup();
    setJoined(false);
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

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

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
                <span className="text-sm truncate flex-1">{u.username}</span>
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
            className="w-full h-9 text-xs bg-[#10B981] hover:bg-[#10B981]/90 text-white transition-all active:scale-[0.98]"
          >
            <Phone className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
            Join Voice
          </Button>
        )}
      </div>
    </div>
  );
}

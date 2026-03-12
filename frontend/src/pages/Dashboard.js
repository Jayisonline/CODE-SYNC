import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription
} from '../components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '../components/ui/dropdown-menu';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import {
  Plus, Code2, LogOut, Clock, Users, MoreVertical, Trash2, ChevronRight, Sparkles
} from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function Dashboard() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLang, setNewLang] = useState('javascript');

  const fetchRooms = async () => {
    try {
      const res = await axios.get(`${API}/rooms?token=${token}`);
      setRooms(res.data);
    } catch (err) {
      toast.error('Failed to load rooms');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRooms(); }, [token]);

  const createRoom = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const res = await axios.post(`${API}/rooms?token=${token}`, {
        name: newName.trim(),
        language: newLang
      });
      setRooms(prev => [res.data, ...prev]);
      setCreateOpen(false);
      setNewName('');
      toast.success('Room created!');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create room');
    }
  };

  const deleteRoom = async (roomId) => {
    try {
      await axios.delete(`${API}/rooms/${roomId}?token=${token}`);
      setRooms(prev => prev.filter(r => r.id !== roomId));
      toast.success('Room deleted');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete room');
    }
  };

  const langColors = {
    javascript: '#F59E0B',
    python: '#10B981',
    html: '#EF4444',
    css: '#3B82F6',
    json: '#A855F7'
  };

  const roleColors = {
    owner: 'bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/20',
    editor: 'bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/20',
    viewer: 'bg-white/5 text-[#A1A1AA] border-white/10'
  };

  return (
    <div className="min-h-screen grid-texture" data-testid="dashboard-page">
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[#FF3B30] flex items-center justify-center">
              <Code2 className="w-4 h-4 text-white" strokeWidth={1.5} />
            </div>
            <span className="heading-font text-lg font-bold tracking-tight">CodeSync</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[#A1A1AA]">{user?.username}</span>
            <Button
              data-testid="logout-button"
              variant="ghost"
              size="sm"
              onClick={logout}
              className="text-[#A1A1AA] hover:text-white hover:bg-white/5"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.5} />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between mb-10">
          <div>
            <h1 className="heading-font text-4xl font-extrabold tracking-tight mb-2" data-testid="dashboard-title">
              Your Rooms
            </h1>
            <p className="text-sm text-[#A1A1AA]">
              {rooms.length} room{rooms.length !== 1 ? 's' : ''} active
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button
                data-testid="create-room-button"
                className="bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-white shadow-[0_0_15px_rgba(255,59,48,0.3)] transition-all active:scale-[0.98]"
              >
                <Plus className="w-4 h-4 mr-2" strokeWidth={1.5} />
                New Room
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-heavy border-white/10 sm:max-w-md" data-testid="create-room-dialog">
              <DialogHeader>
                <DialogTitle className="heading-font text-xl font-bold">Create Room</DialogTitle>
                <DialogDescription className="text-sm text-[#A1A1AA]">Set up a new collaborative coding room</DialogDescription>
              </DialogHeader>
              <form onSubmit={createRoom} className="flex flex-col gap-5 mt-2">
                <div>
                  <Label className="uppercase text-xs tracking-wider text-[#A1A1AA] mb-1.5 block">Room Name</Label>
                  <Input
                    data-testid="room-name-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="My Awesome Project"
                    required
                    className="bg-transparent border-b border-white/20 focus:border-[#FF3B30] rounded-none px-0 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <Label className="uppercase text-xs tracking-wider text-[#A1A1AA] mb-1.5 block">Language</Label>
                  <Select value={newLang} onValueChange={setNewLang}>
                    <SelectTrigger data-testid="room-language-select" className="bg-[#121214] border-white/10 h-10">
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
                </div>
                <Button
                  data-testid="create-room-submit"
                  type="submit"
                  className="bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-white shadow-[0_0_15px_rgba(255,59,48,0.3)] transition-all active:scale-[0.98]"
                >
                  Create Room
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-6 h-6 border-2 border-[#FF3B30] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center" data-testid="empty-state">
            <div className="w-16 h-16 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
              <Sparkles className="w-7 h-7 text-[#A1A1AA]" strokeWidth={1.5} />
            </div>
            <h3 className="heading-font text-lg font-semibold mb-1">No rooms yet</h3>
            <p className="text-sm text-[#A1A1AA] mb-4">Create your first collaborative room to get started</p>
            <Button
              data-testid="empty-create-room-button"
              onClick={() => setCreateOpen(true)}
              className="bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-white"
            >
              <Plus className="w-4 h-4 mr-2" strokeWidth={1.5} />
              Create Room
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children" data-testid="rooms-grid">
            {rooms.map((room) => {
              const myRole = room.members?.find(m => m.user_id === user?.id)?.role || 'viewer';
              return (
                <div
                  key={room.id}
                  data-testid={`room-card-${room.id}`}
                  className="group bg-[#121214]/60 backdrop-blur-md border border-white/[0.06] rounded-lg p-6 hover:border-white/15 transition-all duration-300 cursor-pointer hover:-translate-y-1"
                  onClick={() => navigate(`/room/${room.id}`)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: langColors[room.language] || '#A1A1AA' }}
                      />
                      <span className="text-xs uppercase tracking-wider text-[#A1A1AA]">{room.language}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] font-medium border ${roleColors[myRole]}`}>
                        {myRole}
                      </Badge>
                      {myRole === 'owner' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-[#A1A1AA] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity">
                              <MoreVertical className="w-3.5 h-3.5" strokeWidth={1.5} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="bg-[#121214] border-white/10">
                            <DropdownMenuItem
                              data-testid={`delete-room-${room.id}`}
                              onClick={(e) => { e.stopPropagation(); deleteRoom(room.id); }}
                              className="text-[#EF4444] focus:text-[#EF4444] focus:bg-[#EF4444]/10"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" strokeWidth={1.5} />
                              Delete Room
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  <h3 className="heading-font text-lg font-semibold mb-3 group-hover:text-white transition-colors">{room.name}</h3>
                  <Separator className="bg-white/5 mb-3" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[#52525B]">
                      <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
                      <span className="text-xs">{room.members?.length || 0} member{(room.members?.length || 0) !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[#52525B] group-hover:text-[#FF3B30] transition-colors">
                      <span className="text-xs font-medium">Open</span>
                      <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

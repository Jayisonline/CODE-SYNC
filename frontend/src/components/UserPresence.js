import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ScrollArea } from '../components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '../components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '../components/ui/dropdown-menu';
import {
  UserPlus, Crown, Pencil, Eye, MoreVertical, UserMinus, ArrowUpDown
} from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const roleIcons = {
  owner: Crown,
  editor: Pencil,
  viewer: Eye
};

const roleStyles = {
  owner: 'bg-[#FF3B30]/15 text-[#FF3B30] border-[#FF3B30]/20',
  editor: 'bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/20',
  viewer: 'bg-white/5 text-[#A1A1AA] border-white/10'
};

export function UserPresence({ roomId, token, members, onlineUsers, myRole, onMembersChange }) {
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');

  const onlineMap = {};
  (onlineUsers || []).forEach(u => { onlineMap[u.user_id] = true; });

  const inviteUser = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/rooms/${roomId}/invite?token=${token}`, {
        email: inviteEmail,
        role: inviteRole
      });
      toast.success('User invited!');
      setInviteOpen(false);
      setInviteEmail('');
      if (onMembersChange) onMembersChange();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to invite');
    }
  };

  const changeRole = async (userId, newRole) => {
    try {
      await axios.put(`${API}/rooms/${roomId}/role?token=${token}`, {
        user_id: userId,
        role: newRole
      });
      toast.success('Role updated');
      if (onMembersChange) onMembersChange();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update role');
    }
  };

  const removeMember = async (userId) => {
    try {
      await axios.delete(`${API}/rooms/${roomId}/members/${userId}?token=${token}`);
      toast.success('Member removed');
      if (onMembersChange) onMembersChange();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to remove');
    }
  };

  return (
    <div className="flex flex-col h-full" data-testid="user-presence-panel">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <span className="text-xs font-medium uppercase tracking-wider text-[#A1A1AA]">
          Members ({members?.length || 0})
        </span>
        {myRole === 'owner' && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button
                data-testid="invite-member-button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-[#A1A1AA] hover:text-white hover:bg-white/5"
              >
                <UserPlus className="w-3.5 h-3.5" strokeWidth={1.5} />
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-heavy border-white/10 sm:max-w-sm" data-testid="invite-dialog">
              <DialogHeader>
                <DialogTitle className="heading-font text-lg font-bold">Invite Member</DialogTitle>
              </DialogHeader>
              <form onSubmit={inviteUser} className="flex flex-col gap-4 mt-2">
                <div>
                  <Label className="uppercase text-xs tracking-wider text-[#A1A1AA] mb-1.5 block">Email</Label>
                  <Input
                    data-testid="invite-email-input"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    placeholder="user@example.com"
                    className="bg-transparent border-b border-white/20 focus:border-[#FF3B30] rounded-none px-0 py-2 text-sm"
                  />
                </div>
                <div>
                  <Label className="uppercase text-xs tracking-wider text-[#A1A1AA] mb-1.5 block">Role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger data-testid="invite-role-select" className="bg-[#121214] border-white/10 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#121214] border-white/10">
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  data-testid="invite-submit-button"
                  type="submit"
                  className="bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-white text-sm"
                >
                  Send Invite
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="flex flex-col gap-1.5">
          {(members || []).map(member => {
            const Icon = roleIcons[member.role] || Eye;
            const isOnline = onlineMap[member.user_id];
            const isMe = member.user_id === user?.id;
            return (
              <div
                key={member.user_id}
                data-testid={`member-${member.user_id}`}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-white/[0.03] transition-colors group"
              >
                <div className="relative">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium
                    ${member.role === 'owner' ? 'bg-[#FF3B30]/15 text-[#FF3B30]' :
                      member.role === 'editor' ? 'bg-[#007AFF]/15 text-[#007AFF]' :
                      'bg-white/10 text-[#A1A1AA]'}`}
                  >
                    {member.username?.[0]?.toUpperCase() || '?'}
                  </div>
                  {isOnline && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#10B981] border-2 border-[#09090b]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm truncate">{member.username}{isMe ? ' (you)' : ''}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Icon className="w-2.5 h-2.5 text-[#52525B]" strokeWidth={1.5} />
                    <span className="text-[10px] text-[#52525B] capitalize">{member.role}</span>
                  </div>
                </div>
                {myRole === 'owner' && !isMe && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-[#52525B] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="w-3 h-3" strokeWidth={1.5} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-[#121214] border-white/10">
                      {member.role !== 'editor' && (
                        <DropdownMenuItem
                          data-testid={`set-editor-${member.user_id}`}
                          onClick={() => changeRole(member.user_id, 'editor')}
                        >
                          <Pencil className="w-3 h-3 mr-2" strokeWidth={1.5} />
                          Make Editor
                        </DropdownMenuItem>
                      )}
                      {member.role !== 'viewer' && (
                        <DropdownMenuItem
                          data-testid={`set-viewer-${member.user_id}`}
                          onClick={() => changeRole(member.user_id, 'viewer')}
                        >
                          <Eye className="w-3 h-3 mr-2" strokeWidth={1.5} />
                          Make Viewer
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        data-testid={`remove-member-${member.user_id}`}
                        onClick={() => removeMember(member.user_id)}
                        className="text-[#EF4444] focus:text-[#EF4444] focus:bg-[#EF4444]/10"
                      >
                        <UserMinus className="w-3 h-3 mr-2" strokeWidth={1.5} />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

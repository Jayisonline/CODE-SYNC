import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Code2, ArrowRight, Mic, Users, Shield } from 'lucide-react';
import { toast } from 'sonner';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isLogin) {
        await login(email, password);
        toast.success('Welcome back!');
      } else {
        await register(email, username, password);
        toast.success('Account created!');
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex grid-texture" data-testid="auth-page">
      {/* Left - Branding */}
      <div className="hidden lg:flex lg:w-[55%] flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#09090b] via-[#121214] to-[#09090b]" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-10 h-10 rounded-md bg-[#FF3B30] flex items-center justify-center glow-primary">
              <Code2 className="w-5 h-5 text-white" strokeWidth={1.5} />
            </div>
            <span className="heading-font text-xl font-bold tracking-tight">CodeSync</span>
          </div>
          <h1 className="heading-font text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.1] tracking-tight mb-8">
            Code Together.<br />
            <span className="text-[#FF3B30]">Ship Faster.</span>
          </h1>
          <p className="text-base text-[#A1A1AA] max-w-md leading-relaxed">
            Real-time collaborative code editor with voice channels, live cursors, and AI-powered suggestions.
          </p>
        </div>
        <div className="relative z-10 flex flex-col gap-6 stagger-children">
          <FeatureRow icon={<Users className="w-4 h-4" strokeWidth={1.5} />} text="Live collaborative editing with cursors" />
          <FeatureRow icon={<Mic className="w-4 h-4" strokeWidth={1.5} />} text="Discord-style voice channels" />
          <FeatureRow icon={<Shield className="w-4 h-4" strokeWidth={1.5} />} text="Role-based access: Owner, Editor, Viewer" />
        </div>
      </div>

      {/* Right - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-md bg-[#FF3B30] flex items-center justify-center">
              <Code2 className="w-4 h-4 text-white" strokeWidth={1.5} />
            </div>
            <span className="heading-font text-lg font-bold">CodeSync</span>
          </div>

          <h2 className="heading-font text-2xl font-bold tracking-tight mb-2">
            {isLogin ? 'Sign in' : 'Create account'}
          </h2>
          <p className="text-sm text-[#A1A1AA] mb-8">
            {isLogin ? 'Enter your credentials to continue' : 'Get started with your free account'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5" data-testid="auth-form">
            <div>
              <Label className="uppercase text-xs tracking-wider text-[#A1A1AA] mb-1.5 block">Email</Label>
              <Input
                data-testid="auth-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-transparent border-b border-white/20 focus:border-[#FF3B30] rounded-none px-0 py-2.5 text-sm placeholder:text-[#52525B]"
                placeholder="you@example.com"
              />
            </div>

            {!isLogin && (
              <div className="animate-fade-in-up">
                <Label className="uppercase text-xs tracking-wider text-[#A1A1AA] mb-1.5 block">Username</Label>
                <Input
                  data-testid="auth-username-input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="bg-transparent border-b border-white/20 focus:border-[#FF3B30] rounded-none px-0 py-2.5 text-sm placeholder:text-[#52525B]"
                  placeholder="johndoe"
                />
              </div>
            )}

            <div>
              <Label className="uppercase text-xs tracking-wider text-[#A1A1AA] mb-1.5 block">Password</Label>
              <Input
                data-testid="auth-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-transparent border-b border-white/20 focus:border-[#FF3B30] rounded-none px-0 py-2.5 text-sm placeholder:text-[#52525B]"
                placeholder="Enter password"
              />
            </div>

            <Button
              data-testid="auth-submit-button"
              type="submit"
              disabled={submitting}
              className="mt-3 bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-white shadow-[0_0_15px_rgba(255,59,48,0.3)] transition-all duration-200 active:scale-[0.98] h-11"
            >
              {submitting ? 'Loading...' : isLogin ? 'Sign In' : 'Create Account'}
              <ArrowRight className="w-4 h-4 ml-2" strokeWidth={1.5} />
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-[#A1A1AA]">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button
              data-testid="auth-toggle-mode"
              onClick={() => { setIsLogin(!isLogin); }}
              className="text-[#FF3B30] hover:text-[#FF3B30]/80 ml-1 font-medium transition-colors"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function FeatureRow({ icon, text }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-[#FF3B30]">
        {icon}
      </div>
      <span className="text-sm text-[#A1A1AA]">{text}</span>
    </div>
  );
}

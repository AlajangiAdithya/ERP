import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, User, AlertCircle, ShieldCheck, Rocket } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const normalizeError = (err) => {
  const status = err?.response?.status;
  const raw = err?.response?.data?.error;
  if (status === 401 || /invalid credentials/i.test(raw || '')) {
    return 'Incorrect username or password. Please try again.';
  }
  if (!err?.response) {
    return 'Cannot reach server. Check your connection and try again.';
  }
  return raw || 'Login failed. Please try again.';
};

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-navy-900">
      {/* Rocket photo background — subtle */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat scale-110"
        style={{ backgroundImage: "url('/rocket.jpg')" }}
        aria-hidden="true"
      />
      {/* Dark gradient overlay for legibility */}
      <div className="absolute inset-0 bg-gradient-to-br from-navy-900/85 via-navy-800/75 to-navy-900/95" aria-hidden="true" />
      {/* Decorative blur orbs */}
      <div className="absolute -top-24 -left-24 w-[28rem] h-[28rem] bg-blue-500/20 rounded-full blur-3xl" aria-hidden="true" />
      <div className="absolute -bottom-32 -right-24 w-[32rem] h-[32rem] bg-blue-400/15 rounded-full blur-3xl" aria-hidden="true" />
      <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl" aria-hidden="true" />

      <div className="w-full max-w-md relative z-10">
        {/* Glass card */}
        <div className="backdrop-blur-xl bg-white/95 rounded-3xl shadow-[0_25px_70px_-15px_rgba(0,0,0,0.6)] border border-white/40 p-8 sm:p-10 animate-fade-in">
          <div className="flex flex-col items-center mb-8">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-blue-500/30 blur-2xl rounded-full" aria-hidden="true" />
              <div className="relative bg-gradient-to-br from-blue-50 to-white rounded-2xl p-3 ring-1 ring-blue-100 shadow-lg">
                <img
                  src="/rapslogo6.png"
                  alt="RAPS"
                  className="h-20 w-auto object-contain"
                />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-navy-800 tracking-tight">Welcome back</h1>
            <p className="text-sm text-navy-500 mt-1">Sign in to your RAPS ERP account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl animate-fade-in"
              >
                <AlertCircle size={18} className="text-brand-red flex-shrink-0 mt-0.5" />
                <p className="text-sm font-medium text-brand-red leading-snug">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-navy-700 uppercase tracking-wider mb-1.5">
                Username
              </label>
              <div className="relative">
                <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  required
                  autoComplete="username"
                  className="w-full pl-10 pr-3 py-2.5 bg-white border border-navy-200 rounded-xl text-[14px] text-navy-800 placeholder:text-navy-300 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-navy-700 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-11 py-2.5 bg-white border border-navy-200 rounded-xl text-[14px] text-navy-800 placeholder:text-navy-300 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-700 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full relative overflow-hidden group bg-gradient-to-r from-navy-700 via-blue-700 to-navy-700 hover:from-navy-800 hover:via-blue-800 hover:to-navy-800 text-white font-semibold py-2.5 rounded-xl shadow-lg shadow-blue-900/30 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]"
            >
              <span className="relative flex items-center justify-center gap-2 text-[14px]">
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <Rocket size={15} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </>
                )}
              </span>
            </button>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-navy-400 pt-1">
              <ShieldCheck size={12} />
              <span>Secure session — stays signed in until you sign out</span>
            </div>
          </form>
        </div>

        <p className="text-center text-xs text-white/60 mt-6 tracking-wide">
          © {new Date().getFullYear()} RAPS ERP · All rights reserved
        </p>
      </div>
    </div>
  );
}

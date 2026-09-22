"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AwsLogo } from "@/components/aws-logo";
import { Eye, EyeOff, Lock } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // Server set an httpOnly session cookie; keep the local flag for any
        // client-only UI checks, then enter the console.
        localStorage.setItem("cf_auth", "1");
        router.push("/console/sources");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Invalid credentials");
        setLoading(false);
      }
    } catch {
      setError("Could not reach the server. Try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[150px] opacity-[0.08] bg-indigo-500" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[300px] rounded-full blur-[120px] opacity-[0.05] bg-purple-500" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <svg className="w-8 h-8" viewBox="0 0 40 40" fill="none"><path d="M20 4L36 12v16L20 36 4 28V12L20 4z" fill="url(#lg)" /><path d="M14 20c0-3.3 2.7-6 6-6s6 2.7 6 6-2.7 6-6 6-6-2.7-6-6z" fill="#fff" fillOpacity="0.9"/><path d="M18 18l2 4 2-4" stroke="#232f3e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><defs><linearGradient id="lg" x1="4" y1="4" x2="36" y2="36"><stop stopColor="#6366f1"/><stop offset="1" stopColor="#a855f7"/></linearGradient></defs></svg>
            <span className="text-2xl font-bold"><span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Ground</span><span className="text-white">Work</span></span>
          </div>
          <p className="text-sm text-zinc-500">Semantic Context Engineering Platform</p>
        </div>

        {/* Login card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl p-6 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-1">Sign in</h2>
          <p className="text-xs text-zinc-500 mb-6">Enter your credentials to access your workspace</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
                className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Password</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                  className="w-full px-3 py-2.5 pr-10 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-colors" />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                <input type="checkbox" className="accent-indigo-500 rounded" /> Remember me
              </label>
              <button type="button" className="text-xs text-indigo-400 hover:text-indigo-300">Forgot password?</button>
            </div>

            {error && <p className="text-xs text-red-400 bg-red-950/20 border border-red-800/20 rounded-lg px-3 py-2">{error}</p>}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium shadow-lg shadow-indigo-900/30 transition-all flex items-center justify-center gap-2">
              {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Signing in...</> : <><Lock className="w-3.5 h-3.5" /> Sign in</>}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-white/[0.06] text-center">
            <p className="text-[11px] text-zinc-600">SSO available via</p>
            <div className="flex items-center justify-center gap-3 mt-2">
              <button className="px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] text-xs text-zinc-300 transition-colors">SAML</button>
              <button className="px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] text-xs text-zinc-300 transition-colors">Okta</button>
              <button className="px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#232f3e] hover:bg-[#2d3b4e] text-xs text-zinc-300 transition-colors flex items-center gap-1.5">
                <AwsLogo className="h-2.5" /> IAM
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-center gap-2">
          <AwsLogo className="h-3.5" />
          <span className="text-[10px] text-zinc-600">Secured by Amazon Cognito</span>
        </div>
      </div>
    </div>
  );
}

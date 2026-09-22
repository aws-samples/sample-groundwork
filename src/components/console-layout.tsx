"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Database, GitBranch, Search, Activity, Settings2, Shield, Zap, Menu, X, Bell, Settings, ChevronDown, CreditCard, LogOut, Users, Rocket, Wrench } from "lucide-react";
import { useState } from "react";
import { enterprise } from "@/data/enterprise";
import { AwsLogo } from "@/components/aws-logo";
import { FidelityBadge } from "@/components/fidelity-badge";

const navItems = [
  { href: "/console/sources", label: "Sources", icon: Database },
  { href: "/console/pipeline", label: "Pipeline", icon: Settings2 },
  { href: "/console/graph", label: "Graph", icon: GitBranch },
  { href: "/console/query", label: "Query", icon: Search },
  { href: "/console/monitor", label: "Monitor", icon: Activity },
  { href: "/console/onboarding", label: "New Vertical", icon: Rocket },
  { href: "/console/usage", label: "Usage & Billing", icon: CreditCard },
  { href: "/console/settings", label: "Settings", icon: Settings },
  { href: "/portal", label: "Customer Portal", icon: Users },
];

export function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { vertical, setVertical } = useAppStore();
  const [mobileNav, setMobileNav] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showUser, setShowUser] = useState(false);

  const unread = enterprise.notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-zinc-100">
      <div className="fixed inset-0 pointer-events-none">
        <div className={cn("absolute top-0 left-1/2 -translate-x-1/2 w-[600px] md:w-[800px] h-[300px] md:h-[400px] rounded-full blur-[120px] opacity-[0.05] transition-colors duration-1000", vertical === "cyber" ? "bg-red-500" : vertical === "energy" ? "bg-emerald-500" : "bg-indigo-500")} />
      </div>

      <header className="relative border-b border-white/[0.06] bg-white/[0.02] backdrop-blur-xl px-4 md:px-5 py-2.5 flex items-center justify-between z-30">
        <div className="flex items-center gap-2 md:gap-3">
          <button onClick={() => setMobileNav(!mobileNav)} className="md:hidden p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-400">
            {mobileNav ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <svg className="w-6 h-6" viewBox="0 0 40 40" fill="none"><path d="M20 4L36 12v16L20 36 4 28V12L20 4z" fill="url(#aws-g)" /><path d="M14 20c0-3.3 2.7-6 6-6s6 2.7 6 6-2.7 6-6 6-6-2.7-6-6z" fill="#fff" fillOpacity="0.9"/><path d="M18 18l2 4 2-4" stroke="#232f3e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><defs><linearGradient id="aws-g" x1="4" y1="4" x2="36" y2="36"><stop stopColor="#6366f1"/><stop offset="1" stopColor="#a855f7"/></linearGradient></defs></svg>
          <div className="text-base font-bold tracking-tight">
            <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Ground</span><span className="text-white">Work</span>
          </div>
          <FidelityBadge />

          {/* Workspace selector */}
          <div className="hidden md:block relative ml-3">
            <button onClick={() => setShowWorkspace(!showWorkspace)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] text-xs text-zinc-300 transition-colors">
              {enterprise.workspaces[0].name} <ChevronDown className="w-3 h-3 text-zinc-500" />
            </button>
            {showWorkspace && (
              <div className="absolute top-full left-0 mt-1 w-56 rounded-xl border border-white/[0.08] bg-[#111118] shadow-2xl z-50 py-1">
                <div className="px-3 py-1.5 border-b border-white/[0.06]"><p className="text-[10px] uppercase tracking-wider text-zinc-500">Workspaces</p></div>
                {enterprise.workspaces.map((ws) => (
                  <button key={ws.id} onClick={() => setShowWorkspace(false)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/[0.04] text-left">
                    <div><div className="text-sm text-zinc-200">{ws.name}</div><div className="text-[10px] text-zinc-600">{ws.members} members • {ws.plan}</div></div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2">
          {/* Vertical toggle */}
          <button onClick={() => setVertical("cyber")} className={cn("flex items-center gap-1 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition-all", vertical === "cyber" ? "bg-gradient-to-r from-red-950/80 to-red-900/50 text-red-300 border border-red-700/50" : "text-zinc-500 hover:text-zinc-300")}>
            <Shield className="w-3 h-3" /> <span className="hidden sm:inline">Cyber</span>
          </button>
          <button onClick={() => setVertical("energy")} className={cn("flex items-center gap-1 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition-all", vertical === "energy" ? "bg-gradient-to-r from-emerald-950/80 to-emerald-900/50 text-emerald-300 border border-emerald-700/50" : "text-zinc-500 hover:text-zinc-300")}>
            <Zap className="w-3 h-3" /> <span className="hidden sm:inline">Energy</span>
          </button>
          <button onClick={() => setVertical("otsec")} className={cn("flex items-center gap-1 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition-all", vertical === "otsec" ? "bg-gradient-to-r from-indigo-950/80 to-indigo-900/50 text-indigo-300 border border-indigo-700/50" : "text-zinc-500 hover:text-zinc-300")}>
            <Shield className="w-3 h-3" /> <span className="hidden sm:inline">OT Sec</span>
          </button>
          <button onClick={() => setVertical("prodquality")} className={cn("flex items-center gap-1 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition-all", vertical === "prodquality" ? "bg-gradient-to-r from-amber-950/80 to-amber-900/50 text-amber-300 border border-amber-700/50" : "text-zinc-500 hover:text-zinc-300")}>
            <Wrench className="w-3 h-3" /> <span className="hidden sm:inline">Product Quality</span>
          </button>
          <div className="w-px h-5 bg-white/[0.06] mx-1 hidden md:block" />

          {/* Notifications */}
          <div className="relative">
            <button onClick={() => setShowNotifs(!showNotifs)} className="relative p-2 rounded-lg hover:bg-white/[0.06] text-zinc-400 transition-colors">
              <Bell className="w-4 h-4" />
              {unread > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-indigo-500 rounded-full" />}
            </button>
            {showNotifs && (
              <div className="absolute top-full right-0 mt-1 w-72 rounded-xl border border-white/[0.08] bg-[#111118] shadow-2xl z-50">
                <div className="px-3 py-2 border-b border-white/[0.06] flex justify-between items-center">
                  <p className="text-xs font-medium text-zinc-300">Notifications</p>
                  <span className="text-[10px] text-indigo-400">{unread} new</span>
                </div>
                {enterprise.notifications.map((n) => (
                  <div key={n.id} className={cn("px-3 py-2.5 border-b border-white/[0.04] last:border-0", !n.read && "bg-indigo-950/10")}>
                    <div className="text-xs font-medium text-zinc-200">{n.title}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">{n.desc}</div>
                    <div className="text-[10px] text-zinc-600 mt-1">{n.time}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* User avatar */}
          <div className="relative flex items-center gap-2 pl-1">
            <button onClick={() => setShowUser(!showUser)} className="flex items-center gap-2 hover:bg-white/[0.04] rounded-lg px-1.5 py-1 transition-colors">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white">{enterprise.currentUser.avatar}</div>
              <div className="hidden md:block text-left">
                <div className="text-xs text-zinc-200 leading-none">{enterprise.currentUser.name}</div>
                <div className="text-[10px] text-amber-400 mt-0.5">{enterprise.currentUser.role}</div>
              </div>
            </button>
            {showUser && (
              <div className="absolute top-full right-0 mt-1 w-48 rounded-xl border border-white/[0.08] bg-[#111118] shadow-2xl z-50 py-1">
                <div className="px-3 py-2 border-b border-white/[0.06]">
                  <div className="text-sm text-zinc-200">{enterprise.currentUser.name}</div>
                  <div className="text-[11px] text-zinc-500">{enterprise.currentUser.email}</div>
                </div>
                <button onClick={() => { localStorage.removeItem("cf_auth"); window.location.href = "/login"; }}
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-950/20 transition-colors flex items-center gap-2">
                  <LogOut className="w-3.5 h-3.5" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="relative flex">
        <nav className="hidden md:flex flex-col w-52 border-r border-white/[0.06] min-h-[calc(100vh-53px)] p-3 bg-white/[0.01] justify-between">
          <div className="space-y-1">
            <NavLinks pathname={pathname} onNavigate={() => {}} />
          </div>
          <div className="pt-3 mt-3 border-t border-white/[0.06]">
            <div className="px-3 py-2 rounded-lg bg-[#232f3e] flex items-center justify-center">
              <AwsLogo className="h-4" />
            </div>
            <div className="px-3 mt-2 space-y-0.5 text-[10px] text-zinc-600">
              <div>Bedrock • Neptune • OpenSearch</div>
              <div>S3 • CloudFront • Lambda</div>
            </div>
          </div>
        </nav>

        {mobileNav && (
          <div className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNav(false)}>
            <nav className="absolute top-[53px] left-0 w-64 h-[calc(100vh-53px)] bg-[#0a0a0f] border-r border-white/[0.06] p-3 space-y-1 overflow-auto" onClick={(e) => e.stopPropagation()}>
              <NavLinks pathname={pathname} onNavigate={() => setMobileNav(false)} />
            </nav>
          </div>
        )}

        <main className="flex-1 p-4 md:p-6 overflow-auto min-h-[calc(100vh-53px)]">{children}</main>
      </div>
    </div>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  return (
    <>
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} onClick={onNavigate}
            className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-200", active ? "bg-white/[0.08] text-white border border-white/[0.06]" : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]")}>
            <Icon className={cn("w-4 h-4", active && "text-indigo-400")} />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

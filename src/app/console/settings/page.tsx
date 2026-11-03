"use client";
import { useState } from "react";
import { enterprise, roles, classifications } from "@/data/enterprise";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Shield, Key, Users, ScrollText, Lock, Plus, Copy, Eye } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useApiJson } from "@/lib/use-api-json";
import type { SourceEvent, SourcesResponse } from "@/lib/coa-source-shape";
import { formatUtc } from "@/components/vertical-sources";

const tabs = [
  { id: "team", label: "Team Members", icon: Users },
  { id: "keys", label: "API Keys", icon: Key },
  { id: "governance", label: "Data Governance", icon: Shield },
  { id: "audit", label: "Audit Log", icon: ScrollText },
];

export default function SettingsPage() {
  const [tab, setTab] = useState("team");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Settings</h1>
        <p className="text-sm text-zinc-400 mt-0.5">Workspace administration & security</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/[0.06] pb-px overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn("flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap",
                tab === t.id ? "text-white border-b-2 border-indigo-500 bg-white/[0.03]" : "text-zinc-500 hover:text-zinc-300")}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
      </div>

      {tab === "team" && <TeamTab />}
      {tab === "keys" && <ApiKeysTab />}
      {tab === "governance" && <GovernanceTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function TeamTab() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-zinc-400">{enterprise.teamMembers.length} members in workspace</p>
        <button className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg text-xs font-medium"><Plus className="w-3.5 h-3.5" />Invite Member</button>
      </div>
      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/[0.06] bg-white/[0.02]">
            <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium">Member</th>
            <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium">Role</th>
            <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium hidden md:table-cell">Status</th>
            <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium hidden md:table-cell">Last Active</th>
          </tr></thead>
          <tbody>
            {enterprise.teamMembers.map((m) => (
              <tr key={m.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3"><div className="text-zinc-200">{m.name}</div><div className="text-[11px] text-zinc-600">{m.email}</div></td>
                <td className="px-4 py-3"><span className={cn("text-xs px-2 py-0.5 rounded-full border", roles[m.role as keyof typeof roles].color)}>{m.role}</span></td>
                <td className="px-4 py-3 hidden md:table-cell"><span className={cn("text-xs", m.status === "Active" ? "text-emerald-400" : "text-amber-400")}>{m.status}</span></td>
                <td className="px-4 py-3 text-xs text-zinc-500 hidden md:table-cell">{m.lastActive}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApiKeysTab() {
  const [showKey, setShowKey] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-zinc-400">Manage API keys for programmatic access</p>
        <button className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg text-xs font-medium"><Plus className="w-3.5 h-3.5" />Create Key</button>
      </div>
      <div className="space-y-3">
        {enterprise.apiKeys.map((k) => (
          <div key={k.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-zinc-200">{k.name}</div>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs text-zinc-500 bg-black/30 px-2 py-0.5 rounded font-mono">{showKey === k.id ? "cf_demo_EXAMPLE_KEY_not_a_real_secret" : k.key}</code>
                  <button onClick={() => setShowKey(showKey === k.id ? null : k.id)} className="text-zinc-600 hover:text-zinc-400"><Eye className="w-3 h-3" /></button>
                  <button className="text-zinc-600 hover:text-zinc-400"><Copy className="w-3 h-3" /></button>
                </div>
              </div>
              <Badge className={cn("text-[10px]", k.status === "Active" ? "bg-emerald-950/30 text-emerald-400 border border-emerald-800/30" : "bg-red-950/30 text-red-400 border border-red-800/30")}>{k.status}</Badge>
            </div>
            <div className="flex gap-4 mt-3 text-[11px] text-zinc-600">
              <span>Created: {k.created}</span><span>Last used: {k.lastUsed}</span><span>Calls: {k.calls.toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GovernanceTab() {
  const gov = enterprise.dataGovernance;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium flex items-center gap-1.5"><Lock className="w-3 h-3" />Encryption & Storage</h3>
          <Item label="Encryption at rest" value={gov.encryption} />
          <Item label="Data region" value={gov.region} />
          <Item label="Data retention" value={gov.retention} />
          <Item label="Audit log retention" value={gov.auditRetention} />
          <Item label="DLP scanning" value={gov.dlpEnabled ? "Enabled" : "Disabled"} />
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium flex items-center gap-1.5"><Shield className="w-3 h-3" />Compliance</h3>
          <div className="flex flex-wrap gap-2">
            {gov.compliance.map((c) => (<span key={c} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-950/30 text-emerald-400 border border-emerald-800/20">{c}</span>))}
          </div>
          <div className="pt-3 border-t border-white/[0.06]">
            <h4 className="text-xs text-zinc-500 mb-2">Data Classification Levels</h4>
            <div className="flex flex-wrap gap-2">
              {gov.classifications.map((c) => (<span key={c} className={cn("text-xs px-2 py-0.5 rounded-full border", classifications[c as keyof typeof classifications].color)}>{c}</span>))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const AUDIT_ACTION: Record<SourceEvent["kind"], string> = {
  "seed-ingested": "Seed document ingested",
  "source-registered": "Source registered",
  "source-scanned": "Source scanned",
  "source-updated": "Source updated",
};
/** Strip the trailing verb the event title carries ("<name> ingested" → "<name>"). */
function auditTarget(e: SourceEvent): string {
  return e.title.replace(/ (ingested|registered|scanned|updated)$/, "");
}

/** Real source lifecycle events only (GET /api/sources), in absolute UTC. */
function AuditTab() {
  const { vertical } = useAppStore();
  const { data, error, loading } = useApiJson<SourcesResponse>(`/api/sources?vertical=${encodeURIComponent(vertical)}`);
  const events = data?.events ?? [];
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/[0.06] bg-white/[0.02]">
            <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium">Action</th>
            <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium hidden md:table-cell">User</th>
            <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium">Target</th>
            <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium hidden md:table-cell">IP</th>
            <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium">Time</th>
          </tr></thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={`${e.at}-${i}`} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-2.5 text-zinc-200 text-xs">{AUDIT_ACTION[e.kind] ?? e.kind}</td>
                <td className="px-4 py-2.5 text-zinc-400 text-xs hidden md:table-cell">{e.kind === "seed-ingested" ? "Seed loader" : "COA"}</td>
                <td className="px-4 py-2.5 text-zinc-400 text-xs font-mono">{auditTarget(e)}</td>
                <td className="px-4 py-2.5 text-zinc-600 text-xs font-mono hidden md:table-cell">—</td>
                <td className="px-4 py-2.5 text-zinc-500 text-xs">{formatUtc(e.at)}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-4 text-xs text-zinc-500">
                {loading ? "Loading…" : error ? `Events unavailable: ${error}` : "No source lifecycle events for this vertical."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-zinc-500">Only source lifecycle events are shown. User and admin actions are not recorded in this demo.</p>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (<div className="flex justify-between text-sm"><span className="text-zinc-500">{label}</span><span className="text-zinc-200 font-medium">{value}</span></div>);
}

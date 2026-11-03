"use client";
import { enterprise } from "@/data/enterprise";
import { verticals } from "@/data/verticals";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";

export default function UsagePage() {
  const { vertical } = useAppStore();
  const u = enterprise.usage;
  const costData = [
    { name: "OpenSearch", cost: u.costs.opensearch, fill: "#6366f1" },
    { name: "Neptune", cost: u.costs.neptune, fill: "#8b5cf6" },
    { name: "Bedrock", cost: u.costs.bedrock, fill: "#a855f7" },
    { name: "Lambda", cost: u.costs.lambda, fill: "#3b82f6" },
    { name: "S3", cost: u.costs.s3, fill: "#06b6d4" },
  ];

  const tokenData = [
    { name: "Embedding", tokens: u.tokenConsumption.embedding / 1_000_000, fill: "#6366f1" },
    { name: "Generation", tokens: u.tokenConsumption.generation / 1_000_000, fill: "#a855f7" },
    { name: "Extraction", tokens: u.tokenConsumption.extraction / 1_000_000, fill: "#8b5cf6" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Usage & Billing</h1>
          <p className="text-sm text-zinc-400 mt-0.5">{u.period} — {verticals[vertical].workspaceName} workspace</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white">${u.costs.total.toFixed(2)}</div>
          <div className="text-xs text-zinc-500">month-to-date</div>
        </div>
      </div>

      <div className="rounded-lg border border-amber-800/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90">
        <span className="font-medium">Illustrative:</span> workspace billing figures on this page are demo values, not metered from AWS.
      </div>

      {/* Quotas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <QuotaCard label="Queries / min" used={u.quotas.queriesPerMin.used} limit={u.quotas.queriesPerMin.limit} unit="" />
        <QuotaCard label="Storage" used={u.quotas.storageTB.used} limit={u.quotas.storageTB.limit} unit=" TB" />
        <QuotaCard label="Team Members" used={u.quotas.teamMembers.used} limit={u.quotas.teamMembers.limit} unit="" />
      </div>

      {/* Cost breakdown + Token consumption */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h3 className="text-sm font-medium text-zinc-300 mb-4">Cost Breakdown by Service</h3>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costData} margin={{ left: 5, right: 10 }}>
                <XAxis dataKey="name" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#52525b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px" }} formatter={(v) => [`$${Number(v).toFixed(2)}`, "Cost"]} />
                <Bar dataKey="cost" radius={[4, 4, 0, 0]} barSize={32}>
                  {costData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h3 className="text-sm font-medium text-zinc-300 mb-4">Token Consumption (millions)</h3>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tokenData} layout="vertical" margin={{ left: 10, right: 10 }}>
                <XAxis type="number" tick={{ fill: "#52525b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}M`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} width={80} />
                <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px" }} formatter={(v) => [`${Number(v).toFixed(1)}M tokens`, ""]} />
                <Bar dataKey="tokens" radius={[0, 4, 4, 0]} barSize={20}>
                  {tokenData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* API Calls */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h3 className="text-sm font-medium text-zinc-300 mb-4">API Calls This Month</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <div className="text-2xl font-bold text-indigo-400">{u.apiCalls.queries.toLocaleString()}</div>
            <div className="text-xs text-zinc-500 mt-1">Queries</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <div className="text-2xl font-bold text-purple-400">{u.apiCalls.graphOps.toLocaleString()}</div>
            <div className="text-xs text-zinc-500 mt-1">Graph Operations</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <div className="text-2xl font-bold text-emerald-400">{u.apiCalls.ingestion.toLocaleString()}</div>
            <div className="text-xs text-zinc-500 mt-1">Ingestion Jobs</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuotaCard({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const pct = (used / limit) * 100;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-zinc-500">{label}</span>
        <span className="text-xs text-zinc-300">{used}{unit} / {limit}{unit}</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", pct > 80 ? "bg-amber-500" : "bg-indigo-500")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

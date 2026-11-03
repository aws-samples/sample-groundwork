export type Vertical = "cyber" | "energy" | "otsec" | "prodquality";

/*
 * Per-vertical presentation config. Every console page that differs between
 * verticals reads one of these fields instead of branching on the vertical id,
 * and every vertical carries every field so `verticals[vertical]` stays
 * type-safe. Live data (sources, schema, events) comes from the API routes,
 * never from here.
 */
export type VerticalIcon = "shield" | "zap" | "wrench";
/** Source-type ids offered by the Add Source walkthrough. */
export type AddSourceTypeId = "s3" | "web" | "api" | "csv" | "confluence" | "jdbc";
export interface AddSourceConfig {
  /** Hint shown on the Configure step. */
  configureHint: string;
  /** Prefilled display name and path per source type (placeholders only). */
  defaults: Record<AddSourceTypeId, { name: string; path: string }>;
}
export interface CoaQuery {
  question: string;
}
export interface VerticalPresentation {
  /** Header workspace button label. */
  workspaceName: string;
  /** Header vertical toggle label. */
  toggleLabel: string;
  icon: VerticalIcon;
  /** Graph node colour per entity type (the graph page falls back to a palette). */
  graphColors: Record<string, string>;
  addSource: AddSourceConfig;
  /** Example questions for Live COA mode, when its corpus differs from the seed. */
  coaQueries?: CoaQuery[];
}

const presentation: Record<Vertical, VerticalPresentation> = {
  cyber: {
    workspaceName: "Security Operations",
    toggleLabel: "Cyber",
    icon: "shield",
    graphColors: {
      ThreatActor: "#ef4444", CVE: "#f59e0b", Technique: "#8b5cf6", Malware: "#ec4899", Campaign: "#06b6d4", Asset: "#10b981", Indicator: "#6366f1",
    },
    addSource: {
      configureHint: "Documents are parsed, chunked and embedded for vector search; CVEs, techniques and threat actors map onto the pack ontology.",
      defaults: {
        s3: { name: "Threat Intel Reports", path: "s3://<your-bucket>/threat-intel/" },
        web: { name: "MITRE ATT&CK", path: "https://attack.mitre.org/techniques/" },
        api: { name: "NVD CVE API", path: "https://services.nvd.nist.gov/rest/json/cves/2.0" },
        csv: { name: "SBOM Registry", path: "sbom-enterprise-2024.json (CycloneDX)" },
        confluence: { name: "Security Runbooks", path: "Confluence Space: SEC-OPS" },
        jdbc: { name: "Security database", path: "jdbc:postgresql://<host>:5432/<database>" },
      },
    },
  },
  energy: {
    workspaceName: "Grid Operations",
    toggleLabel: "Energy",
    icon: "zap",
    graphColors: {
      Outage: "#ef4444", Asset: "#10b981", Crew: "#3b82f6", Obstacle: "#f59e0b", Feeder: "#06b6d4", Customer: "#a855f7", RootCause: "#ec4899",
    },
    addSource: {
      configureHint: "Documents are parsed, chunked and embedded for vector search; outages, assets, feeders and crews map onto the pack ontology.",
      defaults: {
        s3: { name: "NERC CIP Standards", path: "s3://<your-bucket>/nerc-cip/" },
        web: { name: "FERC Regulations", path: "https://www.ferc.gov/industries-data/" },
        api: { name: "Grid Telemetry API", path: "https://api.grid-ops.internal/v2/events" },
        csv: { name: "Asset Registry", path: "asset-registry-substations.csv (550 records)" },
        confluence: { name: "Maintenance Procedures", path: "Confluence Space: GRID-OPS" },
        jdbc: { name: "Grid operations database", path: "jdbc:postgresql://<host>:5432/<database>" },
      },
    },
  },
  otsec: {
    workspaceName: "OT Security Operations",
    toggleLabel: "OT Sec",
    icon: "shield",
    graphColors: {
      ThreatGroup: "#ef4444", Vulnerability: "#f59e0b", ICSTechnique: "#8b5cf6", Malware: "#ec4899", OTAsset: "#10b981", PurdueZone: "#06b6d4", Compliance: "#3b82f6",
    },
    addSource: {
      configureHint: "Documents are parsed, chunked and embedded for vector search; threat groups, ICS techniques and OT assets map onto the pack ontology.",
      defaults: {
        s3: { name: "ICS-CERT Advisories", path: "s3://<your-bucket>/ics-advisories/" },
        web: { name: "MITRE ATT&CK for ICS", path: "https://attack.mitre.org/matrices/ics/" },
        api: { name: "OT Asset Inventory API", path: "https://<your-api>/ot-assets" },
        csv: { name: "Vulnerability scan export", path: "ot-vuln-scan.csv" },
        confluence: { name: "Plant runbooks", path: "Confluence Space: <PLANT-OPS>" },
        jdbc: { name: "OT asset database", path: "jdbc:postgresql://<host>:5432/<database>" },
      },
    },
    // Live COA runs against a different corpus (MITRE ATT&CK for ICS + NVD
    // CVEs) than the local seed, so these presets replace the seed's hero
    // questions in coa mode.
    coaQueries: [
      { question: "Which ICS threat groups can reach our PLCs and what techniques would they use?" },
      { question: "What is CVE-2024-36401 in GeoServer, how severe is it, and how could it be exploited?" },
      { question: "How can an attacker achieve persistence on a Siemens PLC?" },
    ],
  },
  prodquality: {
    workspaceName: "Product Quality",
    toggleLabel: "Product Quality",
    icon: "wrench",
    graphColors: {
      Product: "#f59e0b", ReviewCluster: "#ef4444", Region: "#06b6d4", Store: "#3b82f6", Return: "#ec4899", Component: "#10b981", ComponentLot: "#a855f7", Supplier: "#8b5cf6", PurchaseOrder: "#eab308", SupplierScorecard: "#14b8a6", RootCause: "#f43f5e", CorrectiveAction: "#22c55e",
    },
    addSource: {
      configureHint: "Documents are parsed, chunked and embedded for vector search; products, components, lots and suppliers map onto the pack ontology.",
      defaults: {
        s3: { name: "QA Lab Reports", path: "s3://<your-bucket>/qa-reports/" },
        web: { name: "Supplier portal bulletins", path: "https://<supplier-portal>/bulletins/" },
        api: { name: "Returns / RMA API", path: "https://<your-api>/returns" },
        csv: { name: "Bill of Materials export", path: "bom-export.csv" },
        confluence: { name: "CAPA procedures", path: "Confluence Space: <QUALITY>" },
        jdbc: { name: "Quality database", path: "jdbc:postgresql://<host>:5432/<database>" },
      },
    },
  },
};

export const verticals = {
  cyber: {
    ...presentation.cyber,
    name: "ThreatGraph Intelligence",
    description: "Cybersecurity threat intelligence & attack chain analysis",
    color: "red",
    entityTypes: ["CVE", "ThreatActor", "Technique", "Malware", "Campaign", "Asset", "Indicator"],
    relationTypes: ["EXPLOITS", "USES_TECHNIQUE", "DEPLOYS_MALWARE", "CHAINS_TO", "AFFECTS_ASSET", "ATTRIBUTED_TO", "MITIGATED_BY"],
    graphNodes: [
      { id: "apt29", label: "Midnight Blizzard", type: "ThreatActor" },
      { id: "cve1", label: "CVE-2020-10148", type: "CVE" },
      { id: "t1", label: "T1195.002", type: "Technique" },
      { id: "t2", label: "T1546.003", type: "Technique" },
      { id: "t3", label: "T1071.001", type: "Technique" },
      { id: "t4", label: "T1550.001", type: "Technique" },
      { id: "t5", label: "T1567.002", type: "Technique" },
      { id: "m1", label: "SUNBURST", type: "Malware" },
      { id: "c1", label: "SolarWinds Campaign", type: "Campaign" },
      { id: "vt", label: "Volt Typhoon", type: "ThreatActor" },
      { id: "t6", label: "T1190", type: "Technique" },
      { id: "t7", label: "T1059.001", type: "Technique" },
      { id: "cve2", label: "CVE-2021-44228", type: "CVE" },
      { id: "a1", label: "log4j-core:2.14.1", type: "Asset" },
      { id: "a2", label: "spring-boot:2.6.1", type: "Asset" },
      { id: "sc", label: "Scattered Spider", type: "ThreatActor" },
      { id: "t8", label: "T1566.004", type: "Technique" },
      { id: "c2", label: "Log4Shell Campaign", type: "Campaign" },
    ],
    graphLinks: [
      { source: "apt29", target: "c1", label: "ATTRIBUTED_TO" },
      { source: "c1", target: "cve1", label: "EXPLOITS" },
      { source: "c1", target: "m1", label: "DEPLOYS_MALWARE" },
      { source: "apt29", target: "t1", label: "USES_TECHNIQUE" },
      { source: "apt29", target: "t2", label: "USES_TECHNIQUE" },
      { source: "t1", target: "t2", label: "CHAINS_TO" },
      { source: "t2", target: "t3", label: "CHAINS_TO" },
      { source: "t3", target: "t4", label: "CHAINS_TO" },
      { source: "t4", target: "t5", label: "CHAINS_TO" },
      { source: "vt", target: "t6", label: "USES_TECHNIQUE" },
      { source: "vt", target: "t7", label: "USES_TECHNIQUE" },
      { source: "cve2", target: "a1", label: "AFFECTS_ASSET" },
      { source: "cve2", target: "a2", label: "AFFECTS_ASSET" },
      { source: "c2", target: "cve2", label: "EXPLOITS" },
      { source: "sc", target: "t8", label: "USES_TECHNIQUE" },
      { source: "m1", target: "t3", label: "USES_TECHNIQUE" },
    ],
    queries: [
      {
        question: "Trace the full attack chain Midnight Blizzard used in the SolarWinds campaign from initial access to exfiltration.",
        vectorResult: { answer: "Based on retrieved documents, Midnight Blizzard used supply chain compromise in the SolarWinds campaign. See incident report 003.", sources: 2, latency: 312 },
        graphResult: { answer: "Midnight Blizzard (APT29) executed a 5-stage attack chain:\n\n1. T1195.002 — Supply Chain Compromise → SolarWinds Orion build process\n2. T1546.003 — Event Triggered Execution via SUNBURST DLL\n3. T1071.001 — C2 over HTTP (api.digitalcollege.org)\n4. T1550.001 — Pass the Hash (5 CVEs linked)\n5. T1567.002 — Exfil to cloud storage\n\nCVE-2020-10148 (SolarWinds API auth bypass) enabled initial access. SUNBURST malware deployed as trojanized DLL.", sources: 11, latency: 847, hops: 4 },
      },
      {
        question: "Which assets in our SBOM are vulnerable to CVE-2021-44228 (Log4Shell) and what is the exploitation path?",
        vectorResult: { answer: "Log4Shell (CVE-2021-44228) is a critical RCE vulnerability affecting Apache Log4j. It allows arbitrary code execution via JNDI lookups.", sources: 3, latency: 289 },
        graphResult: { answer: "2 SBOM assets vulnerable to CVE-2021-44228:\n\n• log4j-core:2.14.1 — used by: payment-service, auth-gateway\n• spring-boot:2.6.1 (transitive dep) — used by: order-api\n\nExploitation path: T1190 (Exploit Public-Facing App) → JNDI injection → T1059.001 (PowerShell) → reverse shell. Patch: upgrade to log4j-core >= 2.17.1", sources: 8, latency: 723, hops: 3 },
      },
      {
        question: "What detection methods would disrupt Volt Typhoon techniques targeting energy infrastructure?",
        vectorResult: { answer: "Volt Typhoon is a Chinese state-sponsored threat actor targeting critical infrastructure. CISA recommends hardening network perimeters and monitoring for living-off-the-land techniques.", sources: 2, latency: 301 },
        graphResult: { answer: "Volt Typhoon techniques targeting energy sector with detection methods:\n\n| Technique | Detection | SIEM Rule |\n|-----------|-----------|----------|\n| T1190 — Exploit Public App | WAF anomaly + auth failure spike | Alert on >5 failed logins from same IP in 60s |\n| T1059.001 — PowerShell | Script block logging + AMSI | Flag encoded commands >500 chars |\n| T1078 — Valid Accounts | Impossible travel + off-hours access | Baseline user geo + time patterns |\n\n3 additional techniques identified via CHAINS_TO traversal from known Volt Typhoon TTPs.", sources: 9, latency: 891, hops: 3 },
      },
    ],
  },
  energy: {
    ...presentation.energy,
    name: "OutageGraph Intelligence",
    description: "Power outage root cause analysis & customer communication",
    color: "green",
    entityTypes: ["Outage", "Asset", "Crew", "Obstacle", "Feeder", "Customer", "RootCause"],
    relationTypes: ["CAUSED_BY", "ASSIGNED_TO", "BLOCKING_ACCESS", "FEEDS", "AFFECTS_CUSTOMER", "CONNECTED_TO", "DELAYS_ETA", "EVIDENCED_BY", "SERVES"],
    graphNodes: [
      { id: "outage-4471", label: "Outage OE-4471", type: "Outage" },
      { id: "tx447", label: "TX-447 Transformer", type: "Asset" },
      { id: "feeder-2201", label: "Feeder F-2201", type: "Feeder" },
      { id: "feeder-1108", label: "Feeder F-1108", type: "Feeder" },
      { id: "crew-alpha", label: "Crew Alpha-7", type: "Crew" },
      { id: "crew-bravo", label: "Crew Bravo-3", type: "Crew" },
      { id: "veg-rd12", label: "Vegetation Rd-12", type: "Obstacle" },
      { id: "debris-oak", label: "Fallen Oak (Elm St)", type: "Obstacle" },
      { id: "overload", label: "Thermal Overload", type: "RootCause" },
      { id: "storm-july", label: "Storm Jul-28", type: "RootCause" },
      { id: "sub-east", label: "Eastview Substation", type: "Asset" },
      { id: "sub-west", label: "Westside Substation", type: "Asset" },
      { id: "pole-144", label: "Pole #144", type: "Asset" },
      { id: "cust-zone-a", label: "Zone A (2,400 homes)", type: "Customer" },
      { id: "cust-zone-b", label: "Zone B (890 homes)", type: "Customer" },
      { id: "drone-img1", label: "Drone Photo DI-0091", type: "Asset" },
      { id: "outage-4472", label: "Outage OE-4472", type: "Outage" },
      { id: "recloser-7", label: "Recloser RC-7", type: "Asset" },
    ],
    graphLinks: [
      { source: "outage-4471", target: "overload", label: "CAUSED_BY" },
      { source: "overload", target: "tx447", label: "AFFECTS" },
      { source: "tx447", target: "sub-east", label: "CONNECTED_TO" },
      { source: "feeder-2201", target: "sub-east", label: "FEEDS" },
      { source: "feeder-2201", target: "cust-zone-a", label: "SERVES" },
      { source: "outage-4471", target: "crew-alpha", label: "ASSIGNED_TO" },
      { source: "veg-rd12", target: "crew-alpha", label: "BLOCKING_ACCESS" },
      { source: "veg-rd12", target: "outage-4471", label: "DELAYS_ETA" },
      { source: "drone-img1", target: "tx447", label: "EVIDENCED_BY" },
      { source: "outage-4472", target: "storm-july", label: "CAUSED_BY" },
      { source: "storm-july", target: "pole-144", label: "AFFECTS" },
      { source: "storm-july", target: "debris-oak", label: "CAUSED_BY" },
      { source: "debris-oak", target: "crew-bravo", label: "BLOCKING_ACCESS" },
      { source: "feeder-1108", target: "sub-west", label: "FEEDS" },
      { source: "feeder-1108", target: "cust-zone-b", label: "SERVES" },
      { source: "outage-4472", target: "crew-bravo", label: "ASSIGNED_TO" },
      { source: "pole-144", target: "recloser-7", label: "CONNECTED_TO" },
      { source: "outage-4472", target: "cust-zone-b", label: "AFFECTS_CUSTOMER" },
      { source: "outage-4471", target: "cust-zone-a", label: "AFFECTS_CUSTOMER" },
    ],
    queries: [
      {
        question: "Why is my power out at 123 Maple Drive and when will it be restored?",
        vectorResult: { answer: "There is a power outage affecting your area. A crew has been dispatched. Estimated restoration time is approximately 3-4 hours. We apologize for the inconvenience.", sources: 2, latency: 289 },
        graphResult: { answer: "Your address (123 Maple Drive) is served by Feeder F-2201 from Eastview Substation.\n\n🔴 Root Cause: Transformer TX-447 experienced thermal overload at 2:14 PM due to sustained 108°F heat + peak demand.\n\n📷 Drone imagery (DI-0091) confirms insulation damage on phase-B bushing.\n\n👷 Crew Alpha-7 dispatched at 2:22 PM, currently en route.\n⚠️ Delay: Vegetation overgrowth on Road 12 blocking direct access — crew rerouting via Highway 9 (adds ~45 min).\n\n⏱️ Revised ETA: 5:15 PM (was 4:30 PM before reroute)\n\n💡 2,400 homes affected in Zone A. Portable generators deployed to critical facilities (hospital, water pump).", sources: 14, latency: 923, hops: 5 },
      },
      {
        question: "What caused the outage on Elm Street and is there anything blocking the repair crew?",
        vectorResult: { answer: "A storm-related outage is affecting the Elm Street area. Crews are working to restore power. Please check back for updates.", sources: 1, latency: 267 },
        graphResult: { answer: "Outage OE-4472 (Elm Street area, Zone B — 890 homes):\n\n🌪️ Root Cause: Storm Jul-28 (60mph gusts at 1:47 PM)\n→ Downed a mature oak tree onto Pole #144\n→ Snapped crossarm, pulled down 3-phase primary conductor\n→ Recloser RC-7 tripped and locked out\n\n🚧 Obstacle: Fallen oak (est. 18\" diameter) blocking Elm St between 4th and 5th Ave.\n→ City arborist notified, chainsaw crew en route (ETA 30 min)\n→ Electrical Crew Bravo-3 staged 2 blocks away, waiting for tree clearance\n\n⏱️ Repair ETA: 2.5 hours after tree clearance (pole replacement + conductor re-stringing)\n📊 Estimated full restoration: 7:00 PM\n\n🔄 Mutual aid: Crew Charlie-1 requested from neighboring utility for pole-setting assistance.", sources: 11, latency: 856, hops: 4 },
      },
      {
        question: "Show me all active outages, their root causes, and which crews are assigned with any access issues.",
        vectorResult: { answer: "There are currently 2 active outages in the service territory. Crews have been dispatched to both locations. Updates will be provided as restoration progresses.", sources: 2, latency: 301 },
        graphResult: { answer: "📋 Active Outages Dashboard (2 events):\n\n| Outage | Root Cause | Customers | Crew | Obstacle | ETA |\n|--------|-----------|-----------|------|----------|-----|\n| OE-4471 | TX-447 thermal overload (heat) | 2,400 (Zone A) | Alpha-7 | Vegetation on Rd-12 (+45min) | 5:15 PM |\n| OE-4472 | Storm — pole damage (wind) | 890 (Zone B) | Bravo-3 | Fallen oak on Elm St | 7:00 PM |\n\n🔗 Graph Insights:\n• Both outages are independent (no cascade relationship)\n• OE-4471: Drone evidence available (DI-0091) — thermal damage confirmed\n• OE-4472: Requires mutual aid (pole replacement specialty)\n• Total affected: 3,290 customers\n• Critical facilities on backup: Eastview Hospital, Zone A Water Pump Station", sources: 18, latency: 1102, hops: 5 },
      },
    ],
  },
  otsec: {
    ...presentation.otsec,
    name: "OT Security Intelligence",
    description: "ICS/OT threat analysis, blast radius mapping & compliance",
    color: "indigo",
    entityTypes: ["ThreatGroup", "Vulnerability", "ICSTechnique", "Malware", "OTAsset", "PurdueZone", "Compliance"],
    relationTypes: ["USES_TECHNIQUE", "EXPLOITS", "DEPLOYS_MALWARE", "AFFECTS_ASSET", "RESIDES_IN", "CAN_REACH", "SUBJECT_TO", "CATEGORIZED_AS", "CONTROLS", "PROVIDES_ACCESS_TO", "IMPLEMENTS", "TARGETS"],
    graphNodes: [
      { id: "voltzite", label: "VOLTZITE", type: "ThreatGroup" },
      { id: "electrum", label: "ELECTRUM", type: "ThreatGroup" },
      { id: "chernovite", label: "CHERNOVITE", type: "ThreatGroup" },
      { id: "bentonite", label: "BENTONITE", type: "ThreatGroup" },
      { id: "vpn-gw", label: "VPN Gateway (PAN-OS)", type: "OTAsset" },
      { id: "scada-srv", label: "SCADA Server", type: "OTAsset" },
      { id: "plc-sub1", label: "PLC-SUB1 (Eastview)", type: "OTAsset" },
      { id: "plc-wtp", label: "PLC-WTP (Water)", type: "OTAsset" },
      { id: "pipedream", label: "PIPEDREAM", type: "Malware" },
      { id: "industroyer2", label: "Industroyer2", type: "Malware" },
      { id: "cve-2024-3400", label: "CVE-2024-3400", type: "Vulnerability" },
      { id: "cve-2023-3595", label: "CVE-2023-3595", type: "Vulnerability" },
      { id: "zone-dmz", label: "IT/OT DMZ", type: "PurdueZone" },
      { id: "zone-l1", label: "Level 1 Control", type: "PurdueZone" },
      { id: "zone-l2", label: "Level 2 Supervisory", type: "PurdueZone" },
      { id: "cip007", label: "NERC CIP-007", type: "Compliance" },
      { id: "t0855", label: "T0855: Unauthorized Cmd", type: "ICSTechnique" },
      { id: "t0866", label: "T0866: Exploit Remote Svc", type: "ICSTechnique" },
    ],
    graphLinks: [
      { source: "voltzite", target: "cve-2024-3400", label: "EXPLOITS" },
      { source: "voltzite", target: "t0866", label: "USES_TECHNIQUE" },
      { source: "cve-2024-3400", target: "vpn-gw", label: "AFFECTS_ASSET" },
      { source: "vpn-gw", target: "zone-dmz", label: "RESIDES_IN" },
      { source: "vpn-gw", target: "scada-srv", label: "CAN_REACH" },
      { source: "scada-srv", target: "zone-l2", label: "RESIDES_IN" },
      { source: "scada-srv", target: "plc-sub1", label: "CAN_REACH" },
      { source: "plc-sub1", target: "zone-l1", label: "RESIDES_IN" },
      { source: "plc-sub1", target: "cip007", label: "SUBJECT_TO" },
      { source: "electrum", target: "industroyer2", label: "DEPLOYS_MALWARE" },
      { source: "electrum", target: "t0855", label: "USES_TECHNIQUE" },
      { source: "chernovite", target: "pipedream", label: "DEVELOPS_MALWARE" },
      { source: "pipedream", target: "t0855", label: "IMPLEMENTS" },
      { source: "cve-2023-3595", target: "plc-sub1", label: "AFFECTS_ASSET" },
      { source: "bentonite", target: "plc-wtp", label: "TARGETS" },
      { source: "plc-wtp", target: "zone-l1", label: "RESIDES_IN" },
    ],
    queries: [
      {
        question: "If VOLTZITE compromises our VPN gateway, what's the blast radius through our OT network?",
        vectorResult: { answer: "VOLTZITE (Volt Typhoon) is a Chinese state-sponsored threat group targeting critical infrastructure. They use living-off-the-land techniques and exploit perimeter devices. Organizations should patch VPN appliances promptly.", sources: 3, latency: 298 },
        graphResult: { answer: "🔴 BLAST RADIUS ANALYSIS: VPN Gateway (PAN-OS) compromise by VOLTZITE\n\nAttack Path (5 hops, DMZ → Level 0):\n\n1️⃣ VPN Gateway (CVE-2024-3400, CVSS 10.0) — EXPLOITED\n   └─ Resides in: IT/OT DMZ (Level 3.5)\n   └─ Patch 47 days overdue → NERC CIP-005 VIOLATION\n\n2️⃣ → CAN_REACH → PI Historian Server (Level 3)\n   └─ Windows Server 2019, 45,000 data points\n   └─ OS patches 112 days overdue → CIP-007 VIOLATION\n\n3️⃣ → CAN_REACH → SCADA Server (Level 2)\n   └─ GE iFIX 2024, manages 14 RTUs + 6 substations\n   └─ Categorized: High Impact BES Cyber System\n\n4️⃣ → CAN_REACH → PLC-SUB1 ControlLogix (Level 1)\n   └─ CVE-2023-3595 (CIP RCE, CVSS 9.8) — UNPATCHED\n   └─ Controls: Breaker control, load shedding (Eastview)\n   └─ Firmware 94 days behind → CIP-007 VIOLATION\n\n5️⃣ → CONTROLS → Physical Process (Level 0)\n   └─ Breakers, capacitor banks, field devices\n   └─ Impact: Potential de-energization of Eastview substation (2,400 customers)\n\n⚠️ COMPLIANCE GAPS ENABLING THIS PATH:\n• CIP-005: VPN patch overdue (47 days) — $1M/day penalty risk\n• CIP-007: 3 assets with patches >90 days overdue\n• Total penalty exposure: $3M/day\n\n🛡️ MITIGATIONS NEEDED:\n1. Emergency patch VPN gateway (CVE-2024-3400)\n2. Segment historian from SCADA (break hop 2→3)\n3. Apply ControlLogix firmware update (v34.014)\n4. Enable CIP message filtering on OT firewall", sources: 22, latency: 1247, hops: 5 },
      },
      {
        question: "Which ICS threat groups can reach our PLCs and what techniques would they use?",
        vectorResult: { answer: "Several ICS-focused threat groups target programmable logic controllers. MITRE ATT&CK for ICS documents techniques like unauthorized command messages (T0855) and manipulation of control (T0831). Organizations should implement defense-in-depth.", sources: 2, latency: 312 },
        graphResult: { answer: "🎯 THREAT GROUPS WITH PLC REACH CAPABILITY:\n\n| Group | Target PLC | Technique | Malware | Path |\n|-------|-----------|-----------|---------|------|\n| VOLTZITE | PLC-SUB1, PLC-SUB2 | T0866 → T0886 → T0855 | None (LOTL) | VPN → Historian → SCADA → PLC |\n| ELECTRUM | PLC-SUB1, PLC-SUB2 | T0855, T0831 | Industroyer2 | Perimeter → L3 → L2 → L1 (IEC-104) |\n| CHERNOVITE | PLC-SUB1, PLC-SUB2, PLC-WTP | T0831, T0855, T0821 | PIPEDREAM | Any path (multi-protocol framework) |\n| BENTONITE | PLC-WTP | T0859, T0855 | None | Default credentials on Siemens S7 |\n\n🔥 HIGHEST RISK: CHERNOVITE + PIPEDREAM\n• PIPEDREAM supports: Schneider Modicon, OMRON NX/NJ, Rockwell ControlLogix (via CIP), Codesys\n• Our ControlLogix PLCs are directly targetable\n• PIPEDREAM can modify controller logic WITHOUT engineering workstation access\n\n📊 VULNERABILITY OVERLAP:\n• PLC-SUB1: CVE-2023-3595 (RCE via CIP) — exploitable by PIPEDREAM\n• PLC-WTP: CVE-2023-36745 (DoS) — exploitable by BENTONITE\n• Engineering WS: CVE-2023-28229 (privesc) — enables PLC programming access\n\n🛡️ DETECTION RECOMMENDATIONS:\n1. Monitor all CIP write commands to PLCs (baseline → alert on deviation)\n2. Enable PLC logic change detection (hash comparison every scan cycle)\n3. Implement allowlisting on EtherNet/IP traffic (Level 2 → Level 1)\n4. Block all OPC-UA from DMZ to Level 1 (PIPEDREAM recon vector)", sources: 18, latency: 1089, hops: 4 },
      },
      {
        question: "What is CVE-2024-36401 in GeoServer, how severe is it, and how could it be exploited?",
        vectorResult: { answer: "NERC CIP standards require utilities to protect Bulk Electric System Cyber Assets. Key standards include CIP-002 (categorization), CIP-005 (electronic security perimeters), and CIP-007 (system security management). Regular audits assess compliance.", sources: 3, latency: 278 },
        graphResult: { answer: "📋 NERC CIP COMPLIANCE + RISK CROSSWALK:\n\n| Standard | Status | Gap | Exploitable By | Attack Path Enabled |\n|----------|--------|-----|----------------|--------------------|\n| CIP-002-5.1a | ✅ Compliant | — | — | — |\n| CIP-005-7 | ❌ GAP | VPN unpatched 47 days | VOLTZITE | DMZ → full OT access |\n| CIP-007-6 | ❌ NON-COMPLIANT | 3 assets >90 days overdue | VOLTZITE, ELECTRUM, CHERNOVITE | Each unpatched asset is a pivot point |\n| CIP-010-4 | ✅ Compliant | — | — | — |\n| CIP-013-2 | ⚠️ In Progress | Siemens firmware process undocumented | Supply chain risk | CHERNOVITE-style supply chain attack |\n\n🔴 CRITICAL FINDING: CIP-005 + CIP-007 gaps create a complete kill chain:\n\nCIP-005 gap (unpatched VPN) → Initial Access\n  → CIP-007 gap (historian unpatched 112 days) → Pivot to Level 3\n    → CIP-007 gap (PLC firmware 94 days behind) → Reach Level 1\n      → Physical process manipulation possible\n\n💰 PENALTY EXPOSURE:\n• CIP-005 violation: up to $1,000,000/day\n• CIP-007 violations (×3): up to $3,000,000/day\n• Combined: $4M/day maximum penalty risk\n\n📅 REMEDIATION PRIORITY (risk-ranked):\n1. [IMMEDIATE] Patch VPN gateway — eliminates initial access vector\n2. [THIS WEEK] Update ControlLogix firmware — blocks PLC exploitation\n3. [THIS MONTH] Patch historian OS — breaks lateral movement path\n4. [Q3] Formalize Siemens supply chain process — CIP-013 compliance", sources: 28, latency: 1340, hops: 5 },
      },
    ],
  },
  prodquality: {
    ...presentation.prodquality,
    name: "Product Quality Intelligence",
    description: "Cross-source root-cause analysis: reviews → returns → components → suppliers",
    color: "amber",
    entityTypes: ["Product", "ReviewCluster", "Region", "Store", "Return", "Component", "ComponentLot", "Supplier", "SupplierScorecard", "PurchaseOrder", "RootCause", "CorrectiveAction"],
    relationTypes: ["HAS_REVIEWS", "CONCENTRATED_IN", "INCLUDES_STORE", "GENERATED_RETURNS", "RETURNS_OF", "FAULT_ISOLATED_TO", "INVESTIGATED_CLEARED", "HAS_COMPONENT", "BUILT_FROM_LOT", "SUPPLIED_BY", "SOURCED_VIA", "ISSUED_TO", "ROOT_CAUSED_BY", "INTRODUCED_BY", "PREDATES", "HAS_SCORECARD", "HAS_CORRECTIVE_ACTION", "QUARANTINES"],
    graphNodes: [
      { id: "drill-vc20", label: "VoltCore 20V Drill", type: "Product" },
      { id: "driver-vc20i", label: "VoltCore 20V Impact Driver", type: "Product" },
      { id: "rev-cluster-cold", label: "Reviews: \"dies in cold\"", type: "ReviewCluster" },
      { id: "rev-cluster-grip", label: "Reviews: \"grip\" (false lead)", type: "ReviewCluster" },
      { id: "region-north", label: "Cold-Climate Region", type: "Region" },
      { id: "store-lowes-mn", label: "Lowe's — Minnesota", type: "Store" },
      { id: "store-acehw-wi", label: "Ace Hardware — Wisconsin", type: "Store" },
      { id: "return-batch-winter", label: "Winter Return Batch", type: "Return" },
      { id: "battery-pack", label: "20V 2.0Ah Battery Pack", type: "Component" },
      { id: "charger-unit", label: "Fast Charger (cleared)", type: "Component" },
      { id: "cell-lot-ns", label: "Cell Lot NS-2411", type: "ComponentLot" },
      { id: "cell-lot-ax", label: "Cell Lot AX-2409 (good)", type: "ComponentLot" },
      { id: "electrolyte-change", label: "Electrolyte Change (ECN-NS-77)", type: "RootCause" },
      { id: "supplier-northstar", label: "NorthStar Cells Ltd.", type: "Supplier" },
      { id: "supplier-apex", label: "Apex Power Components", type: "Supplier" },
      { id: "capa-ns-01", label: "CAPA #NS-01", type: "CorrectiveAction" },
      { id: "po-ns-4411", label: "PO #NS-4411", type: "PurchaseOrder" },
    ],
    graphLinks: [
      { source: "drill-vc20", target: "rev-cluster-cold", label: "HAS_REVIEWS" },
      { source: "drill-vc20", target: "rev-cluster-grip", label: "HAS_REVIEWS" },
      { source: "driver-vc20i", target: "battery-pack", label: "HAS_COMPONENT" },
      { source: "rev-cluster-cold", target: "region-north", label: "CONCENTRATED_IN" },
      { source: "region-north", target: "store-lowes-mn", label: "INCLUDES_STORE" },
      { source: "region-north", target: "store-acehw-wi", label: "INCLUDES_STORE" },
      { source: "store-lowes-mn", target: "return-batch-winter", label: "GENERATED_RETURNS" },
      { source: "return-batch-winter", target: "battery-pack", label: "FAULT_ISOLATED_TO" },
      { source: "return-batch-winter", target: "charger-unit", label: "INVESTIGATED_CLEARED" },
      { source: "drill-vc20", target: "battery-pack", label: "HAS_COMPONENT" },
      { source: "battery-pack", target: "cell-lot-ns", label: "BUILT_FROM_LOT" },
      { source: "battery-pack", target: "cell-lot-ax", label: "BUILT_FROM_LOT" },
      { source: "cell-lot-ns", target: "supplier-northstar", label: "SUPPLIED_BY" },
      { source: "cell-lot-ax", target: "supplier-apex", label: "SUPPLIED_BY" },
      { source: "cell-lot-ns", target: "electrolyte-change", label: "ROOT_CAUSED_BY" },
      { source: "electrolyte-change", target: "supplier-northstar", label: "INTRODUCED_BY" },
      { source: "supplier-northstar", target: "capa-ns-01", label: "HAS_CORRECTIVE_ACTION" },
      { source: "cell-lot-ns", target: "po-ns-4411", label: "SOURCED_VIA" },
      { source: "po-ns-4411", target: "supplier-northstar", label: "ISSUED_TO" },
    ],
    queries: [
      {
        question: "The VoltCore 20V drill has a cluster of cold-weather battery reviews — which cell lot and supplier are the root cause?",
        vectorResult: { answer: "Recent reviews mention the drill 'dying in the cold' and batteries not holding a charge. Sentiment dropped sharply in winter months. Consider a battery quality review.", sources: 3, latency: 291 },
        graphResult: { answer: "🔎 ROOT-CAUSE TRACE — VoltCore 20V bad reviews (6 hops, reviews → supplier):\n\n1️⃣ Negative review cluster (312 reviews, 1.8★) — \"won't hold charge / dies below freezing\"\n2️⃣ → CONCENTRATED_IN → Cold-Climate Region (MN, WI, MI, ND) — 0.89 correlation, 0 such reviews in warm states\n3️⃣ → stores: Lowe's MN (14.2% return rate) + Ace WI (12.8%) vs Home Depot TX (2.1%)\n4️⃣ → Winter Return Batch (2,870 units) → FAULT_ISOLATED_TO → 20V Battery Pack (94% fail battery diagnostic; motor & chuck pass)\n5️⃣ → BUILT_FROM_LOT → Cell Lot NS-2411 — cold test FAIL, 41% capacity retention @ 20°F\n6️⃣ → SUPPLIED_BY → NorthStar Cells Ltd. (changed electrolyte formulation in Q3 without re-qualification) → PO #NS-4411 (60,000 cells, Sep-Nov build)\n\n✅ ROOT CAUSE: NorthStar cell lot NS-2411 loses >half its capacity below freezing. It shipped only in the Sep-Nov battery build, which went disproportionately to cold-climate stores → the winter review spike.\n\n🎯 ACTION: quarantine NS-2411 packs, revert to Apex lot AX-2409 (88% cold retention), re-qualify NorthStar before any new PO.\n\nA human took this from 'random bad reviews' to a named supplier lot by hand over ~3 months. The graph stitched reviews → geography → returns → BOM → lot → supplier → PO in one traversal.", sources: 19, latency: 1210, hops: 6 },
      },
      {
        question: "Which supplier and purchase order are behind the winter battery failures?",
        vectorResult: { answer: "Battery failures appear related to cold weather. Supplier records mention NorthStar Cells. A purchase order review is recommended.", sources: 2, latency: 268 },
        graphResult: { answer: "The winter battery failures trace to NorthStar Cells Ltd. (cell lot NS-2411, PO #NS-4411). That lot fails cold testing (41% capacity @ 20°F) and was built into the Sep-Nov battery run. The qualified alternative, Apex Power (lot AX-2409), retains 88%. NorthStar changed its electrolyte formulation in Q3 without re-qualification.", sources: 8, latency: 640, hops: 4 },
      },
      {
        question: "For the VoltCore 20V winter returns, is the battery, motor, or chuck the failing component?",
        vectorResult: { answer: "Returns reference the drill not working. Components include motor, chuck, and battery. Further diagnostics recommended.", sources: 2, latency: 254 },
        graphResult: { answer: "No — the graph isolates the fault to the battery, not the motor or chuck. 94% of winter returns fail the battery diagnostic while the brushless motor and 13mm chuck pass. The fault path runs Return Batch → Battery Pack → Cell Lot NS-2411 → NorthStar Cells. Motor and chuck have 3 and 1 linked returns respectively (noise). The charger was also investigated and cleared — it passes the cold test.", sources: 6, latency: 520, hops: 3 },
      },
      {
        question: "If NorthStar lot NS-2411 is bad, which other products are affected?",
        vectorResult: { answer: "Lot NS-2411 is associated with battery quality issues. The VoltCore drill is mentioned. Other products may share components.", sources: 2, latency: 244 },
        graphResult: { answer: "Blast radius of lot NS-2411 spans TWO products, because the 20V 2.0Ah battery pack is shared:\n\n• VoltCore 20V Drill — 312 cold reviews, 2,870 winter returns\n• VoltCore 20V Impact Driver — 88 cold reviews, 640 winter returns (same symptom, same season)\n\nBoth trace through Battery Pack VC-BAT-20 → Cell Lot NS-2411 → NorthStar → PO #NS-4411. The 4.0Ah XL pack is NOT affected — it's built only from Apex cells (lot AX-2409). Containment scope: every 2.0Ah pack from the Sep-Nov build across both SKUs. This cross-product link is exactly what a per-product review dashboard misses and a shared-component graph surfaces immediately.", sources: 11, latency: 720, hops: 4 },
      },
      {
        question: "According to ECN-NS-77 and CAPA #NS-01, what changed at NorthStar and what is the corrective action?",
        vectorResult: { answer: "There is a corrective action related to NorthStar cells. The supplier changed a formulation. See CAPA records.", sources: 2, latency: 259 },
        graphResult: { answer: "The graph explains both the 'why now' and the fix:\n\n• WHY IT PASSED ORIGINALLY: NorthStar's prior lot NS-2308 passed cold testing (84% retention) — it PREDATES the electrolyte change. Qualification was done on the old formulation.\n• WHAT CHANGED: Engineering Change Notice ECN-NS-77 — NorthStar switched to a lower-cost electrolyte in Q3 that raises internal resistance below freezing, and did NOT re-qualify. Lot NS-2411 is the first lot built after the change → ROOT_CAUSED_BY the change.\n• CORRECTIVE ACTION: CAPA #NS-01 (open) — quarantine lot NS-2411, revert the electrolyte formulation, re-qualify at 20°F before any new PO.\n\nThe root cause isn't 'a bad battery' — it's an unqualified supplier process change. Only the graph connects the change notice to the failing lot to the reviews.", sources: 9, latency: 680, hops: 5 },
      },
    ],
  },
};

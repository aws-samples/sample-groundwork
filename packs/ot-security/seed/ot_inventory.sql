-- GroundWork — OT Security demo dataset (PostgreSQL)
--
-- Synthetic OT estate for the JDBC/RDS scenario. Table shapes match
-- packs/ot-security/sources.yaml and the governed metrics in metrics.osi.yaml,
-- so once this is loaded and the database is registered as a COA JDBC_DATABASE
-- source, all six metrics resolve. See docs/JDBC_OT_SECURITY_SCENARIO.md.
--
-- All data is illustrative — vendors, assets, CVEs and attack paths are made up
-- for demonstration and do not describe any real deployment.
--
-- Load (from inside the DB's VPC — the demo DB is private):
--   psql "host=<endpoint> dbname=ot_inventory user=<u> password=<p>" -f ot_inventory.sql
-- or run the statements from a short-lived Lambda/bastion in the VPC.

BEGIN;

DROP TABLE IF EXISTS asset_vulnerabilities CASCADE;
DROP TABLE IF EXISTS asset_connectivity CASCADE;
DROP TABLE IF EXISTS compliance_controls CASCADE;
DROP TABLE IF EXISTS vulnerabilities CASCADE;
DROP TABLE IF EXISTS ot_assets CASCADE;

CREATE TABLE ot_assets (
    asset_id          TEXT PRIMARY KEY,
    asset_tag         TEXT NOT NULL,
    vendor            TEXT NOT NULL,
    model             TEXT,
    firmware_version  TEXT,
    purdue_level      INTEGER NOT NULL,
    safety_critical   BOOLEAN NOT NULL DEFAULT FALSE,
    last_patched      DATE
);

CREATE TABLE vulnerabilities (
    cve_id                TEXT PRIMARY KEY,
    cvss_score            NUMERIC(3,1) NOT NULL,
    exploited_in_wild     BOOLEAN NOT NULL DEFAULT FALSE,
    patch_available       BOOLEAN NOT NULL DEFAULT FALSE,
    patch_available_date  DATE
);

CREATE TABLE asset_vulnerabilities (
    asset_id              TEXT NOT NULL REFERENCES ot_assets(asset_id),
    cve_id                TEXT NOT NULL REFERENCES vulnerabilities(cve_id),
    patch_applied         BOOLEAN NOT NULL DEFAULT FALSE,
    patch_available_date  DATE,
    cvss_score            NUMERIC(3,1),
    exploited_in_wild     BOOLEAN,
    purdue_level          INTEGER,
    PRIMARY KEY (asset_id, cve_id)
);

CREATE TABLE asset_connectivity (
    source_asset_id      TEXT NOT NULL REFERENCES ot_assets(asset_id),
    target_asset_id      TEXT NOT NULL REFERENCES ot_assets(asset_id),
    source_purdue_level  INTEGER,
    safety_critical      BOOLEAN,
    PRIMARY KEY (source_asset_id, target_asset_id)
);

CREATE TABLE compliance_controls (
    control_id       TEXT NOT NULL,
    framework        TEXT NOT NULL,
    asset_id         TEXT NOT NULL REFERENCES ot_assets(asset_id),
    in_scope         BOOLEAN NOT NULL DEFAULT TRUE,
    evidence_status  TEXT,
    PRIMARY KEY (control_id, asset_id)
);

-- ── Assets: a small substation + plant floor across the Purdue model ─────────
INSERT INTO ot_assets(asset_id,asset_tag,vendor,model,firmware_version,purdue_level,safety_critical,last_patched) VALUES
 ('AST-0001','PLC-SUB-A-01','Siemens','S7-1500','2.8.1',1,TRUE,'2024-11-02'),
 ('AST-0002','PLC-SUB-A-02','Siemens','S7-1200','4.4.0',1,TRUE,'2023-06-15'),
 ('AST-0003','RTU-FEEDER-07','SEL','SEL-3530','R143',1,TRUE,'2024-02-20'),
 ('AST-0004','HMI-CTRL-01','Rockwell','PanelView 5510','12.00',2,FALSE,'2024-09-10'),
 ('AST-0005','SCADA-SVR-01','AVEVA','System Platform','2023 R2',2,FALSE,'2025-01-08'),
 ('AST-0006','ENG-WS-01','Microsoft','Windows 10 LTSC','21H2',3,FALSE,'2024-12-01'),
 ('AST-0007','HIST-SVR-01','OSIsoft','PI Server','2018 SP3',3,FALSE,'2022-10-30'),
 ('AST-0008','FW-DMZ-01','Palo Alto','PA-3220','10.2.3',4,FALSE,'2025-02-14'),
 ('AST-0009','VPN-GW-01','Cisco','ASA 5516-X','9.16.1',4,FALSE,'2023-01-19'),
 ('AST-0010','DRIVE-PUMP-03','Schneider','Altivar 630','1.7',0,TRUE,'2024-05-22'),
 ('AST-0011','SAFETY-PLC-01','HIMA','HIMax','V5',1,TRUE,'2024-08-01'),
 ('AST-0012','SWITCH-CELL-A','Hirschmann','RSP35','09.1.00',2,FALSE,'2024-03-11');

-- ── Vulnerabilities (illustrative CVE ids; KEV = exploited_in_wild) ──────────
INSERT INTO vulnerabilities(cve_id,cvss_score,exploited_in_wild,patch_available,patch_available_date) VALUES
 ('CVE-2024-30111',9.8,TRUE,TRUE,'2024-06-01'),
 ('CVE-2023-27983',7.5,TRUE,TRUE,'2023-04-10'),
 ('CVE-2024-38434',8.1,FALSE,TRUE,'2024-07-15'),
 ('CVE-2022-1161',10.0,TRUE,TRUE,'2022-06-14'),
 ('CVE-2024-4879',9.3,FALSE,FALSE,NULL),
 ('CVE-2023-3595',9.8,TRUE,TRUE,'2023-07-12'),
 ('CVE-2024-45678',6.5,FALSE,TRUE,'2024-10-01'),
 ('CVE-2021-22779',8.8,TRUE,TRUE,'2021-08-25');

-- ── Asset ↔ vulnerability (derived cols mirror the vuln + asset) ─────────────
INSERT INTO asset_vulnerabilities(asset_id,cve_id,patch_applied,patch_available_date,cvss_score,exploited_in_wild,purdue_level) VALUES
 ('AST-0001','CVE-2024-30111',FALSE,'2024-06-01',9.8,TRUE,1),
 ('AST-0002','CVE-2023-27983',FALSE,'2023-04-10',7.5,TRUE,1),
 ('AST-0003','CVE-2024-38434',TRUE,'2024-07-15',8.1,FALSE,1),
 ('AST-0004','CVE-2022-1161',FALSE,'2022-06-14',10.0,TRUE,2),
 ('AST-0005','CVE-2024-4879',FALSE,NULL,9.3,FALSE,2),
 ('AST-0006','CVE-2024-45678',TRUE,'2024-10-01',6.5,FALSE,3),
 ('AST-0007','CVE-2023-3595',FALSE,'2023-07-12',9.8,TRUE,3),
 ('AST-0009','CVE-2021-22779',FALSE,'2021-08-25',8.8,TRUE,4),
 ('AST-0010','CVE-2024-30111',FALSE,'2024-06-01',9.8,TRUE,0),
 ('AST-0011','CVE-2024-4879',FALSE,NULL,9.3,FALSE,1),
 ('AST-0008','CVE-2024-45678',TRUE,'2024-10-01',6.5,FALSE,4);

-- ── Directed network reachability (the attack-path graph) ────────────────────
-- Enterprise/DMZ -> SCADA -> controllers -> field devices.
INSERT INTO asset_connectivity(source_asset_id,target_asset_id,source_purdue_level,safety_critical) VALUES
 ('AST-0009','AST-0008',4,FALSE),  -- VPN -> DMZ firewall
 ('AST-0008','AST-0005',4,FALSE),  -- DMZ -> SCADA
 ('AST-0005','AST-0004',2,FALSE),  -- SCADA -> HMI
 ('AST-0005','AST-0007',2,FALSE),  -- SCADA -> Historian
 ('AST-0004','AST-0001',2,TRUE),   -- HMI -> safety-critical PLC
 ('AST-0004','AST-0002',2,TRUE),   -- HMI -> PLC
 ('AST-0001','AST-0010',1,TRUE),   -- PLC -> safety-critical pump drive
 ('AST-0002','AST-0003',1,TRUE),   -- PLC -> RTU
 ('AST-0012','AST-0011',2,TRUE),   -- cell switch -> safety PLC
 ('AST-0005','AST-0012',2,FALSE),  -- SCADA -> cell switch
 ('AST-0006','AST-0005',3,FALSE);  -- eng workstation -> SCADA

-- ── Compliance controls + per-asset evidence status ─────────────────────────
INSERT INTO compliance_controls(control_id,framework,asset_id,in_scope,evidence_status) VALUES
 ('CIP-007-6 R2','NERC CIP','AST-0001',TRUE,'GAP'),
 ('CIP-007-6 R2','NERC CIP','AST-0007',TRUE,'GAP'),
 ('CIP-005-7 R1','NERC CIP','AST-0008',TRUE,'COMPLIANT'),
 ('CIP-005-7 R1','NERC CIP','AST-0009',TRUE,'GAP'),
 ('CIP-010-4 R1','NERC CIP','AST-0005',TRUE,'PARTIAL'),
 ('IEC62443-SL2','IEC 62443','AST-0011',TRUE,'COMPLIANT'),
 ('IEC62443-SL2','IEC 62443','AST-0010',TRUE,'PARTIAL'),
 ('CIP-007-6 R2','NERC CIP','AST-0002',TRUE,'GAP');

COMMIT;

-- Sanity: the six governed metrics should now resolve, e.g.
--   SELECT COUNT(DISTINCT CASE WHEN exploited_in_wild THEN asset_id END)
--     FROM asset_vulnerabilities;                    -- kev_exposure_count = 6
--   SELECT COUNT(*) FILTER (WHERE in_scope AND (evidence_status IS NULL
--     OR evidence_status <> 'PASS')) FROM compliance_controls;  -- gaps = 8

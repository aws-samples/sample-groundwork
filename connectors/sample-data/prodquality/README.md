# Product Quality — synthetic source documents for COA ingestion

These eight Markdown documents are the **synthetic drill-bit root-cause story**
rendered as source documents for **Mode 3 (Live COA)** ingestion. They follow the
same format the `gw_connectors` produce (Markdown + YAML frontmatter, prose
written in the manufacturing ontology's vocabulary) so COA's document-extraction
pipeline maps them onto the ontology's classes and relations.

## Why documents (not the SQLite seed)

Modes 1 & 2 run on the hand-built graph in `src/data/datasets/prodquality/`.
Mode 3 (COA) has no "load these nodes" API — it ingests **documents** from S3,
chunks + embeds them, and builds the knowledge graph via LLM extraction. These
files are what get registered as a COA `DOCUMENTS` source on the `prodquality`
namespace.

## The story the documents encode

Bad reviews → cold-climate concentration → specific stores → winter returns →
fault isolated to the battery → battery built from cell lot NS-2411 → lot fails
cold test (41% @ 20°F) → supplied by NorthStar via PO #NS-4411 → root cause is
NorthStar's unqualified Q3 electrolyte change (ECN-NS-77) → CAPA #NS-01.

Good-path decoys the graph should NOT name as the cause: prior good lot NS-2308,
prior PO #NS-3300, supplier Apex (lot AX-2409), the 4.0Ah XL pack, the cleared
charger, and the non-climate "grip" review cluster.

## Documents

| File | Represents | Key entities |
| --- | --- | --- |
| 01-reviews-voltcore-drill.md | Retailer review API | Product, review clusters (cold / baseline / grip false-lead) |
| 02-returns-rma-winter.md | Returns/RMA system | Return batch, battery fault isolation, cleared charger |
| 03-cold-test-lab-report.md | QA lab | Cell lots NS-2411 (FAIL) / NS-2308 / AX-2409, spec |
| 04-bill-of-materials.md | PLM/BOM | Product→component→lot genealogy, cross-product battery share |
| 05-purchase-order-ledger.md | ERP purchase orders | PO #NS-4411 → NorthStar, decoy POs |
| 06-engineering-change-notice.md | PLM change notice | Root cause: ECN-NS-77 electrolyte change |
| 07-capa-and-scorecards.md | Quality GRC | CAPA #NS-01, supplier scorecards |
| 08-store-sales-by-region.md | POS/store sales | Regions, stores, return-rate correlation |

## To ingest (once COA access is available)

1. Upload this folder to the S3 bucket COA reads (feeds bucket / prefix).
2. Register the prefix as a `DOCUMENTS` source on the `prodquality` namespace.
3. COA's Scan stage chunks, embeds, and extracts the KG asynchronously.
4. Verify with a `graph_traversal` / `query` against the namespace.

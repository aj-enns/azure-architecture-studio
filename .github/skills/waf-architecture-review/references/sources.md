# Microsoft Sources

Ground every figure and recommendation in these. Prefer the live document over
memory — SLA terms change monthly and Azure adds AZ regions regularly.

## Authoritative sources

| Need | Source |
|---|---|
| **SLA %** (contractual) | [SLA for Microsoft Online Services (SLAOS)](https://www.microsoft.com/licensing/docs/view/Service-Level-Agreements-SLA-for-Online-Services) — a `.docx`, revised monthly. The single authoritative source; it replaced the per-service legal SLA pages. **No API / not machine-readable.** |
| **Per-service reliability** (SLA, AZ support, multi-region, backup) | [Azure reliability guides by service](https://learn.microsoft.com/azure/reliability/overview-reliability-guidance) — ~80 services, one guide each. Reachable via Learn MCP. |
| **How to define targets & composite SLO** | [WAF — define reliability targets](https://learn.microsoft.com/azure/well-architected/reliability/metrics) |
| **Availability-zone regions list** | [What are Azure availability zones](https://learn.microsoft.com/azure/reliability/availability-zones-overview) |
| **RTO / RPO** | Mostly **not published**. WAF states Microsoft publishes these for only a few services (e.g. [Azure SQL Database HADR](https://learn.microsoft.com/azure/azure-sql/database/business-continuity-high-availability-disaster-recover-hadr-overview)). |
| **Reference architectures** | [Azure Architecture Center](https://learn.microsoft.com/azure/architecture/) |
| **Reliability concepts** (BCDR, redundancy, failover) | [Azure reliability overview](https://learn.microsoft.com/azure/reliability/overview) |
| **Live pricing** (for cost-vs-uptime deltas) | [Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices) — public, no auth: `GET https://prices.azure.com/api/retail/prices`. |

## Pulling current docs (Learn MCP)

If a Microsoft Learn MCP server / `microsoft_docs_search` tool is available, use it
to fetch current reliability-guide text instead of relying on memory — query, for a
given service, something like:

```
"Azure <Service Name> reliability SLA availability zones RTO RPO"
```

Then cite the returned `learn.microsoft.com` URLs in the review's Sources section.

If no such tool is available, fetch the reliability guide URL for the service from
the table above and cite it directly.

## Key facts to keep straight

- **SLA is contractual and financially backed; SLO is your internal target.** They
  are not the same number and should be controlled independently.
- **Published SLA coverage is narrow.** Treat anything outside the SLA's stated
  definition as "best effort" and lower your working SLO accordingly.
- **Zone redundancy ≠ DR.** It survives a zone, not a region.
- **Numbers you quote from memory must be verified** against the source before they
  go in a customer-facing review. When unsure, say so.

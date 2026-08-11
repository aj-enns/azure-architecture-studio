# Resiliency & DR Method

The differentiated core of the review. Produce numbers with sources, then a
composite, then a failure-mode narrative.

## 1. Per-component figures

For each service on the request path, record the SLA %, RTO, and RPO **at its
configured tier** — not the best case the service can theoretically reach.

| Field | Notes |
|---|---|
| Service + SKU/tier | e.g. "App Service Plan P1v3, 2 instances" |
| Resilience tier | `global` \| `nonzonal` \| `zoneRedundant` \| `multiRegion` |
| SLA % | Published uptime for that configuration |
| RTO | Recovery time; **"not published"** for most services |
| RPO | Data-loss window; published only for a few data services |
| Source | Link (SLAOS or the service reliability guide) |

Most services publish an SLA but **not** RTO/RPO. The Well-Architected Framework
says so explicitly and names Azure SQL Database as one of the few exceptions. Do
not fabricate a recovery objective — mark it "not published" and reason about it
qualitatively.

## 2. The three zone-redundancy gates

A component is only zone-redundant if **all three** hold. Failing any one silently
downgrades it to single-zone and caps the whole design:

1. **Region** has availability zones. Not every region does — verify against the
   AZ region list in [sources](./sources.md).
2. **Service + SKU** supports zone redundancy. Examples of the gotchas:
   - Storage needs a ZRS/GZRS replication SKU; `Standard_LRS` is single-zone.
   - Redis needs a Premium/Enterprise tier.
   - App Service Plan and Application Gateway v2 need ≥2 instances.
   - Front Door, Entra ID, and Static Web Apps are **global** — no zone concept.
3. **Configuration** actually enables it (the zone-redundant flag / multi-instance).

Call out any component the customer *believes* is zone-redundant but isn't.

## 3. Composite SLA

Per the WAF, a composite SLA is the **product** of the contributing components'
SLAs, over the request path. Supporting services (monitoring, identity, DevOps)
that don't gate a request are excluded.

```
composite = Π (component SLA%) over request-path components
```

Worked WAF example: `99.99% × 99.99999% ≈ 99.99%`. Chaining more components only
ever lowers the number.

Downtime budget per SLA (30-day month):

| SLA | Downtime / week | Downtime / month | Downtime / year |
|---|---|---|---|
| 99% | 1.68 h | 7.2 h | 3.65 d |
| 99.9% | 10.1 min | 43.2 min | 8.76 h |
| 99.95% | 5 min | 21.6 min | 4.38 h |
| 99.99% | 1.01 min | 4.32 min | 52.6 min |
| 99.999% | 6 s | 25.9 s | 5.26 min |

Report the composite as a headline **downtime/month**, then name the **weakest
link** — the lowest-SLA component — because that is the actionable lever.

### Adjusted SLO

The published SLA covers a narrow definition (e.g. App Service = returns 200 OK;
it does **not** cover Easy Auth or slot swaps). For anything the SLA excludes but
the workload depends on, lower the figure to an *adjusted SLO*. The WAF example
adjusts SQL Managed Instance from a 99.99% SLA down to a 99.80% working SLO to
account for data operations the SLA doesn't cover. State the adjustment and why.

## 4. Region strategy

Match the strategy to the RTO/RPO the customer actually needs — do not default to
multi-region.

| Strategy | Survives | Rough RTO/RPO | Cost |
|---|---|---|---|
| Single region, nonzonal | instance failure | hours / last backup | $ |
| Single region, zone-redundant | one zone lost | minutes / seconds | $$ |
| Active-passive, paired region | full region lost | minutes-hours / replication lag | $$$ |
| Active-active, multi-region | full region lost | seconds / near-zero | $$$$ |

Notes:
- Zone redundancy does **not** protect against a full-region outage — it is not DR.
- Some services publish a **higher** SLA for multi-region (e.g. Cosmos DB
  multi-region write) than single-region; use that when justifying the spend.
- Data residency / sovereignty may forbid a secondary region — then in-region
  zone redundancy plus backup/restore is the ceiling, and the RTO must reflect
  region-rebuild time. Flag this explicitly.
- Cross-region replication adds **egress cost** and **latency**; both are part of
  the trade-off.

## 5. Failure-mode walk

Narrate three scenarios and, for each, state whether recovery stays within the
stated RTO/RPO:

1. **Component fails** — a single instance/node drops. Does traffic route around it?
2. **Zone fails** — one AZ goes dark. Which components survive, which don't, and
   what's the blast radius?
3. **Region fails** — the whole region is unavailable. Is there a failover target,
   how is failover triggered (manual vs automatic), and how much data is lost?

If any scenario breaches the target, that's a finding for the recommendations.

## 5b. Estimated recovery window (RPO/RTO)

Most services don't publish RTO/RPO, but the customer still needs a planning
number. Give an **estimated** RPO and RTO **range** for the design as a whole,
derived from its resilience tier and the failure-mode walk above — not a
per-service figure. Use the region-strategy bands as the starting point:

| Design tier | Est. RTO | Est. RPO |
|---|---|---|
| Single region, nonzonal | hours | back to last backup |
| Single region, zone-redundant | minutes | seconds |
| Active-passive, paired region | minutes–hours | replication lag |
| Active-active, multi-region | seconds | near-zero |

Rules:
- Prefer a **published** per-service figure (e.g. Azure SQL Database) over the band.
- If there is **no DR target region**, the region-loss RTO is bounded by
  region-rebuild time — say so.
- State clearly this is a **planning estimate, not an authoritative or contractual
  objective**. The customer's own infrastructure — backup cadence, replication
  configuration, failover automation, tested runbooks, and app-level retry — will
  move these numbers materially. The only way to know the real window is to test a
  restore and a failover.

## 6. Backup & recovery hygiene

- Backups exist **and a restore has been tested** — untested backups are a
  liability, not a control.
- Backup retention meets the compliance/recovery requirement.
- Geo-redundant backup where a region-loss RPO demands it.
- The recovery runbook is written and someone has run it.

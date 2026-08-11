# Pricing the Trade-offs

Cost deltas in a review should be **live** when practical, and clearly labelled as
live-vs-estimate either way. The Azure Retail Prices API is public and needs no
auth.

## Azure Retail Prices API

`GET https://prices.azure.com/api/retail/prices`

Filter with OData `$filter`. Prices are per unit (per hour, per GB, per 10k ops,
etc.) — read `unitOfMeasure` and multiply out to a monthly figure (730 hours).

Useful filter fields: `serviceName`, `armSkuName`, `skuName`, `productName`,
`armRegionName`, `priceType` (`Consumption` vs `Reservation`), `meterName`.

Examples:

```
# App Service P1v3 in East US 2 (per-hour) → ×730 for monthly
?$filter=serviceName eq 'Azure App Service' and armRegionName eq 'eastus2' and skuName eq 'P1 v3' and priceType eq 'Consumption'

# Storage ZRS vs LRS hot data (per GB/month)
?$filter=serviceName eq 'Storage' and armRegionName eq 'eastus2' and meterName eq 'Hot ZRS Data Stored'

# Reserved vs pay-as-you-go for the same SKU
?$filter=armSkuName eq 'Standard_D2s_v5' and armRegionName eq 'eastus2'
```

Response items carry `retailPrice`, `unitPrice`, `unitOfMeasure`, `armRegionName`,
`reservationTerm` (for reservations). Page via the `NextPageLink` field.

## Translating to a monthly delta

For a reliability change, price the **increment**, not the whole system:

- **Zone redundancy via instance count** — cost of the added instance(s): unit
  hourly × 730 × extra instances.
- **Zone redundancy via SKU** (Storage ZRS/GZRS, Redis Premium) — difference
  between the ZRS meter and the current LRS meter for the stored volume.
- **Paired-region failover** — roughly a second copy of the compute + data, plus
  **cross-region egress** (`meterName` like "… Data Transfer Out") on replication
  volume. Egress is easy to forget and often material.
- **Reserved vs consumption** — compare `priceType eq 'Reservation'` (amortise the
  1yr/3yr term to monthly) against `Consumption` to show a savings option.

## Fallback

When a meter is ambiguous, the region isn't priced, or the API is unavailable, use
an order-of-magnitude estimate and **label it "estimate"**. If working inside the
`azure-architecture-review` repo, `packages/shared/src/pricing.ts`
(`estimateDiagramCost`) gives curated baseline figures — use those and say so.

Never present an estimate as a quote. The goal is the shape of the trade-off, not a
billing commitment.

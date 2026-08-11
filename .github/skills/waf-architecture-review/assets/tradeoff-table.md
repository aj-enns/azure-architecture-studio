# Trade-off Table Template

One row per reliability recommendation. Price the increment from the **Azure Retail
Prices API** where practical (see [pricing](../references/pricing.md)); otherwise
use a labelled order-of-magnitude estimate. Either way the point is the *shape* of
the trade, not a billing quote.

| Change | Current → Proposed | Failure mode closed | ~Cost Δ / month | Worth it? |
|---|---|---|---|---|
| _e.g._ App Service Plan → zone-redundant (2+ instances) | 99.95% → 99.99% (21.6 → 4.3 min/mo) | Single-zone outage takes the tier down | +~$120 (2nd instance) | Yes for tier-0/1 |
| _e.g._ Storage LRS → ZRS | single-zone → zone-redundant | Zone loss = data unavailable | +~20% storage | Yes if data is on the request path |
| _e.g._ Add paired-region failover | single-region → active-passive | Full region outage = total outage | +~1x compute + egress | Only if region-loss RTO is required |

Columns:

- **Change** — the specific config/topology change, smallest that closes the gap.
- **Current → Proposed** — availability (and RTO/RPO where relevant) before/after.
- **Failure mode closed** — the concrete outage this prevents.
- **~Cost Δ / month** — rough monthly delta; label it an estimate.
- **Worth it?** — your recommendation *for this workload's criticality*, not a blanket yes.

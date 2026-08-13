# Review Report Template

Fill in and deliver. Keep it scannable; lead with the risk, not the process.

---

## Architecture Review — <workload name>

**Reviewed:** <date> · **Criticality:** <tier-0/1/2> · **Region(s):** <region(s)>
**Targets:** SLA <99.9x%> · RTO <n> · RPO <n>

### Summary

<2–3 sentences: overall posture, the single biggest risk, and the headline
composite SLA / downtime-per-month. State plainly whether it meets the stated
targets.>

### Pillar scorecard

| Pillar | Verdict | Top finding |
|---|---|---|
| Reliability | <Strong / Adequate / At risk> | <one line> |
| Security | | |
| Cost Optimization | | |
| Operational Excellence | | |
| Performance Efficiency | | |

### Resiliency & DR

- **Composite SLA:** <99.9x%> → <n> min downtime/month (target: <99.9x%> — **met / missed**).
- **Weakest link:** <service> at <SLA%> — <why>.
- **Region strategy:** <single / zone-redundant / active-passive / active-active> — <fit to target>.
- **Zone-redundancy gaps:** <components that appear zone-redundant but aren't, with the gate they fail>.
- **Failure walk:**
  - _Component fails:_ <survives? recovery within RTO?>
  - _Zone fails:_ <blast radius>
  - _Region fails:_ <failover target, trigger, data loss vs RPO>
- **Estimated recovery window:** ~RTO <range> / ~RPO <range> — _planning estimate
  only, not authoritative; the customer's backup cadence, replication, failover
  automation, and runbooks will change it._

### Prioritized recommendations

Ranked by risk-reduction per dollar. Each is a trade-off, not a mandate.

1. **[Critical]** <change> — <current → proposed>, closes <failure mode>, ~<$Δ>/mo.
2. **[Recommended]** <change> — …
3. **[Optional]** <change> — …

<Embed the full [trade-off table](./tradeoff-table.md) here.>

### Sources

- <Microsoft Learn / SLAOS / reliability-guide links behind the figures above.>

---

_Figures are representative planning inputs, not a contractual SLA — published SLA
coverage is narrower than a service as a whole. Verify against the current SLA for
Microsoft Online Services before contractual use._

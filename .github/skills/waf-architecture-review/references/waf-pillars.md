# Well-Architected Framework — Pillar Checklists

Concrete checks per pillar. Right-size expectations to workload criticality; a
tier-0 system clears every box, a dev/test one does not need to.

## Reliability

- No single point of failure on the request path.
- Compute is zone-redundant (≥2 instances across zones) in an AZ-capable region,
  or has a documented reason not to be.
- Data tier has zone redundancy and a backup/restore strategy with a **tested**
  recovery, not just enabled backups.
- Health probes and load balancing route around unhealthy instances.
- Transient-fault handling: retry with exponential backoff and circuit breakers on
  every remote call.
- Failover path is defined and tested; RTO/RPO are measured, not aspirational.
- Autoscale handles expected peak plus headroom.

## Security

- Managed identity + Microsoft Entra ID for service-to-service auth; keys only
  where no identity option exists.
- Secrets, keys, and certs in Key Vault, referenced — not in config or code.
- Internet-facing entry points sit behind a WAF (Application Gateway or Front Door).
- Private networking (VNet, private endpoints) for data services; public access
  disabled where possible.
- Least-privilege RBAC; no broad Owner/Contributor grants on the workload identity.
- TLS enforced; minimum TLS version set.

## Cost Optimization

- SKUs right-sized to actual load, not defaulted high.
- Reserved instances / savings plans for steady-state compute; consumption for spiky.
- Autoscale-to-zero or scheduled scaling for non-production.
- No orphaned resources (unattached disks, idle public IPs, empty plans).
- The **cost of the reliability being added** is quantified — zone redundancy,
  replicas, a second region, and cross-region egress all cost money.
- Storage tier (hot/cool/cold/archive) matches access pattern; lifecycle rules set.

## Operational Excellence

- Application Insights + a Log Analytics workspace wired up.
- Infrastructure is defined as code (Bicep/Terraform), not click-ops.
- Deployments are safe: slots/canary/blue-green, and automated rollback on failure.
- Alerts fire on the **SLO** (error rate, latency, availability), not just on CPU.
- Runbooks exist for the failure modes identified in the resiliency review.

## Performance Efficiency

- A cache (Redis) fronts read-heavy or expensive data access where it helps.
- Data tier is sized for the query and throughput profile.
- Scale rules are driven by the right signal (queue depth, RPS), not only CPU.
- Latency-sensitive components are co-located (same region, ideally same zone if
  chatty) — balanced against the zone-resilience requirement.
- CDN / Front Door for global static and cacheable content.

## Reference

- Well-Architected Framework: https://learn.microsoft.com/azure/well-architected/
- Reliability pillar: https://learn.microsoft.com/azure/well-architected/reliability/

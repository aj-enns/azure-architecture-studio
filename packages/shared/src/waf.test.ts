import { describe, expect, it } from 'vitest';
import { emptyDiagram, type Diagram } from './schema.js';
import { validateArchitecture } from './waf.js';

function diagramWith(serviceIds: string[]): Diagram {
  const d = emptyDiagram('test');
  d.nodes = serviceIds.map((serviceId, i) => ({
    id: `n${i}`,
    serviceId,
    label: serviceId,
    position: { x: 0, y: 0 },
    properties: {},
  }));
  return d;
}

describe('validateArchitecture', () => {
  it('scores an empty diagram as perfect with no findings', () => {
    const report = validateArchitecture(emptyDiagram());
    expect(report.findings).toEqual([]);
    expect(report.overallScore).toBe(100);
  });

  it('flags missing Key Vault when data services are present', () => {
    const report = validateArchitecture(diagramWith(['app-service', 'sql-database']));
    expect(report.findings.map((f) => f.id)).toContain('sec-key-vault');
  });

  it('flags missing managed identity and WAF for a public web app', () => {
    const report = validateArchitecture(diagramWith(['app-service', 'sql-database']));
    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain('sec-managed-identity');
    expect(ids).toContain('sec-waf');
  });

  it('does not flag WAF when Application Gateway is present', () => {
    const report = validateArchitecture(diagramWith(['app-service', 'application-gateway']));
    expect(report.findings.map((f) => f.id)).not.toContain('sec-waf');
  });

  it('flags missing Application Insights for any non-empty diagram', () => {
    const report = validateArchitecture(diagramWith(['app-service']));
    expect(report.findings.map((f) => f.id)).toContain('ops-app-insights');
  });

  it('lowers the security score when security findings exist', () => {
    const report = validateArchitecture(diagramWith(['app-service', 'sql-database']));
    expect(report.scoreByPillar.security).toBeLessThan(100);
  });

  it('rewards a hardened design with a high overall score', () => {
    const report = validateArchitecture(
      diagramWith([
        'app-service',
        'application-gateway',
        'sql-database',
        'key-vault',
        'managed-identity',
        'private-endpoint',
        'app-insights',
        'log-analytics',
      ]),
    );
    expect(report.overallScore).toBeGreaterThanOrEqual(95);
  });
});

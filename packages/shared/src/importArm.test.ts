import { describe, expect, it } from 'vitest';
import { armResourcesToDiagram, armTemplateToDiagram, resolveServiceId } from './importArm.js';

describe('resolveServiceId', () => {
  it('maps a known Azure type via the catalog', () => {
    expect(resolveServiceId('Microsoft.App/containerApps')).toBe('container-apps');
    expect(resolveServiceId('Microsoft.App/managedEnvironments')).toBe(
      'container-apps-environment',
    );
    expect(resolveServiceId('Microsoft.OperationalInsights/workspaces')).toBe('log-analytics');
  });

  it('disambiguates Microsoft.Web/sites by kind', () => {
    expect(resolveServiceId('Microsoft.Web/sites', 'functionapp,linux')).toBe('functions');
    expect(resolveServiceId('Microsoft.Web/sites', 'app,linux')).toBe('app-service');
  });

  it('skips infrastructure glue', () => {
    expect(resolveServiceId('Microsoft.Authorization/roleAssignments')).toBeNull();
    expect(resolveServiceId('Microsoft.Resources/deployments')).toBeNull();
  });

  it('keeps unmapped real resources as external', () => {
    expect(resolveServiceId('Microsoft.Example/widgets')).toBe('external');
  });
});

describe('armTemplateToDiagram', () => {
  it('builds nodes and dependsOn edges from a symbolic template', () => {
    const template = {
      resources: {
        env: { type: 'Microsoft.App/managedEnvironments', name: 'aar-env' },
        api: {
          type: 'Microsoft.App/containerApps',
          name: 'aar-api',
          dependsOn: ['env'],
        },
        role: {
          type: 'Microsoft.Authorization/roleAssignments',
          name: 'assignment',
          dependsOn: ['api'],
        },
      },
    };

    const diagram = armTemplateToDiagram(template, { name: 'Test' });

    // roleAssignments is skipped; the environment + app remain.
    expect(diagram.nodes).toHaveLength(2);
    expect(diagram.nodes.map((n) => n.serviceId).sort()).toEqual([
      'container-apps',
      'container-apps-environment',
    ]);

    const api = diagram.nodes.find((n) => n.serviceId === 'container-apps')!;
    const env = diagram.nodes.find((n) => n.serviceId === 'container-apps-environment')!;
    expect(diagram.edges).toEqual([expect.objectContaining({ source: api.id, target: env.id })]);
  });

  it('resolves dependsOn expressed as resourceId()', () => {
    const template = {
      resources: [
        { type: 'Microsoft.Web/serverfarms', name: 'plan' },
        {
          type: 'Microsoft.Web/sites',
          name: 'site',
          kind: 'app',
          dependsOn: ["[resourceId('Microsoft.Web/serverfarms', 'plan')]"],
        },
      ],
    };

    const diagram = armTemplateToDiagram(template);
    const site = diagram.nodes.find((n) => n.serviceId === 'app-service')!;
    const plan = diagram.nodes.find((n) => n.serviceId === 'app-service-plan')!;
    expect(diagram.edges).toEqual([expect.objectContaining({ source: site.id, target: plan.id })]);
  });
});

describe('armResourcesToDiagram', () => {
  it('does not invent catalog defaults for imported resources', () => {
    const diagram = armResourcesToDiagram([
      { key: 'acr', type: 'Microsoft.ContainerRegistry/registries', name: 'acrName' },
    ]);

    expect(diagram.nodes[0]?.properties).toEqual({});
  });

  it('derives edges from property id references (Resource Graph shape)', () => {
    const envId =
      '/subscriptions/s/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/aar-env';
    const diagram = armResourcesToDiagram([
      { key: 'env', type: 'Microsoft.App/managedEnvironments', name: 'aar-env', id: envId },
      {
        key: 'api',
        type: 'Microsoft.App/containerApps',
        name: 'aar-api',
        id: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.App/containerApps/aar-api',
        properties: { managedEnvironmentId: envId },
      },
    ]);

    const api = diagram.nodes.find((n) => n.serviceId === 'container-apps')!;
    const env = diagram.nodes.find((n) => n.serviceId === 'container-apps-environment')!;
    expect(diagram.edges).toEqual([expect.objectContaining({ source: api.id, target: env.id })]);
  });
});

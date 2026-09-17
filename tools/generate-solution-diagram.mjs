import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { layoutDiagram, safeParseDiagram } from '../packages/shared/dist/index.js';

const outputPath = fileURLToPath(
  new URL('../docs/examples/solution-deployment-topology.json', import.meta.url),
);
const resourceGroup = process.env.AZURE_RESOURCE_GROUP || 'AZURE_RESOURCE_GROUP';
const region = process.env.AZURE_LOCATION || 'eastus2';

// This project-specific topology combines deployment facts from infra/*.bicep
// with runtime facts from nginx, the API routes, and the deployment workflow.
const diagram = {
  version: 1,
  metadata: {
    name: 'Azure Architecture Studio - Deployment Topology',
    description:
      'Faithful repository-derived topology: external web and internal API Container Apps, ACR image delivery, a shared pull/inference identity, Log Analytics, BYO Microsoft Foundry, and Microsoft Learn grounding.',
    region,
  },
  nodes: [
    {
      id: 'browser',
      serviceId: 'external:browser',
      label: 'User (Browser)',
      position: { x: 20, y: 310 },
      properties: { role: 'Client' },
    },
    {
      id: 'acr',
      serviceId: 'container-registry',
      label: 'aas images (ACR)',
      position: { x: 40, y: 70 },
      parentId: 'resource-group',
      properties: { sku: 'Basic', adminUserEnabled: false },
    },
    {
      id: 'identity',
      serviceId: 'managed-identity',
      label: 'aas pull and inference identity',
      position: { x: 330, y: 70 },
      parentId: 'resource-group',
      properties: { type: 'UserAssigned' },
    },
    {
      id: 'container-env',
      serviceId: 'container-apps-environment',
      label: 'Container Apps Environment',
      position: { x: 40, y: 250 },
      parentId: 'resource-group',
      properties: { logDestination: 'Log Analytics' },
    },
    {
      id: 'web',
      serviceId: 'container-apps',
      label: 'Web (nginx + React)',
      position: { x: 330, y: 220 },
      parentId: 'resource-group',
      properties: {
        ingress: 'External',
        targetPort: 80,
        minReplicas: 1,
        maxReplicas: 3,
        image: 'aas-web:<git-sha>',
      },
    },
    {
      id: 'api',
      serviceId: 'container-apps',
      label: 'API (Fastify)',
      position: { x: 620, y: 220 },
      parentId: 'resource-group',
      properties: {
        ingress: 'Internal',
        targetPort: 8080,
        minReplicas: 0,
        maxReplicas: 3,
        image: 'aas-api:<git-sha>',
      },
    },
    {
      id: 'logs',
      serviceId: 'log-analytics',
      label: '${name}-logs-${uniqueSuffix}',
      position: { x: 330, y: 420 },
      parentId: 'resource-group',
      properties: { sku: 'PerGB2018', retentionInDays: 30 },
    },
    {
      id: 'foundry',
      serviceId: 'ai-foundry',
      label: 'Microsoft Foundry (BYO)',
      position: { x: 960, y: 320 },
      parentId: 'azure',
      properties: {
        existing: true,
        integration: 'Model inference and deployment discovery',
        auth: 'Microsoft Entra ID via the user-assigned identity',
      },
    },
    {
      id: 'learn',
      serviceId: 'external',
      label: 'Microsoft Learn MCP',
      position: { x: 1580, y: 120 },
      properties: { integration: 'Documentation grounding', failureMode: 'Best effort' },
    },
  ],
  groups: [
    {
      id: 'azure',
      kind: 'subscription',
      label: 'Azure',
      position: { x: 240, y: 0 },
      size: { width: 1280, height: 700 },
      collapsed: false,
      properties: { scope: 'Azure cloud boundary' },
    },
    {
      id: 'resource-group',
      kind: 'resourceGroup',
      label: resourceGroup,
      position: { x: 20, y: 40 },
      size: { width: 900, height: 600 },
      parentId: 'azure',
      collapsed: false,
      properties: { source: 'AZURE_RESOURCE_GROUP deployment variable' },
    },
  ],
  edges: [
    { id: 'browser-web', source: 'browser', target: 'web', label: 'HTTPS' },
    { id: 'web-api', source: 'web', target: 'api', label: '/api and /healthz reverse proxy' },
    { id: 'env-web', source: 'container-env', target: 'web', label: 'hosts' },
    { id: 'env-api', source: 'container-env', target: 'api', label: 'hosts' },
    { id: 'env-logs', source: 'container-env', target: 'logs', label: 'app logs' },
    { id: 'acr-web', source: 'acr', target: 'web', label: 'aas-web image pull' },
    { id: 'acr-api', source: 'acr', target: 'api', label: 'aas-api image pull' },
    { id: 'identity-acr', source: 'identity', target: 'acr', label: 'AcrPull' },
    { id: 'identity-web', source: 'identity', target: 'web', label: 'assigned identity' },
    { id: 'identity-api', source: 'identity', target: 'api', label: 'assigned identity' },
    { id: 'api-foundry', source: 'api', target: 'foundry', label: 'Entra ID model inference' },
    { id: 'api-learn', source: 'api', target: 'learn', label: 'grounding (best effort)' },
  ],
};

const parsed = safeParseDiagram(diagram);
if (!parsed.success) {
  console.error(parsed.error.format());
  process.exitCode = 1;
} else {
  // Positions above are seeds only; the shared label-aware Dagre layout owns the
  // final placement (including pulling external nodes outside their box) so the
  // generated artifact and the in-app Auto-layout stay identical.
  const laidOut = layoutDiagram(parsed.data);
  await writeFile(outputPath, `${JSON.stringify(laidOut, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outputPath}`);
}

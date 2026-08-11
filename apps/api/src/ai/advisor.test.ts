import { describe, expect, it } from 'vitest';
import { emptyDiagram } from '@aar/shared';
import { ADVISOR_SYSTEM_PROMPT, buildAdvisorUserPrompt } from './advisor.js';

describe('architecture advisor prompt', () => {
  it('makes the latest diagram authoritative while retaining conversation context', () => {
    const diagram = {
      ...emptyDiagram(),
      metadata: { name: 'Advisor test', region: 'canadacentral' },
      nodes: [
        {
          id: 'web-1',
          serviceId: 'app-service',
          label: 'orders-api',
          position: { x: 0, y: 0 },
          properties: {},
        },
      ],
    };

    const prompt = buildAdvisorUserPrompt(
      diagram,
      'Do I need a load balancer?',
      [
        { role: 'user', content: 'This used to run on AKS.' },
        { role: 'assistant', content: 'I will use the current topology for the next answer.' },
      ],
      'Microsoft Learn grounding:\n- App Service guidance',
    );

    expect(prompt).toContain('LATEST DIAGRAM (authoritative)');
    expect(prompt).toContain('orders-api [app-service]');
    expect(prompt).toContain('This used to run on AKS.');
    expect(prompt).toContain('Do I need a load balancer?');
    expect(prompt).toContain('Microsoft Learn grounding');
  });

  it('forbids implicit mutations and distinguishes traffic-management options', () => {
    expect(ADVISOR_SYSTEM_PROMPT).toContain('never instruct the UI to change it automatically');
    expect(ADVISOR_SYSTEM_PROMPT).toContain('Azure Load Balancer');
    expect(ADVISOR_SYSTEM_PROMPT).toContain('Application Gateway');
    expect(ADVISOR_SYSTEM_PROMPT).toContain('Azure Front Door');
  });
});
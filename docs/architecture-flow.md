# Architecture flow: prompt, AI, and deterministic calls

This diagram traces a request through the two AI paths in the app and shows where
work is **deterministic** (pure functions in `packages/shared`, no model), where it
is **AI** (a model call), and where it reaches **external** services.

The analytical intelligence — Well-Architected, resiliency, and cost — is computed
deterministically and injected into the prompt. The model synthesizes prose over
verified numbers rather than inventing them (see
[ADR-0019](adr/0019-single-synthesizer-over-multi-agent.md),
[ADR-0014](adr/0014-in-app-ai-architecture-review.md)).

```mermaid
flowchart TD
    User([User]) -->|prompt / diagram| Web[Web app · React Flow]

    %% ---------- PROMPT -> DIAGRAM ----------
    Web -->|"POST /api/generate<br/>{prompt, current, mode}"| Gen{{config.ts:<br/>Foundry/OpenAI configured?}}
    Gen -->|no| G503[503 not configured]
    Gen -->|yes| Retrieve[retrieveArchitectures<br/>knowledge.ts · keyword RAG]
    Retrieve --> Fmt[formatArchitecturesForPrompt]
    Fmt --> LearnG[getLearnGrounding<br/>best-effort]
    LearnG -.->|MCP search| Learn[(Microsoft Learn MCP)]
    LearnG --> BuildP[buildSystemPrompt + buildUserPrompt<br/>prompt.ts · injects catalog ids]
    BuildP --> GenSpec[generateSpec → generateJson<br/>openai.ts]
    GenSpec -->|inference| Foundry[(Microsoft Foundry /<br/>Azure OpenAI model)]
    Foundry --> Spec[specToDiagram<br/>spec.ts]
    Spec --> Layout[layoutDiagram · dagre<br/>+ schema validation]
    Layout --> DiagramOut[/Validated Diagram/]
    DiagramOut --> Web

    %% ---------- DIAGRAM -> AI ANALYSIS ----------
    Web -->|"POST /api/review or /api/advise<br/>{diagram}"| Det

    subgraph Det [Deterministic engines · packages/shared · no model]
        WAF[validateArchitecture<br/>waf.ts]
        Res[analyzeResiliency<br/>resiliency.ts · SLA/RTO/RPO]
        Cost[estimateDiagramCost<br/>pricing.ts]
    end

    Det --> LearnG2[optional Learn grounding<br/>best-effort]
    LearnG2 -.->|MCP search| Learn
    LearnG2 --> BuildR[review.ts / advisor.ts<br/>inject deterministic JSON into prompt]
    BuildR --> Synth[generateJson<br/>openai.ts]
    Synth -->|inference| Foundry
    Foundry --> Markdown[/Markdown review or advice<br/>+ optional diagramPrompt/]
    Markdown --> Web

    %% ---------- deterministic-only panels ----------
    Web -.->|"/api/validate · /api/cost · /api/resiliency"| Det

    classDef deterministic fill:#e6f4ea,stroke:#137333,color:#0b3d1f;
    classDef ai fill:#e8f0fe,stroke:#1967d2,color:#0b2a5b;
    classDef external fill:#fff4e5,stroke:#c05621,color:#5a2c06;

    class Retrieve,Fmt,BuildP,Spec,Layout,WAF,Res,Cost,BuildR deterministic
    class GenSpec,Synth,BuildR ai
    class Foundry,Learn external
```

## Legend

- **Green — deterministic** (no model): retrieval/RAG, WAF, resiliency, cost,
  layout, and schema validation. All in `packages/shared` or pure API helpers.
- **Blue — AI**: the only two model touchpoints — `generateSpec`
  (prompt → diagram) and `generateJson` (review/advice synthesis), both through
  [`apps/api/src/ai/openai.ts`](../apps/api/src/ai/openai.ts).
- **Orange — external**: the Foundry / Azure OpenAI model endpoint and the
  Microsoft Learn MCP. Learn grounding is always best-effort and soft-fails.

## Notes

- Deterministic analysis is computed **before** the model call and injected into
  the prompt, so review and advice agree with the app's own panels by construction.
- The `/api/validate`, `/api/cost`, and `/api/resiliency` panels call the green
  engines directly with **no model call at all**.
- Foundry vs. Azure OpenAI is resolved in
  [`apps/api/src/config.ts`](../apps/api/src/config.ts); both flow through the same
  `openai.ts` inference helper.

## Prompt → presented diagram (happy path)

A focused view of a single generation request, from the user's words to the
rendered canvas. Dashed steps are best-effort and soft-fail without blocking.

```mermaid
flowchart TD
    A([User types a prompt]) --> B[Web app sends<br/>POST /api/generate]
    B --> C{Model configured?<br/>config.ts}
    C -->|No| C1[[503 · show &quot;configure AI&quot; gate]]
    C -->|Yes| D[Validate request body<br/>Zod generateRequestSchema]
    D --> E[retrieveArchitectures<br/>knowledge.ts · pick closest reference patterns]
    E --> F[formatArchitecturesForPrompt<br/>reference grounding text]
    F -.->|best-effort| G[getLearnGrounding<br/>Microsoft Learn MCP]
    G -.-> H
    F --> H[buildSystemPrompt + buildUserPrompt<br/>prompt.ts · enumerate catalog ids]
    H --> I[generateSpec → generateJson<br/>openai.ts]
    I -->|inference| J[(Foundry / Azure OpenAI)]
    J --> K[specToDiagram<br/>spec.ts · drop unknown ids]
    K --> L[layoutDiagram · dagre<br/>auto-position nodes]
    L --> M[Diagram schema validation]
    M --> N["Return {diagram, citations}"]
    N --> O([Render on React Flow canvas])

    classDef ok fill:#e6f4ea,stroke:#137333,color:#0b3d1f;
    classDef ai fill:#e8f0fe,stroke:#1967d2,color:#0b2a5b;
    classDef ext fill:#fff4e5,stroke:#c05621,color:#5a2c06;
    class E,F,K,L,M ok
    class I ai
    class G,J ext
```

Failure handling along this path:

- **No model** → `503`, the UI shows the "configure AI" gate (same as the review panel).
- **Bad request body** → `400` from the Zod schema.
- **Learn grounding fails** → ignored; generation proceeds on the reference patterns.
- **Model returns invalid ids** → `specToDiagram` drops them, so only real catalog services reach the canvas ([ADR-0010](adr/0010-ai-prompt-to-diagram.md)).

## Related

- [ADR-0010](adr/0010-ai-prompt-to-diagram.md) — prompt-to-diagram
- [ADR-0012](adr/0012-resiliency-sla-rpo-rto-modelling.md) — resiliency modelling
- [ADR-0014](adr/0014-in-app-ai-architecture-review.md) — in-app AI review
- [ADR-0016](adr/0016-unified-ai-advisor.md) — unified advisor
- [ADR-0019](adr/0019-single-synthesizer-over-multi-agent.md) — single synthesizer over per-pillar agents

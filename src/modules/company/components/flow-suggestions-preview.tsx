import { Badge } from '@/components/ui/badge';
import type { FlowGraph, FlowNode, FlowNodeType } from '@/lib/flows/types';

/**
 * The proposed flow, read as a script rather than drawn as a canvas.
 *
 * A reviewer deciding whether to accept a suggestion is asking one question:
 * "would I be happy if a customer saw this?" A miniature of the builder canvas
 * answers a different question — it shows the shape of the graph, not the
 * words — and at the size that fits beside the evidence, the words are the part
 * that gets illegible. So this walks the graph from its Start block in the
 * order a customer would meet it and prints what each block actually says.
 *
 * A SERVER COMPONENT ON PURPOSE. Nothing here is interactive, and the real
 * editing experience is the existing builder, which the accept button opens.
 *
 * Layout note: one column, always. This renders inside a card that shares the
 * page with the evidence, so it is a narrow container on a wide screen — the
 * kind of place a responsive grid keyed to the viewport clips its own text.
 */

const TYPE_LABELS: Partial<Record<FlowNodeType, string>> = {
  start: 'Start',
  message: 'Says',
  ask: 'Asks',
  buttons: 'Choice',
  quick_replies: 'Choice',
  condition: 'Checks',
  ai: 'Assistant answers',
  handoff: 'Passes to a person',
  end: 'Ends',
};

const OPERATOR_WORDS: Record<string, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  is_set: 'has been answered',
  is_empty: 'is blank',
  greater_than: 'is more than',
  less_than: 'is less than',
};

/** What a block does, in the words the customer would experience. */
function describe(node: FlowNode): string {
  const data = node.data;
  switch (node.type) {
    case 'start':
      return 'The conversation reaches this guided chat.';
    case 'ai':
      return data.instruction
        ? `The assistant answers from your own business information — ${data.instruction}`
        : 'The assistant answers from your own business information.';
    case 'handoff':
      return data.text || 'The conversation is passed to someone on your team.';
    case 'condition': {
      const clauses = (data.conditions ?? []).map(
        (c) => `${c.variable.replace(/_/g, ' ')} ${OPERATOR_WORDS[c.operator] ?? c.operator}${c.value ? ` “${c.value}”` : ''}`,
      );
      if (clauses.length === 0) return 'Branches, but has no rule to check.';
      return `If ${clauses.join(data.match === 'any' ? ', or ' : ', and ')}.`;
    }
    default:
      return data.text || '';
  }
}

interface Step {
  node: FlowNode;
  depth: number;
  /** Which output of the previous block led here, in plain words. */
  via: string | null;
}

/**
 * The blocks in the order a customer meets them.
 *
 * Breadth-first from the Start block, so a branch's two sides sit next to each
 * other rather than one being buried under the other's whole subtree. Blocks
 * nothing reaches come last — the graph was validated before it was stored, so
 * that list should always be empty, but a hand-edited row must still render.
 */
function walk(graph: FlowGraph): Step[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const entry = graph.nodes.find((n) => n.type === 'start') ?? graph.nodes[0];
  if (!entry) return [];

  const steps: Step[] = [];
  const seen = new Set<string>([entry.id]);
  const queue: Step[] = [{ node: entry, depth: 0, via: null }];

  while (queue.length) {
    const step = queue.shift();
    if (!step) break;
    steps.push(step);

    const source = step.node;
    for (const edge of graph.edges) {
      if (edge.source !== source.id) continue;
      const target = byId.get(edge.target);
      if (!target || seen.has(target.id)) continue;
      seen.add(target.id);
      queue.push({ node: target, depth: step.depth + 1, via: handleLabel(source, edge.sourceHandle) });
    }
  }

  for (const node of graph.nodes) {
    if (!seen.has(node.id)) steps.push({ node, depth: 0, via: 'not connected' });
  }
  return steps;
}

function handleLabel(source: FlowNode, handle: string | undefined): string | null {
  if (source.type === 'condition') return handle === 'false' ? 'if not' : 'if so';
  if (source.type === 'buttons' || source.type === 'quick_replies') {
    if (handle === 'fallback') return 'anything else';
    const choice = (source.data.choices ?? []).find((c) => c.id === handle);
    return choice ? `“${choice.label}”` : null;
  }
  return null;
}

/** Indent per branch level, capped so a deep flow never pushes text off the card. */
const INDENT = ['ps-0', 'ps-4', 'ps-8', 'ps-12', 'ps-12', 'ps-12'];

export function FlowSuggestionPreview({ graph }: { graph: FlowGraph }) {
  const steps = walk(graph);

  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This draft has no blocks left to show. Dismiss it and it will not come back.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {steps.map((step) => {
        const text = describe(step.node);
        const choices = step.node.data.choices ?? [];
        return (
          <li key={step.node.id} className={INDENT[Math.min(step.depth, INDENT.length - 1)]}>
            <div className="rounded-md border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{TYPE_LABELS[step.node.type] ?? step.node.type}</Badge>
                {step.via ? (
                  <span className="text-xs text-muted-foreground">{step.via}</span>
                ) : null}
              </div>
              {text ? <p className="mt-1.5 text-sm leading-relaxed">{text}</p> : null}
              {choices.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {choices.map((choice) => (
                    <Badge key={choice.id} variant="secondary">
                      {choice.label}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {step.node.type === 'ask' && step.node.data.variable ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Saves the answer as “{step.node.data.variable.replace(/_/g, ' ')}”.
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

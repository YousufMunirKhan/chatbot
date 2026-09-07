// Flow builder verification — graph validation rules, the ready-made templates,
// the edge/handle contract with the runtime engine, and version restore.
//
// No database and no browser: the modules under test are pure, so they are
// transpiled with the TypeScript compiler and executed directly. That means
// these checks run the REAL `validateGraph`, the REAL templates and the REAL
// `runFlow` — not a re-implementation that can drift from them.
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const Module = require('module');

/** Transpile one TS file and load it, resolving `deps` before the real loader. */
function loadTs(path, deps = {}) {
  const source = readFileSync(path, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: 'commonjs', target: 'es2020' },
  }).outputText;
  const mod = new Module(path);
  mod.filename = path;
  mod.require = (id) => (id in deps ? deps[id] : require(id));
  mod._compile(js, `${path}.cjs`);
  return mod.exports;
}

// `types.ts` and `flow-graph.ts` import only *types* from aliased paths, which
// TypeScript elides, so they load with no shims at all. `engine.ts` has one
// value import (`./types`), wired to the module we just built.
const flowTypes = loadTs('src/lib/flows/types.ts');
const engine = loadTs('src/lib/flows/engine.ts', { './types': flowTypes });
const core = loadTs('src/modules/company/flow-graph.ts');

const {
  validateGraph,
  problemMessages,
  FLOW_TEMPLATES,
  findTemplate,
  outputHandles,
  planGraphSave,
  planVersionRestore,
  describeTrigger,
  createNode,
  newId,
} = core;
const { runFlow } = engine;

let failures = 0;
const check = (label, cond, extra) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
const has = (problems, fragment) =>
  problems.some((p) => p.toLowerCase().includes(fragment.toLowerCase()));

const node = (id, type, data = {}, x = 0, y = 0) => ({ id, type, position: { x, y }, data });
const edge = (source, target, sourceHandle = 'default') => ({
  id: `${source}:${sourceHandle}->${target}`,
  source,
  sourceHandle,
  target,
});

// ===========================================================================
console.log('\n— Graph validation ————————————————————————————');
// ===========================================================================

// 0. A well-formed graph produces no problems at all.
{
  const graph = {
    nodes: [
      node('start_1', 'start'),
      node('msg_1', 'message', { text: 'Hello' }),
      node('end_1', 'end', { text: 'Bye' }),
    ],
    edges: [edge('start_1', 'msg_1'), edge('msg_1', 'end_1')],
  };
  check('A valid graph reports no problems', validateGraph(graph).length === 0, JSON.stringify(problemMessages(graph)));
}

// 1a. Empty graph.
check('An empty graph is rejected', has(problemMessages({ nodes: [], edges: [] }), 'no blocks'));

// 1b. Two Start blocks = two entry points.
{
  const graph = {
    nodes: [node('start_1', 'start'), node('start_2', 'start'), node('msg_1', 'message', { text: 'hi' })],
    edges: [edge('start_1', 'msg_1'), edge('start_2', 'msg_1')],
  };
  check('Two Start blocks are rejected', has(problemMessages(graph), 'start blocks'));
}

// 1c. No Start block and two blocks nothing points at.
{
  const graph = {
    nodes: [
      node('msg_1', 'message', { text: 'a' }),
      node('msg_2', 'message', { text: 'b' }),
      node('end_1', 'end', {}),
    ],
    edges: [edge('msg_1', 'end_1')],
  };
  const problems = problemMessages(graph);
  check('Two possible entry points are rejected', has(problems, 'entry points'));
}

// 1d. Exactly one root and no Start block is fine — the engine treats the only
//     unreferenced node as the entry point.
{
  const graph = {
    nodes: [node('msg_1', 'message', { text: 'a' }), node('end_1', 'end', {})],
    edges: [edge('msg_1', 'end_1')],
  };
  check('A single implicit entry point is accepted', validateGraph(graph).length === 0);
}

// 1e. A closed loop has no entry point at all.
{
  const graph = {
    nodes: [node('msg_1', 'message', { text: 'a' }), node('msg_2', 'message', { text: 'b' })],
    edges: [edge('msg_1', 'msg_2'), edge('msg_2', 'msg_1')],
  };
  check('A graph with no entry point is rejected', has(problemMessages(graph), 'no entry point'));
}

// 2. Unreachable block.
{
  const graph = {
    nodes: [
      node('start_1', 'start'),
      node('msg_1', 'message', { text: 'hi' }),
      node('msg_orphan', 'message', { text: 'nobody gets here' }),
    ],
    edges: [edge('start_1', 'msg_1')],
  };
  const problems = problemMessages(graph);
  check('An unreachable block is reported', has(problems, 'can never be reached'));
  check(
    'The unreachable block is named in the problem',
    problems.some((p) => p.includes('nobody gets here')),
    problems.join(' | '),
  );
  check(
    'The problem points at the offending node id',
    validateGraph(graph).some((p) => p.nodeId === 'msg_orphan'),
  );
}

// 3. Duplicate choice ids inside one block.
{
  const graph = {
    nodes: [
      node('start_1', 'start'),
      node('btn_1', 'buttons', {
        text: 'Pick',
        choices: [
          { id: 'c1', label: 'One' },
          { id: 'c1', label: 'Two' },
        ],
      }),
    ],
    edges: [edge('start_1', 'btn_1')],
  };
  check('Duplicate choice ids are rejected', has(problemMessages(graph), 'twice'));
}

// 3b. The same choice id in a DIFFERENT block is fine — ids are per node.
{
  const graph = {
    nodes: [
      node('start_1', 'start'),
      node('btn_1', 'buttons', { text: 'A', choices: [{ id: 'c1', label: 'One' }] }),
      node('btn_2', 'buttons', { text: 'B', choices: [{ id: 'c1', label: 'One' }] }),
    ],
    edges: [edge('start_1', 'btn_1'), edge('btn_1', 'btn_2', 'c1')],
  };
  check('The same choice id in two blocks is allowed', validateGraph(graph).length === 0, JSON.stringify(problemMessages(graph)));
}

// 3c. A choice block with no choices cannot be answered.
{
  const graph = {
    nodes: [node('start_1', 'start'), node('btn_1', 'buttons', { text: 'Pick', choices: [] })],
    edges: [edge('start_1', 'btn_1')],
  };
  check('A choice block with no choices is rejected', has(problemMessages(graph), 'no choices'));
}

// 4. Condition with no clauses.
{
  const graph = {
    nodes: [
      node('start_1', 'start'),
      node('if_1', 'condition', { conditions: [] }),
      node('end_1', 'end', {}),
    ],
    edges: [edge('start_1', 'if_1'), edge('if_1', 'end_1', 'true')],
  };
  check('A condition with no rules is rejected', has(problemMessages(graph), 'no rules to check'));
}

// 4b. A condition with one clause passes.
{
  const graph = {
    nodes: [
      node('start_1', 'start'),
      node('if_1', 'condition', { match: 'all', conditions: [{ variable: 'name', operator: 'is_set' }] }),
      node('yes', 'end', {}),
      node('no', 'end', {}),
    ],
    edges: [edge('start_1', 'if_1'), edge('if_1', 'yes', 'true'), edge('if_1', 'no', 'false')],
  };
  check('A condition with one rule is accepted', validateGraph(graph).length === 0, JSON.stringify(problemMessages(graph)));
}

// 5. An `ask` with nowhere to put the answer.
{
  const graph = {
    nodes: [node('start_1', 'start'), node('ask_1', 'ask', { text: 'Name?' })],
    edges: [edge('start_1', 'ask_1')],
  };
  check('An Ask block with no variable is rejected', has(problemMessages(graph), 'where to save'));
}

// 6. Edge pointing at a deleted block.
{
  const graph = {
    nodes: [node('start_1', 'start'), node('msg_1', 'message', { text: 'hi' })],
    edges: [edge('start_1', 'msg_1'), edge('msg_1', 'ghost_node')],
  };
  check('A connection to a missing block is reported', has(problemMessages(graph), 'no longer exists'));
}

// ===========================================================================
console.log('\n— Templates ————————————————————————————————————');
// ===========================================================================

check('At least five ready-made templates ship', FLOW_TEMPLATES.length >= 5, `${FLOW_TEMPLATES.length} found`);

const REQUIRED_TEMPLATES = ['welcome_menu', 'lead_capture', 'faq_menu', 'book_appointment', 'order_status'];
for (const key of REQUIRED_TEMPLATES) {
  check(`Template "${key}" exists`, Boolean(findTemplate(key)));
}

for (const template of FLOW_TEMPLATES) {
  const graph = template.build();
  const problems = problemMessages(graph);
  check(`Template "${template.key}" passes validation`, problems.length === 0, problems.join(' | '));
  check(`Template "${template.key}" has exactly one Start block`, graph.nodes.filter((n) => n.type === 'start').length === 1);

  // Every edge must leave through a handle the node actually offers — this is
  // the contract `src/lib/flows/engine.ts` reads when it follows an output.
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let badHandle = null;
  for (const e of graph.edges) {
    const source = byId.get(e.source);
    if (!source) {
      badHandle = `${e.source} missing`;
      break;
    }
    const ids = outputHandles(source).map((h) => h.id);
    if (!ids.includes(e.sourceHandle ?? 'default')) {
      badHandle = `${e.source} has no handle "${e.sourceHandle}" (has ${ids.join(',')})`;
      break;
    }
  }
  check(`Template "${template.key}" only wires real output handles`, badHandle === null, badHandle ?? '');
}

// ===========================================================================
console.log('\n— Templates actually run in the engine ——————————');
// ===========================================================================
{
  const graph = findTemplate('welcome_menu').build();
  const first = await runFlow({ graph });
  check('Welcome template sends something on entry', first.blocks.length > 0);
  check(
    'Welcome template parks on the menu awaiting an answer',
    first.awaitingNodeId === 'btn_1',
    String(first.awaitingNodeId),
  );

  const sales = await runFlow({ graph, startNodeId: first.awaitingNodeId, input: 'c_sales', state: first.state });
  check('Choosing "Talk to sales" escalates to a human', sales.handoffToHuman === true);

  const unknown = await runFlow({
    graph,
    startNodeId: first.awaitingNodeId,
    input: 'something nobody predicted',
    state: first.state,
  });
  check('An unmatched answer takes the fallback path', unknown.blocks.length > 0 && !unknown.handoffToHuman);
}

{
  const graph = findTemplate('lead_capture').build();
  let result = await runFlow({ graph });
  check('Lead capture asks for a name first', result.awaitingNodeId === 'ask_name');

  result = await runFlow({ graph, startNodeId: result.awaitingNodeId, input: 'Sam', state: result.state });
  check('Lead capture stores the name', result.state.name === 'Sam');

  // A bad email must be re-asked rather than accepted.
  const retry = await runFlow({ graph, startNodeId: 'ask_email', input: 'not-an-email', state: result.state });
  check('Lead capture rejects a malformed email', retry.awaitingNodeId === 'ask_email');

  result = await runFlow({ graph, startNodeId: 'ask_email', input: 'sam@example.com', state: result.state });
  result = await runFlow({ graph, startNodeId: result.awaitingNodeId, input: '+441234567890', state: result.state });
  check('Lead capture finishes after the phone number', result.completed === true);
  check(
    'Lead capture emits a save_lead effect',
    result.effects.some((e) => e.type === 'save_lead' && e.fields.email === 'sam@example.com'),
    JSON.stringify(result.effects),
  );
}

{
  const graph = findTemplate('order_status').build();
  const first = await runFlow({ graph });
  check('Order lookup asks for the order number', first.awaitingNodeId === 'ask_order');

  // Inject a failing fetch: the API block must take its "false" handle.
  const failed = await runFlow({
    graph,
    startNodeId: 'ask_order',
    input: '12345',
    state: first.state,
    deps: { httpFetch: async () => { throw new Error('offline'); } },
  });
  check('A failed API call routes to the human handoff', failed.handoffToHuman === true);

  const ok = await runFlow({
    graph,
    startNodeId: 'ask_order',
    input: '12345',
    state: first.state,
    deps: {
      httpFetch: async () => ({
        ok: true,
        text: async () => JSON.stringify({ data: { status: 'out for delivery', eta: 'tomorrow' } }),
      }),
    },
  });
  check(
    'A successful API call reads the status back',
    ok.blocks.some((b) => b.type === 'text' && b.text.includes('out for delivery')),
    JSON.stringify(ok.blocks),
  );
}

// ===========================================================================
console.log('\n— Versions ——————————————————————————————————————');
// ===========================================================================
{
  const v1 = { nodes: [node('start_1', 'start')], edges: [] };
  const v2 = { nodes: [node('start_1', 'start'), node('msg_1', 'message', { text: 'hi' })], edges: [] };
  const v3 = { nodes: [node('start_1', 'start'), node('msg_1', 'message', { text: 'changed' })], edges: [] };

  const save = planGraphSave({ version: 1, graph: v1 }, v2);
  check('Saving snapshots the version being replaced', save.snapshot.version === 1);
  check('The snapshot holds the OLD graph', save.snapshot.graph === v1);
  check('Saving bumps the flow to the next version', save.nextVersion === 2);
  check('Saving writes the new graph', save.graph === v2);

  const save2 = planGraphSave({ version: 2, graph: v2 }, v3);
  check('A second save snapshots version 2', save2.snapshot.version === 2 && save2.nextVersion === 3);

  // Restoring v1 while sitting on v3: v3 is snapshotted, v1 becomes v4.
  const restore = planVersionRestore({ version: 3, graph: v3 }, { version: 1, graph: v1 });
  check('Restoring snapshots the graph being replaced', restore.snapshot.version === 3 && restore.snapshot.graph === v3);
  check('Restoring brings back the target graph', restore.graph === v1);
  check('Restoring bumps the version rather than rewinding it', restore.nextVersion === 4);

  // …so restoring the snapshot it just wrote undoes the restore.
  const undo = planVersionRestore({ version: 4, graph: v1 }, { version: 3, graph: v3 });
  check('A restore is itself undoable', undo.graph === v3 && undo.nextVersion === 5);
}

// ===========================================================================
console.log('\n— Helpers ———————————————————————————————————————');
// ===========================================================================
{
  check('newId skips ids already taken', newId('msg', ['msg_1', 'msg_2']) === 'msg_3');
  const created = createNode('buttons', { x: 10.4, y: 20.6 }, ['btn_1']);
  check('createNode avoids id collisions', created.id === 'btn_2');
  check('createNode rounds the position', created.position.x === 10 && created.position.y === 21);
  check('createNode seeds usable defaults', (created.data.choices ?? []).length >= 2);

  const buttonsNode = node('btn_1', 'buttons', {
    choices: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
  });
  const handles = outputHandles(buttonsNode).map((h) => h.id);
  check('A choice block exposes one handle per choice plus fallback', handles.join(',') === 'a,b,fallback');
  check(
    'Condition and API blocks expose true/false',
    outputHandles(node('if_1', 'condition', {})).map((h) => h.id).join(',') === 'true,false' &&
      outputHandles(node('api_1', 'http', {})).map((h) => h.id).join(',') === 'true,false',
  );
  check('Terminal blocks expose no outputs', outputHandles(node('end_1', 'end', {})).length === 0);

  check(
    'Trigger summaries read as English',
    describeTrigger({ type: 'keyword', matchValue: 'pricing', matchMode: 'contains', channels: ['whatsapp'] }) ===
      'When a message contains "pricing" on whatsapp.',
    describeTrigger({ type: 'keyword', matchValue: 'pricing', matchMode: 'contains', channels: ['whatsapp'] }),
  );
}

console.log(
  failures === 0 ? '\n🎉 Flow builder verified.' : `\n❌ ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);

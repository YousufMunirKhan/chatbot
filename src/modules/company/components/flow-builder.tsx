'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { FlowGraph, FlowNode, FlowNodeData, FlowNodeType } from '@/lib/flows/types';
import {
  FIRST_PORT_Y,
  INPUT_PORT_Y,
  NODE_WIDTH,
  PALETTE,
  PORT_GAP,
  createNode,
  edgePath,
  inputPoint,
  nodeGroup,
  nodeHeight,
  nodeTitle,
  nodeTypeLabel,
  outputHandles,
  outputPoint,
  validateGraph,
} from '../flow-graph';
import {
  publishFlowAction,
  restoreFlowVersionAction,
  saveFlowGraphAction,
  setFlowStatusAction,
  updateFlowMetaAction,
} from '../flows-actions';
import type { FlowAnalytics, FlowDetail } from '../flows-data';
import { FlowInspector } from './flow-inspector';
import { FlowSimulator } from './flow-simulator';
import { FlowTriggersPanel } from './flow-triggers-panel';

/**
 * The visual builder.
 *
 * PERFORMANCE NOTE — the whole design of this file follows from one rule: React
 * must not re-render while the mouse is moving.
 *
 *  - A node card is `memo`ised on its own `FlowNode` object. Committing a change
 *    replaces exactly one node object, so the other cards never re-render.
 *  - Dragging a node writes `element.style.transform` and the `d` attribute of
 *    the handful of edges touching it *directly*, and only commits to React
 *    state on pointer-up. A 200-node canvas therefore costs the same per
 *    mousemove as a 5-node one.
 *  - Panning and zooming write the transform of one wrapper element and the
 *    text of the zoom label; neither is React state at all.
 *  - Edge geometry is arithmetic (`flow-graph.ts` fixes the card width and the
 *    handle offsets), so nothing here ever measures the DOM.
 *  - Typing in the properties panel coalesces into a single history entry per
 *    ~second, and touches only the edited node.
 */

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Tab = 'block' | 'triggers' | 'test' | 'history';

const GROUP_ACCENT: Record<string, string> = {
  content: 'border-l-sky-500',
  questions: 'border-l-violet-500',
  logic: 'border-l-amber-500',
  actions: 'border-l-emerald-500',
};

// ---------------------------------------------------------------------------
// Node card
// ---------------------------------------------------------------------------
interface NodeCardProps {
  node: FlowNode;
  selected: boolean;
  entered: number | undefined;
  registerEl: (id: string, el: HTMLDivElement | null) => void;
  onCardPointerDown: (event: React.PointerEvent, nodeId: string) => void;
  onHandlePointerDown: (event: React.PointerEvent, nodeId: string, handleId: string) => void;
}

const NodeCard = memo(function NodeCard({
  node,
  selected,
  entered,
  registerEl,
  onCardPointerDown,
  onHandlePointerDown,
}: NodeCardProps) {
  const handles = outputHandles(node);
  const preview = node.data.text ?? node.data.url ?? node.data.instruction ?? '';

  return (
    <div
      data-node-id={node.id}
      ref={(el) => registerEl(node.id, el)}
      onPointerDown={(event) => onCardPointerDown(event, node.id)}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: NODE_WIDTH,
        minHeight: nodeHeight(node),
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
      }}
      className={`select-none rounded-lg border border-l-4 bg-card shadow-sm transition-shadow ${
        GROUP_ACCENT[nodeGroup(node.type)] ?? 'border-l-slate-400'
      } ${selected ? 'ring-2 ring-ring' : 'hover:shadow-md'}`}
    >
      {/* Input handle — every block except the entry point can be wired into. */}
      {node.type === 'start' ? null : (
        <span
          aria-hidden="true"
          style={{ top: INPUT_PORT_Y - 6 }}
          className="absolute -left-1.5 h-3 w-3 rounded-full border-2 border-background bg-muted-foreground"
        />
      )}

      <div className="cursor-grab px-3 pb-1 pt-2 active:cursor-grabbing">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {nodeTypeLabel(node.type)}
          </p>
          {entered ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
              {entered}
            </span>
          ) : null}
        </div>
        <p className="truncate text-sm font-medium">{nodeTitle(node)}</p>
      </div>

      {preview ? (
        <p className="line-clamp-2 px-3 pb-2 text-xs text-muted-foreground">{preview}</p>
      ) : null}

      {handles.map((handle, index) => (
        <div
          key={handle.id}
          style={{ top: FIRST_PORT_Y + index * PORT_GAP - 9 }}
          className="absolute right-0 flex h-[18px] items-center gap-1 pe-1"
        >
          <span
            className={`max-w-[120px] truncate text-[10px] ${
              handle.tone === 'true'
                ? 'text-success-fg'
                : handle.tone === 'false'
                  ? 'text-danger-fg'
                  : handle.tone === 'fallback'
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground'
            }`}
          >
            {handle.label}
          </span>
          <button
            type="button"
            aria-label={`Connect the "${handle.label}" output`}
            onPointerDown={(event) => onHandlePointerDown(event, node.id, handle.id)}
            style={{ marginRight: -8 }}
            className={`h-3 w-3 shrink-0 cursor-crosshair rounded-full border-2 border-background ${
              // Raw palette values (`emerald-500`, `rose-500`, `slate-400`) for
              // what are exactly the yes / no / neither states the semantic
              // solids already name. `--success`, `--danger` and
              // `--muted-foreground` are defined in both themes; the palette
              // ones were tuned against a light canvas only.
              handle.tone === 'true'
                ? 'bg-success'
                : handle.tone === 'false'
                  ? 'bg-danger'
                  : handle.tone === 'fallback'
                    ? 'bg-muted-foreground'
                    : 'bg-primary'
            }`}
          />
        </div>
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Edge layer
// ---------------------------------------------------------------------------
const EdgeLayer = memo(function EdgeLayer({
  graph,
  selectedEdgeId,
  onSelectEdge,
  registerPath,
  registerTemp,
}: {
  graph: FlowGraph;
  selectedEdgeId: string | null;
  onSelectEdge: (id: string) => void;
  registerPath: (id: string, el: SVGPathElement | null) => void;
  registerTemp: (el: SVGPathElement | null) => void;
}) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <svg
      width={8000}
      height={5000}
      className="pointer-events-none absolute left-0 top-0"
      aria-hidden="true"
    >
      <defs>
        <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
        </marker>
      </defs>
      {graph.edges.map((edge) => {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target) return null;
        const d = edgePath(outputPoint(source, edge.sourceHandle ?? 'default'), inputPoint(target));
        const selected = edge.id === selectedEdgeId;
        return (
          <g key={edge.id} className={selected ? 'text-primary' : 'text-border'}>
            {/* A fat invisible copy makes a 2px line clickable. */}
            <path
              ref={(el) => registerPath(`hit:${edge.id}`, el)}
              d={d}
              stroke="transparent"
              strokeWidth={14}
              fill="none"
              // `stroke` is an SVG-only pointer-events value with no Tailwind
              // utility: the fat transparent copy is clickable, the thin visible
              // one is not, and the surrounding SVG stays click-through.
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectEdge(edge.id);
              }}
            />
            <path
              ref={(el) => registerPath(edge.id, el)}
              d={d}
              stroke="currentColor"
              strokeWidth={selected ? 2.5 : 1.75}
              fill="none"
              markerEnd="url(#flow-arrow)"
            />
          </g>
        );
      })}
      <path
        ref={registerTemp}
        d=""
        style={{ display: 'none' }}
        stroke="currentColor"
        strokeDasharray="4 4"
        strokeWidth={2}
        fill="none"
        className="text-primary"
      />
    </svg>
  );
});

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
export interface FlowBuilderProps {
  flow: FlowDetail;
  flowOptions: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  intents: Array<{ id: string; name: string }>;
  analytics: FlowAnalytics;
}

export function FlowBuilder({ flow, flowOptions, agents, intents, analytics }: FlowBuilderProps) {
  const router = useRouter();

  const [graph, setGraph] = useState<FlowGraph>(() => flow.graph);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('block');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishProblems, setPublishProblems] = useState<string[] | null>(null);
  const [status, setStatus] = useState(flow.status);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // --- refs the pointer handlers work through ------------------------------
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const zoomLabelRef = useRef<HTMLSpanElement | null>(null);
  const viewRef = useRef({ x: 40, y: 20, k: 0.85 });
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const pathEls = useRef(new Map<string, SVGPathElement>());
  const tempPathRef = useRef<SVGPathElement | null>(null);
  const dirtyRef = useRef(false);
  const historyRef = useRef<{ past: FlowGraph[]; future: FlowGraph[] }>({ past: [], future: [] });
  const lastCommitRef = useRef<{ key: string; at: number } | null>(null);

  const registerEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) nodeEls.current.set(id, el);
    else nodeEls.current.delete(id);
  }, []);
  const registerPath = useCallback((id: string, el: SVGPathElement | null) => {
    if (el) pathEls.current.set(id, el);
    else pathEls.current.delete(id);
  }, []);
  const registerTemp = useCallback((el: SVGPathElement | null) => {
    tempPathRef.current = el;
  }, []);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyRef.current.past.length > 0);
    setCanRedo(historyRef.current.future.length > 0);
  }, []);

  /**
   * The single write path into the graph.
   *
   * `coalesceKey` folds a run of related edits (typing in one field) into one
   * undo step, so Ctrl+Z steps back through actions rather than characters.
   */
  const commit = useCallback(
    (next: FlowGraph, coalesceKey?: string) => {
      const previous = graphRef.current;
      const now = Date.now();
      const last = lastCommitRef.current;
      const merge =
        Boolean(coalesceKey) && last !== null && last.key === coalesceKey && now - last.at < 900;
      if (!merge) historyRef.current.past = [...historyRef.current.past, previous].slice(-80);
      historyRef.current.future = [];
      lastCommitRef.current = coalesceKey ? { key: coalesceKey, at: now } : null;
      graphRef.current = next;
      dirtyRef.current = true;
      setGraph(next);
      syncHistoryFlags();
    },
    [syncHistoryFlags],
  );

  const undo = useCallback(() => {
    const previous = historyRef.current.past[historyRef.current.past.length - 1];
    if (!previous) return;
    historyRef.current.past = historyRef.current.past.slice(0, -1);
    historyRef.current.future = [graphRef.current, ...historyRef.current.future].slice(0, 80);
    lastCommitRef.current = null;
    graphRef.current = previous;
    dirtyRef.current = true;
    setGraph(previous);
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  const redo = useCallback(() => {
    const next = historyRef.current.future[0];
    if (!next) return;
    historyRef.current.future = historyRef.current.future.slice(1);
    historyRef.current.past = [...historyRef.current.past, graphRef.current].slice(-80);
    lastCommitRef.current = null;
    graphRef.current = next;
    dirtyRef.current = true;
    setGraph(next);
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  // --- view ---------------------------------------------------------------
  const applyView = useCallback(() => {
    const view = viewRef.current;
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    }
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(view.k * 100)}%`;
  }, []);

  useEffect(() => {
    applyView();
  }, [applyView]);

  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const view = viewRef.current;
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: (clientX - left - view.x) / view.k, y: (clientY - top - view.y) / view.k };
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const view = viewRef.current;
      const rect = viewportRef.current?.getBoundingClientRect();
      const cx = (rect?.width ?? 800) / 2;
      const cy = (rect?.height ?? 600) / 2;
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.k * factor));
      view.x = cx - ((cx - view.x) * k) / view.k;
      view.y = cy - ((cy - view.y) * k) / view.k;
      view.k = k;
      applyView();
    },
    [applyView],
  );

  // Wheel must be a non-passive native listener; React's synthetic onWheel is
  // passive and cannot call preventDefault, so the page would scroll instead.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const view = viewRef.current;
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.k * Math.exp(-event.deltaY * 0.0015)));
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      view.x = px - ((px - view.x) * k) / view.k;
      view.y = py - ((py - view.y) * k) / view.k;
      view.k = k;
      applyView();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyView]);

  const startPan = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return;
      setSelection(null);
      const start = { x: event.clientX, y: event.clientY };
      const origin = { x: viewRef.current.x, y: viewRef.current.y };
      const onMove = (moveEvent: PointerEvent) => {
        viewRef.current.x = origin.x + (moveEvent.clientX - start.x);
        viewRef.current.y = origin.y + (moveEvent.clientY - start.y);
        applyView();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [applyView],
  );

  // --- dragging a node -----------------------------------------------------
  const repaintEdges = useCallback(
    (byId: Map<string, FlowNode>, nodeId: string, position: { x: number; y: number }) => {
      const moved = byId.get(nodeId);
      if (!moved) return;
      byId.set(nodeId, { ...moved, position });
      for (const edge of graphRef.current.edges) {
        if (edge.source !== nodeId && edge.target !== nodeId) continue;
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target) continue;
        const d = edgePath(outputPoint(source, edge.sourceHandle ?? 'default'), inputPoint(target));
        pathEls.current.get(edge.id)?.setAttribute('d', d);
        pathEls.current.get(`hit:${edge.id}`)?.setAttribute('d', d);
      }
    },
    [],
  );

  const onCardPointerDown = useCallback(
    (event: React.PointerEvent, nodeId: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      setSelection({ kind: 'node', id: nodeId });
      setTab('block');

      const node = graphRef.current.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const byId = new Map(graphRef.current.nodes.map((n) => [n.id, n]));
      const start = { x: event.clientX, y: event.clientY };
      const origin = { ...node.position };
      let latest = origin;
      let moved = false;

      const onMove = (moveEvent: PointerEvent) => {
        const k = viewRef.current.k;
        latest = {
          x: Math.round(Math.max(0, origin.x + (moveEvent.clientX - start.x) / k)),
          y: Math.round(Math.max(0, origin.y + (moveEvent.clientY - start.y) / k)),
        };
        moved = true;
        const el = nodeEls.current.get(nodeId);
        if (el) el.style.transform = `translate(${latest.x}px, ${latest.y}px)`;
        repaintEdges(byId, nodeId, latest);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!moved) return;
        commit({
          ...graphRef.current,
          nodes: graphRef.current.nodes.map((n) =>
            n.id === nodeId ? { ...n, position: latest } : n,
          ),
        });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [commit, repaintEdges],
  );

  // --- dragging a connection ----------------------------------------------
  const connect = useCallback(
    (source: string, handleId: string, target: string) => {
      const current = graphRef.current;
      // One wire per output: re-dragging a handle re-points it rather than
      // stacking a second edge the engine would ignore.
      const edges = current.edges.filter(
        (e) => !(e.source === source && (e.sourceHandle ?? 'default') === handleId),
      );
      edges.push({
        id: `e_${source}_${handleId}_${target}_${Math.random().toString(36).slice(2, 7)}`,
        source,
        sourceHandle: handleId,
        target,
      });
      commit({ ...current, edges });
    },
    [commit],
  );

  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent, nodeId: string, handleId: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const node = graphRef.current.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const from = outputPoint(node, handleId);
      const temp = tempPathRef.current;

      const onMove = (moveEvent: PointerEvent) => {
        if (!temp) return;
        const to = toCanvas(moveEvent.clientX, moveEvent.clientY);
        temp.setAttribute('d', edgePath(from, to));
        temp.style.display = '';
      };
      const onUp = (upEvent: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (temp) temp.style.display = 'none';
        const under = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const card = under instanceof Element ? under.closest('[data-node-id]') : null;
        const targetId = card instanceof HTMLElement ? card.dataset.nodeId : undefined;
        if (!targetId || targetId === nodeId) return;
        connect(nodeId, handleId, targetId);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [connect, toCanvas],
  );

  // --- adding / deleting ---------------------------------------------------
  const addNode = useCallback(
    (type: FlowNodeType) => {
      const current = graphRef.current;
      const selected =
        selection?.kind === 'node' ? current.nodes.find((n) => n.id === selection.id) : undefined;

      const rect = viewportRef.current?.getBoundingClientRect();
      const view = viewRef.current;
      const centre = {
        x: ((rect?.width ?? 900) / 2 - view.x) / view.k - NODE_WIDTH / 2,
        y: ((rect?.height ?? 600) / 2 - view.y) / view.k - 40,
      };
      const position = selected
        ? { x: selected.position.x + NODE_WIDTH + 70, y: selected.position.y }
        : centre;

      const node = createNode(
        type,
        { x: Math.max(0, position.x), y: Math.max(0, position.y) },
        current.nodes.map((n) => n.id),
      );
      const next: FlowGraph = { nodes: [...current.nodes, node], edges: [...current.edges] };

      // Wire it straight onto the selected block's first free output, so
      // building a linear flow is one click per step.
      if (selected) {
        const free = outputHandles(selected).find(
          (h) =>
            !next.edges.some(
              (e) => e.source === selected.id && (e.sourceHandle ?? 'default') === h.id,
            ),
        );
        if (free) {
          next.edges.push({
            id: `e_${selected.id}_${free.id}_${node.id}`,
            source: selected.id,
            sourceHandle: free.id,
            target: node.id,
          });
        }
      }

      commit(next);
      setSelection({ kind: 'node', id: node.id });
      setTab('block');
    },
    [commit, selection],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      const current = graphRef.current;
      commit({
        nodes: current.nodes.filter((n) => n.id !== nodeId),
        edges: current.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      });
      setSelection(null);
    },
    [commit],
  );

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'edge') {
      const current = graphRef.current;
      commit({ ...current, edges: current.edges.filter((e) => e.id !== selection.id) });
      setSelection(null);
      return;
    }
    const node = graphRef.current.nodes.find((n) => n.id === selection.id);
    if (!node || node.type === 'start') return;
    deleteNode(selection.id);
  }, [commit, deleteNode, selection]);

  const onNodeDataChange = useCallback(
    (nodeId: string, data: FlowNodeData) => {
      const current = graphRef.current;
      commit(
        {
          ...current,
          nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, data } : n)),
        },
        `data:${nodeId}`,
      );
    },
    [commit],
  );

  // --- saving --------------------------------------------------------------
  const save = useCallback(
    async (snapshot: boolean) => {
      setSaveState('saving');
      setSaveError(null);
      const result = await saveFlowGraphAction({
        flowId: flow.id,
        graph: graphRef.current,
        snapshot,
      });
      if (result.error) {
        setSaveState('error');
        setSaveError(result.error);
        return;
      }
      dirtyRef.current = false;
      setSaveState('saved');
      if (snapshot) router.refresh();
    },
    [flow.id, router],
  );

  // Debounced autosave. It deliberately does NOT snapshot a version — one
  // restore point per keystroke would bury the useful ones — so the explicit
  // Save button is what creates an undo point on the server.
  useEffect(() => {
    if (!dirtyRef.current) return undefined;
    const timer = setTimeout(() => {
      void save(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [graph, save]);

  const publish = useCallback(async () => {
    setSaveState('saving');
    setPublishProblems(null);
    const result = await publishFlowAction({ flowId: flow.id, graph: graphRef.current });
    if (result.problems?.length) {
      setPublishProblems(result.problems);
      setSaveState('idle');
      return;
    }
    if (result.error) {
      setSaveState('error');
      setSaveError(result.error);
      return;
    }
    dirtyRef.current = false;
    setSaveState('saved');
    setStatus('live');
    router.refresh();
  }, [flow.id, router]);

  const pause = useCallback(async () => {
    const result = await setFlowStatusAction({ flowId: flow.id, status: 'paused' });
    if (!result.error) {
      setStatus('paused');
      router.refresh();
    }
  }, [flow.id, router]);

  // --- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save(true);
        return;
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (typing) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
      }
      if (event.key === 'Escape') setSelection(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deleteSelection, redo, save, undo]);

  // --- derived -------------------------------------------------------------
  const selectedNode = useMemo(
    () =>
      selection?.kind === 'node' ? (graph.nodes.find((n) => n.id === selection.id) ?? null) : null,
    [graph.nodes, selection],
  );
  const problems = useMemo(() => validateGraph(graph), [graph]);
  const enteredByNode = useMemo(() => {
    const map = new Map<string, number>();
    for (const stat of analytics.nodes) map.set(stat.nodeId, stat.entered);
    return map;
  }, [analytics.nodes]);

  const selectEdge = useCallback((id: string) => setSelection({ kind: 'edge', id }), []);

  const saveLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Save failed'
          : 'Save';

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[560px] flex-col overflow-hidden rounded-lg border bg-background">
      {/* Toolbar ------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge
            variant={status === 'live' ? 'success' : status === 'paused' ? 'warning' : 'outline'}
          >
            {status === 'live' ? 'Live' : status === 'paused' ? 'Paused' : 'Draft'}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {graph.nodes.length} blocks · v{flow.version}
          </span>
          {problems.length > 0 ? (
            <Badge variant="warning">
              {problems.length} {problems.length === 1 ? 'issue' : 'issues'}
            </Badge>
          ) : (
            <Badge variant="outline">Ready to publish</Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={undo} disabled={!canUndo}>
            Undo
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={redo} disabled={!canRedo}>
            Redo
          </Button>
          <div className="mx-1 flex items-center gap-1 rounded-md border px-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label="Zoom out"
              onClick={() => zoomBy(1 / 1.2)}
            >
              −
            </Button>
            <span ref={zoomLabelRef} className="w-10 text-center text-xs text-muted-foreground">
              85%
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label="Zoom in"
              onClick={() => zoomBy(1.2)}
            >
              +
            </Button>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void save(true)}>
            {saveLabel}
          </Button>
          {status === 'live' ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void pause()}>
              Pause
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => void publish()}>
              Publish
            </Button>
          )}
        </div>
      </div>

      {saveError ? (
        <p role="alert" className="border-b bg-danger-bg px-3 py-2 text-xs text-danger-fg">
          {saveError}
        </p>
      ) : null}
      {publishProblems ? (
        <div role="alert" className="border-b bg-warning-bg px-3 py-2 text-xs text-warning-fg">
          <p className="font-semibold">This flow is not ready to go live:</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            {publishProblems.map((problem, i) => (
              <li key={i}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        THE PAGE MUST NOT SCROLL SIDEWAYS; THE BUILDER MAY.
        --------------------------------------------------
        This row holds three panes, two of them fixed and non-shrinking: a 208px
        palette and a 352px inspector. That is 560px of hard minimum before the
        canvas gets a single pixel — so at 375px, and at every width up to about
        620px, the row was wider than the dashboard's content area and the whole
        PAGE gained a horizontal scrollbar. Every other screen went with it: the
        sidebar, the header, the lot.

        Wide content scrolls inside its own container. The row now sits in an
        `overflow-x-auto` box with a `min-w` that keeps the canvas usable
        (52rem − 208px − 352px ≈ 272px of drawing area), so on a phone you pan
        the builder sideways and the page itself stays put. Every coordinate in
        this file comes from `getBoundingClientRect()`, which is viewport-
        relative and already accounts for an ancestor's scroll, so dragging,
        panning and connecting are unaffected.
      */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="flex h-full min-w-[52rem]">
          {/* Palette ---------------------------------------------------------- */}
          <aside className="w-52 shrink-0 overflow-y-auto border-e p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Click a block to add it after the selected one.
            </p>
            {PALETTE.map((group) => (
              <div key={group.group} className="mb-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.group}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      title={item.hint}
                      onClick={() => addNode(item.type)}
                      className="w-full rounded-md border bg-background px-2 py-1.5 text-start text-xs hover:bg-accent hover:text-accent-foreground"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </aside>

          {/* Canvas ----------------------------------------------------------- */}
          <div
            ref={viewportRef}
            onPointerDown={startPan}
            className="relative min-w-0 flex-1 cursor-grab touch-none overflow-hidden bg-muted/30 active:cursor-grabbing"
            style={{
              backgroundImage: 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
              backgroundSize: '22px 22px',
            }}
          >
            <div ref={contentRef} className="absolute left-0 top-0 origin-top-left">
              <EdgeLayer
                graph={graph}
                selectedEdgeId={selection?.kind === 'edge' ? selection.id : null}
                onSelectEdge={selectEdge}
                registerPath={registerPath}
                registerTemp={registerTemp}
              />
              {graph.nodes.map((node) => (
                <NodeCard
                  key={node.id}
                  node={node}
                  selected={selection?.kind === 'node' && selection.id === node.id}
                  entered={enteredByNode.get(node.id)}
                  registerEl={registerEl}
                  onCardPointerDown={onCardPointerDown}
                  onHandlePointerDown={onHandlePointerDown}
                />
              ))}
            </div>

            {graph.nodes.length === 0 ? (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Add a block from the palette to begin.
              </p>
            ) : null}

            <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted-foreground">
              Drag the background to pan · scroll to zoom · Delete removes the selection · Ctrl+Z
              undo · Ctrl+S save
            </p>
          </div>

          {/* Right panel ------------------------------------------------------ */}
          <aside className="flex w-[22rem] shrink-0 flex-col border-s">
            <div className="flex shrink-0 border-b text-xs">
              {(
                [
                  ['block', 'Block'],
                  ['triggers', 'Triggers'],
                  ['test', 'Test'],
                  ['history', 'History'],
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-current={tab === key}
                  className={`flex-1 px-2 py-2 font-medium ${
                    tab === key
                      ? 'border-b-2 border-primary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'block' ? (
                <>
                  {selection?.kind === 'edge' ? (
                    <div className="space-y-2 p-4 text-sm">
                      <p className="font-medium">Connection selected</p>
                      <p className="text-muted-foreground">
                        Press Delete, or use the button below, to remove this connection.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-danger-fg"
                        onClick={deleteSelection}
                      >
                        Delete connection
                      </Button>
                    </div>
                  ) : (
                    <FlowInspector
                      node={selectedNode}
                      onChange={onNodeDataChange}
                      onDelete={deleteNode}
                      flowOptions={flowOptions.filter((f) => f.id !== flow.id)}
                      agents={agents}
                    />
                  )}
                  {problems.length > 0 ? (
                    <div className="border-t p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Before you publish
                      </p>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {problems.map((problem, i) => (
                          <li key={i}>
                            {problem.nodeId ? (
                              <button
                                type="button"
                                className="text-start underline decoration-dotted"
                                onClick={() => setSelection({ kind: 'node', id: problem.nodeId! })}
                              >
                                {problem.message}
                              </button>
                            ) : (
                              problem.message
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}

              {tab === 'triggers' ? (
                <>
                  <FlowSettings flow={flow} />
                  <FlowTriggersPanel flowId={flow.id} triggers={flow.triggers} intents={intents} />
                </>
              ) : null}

              {tab === 'test' ? (
                <div className="h-full">
                  <FlowSimulator graph={graph} />
                </div>
              ) : null}

              {tab === 'history' ? (
                <FlowHistory
                  flow={flow}
                  analytics={analytics}
                  onRestored={(restored) => {
                    // Goes through `commit`, so a restore lands in the local undo
                    // stack like any other edit.
                    commit(restored);
                    setSelection(null);
                  }}
                />
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow-level settings (name, description, channels, priority)
// ---------------------------------------------------------------------------
const CHANNEL_CHOICES = ['web_chat', 'whatsapp', 'instagram', 'facebook', 'telegram', 'email'];

function FlowSettings({ flow }: { flow: FlowDetail }) {
  const router = useRouter();
  const [name, setName] = useState(flow.name);
  const [description, setDescription] = useState(flow.description ?? '');
  const [channels, setChannels] = useState<string[]>(flow.channels);
  const [priority, setPriority] = useState(flow.priority);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const persist = async (next?: Partial<{ channels: string[]; priority: number }>) => {
    setState('saving');
    const result = await updateFlowMetaAction({
      flowId: flow.id,
      name,
      description,
      channels: next?.channels ?? channels,
      priority: next?.priority ?? priority,
    });
    if (result.error) {
      setState('error');
      setError(result.error);
      return;
    }
    setState('saved');
    setError(null);
    router.refresh();
  };

  return (
    <div className="space-y-3 border-b p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Flow settings
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="flow-name-field" className="text-xs">
          Name
        </Label>
        <Input
          id="flow-name-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void persist()}
          className="h-9"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="flow-description-field" className="text-xs">
          What it is for
        </Label>
        <Textarea
          id="flow-description-field"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => void persist()}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Runs on</Label>
        <div className="flex flex-wrap gap-1.5">
          {CHANNEL_CHOICES.map((channel) => {
            const on = channels.includes(channel);
            return (
              <button
                key={channel}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? channels.filter((c) => c !== channel) : [...channels, channel];
                  setChannels(next);
                  void persist({ channels: next });
                }}
                className={`rounded-full border px-2.5 py-0.5 text-xs capitalize ${
                  on
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-accent'
                }`}
              >
                {channel.replace(/_/g, ' ')}
              </button>
            );
          })}
        </div>
        {channels.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing selected means every channel.</p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="flow-priority-field" className="text-xs">
          Priority
        </Label>
        <Input
          id="flow-priority-field"
          type="number"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          onBlur={() => void persist()}
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">
          When two flows match the same message, the higher number wins.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-fg">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved.' : null}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version history + funnel
// ---------------------------------------------------------------------------
function FlowHistory({
  flow,
  analytics,
  onRestored,
}: {
  flow: FlowDetail;
  analytics: FlowAnalytics;
  /** Swaps the canvas to the restored graph — a refresh alone would leave the
      editor showing the graph that was just replaced. */
  onRestored: (graph: FlowGraph) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = async (version: number) => {
    setBusy(version);
    const result = await restoreFlowVersionAction({ flowId: flow.id, version });
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.graph) onRestored(result.graph);
    router.refresh();
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          How it is performing
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md border p-2">
            <dt className="text-xs text-muted-foreground">Started</dt>
            <dd className="font-semibold">{analytics.starts}</dd>
          </div>
          <div className="rounded-md border p-2">
            <dt className="text-xs text-muted-foreground">Completed</dt>
            <dd className="font-semibold">
              {analytics.completions}
              <span className="ms-1 text-xs font-normal text-muted-foreground">
                ({analytics.completionRate}%)
              </span>
            </dd>
          </div>
          <div className="rounded-md border p-2">
            <dt className="text-xs text-muted-foreground">Still running</dt>
            <dd className="font-semibold">{analytics.inProgress}</dd>
          </div>
          <div className="rounded-md border p-2">
            <dt className="text-xs text-muted-foreground">Dropped off</dt>
            <dd className="font-semibold">{analytics.dropOff}</dd>
          </div>
        </dl>
        {analytics.nodes.length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs">
            {analytics.nodes.slice(0, 8).map((stat) => (
              <li key={stat.nodeId} className="flex justify-between gap-2">
                <span className="truncate text-muted-foreground">{stat.nodeId}</span>
                <span>
                  {stat.entered} in
                  {stat.answered ? ` · ${stat.answered} answered` : ''}
                  {stat.dropOff ? ` · ${stat.dropOff} lost` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            No runs recorded yet. Publish the flow and the funnel fills in as conversations arrive.
          </p>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Versions
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every explicit save keeps the previous graph. Restoring one is itself undoable — the graph
          being replaced is snapshotted first.
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-xs font-medium text-danger-fg">
            {error}
          </p>
        ) : null}
        <ul className="mt-2 space-y-1">
          {flow.versions.length === 0 ? (
            <li className="text-xs text-muted-foreground">No earlier versions yet.</li>
          ) : (
            flow.versions.map((version) => (
              <li key={version.version} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  v{version.version} · {new Date(version.createdAt).toLocaleString()}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={busy !== null}
                  onClick={() => void restore(version.version)}
                >
                  {busy === version.version ? 'Restoring…' : 'Restore'}
                </Button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { getTagHierarchy, saveTagHierarchy } from "../../../api/tags";
import { normalizeKey, wouldCreateCycle } from "../../../shared/tagGraph";
import { centerListItem } from "../../../shared/scroll";
import {
  GAP,
  approxNodeSize,
  boxesOverlap,
  findChildSlot,
  nodeBox,
  resolveOverlaps
} from "../../../shared/tagLayout";

const ARROW = { markerEnd: { type: MarkerType.ArrowClosed, color: "#7c6ad0" } };

function gridPosition(index) {
  return { x: (index % 5) * 190, y: Math.floor(index / 5) * 130 };
}

function edgesToParents(edges) {
  const parents = {};
  edges.forEach((edge) => {
    if (!parents[edge.target]) parents[edge.target] = [];
    parents[edge.target].push(edge.source);
  });
  return parents;
}

function intersectionArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

// Choose a tidy, non-overlapping spot below `parentNode` for `childId`. Returns
// { position, moved } where `moved` maps any node nudged aside to its new spot
// (null when nothing else had to move). Parent and child stay put; only crowded
// neighbours are pushed away.
function placeChild(parentNode, childId, childSize, currentNodes) {
  const otherBoxes = currentNodes
    .filter((node) => node.id !== childId)
    .map(nodeBox);
  const parentBox = nodeBox(parentNode);
  const slot = findChildSlot(parentBox, childSize, otherBoxes);
  const childBox = {
    id: childId,
    x: slot.x,
    y: slot.y,
    w: childSize.width,
    h: childSize.height
  };

  const collides = otherBoxes.some((box) => boxesOverlap(childBox, box, GAP));
  if (!collides) {
    return { position: slot, moved: null };
  }

  const positions = resolveOverlaps([...otherBoxes, childBox], {
    pinned: [parentNode.id, childId]
  });
  return { position: positions[childId] || slot, moved: positions };
}

function applyMoved(nodes, childId, childPosition, moved) {
  return nodes.map((node) => {
    if (node.id === childId) return { ...node, position: childPosition };
    if (moved && moved[node.id]) return { ...node, position: moved[node.id] };
    return node;
  });
}

function TagFlowNode({ data }) {
  const accent = data.isRoot ? "#b69cff" : "#3a3a3a";

  return (
    <div
      style={{
        padding: "8px 14px",
        borderRadius: "999px",
        border: `1px solid ${accent}`,
        background: data.isRoot ? "#241d3a" : "#212121",
        color: data.isRoot ? "#d8ccff" : "#ddd",
        fontSize: "13px",
        fontWeight: 600,
        whiteSpace: "nowrap",
        boxShadow: "0 4px 14px rgba(0,0,0,0.35)"
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#7c6ad0" }} />
      #{data.label}
      <Handle type="source" position={Position.Bottom} style={{ background: "#7c6ad0" }} />
    </div>
  );
}

const nodeTypes = { tag: TagFlowNode };

function NetworkEditor({ onClose, availableTags }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [labels, setLabels] = useState({});
  const [customKeys, setCustomKeys] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const poolListRef = useRef(null);
  const poolRowRefs = useRef(new Map());
  const [pendingScrollKey, setPendingScrollKey] = useState(null);
  const [highlightKey, setHighlightKey] = useState(null);

  const { screenToFlowPosition, deleteElements, getIntersectingNodes } =
    useReactFlow();
  const dragStartPosRef = useRef(null);

  // --- Undo (Ctrl/Cmd+Z) -----------------------------------------------------
  const historyRef = useRef([]);
  const deleteBatchRef = useRef(false);
  const stateRef = useRef({ nodes: [], edges: [], labels: {}, customKeys: new Set() });

  useEffect(() => {
    stateRef.current = { nodes, edges, labels, customKeys };
  }, [nodes, edges, labels, customKeys]);

  const pushHistory = useCallback(() => {
    const snapshot = stateRef.current;
    historyRef.current.push({
      nodes: snapshot.nodes.map((node) => ({
        ...node,
        position: { ...node.position },
        data: { ...node.data }
      })),
      edges: snapshot.edges.map((edge) => ({ ...edge })),
      labels: { ...snapshot.labels },
      customKeys: new Set(snapshot.customKeys)
    });
    if (historyRef.current.length > 50) historyRef.current.shift();
  }, []);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setLabels(previous.labels);
    setCustomKeys(previous.customKeys);
    setError(null);
  }, [setNodes, setEdges]);

  // Deleting a node also removes its edges, firing both delete callbacks in one
  // tick — collapse them into a single undo entry.
  const snapshotForDelete = useCallback(() => {
    if (deleteBatchRef.current) return;
    deleteBatchRef.current = true;
    pushHistory();
    queueMicrotask(() => {
      deleteBatchRef.current = false;
    });
  }, [pushHistory]);

  useEffect(() => {
    function onKeyDown(event) {
      const isZ = event.key === "z" || event.key === "Z";
      if (!(event.ctrlKey || event.metaKey) || !isZ || event.shiftKey) return;

      const target = event.target;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return; // let text fields keep their native undo
      }

      event.preventDefault();
      undo();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo]);

  const onNodeDragStart = useCallback(
    (event, node) => {
      pushHistory();
      dragStartPosRef.current = {
        id: node.id,
        x: node.position.x,
        y: node.position.y
      };
    },
    [pushHistory]
  );

  const onNodeDragStop = useCallback(
    (event, node) => {
      const dragged = nodeBox(node);
      const hits = getIntersectingNodes(node).filter((n) => n.id !== node.id);
      if (hits.length === 0) return; // plain reposition

      // Drop onto the most-overlapped node → that node becomes the parent.
      const parentNode = hits.reduce((best, candidate) =>
        intersectionArea(dragged, nodeBox(candidate)) >
        intersectionArea(dragged, nodeBox(best))
          ? candidate
          : best
      );

      const child = node.id;
      const parent = parentNode.id;

      if (wouldCreateCycle(edgesToParents(edges), child, parent)) {
        setError("Lien circulaire refusé");
        const start = dragStartPosRef.current;
        if (start && start.id === child) {
          setNodes((current) =>
            current.map((n) =>
              n.id === child ? { ...n, position: { x: start.x, y: start.y } } : n
            )
          );
        }
        // The node snaps back, so the snapshot taken on drag start is a no-op.
        historyRef.current.pop();
        return;
      }

      setError(null);
      setEdges((current) =>
        addEdge(
          { source: parent, target: child, id: `${parent}__${child}`, ...ARROW },
          current
        )
      );

      const childSize = { width: dragged.w, height: dragged.h };
      setNodes((current) => {
        const { position, moved } = placeChild(
          parentNode,
          child,
          childSize,
          current
        );
        return applyMoved(current, child, position, moved);
      });
    },
    [edges, getIntersectingNodes, setEdges, setNodes]
  );

  const onNodeContextMenu = useCallback(
    (event, node) => {
      event.preventDefault();
      deleteElements({ nodes: [{ id: node.id }] });
    },
    [deleteElements]
  );

  const onEdgeContextMenu = useCallback(
    (event, edge) => {
      event.preventDefault();
      deleteElements({ edges: [{ id: edge.id }] });
    },
    [deleteElements]
  );

  const availableKeys = useMemo(() => {
    const map = {};
    availableTags.forEach((tag) => {
      const value = String(tag || "").trim();
      const key = normalizeKey(value);
      if (key && !map[key]) map[key] = value;
    });
    return map;
  }, [availableTags]);

  const displayOf = useCallback(
    (key) => labels[key] || availableKeys[key] || key,
    [labels, availableKeys]
  );

  // Load the saved network and hydrate canvas + pool.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getTagHierarchy()
      .then((hierarchy) => {
        if (cancelled) return;

        const parents = hierarchy?.parents || {};
        const positions = hierarchy?.positions || {};
        const loadedLabels = hierarchy?.labels || {};

        const mergedLabels = { ...loadedLabels };
        Object.entries(availableKeys).forEach(([key, display]) => {
          if (!mergedLabels[key]) mergedLabels[key] = display;
        });

        const custom = new Set(
          Object.keys(mergedLabels).filter((key) => !availableKeys[key])
        );

        // Every node referenced by an edge or position is "on canvas".
        const placed = new Set(Object.keys(positions));
        Object.entries(parents).forEach(([child, parentList]) => {
          placed.add(child);
          (parentList || []).forEach((parent) => placed.add(parent));
        });

        let fallbackIndex = 0;
        const builtNodes = [...placed].map((key) => ({
          id: key,
          type: "tag",
          position: positions[key] || gridPosition(fallbackIndex++),
          data: { label: mergedLabels[key] || key, isRoot: true }
        }));

        const builtEdges = [];
        Object.entries(parents).forEach(([child, parentList]) => {
          (parentList || []).forEach((parent) => {
            builtEdges.push({
              id: `${parent}__${child}`,
              source: parent,
              target: child,
              ...ARROW
            });
          });
        });

        historyRef.current = [];
        setLabels(mergedLabels);
        setCustomKeys(custom);
        setNodes(builtNodes);
        setEdges(builtEdges);
      })
      .catch(() => {
        if (!cancelled) setError("Chargement impossible");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [availableKeys, setNodes, setEdges]);

  // Keep each node's root flag (no incoming edge) in sync for styling.
  useEffect(() => {
    const targets = new Set(edges.map((edge) => edge.target));
    setNodes((current) =>
      current.map((node) => {
        const isRoot = !targets.has(node.id);
        return node.data.isRoot === isRoot
          ? node
          : { ...node, data: { ...node.data, isRoot } };
      })
    );
  }, [edges, setNodes]);

  const onConnect = useCallback(
    (params) => {
      const child = params.target;
      const parent = params.source;

      if (wouldCreateCycle(edgesToParents(edges), child, parent)) {
        setError("Lien circulaire refusé");
        return;
      }

      setError(null);
      pushHistory();
      setEdges((current) =>
        addEdge({ ...params, id: `${parent}__${child}`, ...ARROW }, current)
      );
    },
    [edges, setEdges, pushHistory]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const key = event.dataTransfer.getData("application/tagkey");
      if (!key) return;
      if (nodes.some((node) => node.id === key)) return;

      pushHistory();

      // Dropping directly onto an existing node links the new tag as its child.
      const nodeEl = event.target.closest?.(".react-flow__node");
      const parentId = nodeEl?.getAttribute("data-id");
      const parentNode =
        parentId && parentId !== key
          ? nodes.find((node) => node.id === parentId)
          : null;
      const cursor = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      if (parentNode) {
        const childSize = approxNodeSize(displayOf(key));
        const { position, moved } = placeChild(parentNode, key, childSize, nodes);
        const newChild = {
          id: key,
          type: "tag",
          position,
          data: { label: displayOf(key), isRoot: false }
        };
        setNodes((current) =>
          applyMoved(current, key, position, moved).concat(newChild)
        );
        setEdges((current) =>
          addEdge(
            { source: parentId, target: key, id: `${parentId}__${key}`, ...ARROW },
            current
          )
        );
        return;
      }

      setNodes((current) =>
        current.concat({
          id: key,
          type: "tag",
          position: cursor,
          data: { label: displayOf(key), isRoot: true }
        })
      );
    },
    [nodes, screenToFlowPosition, setNodes, setEdges, displayOf, pushHistory]
  );

  function addCustomTag() {
    const value = newTag.trim();
    const key = normalizeKey(value);

    if (!key) return;

    // Create the tag only if it doesn't already exist; either way, reveal it in
    // the list so a re-typed name jumps to the existing entry.
    if (!labels[key] && !availableKeys[key]) {
      pushHistory();
      setLabels((prev) => ({ ...prev, [key]: value }));
      setCustomKeys((prev) => new Set(prev).add(key));
    }

    setNewTag("");
    setSearch("");
    setHighlightKey(key);
    setPendingScrollKey(key);
  }

  function removeCustomTag(key) {
    pushHistory();
    setLabels((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCustomKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setNodes((current) => current.filter((node) => node.id !== key));
    setEdges((current) =>
      current.filter((edge) => edge.source !== key && edge.target !== key)
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const parents = edgesToParents(edges);
    const positions = {};
    nodes.forEach((node) => {
      positions[node.id] = { x: node.position.x, y: node.position.y };
    });

    const labelKeys = new Set([
      ...customKeys,
      ...nodes.map((node) => node.id),
      ...edges.flatMap((edge) => [edge.source, edge.target])
    ]);
    const labelsOut = {};
    labelKeys.forEach((key) => {
      labelsOut[key] = displayOf(key);
    });

    try {
      await saveTagHierarchy({ parents, labels: labelsOut, positions });
      onClose?.();
    } catch (saveError) {
      console.error(saveError);
      setError("Enregistrement impossible");
      setSaving(false);
    }
  }

  const placedSet = useMemo(
    () => new Set(nodes.map((node) => node.id)),
    [nodes]
  );

  const poolKeys = useMemo(() => {
    const keys = new Set([
      ...Object.keys(availableKeys),
      ...Object.keys(labels)
    ]);
    const term = search.trim().toLowerCase();
    return [...keys]
      .filter((key) => displayOf(key).toLowerCase().includes(term))
      .sort((a, b) => displayOf(a).localeCompare(displayOf(b)));
  }, [availableKeys, labels, search, displayOf]);

  // After a new tag is added, scroll the pool list to reveal it (mirrors the
  // create-and-reveal behaviour of the Manage list).
  useLayoutEffect(() => {
    if (!pendingScrollKey) return;

    const list = poolListRef.current;
    const row = poolRowRefs.current.get(pendingScrollKey);
    if (list && row) centerListItem(list, row);

    setPendingScrollKey(null);
  }, [pendingScrollKey, poolKeys]);

  // The freshly added tag flashes briefly so the change is noticeable.
  useEffect(() => {
    if (!highlightKey) return undefined;
    const timeout = window.setTimeout(() => setHighlightKey(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [highlightKey]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* LEFT — TAG POOL */}
      <div
        style={{
          width: "250px",
          flexShrink: 0,
          borderRight: "1px solid #262626",
          display: "flex",
          flexDirection: "column",
          minHeight: 0
        }}
      >
        <div style={{ padding: "14px 14px 10px" }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un tag…"
            aria-label="Rechercher un tag"
            style={{
              width: "100%",
              padding: "9px 11px",
              borderRadius: "10px",
              border: "1px solid #2f2f2f",
              background: "#111",
              color: "#eee",
              outline: "none",
              fontSize: "13px",
              boxSizing: "border-box"
            }}
          />
        </div>

        <div
          ref={poolListRef}
          className="app-scrollbar"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 14px",
            display: "flex",
            flexDirection: "column",
            gap: "6px"
          }}
        >
          {poolKeys.length === 0 && (
            <div style={{ color: "#777", fontSize: "13px", padding: "4px 2px" }}>
              Aucun tag.
            </div>
          )}

          {poolKeys.map((key) => {
            const placed = placedSet.has(key);
            const highlighted = key === highlightKey;
            return (
              <div
                key={key}
                ref={(element) => {
                  if (element) poolRowRefs.current.set(key, element);
                  else poolRowRefs.current.delete(key);
                }}
                draggable={!placed}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/tagkey", key);
                  event.dataTransfer.effectAllowed = "move";
                }}
                title={placed ? "Déjà sur le réseau" : "Glisser sur le réseau"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  padding: "7px 10px",
                  borderRadius: "999px",
                  border: `1px solid ${highlighted ? "#b69cff" : "#2a2a2a"}`,
                  background: highlighted
                    ? "#2c2350"
                    : placed
                      ? "#171717"
                      : "#212121",
                  color: placed && !highlighted ? "#666" : "#ccc",
                  fontSize: "13px",
                  cursor: placed ? "default" : "grab",
                  opacity: placed && !highlighted ? 0.7 : 1,
                  transition: "background 0.3s ease, border-color 0.3s ease"
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  {placed && <span aria-hidden="true">● </span>}#{displayOf(key)}
                </span>

                {customKeys.has(key) && !placed && (
                  <button
                    type="button"
                    onClick={() => removeCustomTag(key)}
                    aria-label={`Supprimer ${displayOf(key)}`}
                    title="Supprimer ce thème"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#888",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: "13px",
                      lineHeight: 1
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: "10px 14px", display: "flex", gap: "8px" }}>
          <input
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustomTag();
              }
            }}
            placeholder="Nouveau thème…"
            aria-label="Nouveau thème"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "9px 11px",
              borderRadius: "10px",
              border: "1px solid #2f2f2f",
              background: "#111",
              color: "#eee",
              outline: "none",
              fontSize: "13px",
              boxSizing: "border-box"
            }}
          />
          <button
            type="button"
            onClick={addCustomTag}
            aria-label="Ajouter le thème"
            style={{
              border: "1px solid #3a2f5a",
              borderRadius: "10px",
              background: "#2b2047",
              color: "#d2c2ff",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "14px",
              padding: "0 13px"
            }}
          >
            ＋
          </button>
        </div>
      </div>

      {/* RIGHT — NETWORK CANVAS */}
      <div
        style={{ flex: 1, minWidth: 0, position: "relative" }}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        {loading ? (
          <div style={{ padding: "20px", color: "#888", fontSize: "13px" }}>
            Chargement…
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onNodesDelete={snapshotForDelete}
            onEdgesDelete={snapshotForDelete}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={ARROW}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#2a2a2a" gap={20} />
            <Controls />
          </ReactFlow>
        )}

        {error && (
          <div
            role="alert"
            style={{
              position: "absolute",
              top: "12px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 5,
              padding: "8px 14px",
              borderRadius: "10px",
              border: "1px solid #5a2a2a",
              background: "rgba(40,20,20,0.95)",
              color: "#f2b8b8",
              fontSize: "13px"
            }}
          >
            {error}
          </div>
        )}
      </div>
      </div>

      {/* FOOTER */}
      <div
        style={{
          padding: "12px 20px",
          borderTop: "1px solid #262626",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: "10px"
        }}
      >
        <button
          type="button"
          onClick={() => onClose?.()}
          style={{
            border: "1px solid #2f2f2f",
            borderRadius: "10px",
            background: "#1d1d1d",
            color: "#aaa",
            cursor: "pointer",
            fontSize: "13px",
            padding: "10px 14px"
          }}
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          style={{
            border: "1px solid #3a2f5a",
            borderRadius: "10px",
            background: "#2b2047",
            color: "#d2c2ff",
            cursor: saving || loading ? "default" : "pointer",
            opacity: saving || loading ? 0.6 : 1,
            fontWeight: 700,
            fontSize: "13px",
            padding: "10px 18px"
          }}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

export default function TagNetworkModal({ open, onClose, availableTags = [] }) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Réseau de tags"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        padding: "24px"
      }}
    >
      <div
        style={{
          width: "min(1100px, 96vw)",
          height: "min(88vh, 820px)",
          display: "flex",
          flexDirection: "column",
          background: "#151515",
          border: "1px solid #262626",
          borderRadius: "16px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          overflow: "hidden"
        }}
      >
        {/* HEADER */}
        <div
          style={{
            position: "relative",
            padding: "16px 52px",
            borderBottom: "1px solid #262626",
            textAlign: "center"
          }}
        >
          <div
            style={{
              fontSize: "11px",
              color: "#666",
              fontWeight: 700,
              letterSpacing: "0.08em",
              marginBottom: "4px"
            }}
          >
            MANAGE
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#eee", lineHeight: 1 }}>
            Réseau de tags
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "#777",
              marginTop: "7px",
              lineHeight: 1.4,
              maxWidth: "640px",
              marginLeft: "auto",
              marginRight: "auto"
            }}
          >
            Glissez un tag depuis la liste sur le réseau, puis reliez un thème
            parent vers ses tags enfants. Clic droit pour supprimer un nœud ou un
            lien, Ctrl+Z pour annuler. Entraîner un thème inclut tout ce qu'il
            pointe.
          </div>

          <button
            type="button"
            onClick={() => onClose?.()}
            aria-label="Fermer"
            style={{
              position: "absolute",
              top: "14px",
              right: "16px",
              border: "1px solid #2f2f2f",
              borderRadius: "10px",
              background: "#1d1d1d",
              color: "#aaa",
              cursor: "pointer",
              fontSize: "16px",
              lineHeight: 1,
              padding: "8px 11px"
            }}
          >
            ×
          </button>
        </div>

        <ReactFlowProvider>
          <NetworkEditor onClose={onClose} availableTags={availableTags} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}

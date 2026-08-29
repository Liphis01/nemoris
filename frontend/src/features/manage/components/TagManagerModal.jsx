import { useEffect, useMemo, useState } from "react";

import { applyTagActions, resolveTagConflict, resolveTagInbox } from "../../../api/tags";
import TagPicker from "../../../shared/TagPicker";
import { normalizeKey, wouldCreateCycle } from "../../../shared/tagGraph";
import { loadTags, primeTags, useTagHierarchy } from "../../../shared/tagLabels";
import { ancestorPaths, childrenMap, isBrowseRoot } from "../../../shared/tagTree";
import { findSimilarPairs } from "../utils/tagDuplicates";


const FILTERS = [
  ["all", "Tous"],
  ["used", "Utilisés"],
  ["unused", "Inutilisés"],
  ["unclassified", "Non classés"],
  ["imported", "Importés"],
  ["duplicates", "Doublons possibles"]
];


function cloneNodes(nodes) {
  return Object.fromEntries(Object.entries(nodes || {}).map(([id, node]) => [id, {
    ...node,
    labels: { ...(node.labels || {}) },
    parents: [...(node.parents || [])],
    pack_ids: [...(node.pack_ids || [])]
  }]));
}


function newTagId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, token => {
    const value = Math.floor(Math.random() * 16);
    return (token === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}


function sameList(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}


function localLabel(node, locale = "fr") {
  return node?.labels?.[locale]
    || node?.labels?.[node?.default_locale]
    || Object.values(node?.labels || {})[0]
    || "Tag sans nom";
}


function buildActions(originalNodes, state) {
  const actions = [];
  const skipped = new Set(
    state.commands
      .filter(action => action.type === "merge" || action.type === "delete")
      .map(action => action.tag_id)
  );

  Object.entries(state.nodes).forEach(([tagId, node]) => {
    const original = originalNodes[tagId];
    if (!original) {
      const createAction = {
        type: "create",
        tag_id: tagId,
        label: localLabel(node),
        locale: node.default_locale || "fr",
        parent_ids: node.parents || []
      };
      if (!(node.parents || []).length && node.classification === "root") {
        createAction.classification = "root";
      }
      actions.push(createAction);
      Object.entries(node.labels || {}).forEach(([locale, label]) => {
        if (locale !== (node.default_locale || "fr")) {
          actions.push({ type: "set_label", tag_id: tagId, locale, label });
        }
      });
      return;
    }
    if (skipped.has(tagId)) return;

    const locales = new Set([
      ...Object.keys(original.labels || {}),
      ...Object.keys(node.labels || {})
    ]);
    locales.forEach(locale => {
      const before = original.labels?.[locale] || "";
      const after = node.labels?.[locale] || "";
      if (after && after !== before) {
        actions.push({ type: "set_label", tag_id: tagId, locale, label: after });
      }
    });

    if (!sameList(original.parents, node.parents)) {
      actions.push((node.parents || []).length
        ? { type: "set_parents", tag_id: tagId, parent_ids: node.parents }
        : { type: "unfile", tag_id: tagId });
    }
  });

  const originalHidden = new Set(state.originalHidden);
  const hidden = new Set(state.hidden);
  new Set([...originalHidden, ...hidden]).forEach(tagId => {
    if (originalHidden.has(tagId) !== hidden.has(tagId)) {
      actions.push({ type: "hide_root", tag_id: tagId, hidden: hidden.has(tagId) });
    }
  });

  return [...actions, ...state.commands];
}


function ManagerTree({
  childrenByParent,
  expanded,
  forceOpen,
  labels,
  nodes,
  onExpand,
  onSelect,
  selected,
  showUnplaced = false,
  visible
}) {
  const parentless = Object.keys(nodes).filter(id => !(nodes[id].parents || []).length && !nodes[id].hidden);
  const roots = parentless.filter(id => isBrowseRoot(id, nodes));
  const unplaced = parentless.filter(id =>
    nodes[id].kind !== "core" && nodes[id].classification === "unplaced" && visible.has(id)
  );

  function branch(id, depth, path) {
    if (!visible.has(id) || path.has(id)) return null;
    const childIds = (childrenByParent[id] || []).filter(child => visible.has(child));
    const isOpen = forceOpen || expanded.has(id);
    return (
      <div key={`${[...path].join("/")}/${id}`}>
        <div style={{ display: "flex", alignItems: "center", paddingLeft: `${depth * 15}px` }}>
          <button
            type="button"
            aria-label={`${isOpen ? "Replier" : "Déplier"} ${labels[id]}`}
            onClick={() => onExpand(id)}
            disabled={!childIds.length}
            style={{
              width: "25px", border: 0, background: "transparent",
              color: childIds.length ? "#999" : "#444", cursor: childIds.length ? "pointer" : "default"
            }}
          >
            {childIds.length ? (isOpen ? "▾" : "▸") : "·"}
          </button>
          <button
            type="button"
            onClick={() => onSelect(id)}
            style={{
              flex: 1, minWidth: 0, border: 0, borderRadius: "7px", textAlign: "left",
              padding: "7px 8px", cursor: "pointer",
              background: selected === id ? "#29203f" : "transparent",
              color: selected === id ? "#e0d5ff" : "#ccc"
            }}
          >
            <span>{nodes[id].kind === "core" ? "◆ " : "#"}{labels[id]}</span>
            {nodes[id].parents?.length > 1 && (
              <span aria-label="Plusieurs parents" style={{ color: "#806fac" }}>
                {" "}⑂
              </span>
            )}
            <span style={{ float: "right", color: "#666", fontSize: "11px" }}>
              {nodes[id].direct_count || 0}/{nodes[id].total_count || 0}
            </span>
          </button>
        </div>
        {isOpen && childIds.map(child => branch(child, depth + 1, new Set([...path, id])))}
      </div>
    );
  }

  const rootBranches = roots
    .sort((a, b) => labels[a].localeCompare(labels[b]))
    .map(id => branch(id, 0, new Set()));
  const unplacedBranches = showUnplaced ? unplaced
    .sort((a, b) => labels[a].localeCompare(labels[b]))
    .map(id => branch(id, 0, new Set())) : [];

  return (
    <>
      {rootBranches}
      {unplacedBranches.length > 0 && (
        <div style={{ borderTop: "1px solid #262626", marginTop: "8px", paddingTop: "8px" }}>
          <div style={{ color: "#777", fontSize: "11px", fontWeight: 800, letterSpacing: "0.06em", padding: "0 8px 6px", textTransform: "uppercase" }}>
            Tags à classer
          </div>
          {unplacedBranches}
        </div>
      )}
    </>
  );
}


export default function TagManagerModal({ open, onClose }) {
  const snapshot = useTagHierarchy();
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [parentInput, setParentInput] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [newLocale, setNewLocale] = useState("");
  const [inboxParent, setInboxParent] = useState("");
  const [inboxQuery, setInboxQuery] = useState("");
  const [mergeInput, setMergeInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !snapshot.loaded) return;
    const nodes = cloneNodes(snapshot.nodes);
    const initial = {
      nodes,
      hidden: Object.values(nodes).filter(node => node.hidden).map(node => node.id),
      originalHidden: Object.values(nodes).filter(node => node.hidden).map(node => node.id),
      commands: []
    };
    setHistory([initial]);
    setHistoryIndex(0);
    setSelected(current => nodes[current] ? current : Object.keys(nodes)[0] || null);
    setExpanded(new Set(Object.keys(nodes).filter(id => isBrowseRoot(id, nodes))));
    setError("");
  }, [open, snapshot.loaded, snapshot.nodes, snapshot.revision]);

  const state = history[historyIndex] || {
    nodes: cloneNodes(snapshot.nodes), hidden: [], originalHidden: [], commands: []
  };
  const nodes = state.nodes;
  const labels = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, localLabel(node)]));
  const selectedNode = nodes[selected];
  const pendingEntry = (snapshot.inbox?.pending || []).find(entry => entry.tag_id === selected);
  const dirty = historyIndex > 0;
  const showUnplacedRoots = filter === "unclassified" || Boolean(normalizeKey(search));

  const duplicatePairs = useMemo(
    () => findSimilarPairs(Object.keys(nodes), id => labels[id]),
    [nodes, labels]
  );
  const duplicateIds = useMemo(
    () => new Set(duplicatePairs.flatMap(pair => [pair.a, pair.b])),
    [duplicatePairs]
  );
  const childrenByParent = useMemo(
    () => childrenMap(Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, node.parents || []]))),
    [nodes]
  );
  const visible = useMemo(() => {
    const ids = Object.keys(nodes);
    const needle = normalizeKey(search);
    const matching = new Set(ids.filter(id => {
      const node = nodes[id];
      const filterMatch = filter === "all"
        || (filter === "used" && (node.total_count || 0) > 0)
        || (filter === "unused" && !(node.total_count || 0))
        || (filter === "unclassified" && node.kind !== "core" && node.classification === "unplaced")
        || (filter === "imported" && (node.pack_ids || []).length > 0)
        || (filter === "duplicates" && duplicateIds.has(id));
      return filterMatch && (!needle || normalizeKey(labels[id]).includes(needle));
    }));
    [...matching].forEach(id => ancestorPaths(id, Object.fromEntries(ids.map(key => [key, nodes[key].parents || []])))
      .flat().forEach(parent => matching.add(parent)));
    return matching;
  }, [nodes, labels, search, filter, duplicateIds]);

  if (!open) return null;

  function record(mutator) {
    const next = mutator({
      ...state,
      nodes: cloneNodes(state.nodes),
      hidden: [...state.hidden],
      commands: [...state.commands]
    });
    setHistory(current => [...current.slice(0, historyIndex + 1), next]);
    setHistoryIndex(index => index + 1);
    setError("");
  }

  function close() {
    if (dirty && !window.confirm("Abandonner les modifications non enregistrées ?")) return;
    onClose?.();
  }

  function setLabel(locale, value) {
    if (!selectedNode) return;
    record(next => {
      next.nodes[selected].labels[locale] = value;
      return next;
    });
  }

  function addParent(parentId) {
    if (!selectedNode || selectedNode.kind === "core") return;
    const parents = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, node.parents || []]));
    if (parentId === selected || wouldCreateCycle(parents, selected, parentId)) {
      setError("Ce parent créerait une boucle dans l’arborescence.");
      return;
    }
    if (selectedNode.parents.includes(parentId)) return;
    record(next => {
      next.nodes[selected].parents.push(parentId);
      next.nodes[selected].classification = "placed";
      return next;
    });
    setParentInput("");
  }

  function removeParent(parentId) {
    record(next => {
      next.nodes[selected].parents = next.nodes[selected].parents.filter(id => id !== parentId);
      next.nodes[selected].classification = next.nodes[selected].parents.length ? "placed" : "unplaced";
      return next;
    });
  }

  function createRoot() {
    const id = newTagId();
    record(next => {
      next.nodes[id] = {
        id, labels: { fr: "Nouveau tag" }, default_locale: "fr", parents: [],
        direct_count: 0, total_count: 0, kind: "custom", origin: "local",
        pack_ids: [], classification: "root", hidden: false
      };
      return next;
    });
    setSelected(id);
  }

  function queueMerge() {
    if (!selectedNode || !mergeTarget || mergeTarget === selected) return;
    if (!window.confirm(`Fusionner « ${labels[selected]} » dans « ${labels[mergeTarget]} » ? Toutes les questions seront réécrites.`)) return;
    const source = selected;
    record(next => {
      Object.values(next.nodes).forEach(node => {
        node.parents = [...new Set(node.parents.map(id => id === source ? mergeTarget : id))]
          .filter(id => id !== node.id);
      });
      delete next.nodes[source];
      next.commands.push({ type: "merge", tag_id: source, target_id: mergeTarget });
      return next;
    });
    setSelected(mergeTarget);
    setMergeTarget("");
  }

  function removeAssignments() {
    const count = selectedNode?.direct_count || 0;
    if (!count || !window.confirm(`Retirer ce tag de ${count} question${count > 1 ? "s" : ""} ?`)) return;
    record(next => {
      next.commands.push({ type: "remove_assignments", tag_id: selected });
      next.nodes[selected].direct_count = 0;
      return next;
    });
  }

  function deletePermanently() {
    if (!selectedNode || selectedNode.kind === "core") return;
    if (selectedNode.direct_count || selectedNode.parents.length || (childrenByParent[selected] || []).length) {
      setError("Ce tag doit d’abord être inutilisé et retiré de l’arborescence.");
      return;
    }
    if (!window.confirm(`Supprimer définitivement « ${labels[selected]} » ?`)) return;
    const removedId = selected;
    record(next => {
      delete next.nodes[removedId];
      next.commands.push({ type: "delete", tag_id: removedId });
      return next;
    });
    setSelected(null);
  }

  async function save() {
    const actions = buildActions(snapshot.nodes, state);
    if (!actions.length) {
      onClose?.();
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await applyTagActions(snapshot.revision, actions);
      primeTags(saved);
      onClose?.();
    } catch (saveError) {
      console.error(saveError);
      setError(saveError?.status === 409
        ? "La hiérarchie a changé ailleurs. Recharge-la avant de recommencer."
        : "Enregistrement impossible. Vérifie les parents et réessaie.");
      if (saveError?.status === 409) {
        if (saveError.snapshot) primeTags(saveError.snapshot);
        else loadTags({ force: true }).catch(() => {});
      }
    } finally {
      setSaving(false);
    }
  }

  async function resolveInbox(entry, action, extra = {}) {
    if (dirty) {
      setError("Enregistre ou annule d’abord les modifications locales.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const next = await resolveTagInbox({
        pack_guid: entry.pack_guid,
        tag_id: entry.tag_id,
        action,
        ...extra
      });
      primeTags(next);
      setInboxParent("");
      setInboxQuery("");
    } catch (resolveError) {
      console.error(resolveError);
      setError("Cette décision n’a pas pu être enregistrée.");
    } finally {
      setSaving(false);
    }
  }

  async function resolveConflict(entry, choice) {
    if (dirty) {
      setError("Enregistre ou annule d’abord les modifications locales.");
      return;
    }
    setSaving(true);
    try {
      const next = await resolveTagConflict({
        pack_guid: entry.pack_guid,
        conflict_id: entry.id,
        choice
      });
      primeTags(next);
    } catch (resolveError) {
      console.error(resolveError);
      setError("Le conflit n’a pas pu être résolu.");
    } finally {
      setSaving(false);
    }
  }

  const panelButton = {
    border: "1px solid #343434", borderRadius: "8px", background: "#1d1d1d",
    color: "#bbb", cursor: "pointer", fontSize: "12px", padding: "7px 10px"
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Gérer les tags"
      onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
      style={{ position: "fixed", inset: "var(--shell-top, 0px) 0 0", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.58)", padding: "20px" }}
    >
      <div style={{ width: "min(1120px, 97vw)", height: "min(88vh, 850px)", display: "flex", flexDirection: "column", background: "#151515", border: "1px solid #292929", borderRadius: "16px", overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,0,.55)" }}>
        <header style={{ display: "flex", alignItems: "center", gap: "12px", padding: "15px 18px", borderBottom: "1px solid #292929" }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#eee", fontWeight: 800, fontSize: "19px" }}>Gérer les tags</div>
            <div style={{ color: "#777", fontSize: "12px", marginTop: "3px" }}>Une identité partagée, plusieurs langues et plusieurs chemins possibles.</div>
          </div>
          {snapshot.inbox?.count > 0 && <span style={{ color: "#d9c58c", fontSize: "12px" }}>{snapshot.inbox.count} élément{snapshot.inbox.count > 1 ? "s" : ""} à classer</span>}
          <button type="button" onClick={createRoot} style={panelButton}>+ Racine personnalisée</button>
          <button type="button" aria-label="Fermer" onClick={close} style={{ ...panelButton, fontSize: "16px" }}>×</button>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 43%) 1fr", minHeight: 0, flex: 1 }}>
          <section style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid #292929" }}>
            <div style={{ padding: "12px", borderBottom: "1px solid #242424" }}>
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher par nom…" aria-label="Rechercher un tag" style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "9px", border: "1px solid #303030", background: "#101010", color: "#eee" }} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "8px" }}>
                {FILTERS.map(([value, text]) => <button key={value} type="button" onClick={() => setFilter(value)} style={{ ...panelButton, padding: "4px 8px", background: filter === value ? "#29203f" : "#1a1a1a", color: filter === value ? "#d8cbff" : "#888" }}>{text}</button>)}
              </div>
            </div>
            <div className="app-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
              {(snapshot.inbox?.pending || []).length > 0 && (
                <div style={{ border: "1px solid #40371f", borderRadius: "9px", padding: "8px", marginBottom: "8px", background: "#211d12" }}>
                  <div style={{ color: "#d9c58c", fontSize: "11px", fontWeight: 700, marginBottom: "5px" }}>TAGS À CLASSER</div>
                  {snapshot.inbox.pending.map(entry => (
                    <button key={entry.id} type="button" onClick={() => setSelected(entry.tag_id)} style={{ display: "block", width: "100%", border: 0, background: selected === entry.tag_id ? "#302a1b" : "transparent", color: "#cdbd90", textAlign: "left", padding: "5px", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}>
                      #{entry.label} · {entry.pack_name}
                    </button>
                  ))}
                </div>
              )}
              <ManagerTree
                childrenByParent={childrenByParent} expanded={expanded} labels={labels}
                nodes={nodes} selected={selected} visible={visible}
                showUnplaced={showUnplacedRoots}
                forceOpen={Boolean(normalizeKey(search)) || filter !== "all"}
                onSelect={setSelected}
                onExpand={id => setExpanded(current => {
                  const next = new Set(current);
                  next.has(id) ? next.delete(id) : next.add(id);
                  return next;
                })}
              />
              {!visible.size && <div style={{ color: "#777", padding: "12px" }}>Aucun tag.</div>}
            </div>
          </section>

          <section className="app-scrollbar" style={{ overflowY: "auto", padding: "20px 22px" }}>
            {!selectedNode ? <div style={{ color: "#777" }}>Sélectionne un tag dans l’arborescence.</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                <div>
                  <div style={{ color: "#777", fontSize: "11px", textTransform: "uppercase", letterSpacing: ".08em" }}>{selectedNode.kind === "core" ? "Thème de base" : "Tag personnalisé"}</div>
                  <h2 style={{ color: "#eee", margin: "5px 0 0", fontSize: "22px" }}>{labels[selected]}</h2>
                  <div style={{ color: "#777", fontSize: "12px", marginTop: "5px" }}>{selectedNode.direct_count || 0} directement · {selectedNode.total_count || 0} avec les descendants</div>
                </div>

                {pendingEntry && (
                  <div style={{ border: "1px solid #40371f", borderRadius: "10px", background: "#211d12", padding: "12px" }}>
                    <div style={{ color: "#d9c58c", fontWeight: 700, fontSize: "12px" }}>À classer depuis {pendingEntry.pack_name}</div>
                    <div style={{ color: "#8f815e", fontSize: "11px", margin: "5px 0 9px" }}>{pendingEntry.question_count || 0} question(s){pendingEntry.pack_version ? ` · version ${pendingEntry.pack_version}` : ""}</div>
                    <div style={{ display: "flex", gap: "7px", alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <TagPicker tags={[selected]} value={inboxQuery} onChange={setInboxQuery} onAdd={parentId => { setInboxParent(parentId); setInboxQuery(""); }} allowCreate={false} showChips={false} placeholder="Placer sous…" inputStyle={{ padding: "7px 8px", borderRadius: "8px", border: "1px solid #4b4025", background: "#17140d", color: "#eee" }} />
                      </div>
                      <button type="button" disabled={!inboxParent || saving} onClick={() => resolveInbox(pendingEntry, "place", { parent_id: inboxParent })} style={{ ...panelButton, opacity: inboxParent ? 1 : .45 }}>Ranger</button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                      {(pendingEntry.suggested_matches || []).map(targetId => (
                        <button key={targetId} type="button" onClick={() => resolveInbox(pendingEntry, "merge", { target_id: targetId })} style={panelButton}>Fusionner avec #{labels[targetId]}</button>
                      ))}
                      <button type="button" onClick={() => resolveInbox(pendingEntry, "keep_root")} style={panelButton}>Garder comme racine</button>
                      <button type="button" onClick={() => resolveInbox(pendingEntry, "defer")} style={panelButton}>Décider plus tard</button>
                    </div>
                  </div>
                )}

                <div>
                  <div style={{ color: "#aaa", fontSize: "12px", marginBottom: "7px" }}>Noms localisés</div>
                  {Object.entries(selectedNode.labels || {}).map(([locale, label]) => (
                    <label key={locale} style={{ display: "grid", gridTemplateColumns: "48px 1fr", alignItems: "center", gap: "8px", marginBottom: "7px", color: "#777", fontSize: "12px" }}>
                      {locale}
                      <input value={label} onChange={event => setLabel(locale, event.target.value)} aria-label={`Nom ${locale}`} style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid #303030", background: "#101010", color: "#eee" }} />
                    </label>
                  ))}
                  <div style={{ display: "flex", gap: "7px" }}>
                    <input value={newLocale} onChange={event => setNewLocale(event.target.value.toLowerCase().slice(0, 12))} placeholder="en, de…" aria-label="Nouvelle langue" style={{ width: "90px", padding: "7px", borderRadius: "8px", border: "1px solid #303030", background: "#101010", color: "#eee" }} />
                    <button type="button" style={panelButton} onClick={() => {
                      const locale = newLocale.trim();
                      if (!locale || selectedNode.labels?.[locale]) return;
                      setLabel(locale, labels[selected]);
                      setNewLocale("");
                    }}>Ajouter une traduction</button>
                  </div>
                </div>

                <div>
                  <div style={{ color: "#aaa", fontSize: "12px", marginBottom: "7px" }}>Parents et chemins</div>
                  {ancestorPaths(selected, Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, node.parents || []])))
                    .filter(path => path.length)
                    .map((path, index) => (
                      <div key={`path-${index}`} style={{ color: "#777", fontSize: "11px", marginBottom: "6px" }}>
                        {path.map(id => labels[id]).concat(labels[selected]).join(" › ")}
                      </div>
                    ))}
                  {(selectedNode.parents || []).map(parentId => (
                    <div key={parentId} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", color: "#bbb", fontSize: "12px" }}>
                      <span style={{ flex: 1 }}>Parent direct : {labels[parentId]}</span>
                      {selectedNode.kind !== "core" && <button type="button" onClick={() => removeParent(parentId)} style={{ ...panelButton, padding: "3px 7px" }}>Retirer</button>}
                    </div>
                  ))}
                  {selectedNode.kind !== "core" && (
                    <TagPicker tags={[selected, ...(selectedNode.parents || [])]} value={parentInput} onChange={setParentInput} onAdd={addParent} allowCreate={false} showChips={false} placeholder="Ajouter un parent…" inputStyle={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid #303030", background: "#101010", color: "#eee" }} />
                  )}
                  {!selectedNode.parents?.length && <div style={{ color: "#666", fontSize: "12px", marginTop: "6px" }}>{selectedNode.kind === "core" ? "Racine universelle" : "Racine personnalisée ou tag non classé"}</div>}
                </div>

                {(selectedNode.pack_ids || []).length > 0 && <div style={{ color: "#999", fontSize: "12px" }}>Fourni par : {(selectedNode.source_packs || []).map(pack => pack.name).join(", ") || selectedNode.pack_ids.join(", ")}</div>}

                {(selectedNode.representative_questions || []).length > 0 && (
                  <div>
                    <div style={{ color: "#aaa", fontSize: "12px", marginBottom: "6px" }}>Questions représentatives</div>
                    {selectedNode.representative_questions.map(question => (
                      <div key={question.id} style={{ color: "#777", fontSize: "12px", padding: "4px 0" }}>• {question.question}</div>
                    ))}
                  </div>
                )}

                {(snapshot.inbox?.conflicts || []).filter(conflict => conflict.tag_id === selected).map(conflict => (
                  <div key={conflict.id} style={{ border: "1px solid #4b2d2d", borderRadius: "9px", padding: "10px", background: "#241717", color: "#cfaeae", fontSize: "12px" }}>
                    <div>Conflit du pack {conflict.pack_name} sur {conflict.field}</div>
                    <div style={{ color: "#8f7777", margin: "5px 0" }}>Ma version : {JSON.stringify(conflict.local)} · Pack : {JSON.stringify(conflict.incoming)}</div>
                    <div style={{ display: "flex", gap: "7px" }}>
                      <button type="button" onClick={() => resolveConflict(conflict, "local")} style={panelButton}>Garder ma version</button>
                      <button type="button" onClick={() => resolveConflict(conflict, "pack")} style={panelButton}>Utiliser celle du pack</button>
                    </div>
                  </div>
                ))}

                <details>
                  <summary style={{ color: "#777", cursor: "pointer", fontSize: "12px" }}>Détails avancés</summary>
                  <code style={{ display: "block", marginTop: "8px", color: "#777", fontSize: "11px", overflowWrap: "anywhere" }}>{selected}</code>
                </details>

                {selectedNode.kind === "core" ? (
                  <button type="button" disabled={(selectedNode.total_count || 0) > 0} onClick={() => record(next => {
                    next.hidden = next.hidden.includes(selected) ? next.hidden.filter(id => id !== selected) : [...next.hidden, selected];
                    return next;
                  })} style={{ ...panelButton, alignSelf: "flex-start", opacity: selectedNode.total_count ? .45 : 1 }}>
                    {state.hidden.includes(selected) ? "Afficher dans les sélecteurs" : "Masquer des sélecteurs"}
                  </button>
                ) : (
                  <div style={{ borderTop: "1px solid #292929", paddingTop: "15px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <TagPicker tags={[selected]} value={mergeInput} onChange={setMergeInput} onAdd={targetId => { setMergeTarget(targetId); setMergeInput(""); }} allowCreate={false} showChips={false} placeholder="Fusionner dans…" inputStyle={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid #3b3220", background: "#101010", color: "#eee" }} />
                      <button type="button" disabled={!mergeTarget} onClick={queueMerge} style={{ ...panelButton, opacity: mergeTarget ? 1 : .45 }}>Fusionner</button>
                    </div>
                    {mergeTarget && <div style={{ color: "#a997d5", fontSize: "11px" }}>Cible : #{labels[mergeTarget]}</div>}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {!!selectedNode.parents.length && <button type="button" onClick={() => record(next => { next.nodes[selected].parents = []; next.nodes[selected].classification = "unplaced"; return next; })} style={panelButton}>Retirer de l’arborescence</button>}
                      {!!selectedNode.direct_count && <button type="button" onClick={removeAssignments} style={{ ...panelButton, color: "#e2b2a9" }}>Retirer des {selectedNode.direct_count} questions</button>}
                      <button type="button" onClick={deletePermanently} style={{ ...panelButton, color: "#e2b2a9" }}>Supprimer définitivement</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <footer style={{ display: "flex", alignItems: "center", gap: "9px", padding: "12px 17px", borderTop: "1px solid #292929" }}>
          <button type="button" disabled={historyIndex <= 0} onClick={() => setHistoryIndex(index => index - 1)} style={{ ...panelButton, opacity: historyIndex <= 0 ? .4 : 1 }}>Annuler l’action</button>
          <button type="button" disabled={historyIndex >= history.length - 1} onClick={() => setHistoryIndex(index => index + 1)} style={{ ...panelButton, opacity: historyIndex >= history.length - 1 ? .4 : 1 }}>Rétablir</button>
          {error && <span role="alert" style={{ color: "#f0b1aa", fontSize: "12px", marginLeft: "8px" }}>{error}</span>}
          <span style={{ marginLeft: "auto", color: "#666", fontSize: "11px" }}>Révision {snapshot.revision}</span>
          <button type="button" onClick={close} style={panelButton}>Fermer</button>
          <button type="button" disabled={saving || !dirty} onClick={save} style={{ ...panelButton, background: "#2b2047", color: "#ddd2ff", borderColor: "#443365", opacity: saving || !dirty ? .45 : 1 }}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
        </footer>
      </div>
    </div>
  );
}

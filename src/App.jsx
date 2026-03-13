import { useState, useMemo, useCallback, useRef, useEffect } from "react";

const GEOGRAPHIES = ["US","region","state","county","county subdivision","tract","block group","block","place","american indian area/alaska native area (reservation or statistical entity only)","american indian area (off-reservation trust land only)/hawaiian home land","cbsa","combined statistical area","new england city and town area","urban area","congressional district","school district (elementary)","school district (secondary)","school district (unified)","public use microdata area","zip code tabulation area","state legislative district (upper chamber)","state legislative district (lower chamber)","voting district"];
const STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming","District of Columbia","Puerto Rico"];
const YEARS = Array.from({length: 21}, (_, i) => 2005 + i);

const PINNED_TOPICS = [
  "ACS DEMOGRAPHIC AND HOUSING ESTIMATES",
  "SELECTED ECONOMIC CHARACTERISTICS",
  "SELECTED HOUSING CHARACTERISTICS",
  "SELECTED SOCIAL CHARACTERISTICS IN PUERTO RICO",
  "SELECTED SOCIAL CHARACTERISTICS IN THE UNITED STATES",
];

// ── Label tree ────────────────────────────────────────────────────────────────
function splitLabel(label) {
  if (!label) return [];
  const tokens = label.split(/(\s+(?:by|for)\s+|\s*\()/i);
  const parts = []; let current = tokens[0].trim();
  for (let i = 1; i < tokens.length; i += 2) {
    if (current) parts.push(current);
    current = tokens[i].trim() + " " + (tokens[i+1]||"").trim();
  }
  if (current) parts.push(current);
  return parts;
}

function buildLabelTree(rows) {
  const root = {};
  for (const row of rows) {
    const parts = splitLabel(row.label);
    if (!parts.length) continue;
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      if (!node[parts[i]]) node[parts[i]] = { __rows: [], __children: {} };
      if (i === parts.length - 1) node[parts[i]].__rows.push(row);
      node = node[parts[i]].__children;
    }
  }
  return root;
}

function getLabelChildren(tree, path) {
  let node = tree;
  for (const step of path) { if (!node[step]) return {}; node = node[step].__children; }
  return node || {};
}

function collectAll(node, result) {
  for (const key of Object.keys(node)) {
    result.push(...node[key].__rows);
    collectAll(node[key].__children, result);
  }
}

function getAllRowsUnder(tree, path) {
  const result = [];
  if (path.length === 0) { collectAll(tree, result); return result; }
  let node = tree;
  for (let i = 0; i < path.length - 1; i++) { if (!node[path[i]]) return []; node = node[path[i]].__children; }
  const last = path[path.length - 1];
  if (!node[last]) return [];
  result.push(...node[last].__rows);
  collectAll(node[last].__children, result);
  return result;
}

function autoAdvancePath(tree, path) {
  let children = getLabelChildren(tree, path), current = [...path];
  while (Object.keys(children).length === 1) {
    const key = Object.keys(children)[0];
    current = [...current, key];
    children = getLabelChildren(tree, current);
  }
  return current;
}

// ── Detail tree ───────────────────────────────────────────────────────────────
function buildDetailTree(rows) {
  const root = {};
  for (const row of rows) {
    if (!row.detail) continue;
    const parts = row.detail.split("!!").map(p => p.trim()).filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      if (!node[parts[i]]) node[parts[i]] = { __rows: [], __children: {} };
      if (i === parts.length - 1) node[parts[i]].__rows.push(row);
      node = node[parts[i]].__children;
    }
  }
  return root;
}

function getDetailChildren(tree, path) {
  let node = tree;
  for (const step of path) { if (!node[step]) return {}; node = node[step].__children; }
  return node || {};
}

function getMostGeneralId(rows, detailPath) {
  const matching = rows.filter(r => {
    if (!r.detail) return detailPath.length === 0;
    const parts = r.detail.split("!!").map(p => p.trim());
    return detailPath.every((step, i) => parts[i] === step);
  });
  if (!matching.length) return null;
  return [...matching].sort((a,b) => (a.detail?.split("!!").length||0)-(b.detail?.split("!!").length||0))[0]?.id || null;
}

function getMostGeneralRow(rows, detailPath) {
  const matching = rows.filter(r => {
    if (!r.detail) return detailPath.length === 0;
    const parts = r.detail.split("!!").map(p => p.trim());
    return detailPath.every((step, i) => parts[i] === step);
  });
  if (!matching.length) return null;
  return [...matching].sort((a,b) => (a.detail?.split("!!").length||0)-(b.detail?.split("!!").length||0))[0] || null;
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const cols = []; let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { cols.push(cur); cur = ""; }
    else cur += ch;
  }
  cols.push(cur);
  return cols.map(c => c.trim().replace(/\r$/, ""));
}

function parseCSV(text) {
  if (!text) return { rows: [] };
  const lines = text.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const hdrs = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const col = n => hdrs.findIndex(h => h === n);
  const idCol = col("id") !== -1 ? col("id") : col("variable");
  const labelCol = col("label_clean");
  if (idCol === -1 || labelCol === -1) return { error: `Expected "id"/"variable" and "label_clean" columns. Found: ${hdrs.join(", ")}` };
  const detailCol = col("detail"), labelVarCol = col("label_varname"), detailVarCol = col("detail_varname"), bothVarCol = col("both_varname");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 2) continue;
    const id = cols[idCol], label = cols[labelCol]?.replace(/^"|"$/g, "");
    if (!id || !label || id.toLowerCase() === "geoid" || id.toLowerCase() === "geo_id") continue;
    rows.push({
      id, label,
      detail: detailCol !== -1 ? cols[detailCol]?.replace(/^"|"$/g, "") || null : null,
      labelVar: labelVarCol !== -1 ? cols[labelVarCol] : null,
      detailVar: detailVarCol !== -1 ? cols[detailVarCol] : null,
      bothVar: bothVarCol !== -1 ? cols[bothVarCol] : null,
    });
  }
  return { rows };
}

// ── R script ──────────────────────────────────────────────────────────────────
function generateRScript(queryVars, geography, state, years) {
  const stripE = id => id.endsWith("E") ? id.slice(0, -1) : id;
  const safeName = n => (n || "variable").replace(/[^a-zA-Z0-9_]/g, "_");
  const tableName = geography ? "by_" + safeName(geography) : "acs_data";
  const multiYear = years.length > 1;
  const ind = multiYear ? "      " : "  ";
  const seen = new Set();
  const varLines = queryVars.map(v => {
    let name = safeName(v.row?.bothVar || v.row?.labelVar || v.id);
    if (seen.has(name)) name = name + "_" + v.id.replace(/\W/g, "");
    seen.add(name);
    return ind + "  " + name + ' = "' + stripE(v.id) + '"';
  }).join(",\n");
  const geoLine   = geography ? ind + 'geography = "' + geography + '",\n' : "";
  const stateLine = state     ? ind + 'state = "' + state + '",\n'         : "";
  if (!multiYear) {
    const yearLine = years.length === 1 ? "  year = " + years[0] + "\n" : "";
    return "library(tidyverse)\nlibrary(tidycensus)\n\n" + tableName + " <- get_acs(\n" + geoLine + stateLine + "  variables = c(\n" + varLines + "\n  ),\n" + yearLine + ")";
  }
  const yearsVec = "c(" + years.join(", ") + ")";
  return "library(tidyverse)\nlibrary(tidycensus)\n\nyears <- " + yearsVec + "\n\n" + tableName + " <- map_dfr(years, \\(yr) {\n  get_acs(\n" + geoLine + stateLine + "    variables = c(\n" + varLines + "\n    ),\n    year = yr\n  ) |>\n    mutate(year = yr)\n})";
}

function clipboardCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
  } catch(e) {}
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const selStyle = { fontSize: 13, border: "1.5px solid #cbd5e1", borderRadius: 7, padding: "6px 10px", background: "white", color: "#334155", cursor: "pointer" };

function NavBtn({ active, onClick, label, color = "#1e3a5f" }) {
  return (
    <button onClick={onClick} style={{ background: active ? color : "white", color: active ? "white" : color, border: "1.5px solid " + color, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
      {label}
    </button>
  );
}

function ChildList({ children, onSelect, headerLabel, getBestId, pinned = [] }) {
  const allKeys = Object.keys(children);
  const pinnedKeys = pinned.filter(k => allKeys.includes(k));
  const restKeys = allKeys.filter(k => !pinned.includes(k)).sort();
  const keys = [...pinnedKeys, ...restKeys];
  if (!keys.length) return null;
  return (
    <div style={{ background: "white", borderRadius: 10, border: "1.5px solid #cbd5e1", overflow: "hidden", marginBottom: 14 }}>
      <div style={{ padding: "9px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{headerLabel} · {keys.length}</span>
      </div>
      {keys.map((key, i) => {
        const bestId = getBestId(key);
        const hasKids = Object.keys(children[key].__children || {}).length > 0;
        const isPinned = pinnedKeys.includes(key);
        const showDivider = isPinned && pinnedKeys.length > 0 && restKeys.length > 0 && i === pinnedKeys.length - 1;
        return (
          <div key={key}>
            <div
              onClick={() => onSelect(key)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: showDivider ? "none" : (i < keys.length - 1 ? "1px solid #f1f5f9" : "none"), cursor: "pointer", background: isPinned ? "#fafbff" : "white" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#f8fafc"; }}
              onMouseLeave={e => { e.currentTarget.style.background = isPinned ? "#fafbff" : "white"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {isPinned && (
                  <span style={{ fontSize: 10, color: "#3b82f6", background: "#eff6ff", border: "1px solid #bfdbfe", padding: "1px 6px", borderRadius: 8, fontWeight: 700, letterSpacing: "0.04em", flexShrink: 0 }}>★</span>
                )}
                <span style={{ fontSize: 14, color: "#334155", fontWeight: isPinned ? 600 : 500, textAlign: "left" }}>{key}</span>
                {hasKids && (
                  <span style={{ fontSize: 11, color: "#94a3b8", background: "#f1f5f9", padding: "2px 7px", borderRadius: 10 }}>has subcategories</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {bestId && <code style={{ background: "#eff6ff", color: "#1e40af", padding: "3px 8px", borderRadius: 5, fontSize: 12, fontWeight: 700 }}>{bestId}</code>}
                <span style={{ color: "#94a3b8", fontSize: 18 }}>›</span>
              </div>
            </div>
            {showDivider && <div style={{ height: 1, background: "#e2e8f0", margin: "0 16px" }} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Year picker ───────────────────────────────────────────────────────────────
function YearPicker({ years, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = y => onChange(years.includes(y) ? years.filter(x => x !== y) : [...years, y].sort((a, b) => a - b));
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div onClick={() => setOpen(v => !v)} style={{ ...selStyle, display: "flex", alignItems: "center", gap: 6, minWidth: 160, maxWidth: 280, flexWrap: "wrap", cursor: "pointer", userSelect: "none" }}>
        {years.length === 0
          ? <span style={{ color: "#94a3b8" }}>Year(s)…</span>
          : years.map(y => (
            <span key={y} style={{ background: "#1e3a5f", color: "white", borderRadius: 4, padding: "1px 7px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}>
              {y}<span onMouseDown={e => { e.stopPropagation(); toggle(y); }} style={{ cursor: "pointer", opacity: .75 }}>×</span>
            </span>
          ))}
        {years.length > 0 && (
          <span onMouseDown={e => { e.stopPropagation(); onChange([]); }} style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8", cursor: "pointer" }}>✕</span>
        )}
      </div>
      {open && (
        <div onMouseDown={e => e.stopPropagation()} style={{ position: "absolute", zIndex: 999, top: "calc(100% + 4px)", left: 0, background: "white", border: "1.5px solid #cbd5e1", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.1)", maxHeight: 220, overflowY: "auto", minWidth: 130 }}>
          {YEARS.map(y => (
            <div key={y} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); toggle(y); }}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13, color: "#334155", background: years.includes(y) ? "#eff6ff" : "white", userSelect: "none" }}>
              <input type="checkbox" readOnly checked={years.includes(y)} style={{ accentColor: "#1e3a5f", pointerEvents: "none" }} />
              {y}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Query basket ──────────────────────────────────────────────────────────────
function QueryBasket({ queryVars, onRemove, onClear, geography, selState, years }) {
  const [rScript, setRScript] = useState("");
  const [rCopied, setRCopied] = useState(false);
  const [genError, setGenError] = useState("");

  const tryGenerate = useCallback(() => {
    if (!geography || years.length === 0 || queryVars.length === 0) return;
    setGenError("");
    setRScript(generateRScript(queryVars, geography, selState, years));
  }, [queryVars, geography, selState, years]);

  useEffect(() => { tryGenerate(); }, [tryGenerate]);

  const handleGenerate = () => {
    const missing = [];
    if (!geography) missing.push("Geography");
    if (years.length === 0) missing.push("Year(s)");
    if (missing.length) { setGenError("Please select: " + missing.join(" and ")); return; }
    tryGenerate();
  };

  const handleCopy = () => { clipboardCopy(rScript); setRCopied(true); setTimeout(() => setRCopied(false), 1500); };

  if (queryVars.length === 0) return null;

  return (
    <div style={{ background: "white", border: "2px solid #1e3a5f", borderRadius: 12, padding: 16, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1e3a5f", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Query · {queryVars.length} variable{queryVars.length !== 1 ? "s" : ""}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleGenerate} style={{ background: "#7c3aed", color: "white", border: "none", borderRadius: 7, padding: "7px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            Create R Script
          </button>
          <button onClick={onClear} style={{ background: "white", color: "#dc2626", border: "1.5px solid #fca5a5", borderRadius: 7, padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            Clear all
          </button>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: genError || rScript ? 12 : 0 }}>
        {queryVars.map(v => (
          <div key={v.uid} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 10px", fontSize: 12 }}>
            <code style={{ color: "#1e40af", fontWeight: 700 }}>{v.id}</code>
            <span style={{ color: "#64748b" }}>—</span>
            <span style={{ color: "#475569", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.displayName}</span>
            <span onClick={() => onRemove(v.uid)} style={{ cursor: "pointer", color: "#94a3b8", fontSize: 15, lineHeight: 1, marginLeft: 2 }}>×</span>
          </div>
        ))}
      </div>
      {genError && <p style={{ margin: "0 0 10px", fontSize: 12, color: "#dc2626" }}>{genError}</p>}
      {rScript && (
        <div style={{ background: "#1e1e2e", borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              R Script — tidycensus{years.length > 1 ? " (map_dfr · " + years.length + " yrs)" : ""}
            </span>
            <button onClick={handleCopy} style={{ background: rCopied ? "#10b981" : "#7c3aed", color: "white", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
              {rCopied ? "✓ Copied!" : "Copy"}
            </button>
          </div>
          <pre style={{ margin: 0, fontSize: 12.5, color: "#e2e8f0", fontFamily: "monospace", whiteSpace: "pre-wrap", lineHeight: 1.6, textAlign: "left" }}>{rScript}</pre>
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [csvText, setCsvText]       = useState("");
  const [committed, setCommitted]   = useState("");
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [labelPath, setLabelPath]   = useState([]);
  const [detailPath, setDetailPath] = useState([]);
  const [search, setSearch]         = useState("");
  const [added, setAdded]           = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [geography, setGeography]   = useState("");
  const [selState, setSelState]     = useState("");
  const [years, setYears]           = useState([]);
  const [queryVars, setQueryVars]   = useState([]);

  useEffect(() => {
    fetch("/1yr_clean_varnames.csv")
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(text => { const t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); setCsvText(t); setCommitted(t); })
      .catch(e => setFetchError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const parsed       = useMemo(() => parseCSV(committed), [committed]);
  const rows         = parsed.rows || [];
  const uniqueLabels = useMemo(() => [...new Set(rows.map(r => r.label).filter(Boolean))].sort(), [rows]);
  const labelTree    = useMemo(() => buildLabelTree(rows), [rows]);

  const labelChildren  = useMemo(() => getLabelChildren(labelTree, labelPath), [labelTree, labelPath]);
  const labelRows      = useMemo(() => getAllRowsUnder(labelTree, labelPath), [labelTree, labelPath]);
  const detailTree     = useMemo(() => buildDetailTree(labelRows), [labelRows]);
  const detailChildren = useMemo(() => getDetailChildren(detailTree, detailPath), [detailTree, detailPath]);
  const currentId      = useMemo(() => getMostGeneralId(labelRows, detailPath), [labelRows, detailPath]);
  const currentRow     = useMemo(() => getMostGeneralRow(labelRows, detailPath), [labelRows, detailPath]);

  const isAtRoot = labelPath.length === 0;
  const hasLabelChildren = Object.keys(labelChildren).length > 0;
  const isAtLeaf = !isAtRoot && !hasLabelChildren;

  const filteredLabels = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return uniqueLabels.filter(l => l.toLowerCase().includes(q));
  }, [uniqueLabels, search]);

  const goToLabel = useCallback((path, clearSearch = true) => {
    setLabelPath(path); setDetailPath([]); if (clearSearch) setSearch("");
  }, []);

  const navigateLabel = useCallback(path => {
    goToLabel(autoAdvancePath(labelTree, path));
  }, [labelTree, goToLabel]);

  const alreadyInQuery = currentId && queryVars.some(v => v.id === currentId);

  const handleAddToQuery = () => {
    if (!currentId || alreadyInQuery) return;
    const displayName = [...labelPath, ...detailPath].join(" › ");
    setQueryVars(prev => [...prev, { uid: currentId + "-" + Date.now(), id: currentId, displayName, row: currentRow }]);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  const handleFile = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { const t = ev.target.result.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); setCsvText(t); };
    reader.readAsText(file);
  };

  const hasData = rows.length > 0;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 860, margin: "0 auto", padding: 24, background: "#f8fafc", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, color: "#1e3a5f" }}>Variable Explorer</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
            {hasData ? rows.length.toLocaleString() + " variables · " + uniqueLabels.length + " topics" : "Upload your CSV to get started"}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#475569", maxWidth: 560, lineHeight: 1.6 }}>
            Browse and search ACS variables by topic, drill into subcategories and breakdowns, then build a multi-variable query and export a ready-to-run <code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: 4 }}>tidycensus</code> R script — with optional multi-year <code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: 4 }}>map_dfr</code> looping.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <button onClick={() => setShowUpload(v => !v)}
            style={{ background: showUpload ? "#1e3a5f" : "white", color: showUpload ? "white" : "#1e3a5f", border: "1.5px solid #1e3a5f", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            {showUpload ? "Hide Upload" : "Upload CSV"}
          </button>
          <a href="https://github.com/kaleyjoss/acs_variable_explorer" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#1e3a5f", textDecoration: "none", border: "1.5px solid #1e3a5f", borderRadius: 7, padding: "5px 11px", background: "white", fontWeight: 600 }}
            onMouseEnter={e => { e.currentTarget.style.background = "#f0f4f8"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "white"; }}>
            <svg height="14" width="14" viewBox="0 0 16 16" fill="#1e3a5f">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </a>
        </div>
      </div>

      {/* Upload */}
      {showUpload && (
        <div style={{ background: "white", border: "1.5px solid #cbd5e1", borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#475569" }}>
            Upload <strong>1yr_clean_varnames.csv</strong> or any CSV with <strong>id</strong>, <strong>label_clean</strong>, <strong>detail</strong>, <strong>label_varname</strong>, <strong>detail_varname</strong> columns.
          </p>
          <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ fontSize: 13, marginBottom: 8, display: "block" }} />
          <textarea value={csvText} onChange={e => setCsvText(e.target.value)} placeholder="…or paste CSV text here"
            style={{ width: "100%", height: 100, fontSize: 12, fontFamily: "monospace", border: "1px solid #cbd5e1", borderRadius: 6, padding: 8, boxSizing: "border-box", resize: "vertical" }} />
          {parsed.error && <p style={{ color: "#dc2626", fontSize: 13, margin: "6px 0 0" }}>{parsed.error}</p>}
          <button onClick={() => { setCommitted(csvText); setShowUpload(false); goToLabel([]); }}
            style={{ marginTop: 10, background: "#1e3a5f", color: "white", border: "none", borderRadius: 7, padding: "8px 20px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            Load Data
          </button>
        </div>
      )}

      {loading && <p style={{ color: "#64748b", fontSize: 14 }}>Loading variables…</p>}
      {fetchError && <p style={{ color: "#dc2626", fontSize: 13 }}>Could not auto-load CSV ({fetchError}) — upload it manually above.</p>}
      {!hasData && !loading && !showUpload && <p style={{ color: "#dc2626", fontSize: 14 }}>No data loaded. Click "Upload CSV" above.</p>}

      {hasData && (
        <>
          {/* Search */}
          <div style={{ position: "relative", marginBottom: 12 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}>🔍</span>
            <input placeholder="Search topics…" value={search}
              onChange={e => { setSearch(e.target.value); if (e.target.value) goToLabel([], false); }}
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px 11px 38px", fontSize: 14, border: "1.5px solid #cbd5e1", borderRadius: 10, outline: "none", background: "white" }} />
            {search && (
              <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8" }}>×</button>
            )}
          </div>

          {/* ACS Params */}
          <div style={{ background: "white", border: "1.5px solid #cbd5e1", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>ACS Params</span>
            <select value={geography} onChange={e => setGeography(e.target.value)} style={selStyle}>
              <option value="">Geography… *</option>
              {GEOGRAPHIES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={selState} onChange={e => setSelState(e.target.value)} style={selStyle}>
              <option value="">State…</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <YearPicker years={years} onChange={setYears} />
            {years.length > 1 && (
              <span style={{ fontSize: 12, color: "#7c3aed", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 6, padding: "3px 9px", fontWeight: 600 }}>
                map_dfr · {years.length} yrs
              </span>
            )}
          </div>

          {/* Query basket */}
          <QueryBasket
            queryVars={queryVars}
            onRemove={uid => setQueryVars(prev => prev.filter(v => v.uid !== uid))}
            onClear={() => setQueryVars([])}
            geography={geography}
            selState={selState}
            years={years}
          />

          {/* Search results */}
          {search && (
            <div style={{ background: "white", borderRadius: 10, border: "1.5px solid #cbd5e1", overflow: "hidden", marginBottom: 16 }}>
              <div style={{ padding: "9px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>RESULTS · {filteredLabels.length}</span>
              </div>
              {filteredLabels.length === 0
                ? <p style={{ padding: 24, color: "#94a3b8", textAlign: "center", margin: 0 }}>No topics match "{search}"</p>
                : filteredLabels.slice(0, 50).map((label, i, arr) => {
                  const bestId = getMostGeneralId(rows.filter(r => r.label === label), []);
                  return (
                    <div key={label} onClick={() => { setSearch(""); navigateLabel(splitLabel(label)); }}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", background: "white" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#f8fafc"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "white"; }}>
                      <span style={{ fontSize: 14, color: "#334155", fontWeight: 500, textAlign: "left" }}>{label}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 16 }}>
                        {bestId && <code style={{ background: "#eff6ff", color: "#1e40af", padding: "3px 8px", borderRadius: 5, fontSize: 12, fontWeight: 700 }}>{bestId}</code>}
                        <span style={{ color: "#94a3b8", fontSize: 18 }}>›</span>
                      </div>
                    </div>
                  );
                })}
              {filteredLabels.length > 50 && (
                <p style={{ padding: "8px 16px", margin: 0, fontSize: 12, color: "#94a3b8", background: "#f8fafc" }}>Showing first 50 — narrow your search</p>
              )}
            </div>
          )}

          {/* Main tree */}
          {!search && (
            <div>
              {!isAtRoot && (
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                  <NavBtn active={false} onClick={() => goToLabel([])} label="All Topics" />
                  {labelPath.map((step, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: "#94a3b8" }}>›</span>
                      <NavBtn active={i === labelPath.length - 1} onClick={() => goToLabel(labelPath.slice(0, i + 1))} label={step} />
                    </span>
                  ))}
                </div>
              )}

              {!isAtRoot && currentId && (
                <div style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 10, padding: "14px 18px", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 11, color: "#3b82f6", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {detailPath.length === 0 ? "Most General Variable" : "Current Variable"}
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 700, color: "#1e40af", fontFamily: "monospace" }}>{currentId}</p>
                      <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b" }}>
                        {labelPath.join(" › ")}{detailPath.length > 0 ? " · " + detailPath.join(" › ") : ""}
                      </p>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <button onClick={handleAddToQuery} disabled={!!alreadyInQuery}
                        style={{ background: added ? "#10b981" : alreadyInQuery ? "#e2e8f0" : "#1e3a5f", color: alreadyInQuery ? "#94a3b8" : "white", border: "none", borderRadius: 8, padding: "10px 18px", cursor: alreadyInQuery ? "default" : "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
                        {added ? "✓ Added!" : alreadyInQuery ? "Already in query" : "+ Add to Query"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <ChildList
                children={labelChildren}
                onSelect={key => navigateLabel([...labelPath, key])}
                headerLabel={isAtRoot ? "ALL TOPICS" : "DRILL DOWN"}
                getBestId={key => getMostGeneralId(getAllRowsUnder(labelTree, [...labelPath, key]), [])}
                pinned={isAtRoot ? PINNED_TOPICS : []}
              />

              {isAtLeaf && (
                <div>
                  {detailPath.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                      <NavBtn active={false} onClick={() => setDetailPath([])} label="All Details" color="#7c3aed" />
                      {detailPath.map((step, i) => (
                        <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ color: "#94a3b8" }}>›</span>
                          <NavBtn active={i === detailPath.length - 1} onClick={() => setDetailPath(detailPath.slice(0, i + 1))} label={step} color="#7c3aed" />
                        </span>
                      ))}
                    </div>
                  )}
                  <ChildList
                    children={detailChildren}
                    onSelect={key => setDetailPath([...detailPath, key])}
                    headerLabel={detailPath.length === 0 ? "SELECT DETAIL" : "REFINE BY"}
                    getBestId={key => getMostGeneralId(labelRows, [...detailPath, key])}
                  />
                  {detailPath.length > 0 && Object.keys(detailChildren).length === 0 && (
                    <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", background: "white", borderRadius: 10, border: "1.5px solid #e2e8f0" }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                      <p style={{ margin: 0, fontSize: 14 }}>Most specific level — no further breakdown.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
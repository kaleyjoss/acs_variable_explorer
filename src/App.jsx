import { useState, useMemo, useCallback, useEffect } from "react";

const GEOGRAPHIES = ["US","region","state","county","county subdivision","tract","block group","block","place","american indian area/alaska native area (reservation or statistical entity only)","american indian area (off-reservation trust land only)/hawaiian home land","cbsa","combined statistical area","new england city and town area","urban area","congressional district","school district (elementary)","school district (secondary)","school district (unified)","public use microdata area","zip code tabulation area","state legislative district (upper chamber)","state legislative district (lower chamber)","voting district"];
const STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming","District of Columbia","Puerto Rico"];
const YEARS = Array.from({length: 21}, (_, i) => 2005 + i);
const ALLOWED_COLS = new Set(["id","variable","detail","label","label_varname","detail_varname","both_varname"]);

// ── Label splitting ───────────────────────────────────────────────────────────

function splitLabel(label) {
  if (!label) return [];
  const tokens = label.split(/(\s+(?:by|for)\s+)/i);
  const parts = [];
  let current = tokens[0].trim();
  for (let i = 1; i < tokens.length; i += 2) {
    if (current) parts.push(current);
    const delim = tokens[i].trim();
    const next = (tokens[i + 1] || "").trim();
    current = delim + " " + next;
  }
  if (current) parts.push(current);
  return parts;
}

// ── Label tree ────────────────────────────────────────────────────────────────

function buildLabelTree(rows) {
  const root = {};
  for (const row of rows) {
    const parts = splitLabel(row.label);
    if (!parts.length) continue;
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!node[p]) node[p] = { __rows: [], __children: {} };
      if (i === parts.length - 1) node[p].__rows.push(row);
      node = node[p].__children;
    }
  }
  return root;
}

function getLabelChildren(tree, path) {
  let node = tree;
  for (const step of path) {
    if (!node[step]) return {};
    node = node[step].__children;
  }
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
  for (let i = 0; i < path.length - 1; i++) {
    if (!node[path[i]]) return [];
    node = node[path[i]].__children;
  }
  const last = path[path.length - 1];
  if (!node[last]) return [];
  result.push(...node[last].__rows);
  collectAll(node[last].__children, result);
  return result;
}

function autoAdvancePath(tree, path) {
  let children = getLabelChildren(tree, path);
  let current = [...path];
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
  for (const step of path) {
    if (!node[step]) return {};
    node = node[step].__children;
  }
  return node || {};
}

function getMostGeneralId(rows, detailPath) {
  const matching = rows.filter(r => {
    if (!r.detail) return detailPath.length === 0;
    const parts = r.detail.split("!!").map(p => p.trim());
    return detailPath.every((step, i) => parts[i] === step);
  });
  if (!matching.length) return null;
  return [...matching].sort((a, b) =>
    (a.detail?.split("!!").length || 0) - (b.detail?.split("!!").length || 0)
  )[0]?.id || null;
}

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const cols = [];
  let cur = "", inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === "," && !inQuote) { cols.push(cur); cur = ""; }
    else { cur += ch; }
  }
  cols.push(cur);
  return cols.map(c => c.trim().replace(/\r$/, ""));
}

function parseCSV(text) {
  const lines = text.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rawHeaders = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const col = name => rawHeaders.findIndex(h => h === name);
  const idCol        = col("id") !== -1 ? col("id") : col("variable");
  const labelCol     = col("label_clean");
  const detailCol    = col("detail");
  const labelVarCol  = col("label_varname");
  const detailVarCol = col("detail_varname");
  const bothVarCol   = col("both_varname");
  if (idCol === -1 || labelCol === -1)
    return { error: `Expected "id" and "label" columns. Found: ${rawHeaders.join(", ")}` };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 2) continue;
    const id     = cols[idCol];
    const label  = cols[labelCol]?.replace(/^"|"$/g, "");
    const detail = detailCol !== -1 ? cols[detailCol]?.replace(/^"|"$/g, "") || null : null;
    const labelVar  = labelVarCol  !== -1 ? cols[labelVarCol]  : null;
    const detailVar = detailVarCol !== -1 ? cols[detailVarCol] : null;
    const bothVar   = bothVarCol   !== -1 ? cols[bothVarCol]   : null;
    const idLower = id?.toLowerCase();
    if (id && label && idLower !== "geoid" && idLower !== "geo_id")
      rows.push({ id, label, detail, labelVar, detailVar, bothVar });
  }
  return { rows };
}

// ── R script ─────────────────────────────────────────────────────────────────

function generateRScript(labelPath, rows, geography, state, year) {
  const stripE = id => id.endsWith("E") ? id.slice(0, -1) : id;
  const safeName = n => (n || "est_var").replace(/-/g, "_");
  const tableName = rows[0]?.labelVar || labelPath.join("_").toLowerCase().replace(/\W+/g, "_");
  const seen = new Set();
  const varLines = rows
    .filter(r => { const k = safeName(r.detailVar || r.bothVar); return seen.has(k) ? false : seen.add(k); })
    .map(r => `    ${safeName(r.detailVar || r.bothVar)} = "${stripE(r.id)}"`)
    .join(",\n");
  const geoLine   = geography ? `  geography = "${geography}",\n` : "";
  const stateLine = state     ? `  state = "${state}",\n`         : "";
  const yearLine  = year      ? `  year = ${year}\n`              : "";
  return `\`\`\`{r census_data}\nlibrary(tidyverse)\nlibrary(tidycensus)\n\n${tableName} <- get_acs(\n${geoLine}${stateLine}  variables = c(\n${varLines}\n  ),\n${yearLine})\n\`\`\``;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const selStyle = { fontSize: 13, border: "1.5px solid #cbd5e1", borderRadius: 7, padding: "6px 10px", background: "white", color: "#334155", cursor: "pointer" };

function NavBtn({ active, onClick, label, color = "#1e3a5f" }) {
  return (
    <button onClick={onClick} style={{ background: active ? color : "white", color: active ? "white" : color, border: `1.5px solid ${color}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
      {label}
    </button>
  );
}

function ChildList({ children, onSelect, headerLabel, getBestId }) {
  const keys = Object.keys(children).sort();
  if (!keys.length) return null;
  return (
    <div style={{ background: "white", borderRadius: 10, border: "1.5px solid #cbd5e1", overflow: "hidden", marginBottom: 14 }}>
      <div style={{ padding: "9px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{headerLabel} · {keys.length}</span>
      </div>
      {keys.map((key, i) => {
        const bestId = getBestId(key);
        const hasKids = Object.keys(children[key].__children || {}).length > 0;
        return (
          <div key={key} onClick={() => onSelect(key)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: i < keys.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", background: "white" }}
            onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
            onMouseLeave={e => e.currentTarget.style.background = "white"}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, color: "#334155", fontWeight: 500 }}>{key}</span>
              {hasKids && <span style={{ fontSize: 11, color: "#94a3b8", background: "#f1f5f9", padding: "2px 7px", borderRadius: 10 }}>has subcategories</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {bestId && <code style={{ background: "#eff6ff", color: "#1e40af", padding: "3px 8px", borderRadius: 5, fontSize: 12, fontWeight: 700 }}>{bestId}</code>}
              <span style={{ color: "#94a3b8", fontSize: 18 }}>›</span>
            </div>
          </div>
        );
      })}
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
  const [copied, setCopied]         = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [rScript, setRScript]       = useState("");
  const [rCopied, setRCopied]       = useState(false);
  const [geography, setGeography]   = useState("");
  const [selState, setSelState]     = useState("");
  const [year, setYear]             = useState("");

  useEffect(() => {
    fetch("/1yr_clean_varnames.csv")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(text => { const t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); setCsvText(t); setCommitted(t); })
      .catch(e => setFetchError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const parsed       = useMemo(() => parseCSV(committed), [committed]);
  const rows         = parsed.rows || [];
  const uniqueLabels = useMemo(() => [...new Set(rows.map(r => r.label).filter(Boolean))].sort(), [rows]);
  const labelTree    = useMemo(() => buildLabelTree(rows), [rows]);

  const labelChildren = useMemo(() => getLabelChildren(labelTree, labelPath), [labelTree, labelPath]);
  const labelRows     = useMemo(() => getAllRowsUnder(labelTree, labelPath), [labelTree, labelPath]);
  const detailTree    = useMemo(() => buildDetailTree(labelRows), [labelRows]);
  const detailChildren = useMemo(() => getDetailChildren(detailTree, detailPath), [detailTree, detailPath]);
  const currentId     = useMemo(() => getMostGeneralId(labelRows, detailPath), [labelRows, detailPath]);

  const isAtRoot = labelPath.length === 0;
  const hasLabelChildren = Object.keys(labelChildren).length > 0;
  const isAtLeaf = !isAtRoot && !hasLabelChildren;

  const filteredLabels = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return uniqueLabels.filter(l => l.toLowerCase().includes(q));
  }, [uniqueLabels, search]);

  const copy = useCallback((text) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  // Navigate label path without auto-advance (breadcrumb / back)
  const goToLabel = useCallback((path) => {
    setLabelPath(path);
    setDetailPath([]);
    setRScript("");
    setSearch("");
  }, []);

  // Navigate forward with auto-advance
  const navigateLabel = useCallback((path) => {
    goToLabel(autoAdvancePath(labelTree, path));
  }, [labelTree, goToLabel]);

  const handleGenerateR = () => {
    try {
      const scopedRows = detailPath.length === 0 ? labelRows : labelRows.filter(r => {
        if (!r.detail) return false;
        const parts = r.detail.split("!!").map(p => p.trim());
        return detailPath.every((step, i) => parts[i] === step);
      });
      setRScript(generateRScript(labelPath, scopedRows, geography, selState, year));
    } catch { setRScript("// Error generating script."); }
  };

  const handleCopyR = () => {
    navigator.clipboard.writeText(rScript).catch(() => {});
    setRCopied(true);
    setTimeout(() => setRCopied(false), 1500);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { const t = ev.target.result.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); setCsvText(t); setCommitted(t); };
    reader.readAsText(file);
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 860, margin: "0 auto", padding: 24, background: "#f8fafc", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1e3a5f" }}>Variable Explorer</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>{rows.length.toLocaleString()} variables · {uniqueLabels.length} topics</p>
        </div>
        <button onClick={() => setShowUpload(v => !v)}
          style={{ background: showUpload ? "#1e3a5f" : "white", color: showUpload ? "white" : "#1e3a5f", border: "1.5px solid #1e3a5f", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          {showUpload ? "Hide Upload" : "Upload CSV"}
        </button>
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div style={{ background: "white", border: "1.5px solid #cbd5e1", borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#475569" }}>Upload a CSV with <strong>ID</strong>, <strong>Label</strong>, <strong>Detail</strong>, <strong>label_varname</strong>, <strong>detail_varname</strong> columns.</p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ fontSize: 13 }} />
          </div>
          <textarea value={csvText} onChange={e => setCsvText(e.target.value)}
            style={{ width: "100%", height: 100, fontSize: 12, fontFamily: "monospace", border: "1px solid #cbd5e1", borderRadius: 6, padding: 8, boxSizing: "border-box", resize: "vertical" }} />
          {parsed.error && <p style={{ color: "#dc2626", fontSize: 13, margin: "6px 0 0" }}>{parsed.error}</p>}
          <button onClick={() => { setCommitted(csvText); setShowUpload(false); goToLabel([]); }}
            style={{ marginTop: 10, background: "#1e3a5f", color: "white", border: "none", borderRadius: 7, padding: "8px 20px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            Load Data
          </button>
        </div>
      )}

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}>🔍</span>
        <input placeholder="Search topics…" value={search}
          onChange={e => { setSearch(e.target.value); if (e.target.value) goToLabel([]); }}
          style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px 11px 38px", fontSize: 14, border: "1.5px solid #cbd5e1", borderRadius: 10, outline: "none", background: "white" }} />
        {search && <button onClick={() => setSearch("")}
          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8" }}>×</button>}
      </div>

      {/* ACS Params */}
      <div style={{ background: "white", border: "1.5px solid #cbd5e1", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>ACS Params</span>
        <select value={geography} onChange={e => setGeography(e.target.value)} style={selStyle}>
          <option value="">Geography…</option>
          {GEOGRAPHIES.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={selState} onChange={e => setSelState(e.target.value)} style={selStyle}>
          <option value="">State…</option>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={year} onChange={e => setYear(e.target.value)} style={selStyle}>
          <option value="">Year…</option>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Status */}
      {loading && <p style={{ color: "#64748b", fontSize: 14 }}>Loading data…</p>}
      {fetchError && <p style={{ color: "#dc2626", fontSize: 14 }}>Failed to load CSV: {fetchError}</p>}
      {!loading && !fetchError && rows.length === 0 && <p style={{ color: "#dc2626", fontSize: 14 }}>No data loaded. Upload a CSV above.</p>}

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
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                  onMouseLeave={e => e.currentTarget.style.background = "white"}>
                  <span style={{ fontSize: 14, color: "#334155", fontWeight: 500 }}>{label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 16 }}>
                    {bestId && <code style={{ background: "#eff6ff", color: "#1e40af", padding: "3px 8px", borderRadius: 5, fontSize: 12, fontWeight: 700 }}>{bestId}</code>}
                    <span style={{ color: "#94a3b8", fontSize: 18 }}>›</span>
                  </div>
                </div>
              );
            })}
          {filteredLabels.length > 50 && <p style={{ padding: "8px 16px", margin: 0, fontSize: 12, color: "#94a3b8", background: "#f8fafc" }}>Showing first 50 — narrow your search</p>}
        </div>
      )}

      {/* Main tree (hidden while searching) */}
      {!search && (
        <div>
          {/* Label breadcrumb */}
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

          {/* Variable ID box */}
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
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => copy(currentId)}
                    style={{ background: copied ? "#10b981" : "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
                    {copied ? "✓ Copied!" : "Copy ID"}
                  </button>
                  <button onClick={handleGenerateR}
                    style={{ background: "#7c3aed", color: "white", border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
                    Copy R Script
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* R Script output */}
          {rScript && (
            <div style={{ background: "#1e1e2e", borderRadius: 10, padding: 16, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>R Script — tidycensus</span>
                <button onClick={handleCopyR}
                  style={{ background: rCopied ? "#10b981" : "#7c3aed", color: "white", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                  {rCopied ? "✓ Copied!" : "Copy"}
                </button>
              </div>
              <pre style={{ margin: 0, fontSize: 12.5, color: "#e2e8f0", fontFamily: "monospace", whiteSpace: "pre-wrap", lineHeight: 1.6, textAlign: "left" }}>{rScript}</pre>
            </div>
          )}

          {/* Label children */}
          <ChildList
            children={labelChildren}
            onSelect={key => navigateLabel([...labelPath, key])}
            headerLabel={isAtRoot ? "ALL TOPICS" : "DRILL DOWN"}
            getBestId={key => getMostGeneralId(getAllRowsUnder(labelTree, [...labelPath, key]), [])}
          />

          {/* Detail section — only at leaf label nodes */}
          {isAtLeaf && (
            <div>
              {/* Detail breadcrumb */}
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
    </div>
  );
}
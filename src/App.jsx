import { useState, useMemo, useCallback } from "react";

const SAMPLE_CSV = `ID,Detail,Label,Unnamed: 3,Unnamed: 4,Required,Attributes,Limit,Predicate Type,Group,label_varname,detail_varname,both_varname
AIANHH,Geography,,,,not required,,0,(not a predicate),,,geography,__geography
ANRC,Geography,,,,not required,,0,(not a predicate),,,geography,__geography
B01001_001E,Estimate!!Total:,Sex by Age,,,not required,"B01001_001EA, B01001_001M, B01001_001MA",0,int,B01001,sex_by_age,est_tot,sex_by_age__est_tot
B01001_002E,Estimate!!Total:!!Male:,Sex by Age,,,not required,"B01001_002EA, B01001_002M, B01001_002MA",0,int,B01001,sex_by_age,est_tot_male,sex_by_age__est_tot_male
B01001_003E,Estimate!!Total:!!Male:!!Under 5 years,Sex by Age,,,not required,"B01001_003EA, B01001_003M, B01001_003MA",0,int,B01001,sex_by_age,est_tot_male_under_5_yrs,sex_by_age__est_tot_male_under_5_yrs
B01001_004E,Estimate!!Total:!!Male:!!5 to 9 years,Sex by Age,,,not required,"B01001_004EA, B01001_004M, B01001_004MA",0,int,B01001,sex_by_age,est_tot_male_5-9_yrs,sex_by_age__est_tot_male_5-9_yrs
B01001_005E,Estimate!!Total:!!Male:!!10 to 14 years,Sex by Age,,,not required,"B01001_005EA, B01001_005M, B01001_005MA",0,int,B01001,sex_by_age,est_tot_male_10-14_yrs,sex_by_age__est_tot_male_10-14_yrs
B01001_006E,Estimate!!Total:!!Male:!!15 to 17 years,Sex by Age,,,not required,"B01001_006EA, B01001_006M, B01001_006MA",0,int,B01001,sex_by_age,est_tot_male_15-17_yrs,sex_by_age__est_tot_male_15-17_yrs
B01001_007E,Estimate!!Total:!!Male:!!18 and 19 years,Sex by Age,,,not required,"B01001_007EA, B01001_007M, B01001_007MA",0,int,B01001,sex_by_age,est_tot_male_18_and_19_yrs,sex_by_age__est_tot_male_18_and_19_yrs
B01001_008E,Estimate!!Total:!!Male:!!20 years,Sex by Age,,,not required,"B01001_008EA, B01001_008M, B01001_008MA",0,int,B01001,sex_by_age,est_tot_male_20_yrs,sex_by_age__est_tot_male_20_yrs
B01001_009E,Estimate!!Total:!!Male:!!21 years,Sex by Age,,,not required,"B01001_009EA, B01001_009M, B01001_009MA",0,int,B01001,sex_by_age,est_tot_male_21_yrs,sex_by_age__est_tot_male_21_yrs
B01001_010E,Estimate!!Total:!!Male:!!22 to 24 years,Sex by Age,,,not required,"B01001_010EA, B01001_010M, B01001_010MA",0,int,B01001,sex_by_age,est_tot_male_22-24_yrs,sex_by_age__est_tot_male_22-24_yrs
B01001_011E,Estimate!!Total:!!Male:!!25 to 29 years,Sex by Age,,,not required,"B01001_011EA, B01001_011M, B01001_011MA",0,int,B01001,sex_by_age,est_tot_male_25-29_yrs,sex_by_age__est_tot_male_25-29_yrs`;

const ALLOWED_COLS = new Set(["variable", "id", "detail", "label","label_varname","detail_varname","both_varname"]);

function parseCSVLine(line) {
  const cols = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === "," && !inQuote) { cols.push(cur); cur = ""; }
    else { cur += ch; }
  }
  cols.push(cur);
  return cols.map(c => c.trim());
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const rawHeaders = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const headers = rawHeaders.map(h => ALLOWED_COLS.has(h) ? h : null);
  const idCol = headers.findIndex(h => h === "id" || h === "variable");
  const labelCol = headers.findIndex(h => h === "label");
  const labelVarCol = headers.findIndex(h => h === "label_varname");
  const detailCol = headers.findIndex(h => h === "detail");
  const detailVarCol = headers.findIndex(h => h === "detail_varname");
  const bothVarCol = headers.findIndex(h => h === "both_varname");
  if (idCol === -1 || labelCol === -1)
    return { error: `Expected "id" (or "variable") and "label" columns. Found: ${rawHeaders.join(", ")}` };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 2) continue;
    const id = cols[idCol];
    const label = cols[labelCol]?.replace(/^"|"$/g, "");
    const detail = detailCol !== -1 ? cols[detailCol]?.replace(/^"|"$/g, "") || null : null;
    const idLower = id?.toLowerCase();
    const bothVar = bothVarCol !== -1 ? cols[bothVarCol] : null;
    const detailVar = detailVarCol !== -1 ? cols[detailVarCol] : null;
    const labelVar = labelVarCol !== -1 ? cols[labelVarCol] : null;
    if (id && label && idLower !== "geoid" && idLower !== "geo_id") rows.push({ id, label, detail, bothVar, detailVar, labelVar });
  }
  return { rows, hasDetail: detailCol !== -1 };
}

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
  const sorted = [...matching].sort((a, b) => {
    const aLen = a.detail ? a.detail.split("!!").length : 0;
    const bLen = b.detail ? b.detail.split("!!").length : 0;
    return aLen - bLen;
  });
  return sorted[0]?.id || null;
}

function generateRScript(label, rows) {
  const stripE = id => id.endsWith("E") ? id.slice(0, -1) : id;
  const tableName = rows[0]?.labelVar || label.toLowerCase().replace(/\s+/g, "_");
  const varLines = rows
    .map(r => `    ${r.detailVar || r.bothVar || "est_var"} = "${stripE(r.id)}"`)
    .join(",\n");
  return `${tableName} <- get_acs(\n  geography = "____",\n  state = "____",\n  variables = c(\n${varLines}\n  ),\n  year = ____\n)`;
}

export default function App() {
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [committed, setCommitted] = useState(SAMPLE_CSV);
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [detailPath, setDetailPath] = useState([]);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [rScript, setRScript] = useState("");
  const [rCopied, setRCopied] = useState(false);

  const parsed = useMemo(() => parseCSV(committed), [committed]);
  const rows = parsed.rows || [];
  const uniqueLabels = useMemo(() => [...new Set(rows.map(r => r.label))].sort(), [rows]);

  const filteredLabels = useMemo(() => {
    if (!search) return uniqueLabels;
    const q = search.toLowerCase();
    return uniqueLabels.filter(l => l.toLowerCase().includes(q));
  }, [uniqueLabels, search]);

  const labelRows = useMemo(() => selectedLabel ? rows.filter(r => r.label === selectedLabel) : [], [rows, selectedLabel]);
  const detailTree = useMemo(() => buildDetailTree(labelRows), [labelRows]);
  const detailChildren = useMemo(() => getDetailChildren(detailTree, detailPath), [detailTree, detailPath]);
  const currentId = useMemo(() => getMostGeneralId(labelRows, detailPath), [labelRows, detailPath]);

  const labelBestId = useMemo(() => {
    const map = {};
    for (const label of uniqueLabels) {
      const r = rows.filter(r => r.label === label);
      map[label] = getMostGeneralId(r, []);
    }
    return map;
  }, [rows, uniqueLabels]);

  const copy = useCallback((text) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const handleGenerateR = () => {
    try {
      const scopedRows = detailPath.length === 0 ? labelRows : labelRows.filter(r => {
        if (!r.detail) return false;
        const parts = r.detail.split("!!").map(p => p.trim());
        return detailPath.every((step, i) => parts[i] === step);
      });
      setRScript(generateRScript(selectedLabel, scopedRows));
    } catch (e) {
      setRScript("// Error generating script. Please try again.");
    }
  };

  const handleCopyR = () => {
    navigator.clipboard.writeText(rScript).catch(() => {});
    setRCopied(true);
    setTimeout(() => setRCopied(false), 1500);
  };

  const selectLabel = (label) => { setSelectedLabel(label); setDetailPath([]); setSearch(""); setRScript(""); };
  const back = () => { setSelectedLabel(null); setDetailPath([]); setRScript(""); };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setCsvText(ev.target.result); setCommitted(ev.target.result); };
    reader.readAsText(file);
  };

  const Btn = ({ active, onClick, label }) => (
    <button onClick={onClick} style={{ background: active ? "#1e3a5f" : "white", color: active ? "white" : "#1e3a5f", border: "1.5px solid #1e3a5f", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
      {label}
    </button>
  );

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
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#475569" }}>
            Recognized columns:{" "}
            {[...ALLOWED_COLS].map(w => <code key={w} style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4, fontSize: 12, marginRight: 4 }}>{w}</code>)}
            — needs at least <strong>id</strong> (or <strong>variable</strong>) and <strong>label</strong>.
            <strong> detail</strong> (split by <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 3, fontSize: 12 }}>!!</code>) is optional.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ fontSize: 13 }} />
            <span style={{ color: "#94a3b8", fontSize: 13 }}>or paste below</span>
          </div>
          <textarea value={csvText} onChange={e => setCsvText(e.target.value)}
            style={{ width: "100%", height: 100, fontSize: 12, fontFamily: "monospace", border: "1px solid #cbd5e1", borderRadius: 6, padding: 8, boxSizing: "border-box", resize: "vertical" }} />
          {parsed.error && <p style={{ color: "#dc2626", fontSize: 13, margin: "6px 0 0" }}>{parsed.error}</p>}
          <button onClick={() => { setCommitted(csvText); setShowUpload(false); back(); setSearch(""); }}
            style={{ marginTop: 10, background: "#1e3a5f", color: "white", border: "none", borderRadius: 7, padding: "8px 20px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            Load Data
          </button>
        </div>
      )}

      {/* Search */}
      {!selectedLabel && (
        <div style={{ position: "relative", marginBottom: 16 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}>🔍</span>
          <input placeholder="Search topics…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px 11px 38px", fontSize: 14, border: "1.5px solid #cbd5e1", borderRadius: 10, outline: "none", background: "white" }} />
          {search && (
            <button onClick={() => setSearch("")}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8" }}>×</button>
          )}
        </div>
      )}

      {/* Label list */}
      {!selectedLabel && (
        <div style={{ background: "white", borderRadius: 10, border: "1.5px solid #cbd5e1", overflow: "hidden" }}>
          <div style={{ padding: "9px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
              {search ? `RESULTS · ${filteredLabels.length}` : `ALL TOPICS · ${uniqueLabels.length}`}
            </span>
          </div>
          {filteredLabels.length === 0 && (
            <p style={{ padding: 24, color: "#94a3b8", textAlign: "center", margin: 0 }}>No topics match "{search}"</p>
          )}
          {filteredLabels.map((label, i) => (
            <div key={label} onClick={() => selectLabel(label)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: i < filteredLabels.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", background: "white" }}
              onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
              onMouseLeave={e => e.currentTarget.style.background = "white"}>
              <span style={{ fontSize: 14, color: "#334155", fontWeight: 500 }}>{label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 16 }}>
                {labelBestId[label] && <code style={{ background: "#eff6ff", color: "#1e40af", padding: "3px 8px", borderRadius: 5, fontSize: 12, fontWeight: 700 }}>{labelBestId[label]}</code>}
                <span style={{ color: "#94a3b8", fontSize: 18 }}>›</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail drill-down */}
      {selectedLabel && (
        <div>
          {/* Breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
            <Btn active={false} onClick={back} label="All Topics" />
            <span style={{ color: "#94a3b8" }}>›</span>
            <Btn active={detailPath.length === 0} onClick={() => setDetailPath([])} label={selectedLabel} />
            {detailPath.map((step, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#94a3b8" }}>›</span>
                <Btn active={i === detailPath.length - 1} onClick={() => setDetailPath(detailPath.slice(0, i + 1))} label={step} />
              </span>
            ))}
          </div>

          {/* Current variable ID + action buttons */}
          {currentId && (
            <div style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 10, padding: "14px 18px", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 11, color: "#3b82f6", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {detailPath.length === 0 ? "Most General Variable" : "Current Variable"}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 700, color: "#1e40af", fontFamily: "monospace" }}>{currentId}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b" }}>
                    {selectedLabel}{detailPath.length > 0 ? " · " + detailPath.join(" › ") : ""}
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
            <div style={{ background: "#1e1e2e", borderRadius: 10, padding: 16, marginBottom: 14, position: "relative" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>R Script — tidycensus</span>
                <button onClick={handleCopyR}
                  style={{ background: rCopied ? "#10b981" : "#7c3aed", color: "white", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                  {rCopied ? "✓ Copied!" : "Copy"}
                </button>
              </div>
              <pre style={{ margin: 0, fontSize: 12.5, color: "#e2e8f0", fontFamily: "monospace", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{rScript}</pre>
            </div>
          )}

          {/* Detail children */}
          {Object.keys(detailChildren).length > 0 ? (
            <div style={{ background: "white", borderRadius: 10, border: "1.5px solid #cbd5e1", overflow: "hidden" }}>
              <div style={{ padding: "9px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                  {detailPath.length === 0 ? "SELECT DETAIL" : "REFINE BY"} · {Object.keys(detailChildren).length} options
                </span>
              </div>
              {Object.keys(detailChildren).sort().map((key, i, arr) => {
                const childPath = [...detailPath, key];
                const childId = getMostGeneralId(labelRows, childPath);
                const hasKids = Object.keys(detailChildren[key].__children || {}).length > 0;
                return (
                  <div key={key} onClick={() => setDetailPath(childPath)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none", cursor: "pointer", background: "white" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                    onMouseLeave={e => e.currentTarget.style.background = "white"}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 14, color: "#334155", fontWeight: 500 }}>{key}</span>
                      {hasKids && <span style={{ fontSize: 11, color: "#94a3b8", background: "#f1f5f9", padding: "2px 7px", borderRadius: 10 }}>has subcategories</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      {childId && <code style={{ background: "#eff6ff", color: "#1e40af", padding: "3px 8px", borderRadius: 5, fontSize: 12, fontWeight: 700 }}>{childId}</code>}
                      {hasKids && <span style={{ color: "#94a3b8", fontSize: 18 }}>›</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", background: "white", borderRadius: 10, border: "1.5px solid #e2e8f0" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <p style={{ margin: 0, fontSize: 14 }}>Most specific level — no further breakdown.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
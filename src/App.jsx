import { useState, useMemo, useCallback, useRef, useEffect } from "react";

const GEOGRAPHIES = ["US","region","state","county","county subdivision","tract","block group","block","place","american indian area/alaska native area (reservation or statistical entity only)","american indian area (off-reservation trust land only)/hawaiian home land","cbsa","combined statistical area","new england city and town area","urban area","congressional district","school district (elementary)","school district (secondary)","school district (unified)","public use microdata area","zip code tabulation area","state legislative district (upper chamber)","state legislative district (lower chamber)","voting district"];
const STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming","District of Columbia","Puerto Rico"];
const YEARS = Array.from({length: 21}, (_, i) => 2005 + i);

const ACS_SERIES = [
  { key: "1yr", label: "1-Year ACS Estimates", file: "/1yr_clean_varnames.csv", color: "#1e3a5f" },
  { key: "5yr", label: "5-Year ACS Estimates", file: "/5yr_clean_varnames.csv", color: "#5b21b6" },
];

const LABEL_FORMAT_OPTIONS = [
  { value: "short",      label: "Short" },
  { value: "with_id",    label: "With ID" },
  { value: "full_acs",   label: "Full ACS" },
  { value: "with_table", label: "With Table" },
];

const GEO_STATA = {
  "US":"us","state":"state","county":"county","tract":"tract",
  "block group":"blockgroup","block":"block","place":"place","cbsa":"cbsa",
  "combined statistical area":"csa","congressional district":"cd",
  "zip code tabulation area":"zcta","public use microdata area":"puma",
  "state legislative district (upper chamber)":"sldu",
  "state legislative district (lower chamber)":"sldl",
  "school district (unified)":"sdu","school district (elementary)":"sde",
  "school district (secondary)":"sds",
};

// ── CSV parsing ───────────────────────────────────────────────────────────────
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
  const lines = text.trim().replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
  const hdrs = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const col = n => hdrs.findIndex(h => h === n);

  const idCol        = col("id") !== -1 ? col("id") : col("variable");
  const groupCol     = col("group");
  const labelCol     = col("label_clean");
  const detailVarCol = col("detail_varname");
  const bothVarCol   = col("both_varname");
  const labelVarCol  = col("label_varname");
  const detailCol    = col("detail");
  const baseVarCol   = col("base var");
  const demoLetterCol= col("demographic letter");
  const prCol        = col("puerto rico");

  if (idCol === -1) return { error: "Could not find 'id' or 'variable' column. Found: " + hdrs.join(", ") };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 2) continue;
    const id = cols[idCol]?.trim();
    if (!id || id.toLowerCase() === "geoid" || id.toLowerCase() === "geo_id") continue;
    rows.push({
      id,
      group:      groupCol      !== -1 ? cols[groupCol]?.trim()                     || "" : "",
      label:      labelCol      !== -1 ? cols[labelCol]?.replace(/^"|"$/g,"")?.trim()  || "" : "",
      detailVar:  detailVarCol  !== -1 ? cols[detailVarCol]?.trim()                || "" : "",
      bothVar:    bothVarCol    !== -1 ? cols[bothVarCol]?.trim()                  || "" : "",
      labelVar:   labelVarCol   !== -1 ? cols[labelVarCol]?.trim()                 || "" : "",
      detail:     detailCol     !== -1 ? cols[detailCol]?.replace(/^"|"$/g,"")?.trim() || "" : "",
      baseVar:    baseVarCol    !== -1 ? cols[baseVarCol]?.trim()                  || "" : "",
      demoLetter: demoLetterCol !== -1 ? cols[demoLetterCol]?.trim()               || "" : "",
      isPR:       prCol         !== -1 ? cols[prCol]?.trim().toLowerCase() === "true" || cols[prCol]?.trim() === "1" : false,
    });
  }
  return { rows };
}

// ── Data helpers ──────────────────────────────────────────────────────────────

// Level 1: unique Base Var + label_clean
function buildBaseVars(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (r.baseVar && !seen.has(r.baseVar)) seen.set(r.baseVar, r.label);
  }
  return Array.from(seen.entries())
    .map(([baseVar, label]) => ({ baseVar, label }))
    .sort((a, b) => a.baseVar.localeCompare(b.baseVar));
}

// Level 2: unique Group + label_clean for a given Base Var
function buildGroupsForBaseVar(rows, baseVar) {
  const seen = new Map();
  for (const r of rows) {
    if (r.baseVar === baseVar && r.group && !seen.has(r.group)) {
      seen.set(r.group, r.label);
    }
  }
  return Array.from(seen.entries())
    .map(([group, label]) => ({ group, label }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

// Level 3: all rows for a given Group
function getVarsForGroup(rows, group) {
  return rows.filter(r => r.group === group);
}

// ── Label string ──────────────────────────────────────────────────────────────
function buildVarLabel(v, labelFormat, series) {
  const seriesLabel = series === "5yr" ? "ACS 5-yr Est" : "ACS 1-yr Est";
  const baseLabel = v.detailVar || v.displayName || v.id;
  const group = v.row?.group || v.id.replace(/[_\d]+.*/, "");
  if (labelFormat === "short")       return baseLabel;
  if (labelFormat === "with_id")     return baseLabel + " [" + v.id + "]";
  if (labelFormat === "full_acs")    return baseLabel + " [" + v.id + ", " + seriesLabel + "]";
  if (labelFormat === "with_table")  return group + ": " + baseLabel + " [" + v.id + "]";
  return baseLabel;
}

// ── Name suggestion ───────────────────────────────────────────────────────────
function toCamelCase(str) {
  return str.replace(/_+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
}

function suggestShortName(bothVar, id) {
  const isPercent = id && (id.toUpperCase().endsWith("PE") || id.toUpperCase().endsWith("P"));
  let s = bothVar || "";
  s = s.replace(/^est_tot_/, "").replace(/^perc_/, "").replace(/^est_/, "");
  const tokens = s.split("_").filter(t => t.length > 1 && !/^\d+$/.test(t)).slice(0, 3);
  if (!tokens.length) return isPercent ? "percVar" : "estVar";
  const base = toCamelCase(tokens.join("_"));
  return isPercent ? "perc" + base.charAt(0).toUpperCase() + base.slice(1) : base;
}

// ── R script ──────────────────────────────────────────────────────────────────
function generateRScript(queryVars, geography, state, years, wide, labelFormat, series) {
  const stripE = id => id.endsWith("E") ? id.slice(0,-1) : id;
  const tableName = geography
    ? "acs_" + series + "_by_" + geography.replace(/[^a-zA-Z0-9]/g,"_") + (wide ? "_wide" : "")
    : "acs_data";
  const multiYear = years.length > 1;
  const ind = multiYear ? "      " : "  ";
  const seen = new Set();
  const varLines = queryVars.map(v => {
    let name = v.shortName || v.id;
    if (seen.has(name)) name = name + "_" + v.id.replace(/\W/g,"");
    seen.add(name);
    return ind + "  " + name + ' = "' + stripE(v.id) + '"';
  }).join(",\n");
  const surveyLine = ind + 'survey = "' + (series === "5yr" ? "acs5" : "acs1") + '",\n';
  const geoLine    = geography ? ind + 'geography = "' + geography + '",\n' : "";
  const stateLine  = state     ? ind + 'state = "' + state + '",\n' : "";
  const wideLine   = wide      ? ind + 'output = "wide",\n' : "";
  let getAcsBlock;
  if (!multiYear) {
    const yearLine = years.length === 1 ? "  year = " + years[0] + "\n" : "";
    getAcsBlock = tableName + " <- get_acs(\n" + surveyLine + geoLine + stateLine + wideLine +
      "  variables = c(\n" + varLines + "\n  ),\n" + yearLine + ")";
  } else {
    const yearsVec = "c(" + years.join(", ") + ")";
    getAcsBlock = "years <- " + yearsVec + "\n\n" + tableName +
      " <- map_dfr(years, \\(yr) {\n  get_acs(\n" + surveyLine + geoLine + stateLine + wideLine +
      "    variables = c(\n" + varLines + "\n    ),\n    year = yr\n  ) |>\n    mutate(year = yr)\n})";
  }
  const labelLines = queryVars.map(v => {
    const name = v.shortName || v.id;
    return '  ' + name + 'E = "' + buildVarLabel(v, labelFormat, series).replace(/"/g,"'") + '"';
  }).join(",\n");
  return "library(tidyverse)\nlibrary(tidycensus)\nlibrary(labelled)\n\n" +
    getAcsBlock + "\n\nvar_label(" + tableName + ") <- list(\n" + labelLines + "\n)";
}

// ── Stata script ──────────────────────────────────────────────────────────────
function detectProduct(id) {
  const u = id.toUpperCase();
  if (u.startsWith("DP")) return "profile";
  if (u.startsWith("S"))  return "subject";
  if (u.startsWith("CP")) return "cprofile";
  return "";
}

function generateStataScript(queryVars, geography, state, years, labelFormat, series) {
  const sample = series === "5yr" ? 5 : 1;
  const seriesLabel = series === "5yr" ? "5-Year" : "1-Year";
  const stripE = id => id.endsWith("E") ? id.slice(0,-1) : id;
  const stataId = id => stripE(id).toLowerCase();
  const returnedName = id => stataId(id) + "e";
  const geoStr = GEO_STATA[geography] || geography || "us";
  const varIds = queryVars.map(v => stataId(v.id)).join(" ");
  const products = [...new Set(queryVars.map(v => detectProduct(v.id)).filter(Boolean))];
  const product = products[0] || "";
  const mixedWarning = products.length > 1
    ? "* WARNING: Mixed variable products (" + products.join(", ") + "). Split into separate getcensus calls.\n" : "";
  const multiYear = years.length > 1;
  const yearsLine = multiYear ? "local years " + years.join(" ") + "\n" : "";
  let yearOpt = "";
  if (multiYear)           yearOpt = "year(" + "`" + "years" + "'" + ")";
  else if (years.length===1) yearOpt = "year(" + years[0] + ")";
  const opts = [];
  if (product)  opts.push("product(" + product + ")");
  opts.push("sample(" + sample + ")");
  if (yearOpt)  opts.push(yearOpt);
  opts.push("geo(" + geoStr + ")");
  if (state)    opts.push("statefips(" + state + ")");
  opts.push('key("' + "`" + "apikey" + "'" + '")');
  const optLines = opts.map((o,i) => "    " + o + (i < opts.length-1 ? " ///" : "")).join("\n");
  const renameLines = queryVars.map(v => "rename " + returnedName(v.id) + " " + (v.shortName||v.id)).join("\n");
  const labelLines = queryVars.map(v => {
    const name = v.shortName || v.id;
    return 'label variable ' + name + ' "' + buildVarLabel(v, labelFormat, series).replace(/"/g,"'") + '"';
  }).join("\n");
  return "* ACS " + seriesLabel + " Estimates — " + (geography||"geography not set") + "\n" +
    "* Generated by ACS Variable Explorer\n\n" +
    'local apikey "<your_api_key>"\n' + yearsLine + "\n" +
    mixedWarning +
    "getcensus " + varIds + " ///\n" + optLines + "\n\n" +
    "* Rename to short names\n" + renameLines + "\n\n" +
    "* Label variables\n" + labelLines;
}

// ── Clipboard ─────────────────────────────────────────────────────────────────
function clipboardCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
  } catch(e) {}
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const selStyle = { fontSize:13, border:"1.5px solid #cbd5e1", borderRadius:7, padding:"6px 10px", background:"white", color:"#334155", cursor:"pointer" };

function NavBtn({ active, onClick, label, color="#1e3a5f" }) {
  return (
    <button onClick={onClick} style={{ background:active?color:"white", color:active?"white":color, border:"1.5px solid "+color, borderRadius:6, padding:"4px 12px", cursor:"pointer", fontSize:13, fontWeight:600 }}>
      {label}
    </button>
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
  const toggle = y => onChange(years.includes(y) ? years.filter(x=>x!==y) : [...years,y].sort((a,b)=>a-b));
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <div onClick={()=>setOpen(v=>!v)} style={{ ...selStyle, display:"flex", alignItems:"center", gap:6, minWidth:160, maxWidth:280, flexWrap:"wrap", cursor:"pointer", userSelect:"none" }}>
        {years.length===0 ? <span style={{ color:"#94a3b8" }}>Year(s)…</span>
          : years.map(y => (
            <span key={y} style={{ background:"#1e3a5f", color:"white", borderRadius:4, padding:"1px 7px", fontSize:12, display:"inline-flex", alignItems:"center", gap:3 }}>
              {y}<span onMouseDown={e=>{e.stopPropagation();toggle(y);}} style={{ cursor:"pointer", opacity:.75 }}>×</span>
            </span>
          ))}
        {years.length>0 && <span onMouseDown={e=>{e.stopPropagation();onChange([]);}} style={{ marginLeft:"auto", fontSize:12, color:"#94a3b8", cursor:"pointer" }}>✕</span>}
      </div>
      {open && (
        <div onMouseDown={e=>e.stopPropagation()} style={{ position:"absolute", zIndex:999, top:"calc(100% + 4px)", left:0, background:"white", border:"1.5px solid #cbd5e1", borderRadius:8, boxShadow:"0 4px 16px rgba(0,0,0,.1)", maxHeight:220, overflowY:"auto", minWidth:130 }}>
          {YEARS.map(y => (
            <div key={y} onMouseDown={e=>{e.stopPropagation();e.preventDefault();toggle(y);}}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 12px", cursor:"pointer", fontSize:13, color:"#334155", background:years.includes(y)?"#eff6ff":"white", userSelect:"none" }}>
              <input type="checkbox" readOnly checked={years.includes(y)} style={{ accentColor:"#1e3a5f", pointerEvents:"none" }} />{y}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Var chip ──────────────────────────────────────────────────────────────────
function VarChip({ v, onRemove, onRename, isDuplicate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(v.shortName);
  const inputRef = useRef(null);
  const isPercent = v.id.toUpperCase().endsWith("PE") || v.id.toUpperCase().endsWith("P");
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);
  const commit = () => {
    const cleaned = draft.trim().replace(/[^a-zA-Z0-9_]/g,"") || v.shortName;
    setDraft(cleaned); onRename(cleaned); setEditing(false);
  };
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:0, background:isDuplicate?"#fff1f1":"#eff6ff", border:"1px solid "+(isDuplicate?"#fca5a5":"#bfdbfe"), borderRadius:8, padding:"5px 8px", fontSize:12, maxWidth:460 }}>
      {isPercent
        ? <span style={{ background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0", borderRadius:4, padding:"0 5px", fontSize:11, fontWeight:700, marginRight:6, flexShrink:0 }}>%</span>
        : <span style={{ background:"#fefce8", color:"#92400e", border:"1px solid #fde68a", borderRadius:4, padding:"0 5px", fontSize:11, fontWeight:700, marginRight:6, flexShrink:0 }}>est</span>}
      {editing ? (
        <input ref={inputRef} value={draft} onChange={e=>setDraft(e.target.value)}
          onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape"){setDraft(v.shortName);setEditing(false);}}}
          style={{ fontSize:12, fontWeight:700, color:"#1e40af", fontFamily:"monospace", border:"none", borderBottom:"2px solid #3b82f6", outline:"none", background:"transparent", width:Math.max(60,draft.length*8)+"px", padding:0 }} />
      ) : (
        <span onClick={()=>setEditing(true)} style={{ fontWeight:700, color:isDuplicate?"#dc2626":"#1e40af", fontFamily:"monospace", cursor:"text", borderBottom:"1.5px dashed #93c5fd", marginRight:4 }}>{v.shortName}</span>
      )}
      <span onClick={()=>setEditing(true)} style={{ cursor:"pointer", color:"#94a3b8", fontSize:13, marginLeft:2 }}>✏️</span>
      <span style={{ color:"#94a3b8", margin:"0 6px" }}>·</span>
      <code style={{ color:"#64748b", fontSize:11 }}>{v.id}</code>
      <span style={{ color:"#94a3b8", margin:"0 6px" }}>—</span>
      <span style={{ color:"#475569", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{v.detailVar||v.displayName}</span>
      {isDuplicate && <span style={{ color:"#dc2626", fontSize:11, marginLeft:6, flexShrink:0 }}>⚠ duplicate</span>}
      <span onClick={onRemove} style={{ cursor:"pointer", color:"#94a3b8", fontSize:15, lineHeight:1, marginLeft:8, flexShrink:0 }}>×</span>
    </div>
  );
}

// ── Query basket ──────────────────────────────────────────────────────────────
function QueryBasket({ queryVars, onRemove, onClear, onRename, geography, selState, years, wide, series }) {
  const [rScript, setRScript]         = useState("");
  const [stataScript, setStataScript] = useState("");
  const [scriptType, setScriptType]   = useState("r");
  const [rCopied, setRCopied]         = useState(false);
  const [stataCopied, setStataCopied] = useState(false);
  const [genError, setGenError]       = useState("");
  const [labelFormat, setLabelFormat] = useState("with_id");

  const duplicateNames = useMemo(() => {
    const counts = {};
    queryVars.forEach(v => { counts[v.shortName]=(counts[v.shortName]||0)+1; });
    return new Set(Object.keys(counts).filter(k=>counts[k]>1));
  }, [queryVars]);

  const tryGenerate = useCallback(() => {
    if (!geography||years.length===0||queryVars.length===0) return;
    if (duplicateNames.size>0) { setGenError("Fix duplicate variable names before generating."); return; }
    setGenError("");
    setRScript(generateRScript(queryVars,geography,selState,years,wide,labelFormat,series));
    setStataScript(generateStataScript(queryVars,geography,selState,years,labelFormat,series));
  }, [queryVars,geography,selState,years,wide,labelFormat,duplicateNames,series]);

  useEffect(() => { tryGenerate(); }, [tryGenerate]);

  const handleGenerate = () => {
    const missing = [];
    if (!geography) missing.push("Geography");
    if (years.length===0) missing.push("Year(s)");
    if (missing.length) { setGenError("Please select: "+missing.join(" and ")); return; }
    if (duplicateNames.size>0) { setGenError("Fix duplicate variable names before generating."); return; }
    tryGenerate();
  };

  const activeScript = scriptType==="r" ? rScript : stataScript;
  const handleCopy = () => {
    clipboardCopy(activeScript);
    if (scriptType==="r") { setRCopied(true); setTimeout(()=>setRCopied(false),1500); }
    else { setStataCopied(true); setTimeout(()=>setStataCopied(false),1500); }
  };
  const isCopied = scriptType==="r" ? rCopied : stataCopied;

  if (queryVars.length===0) return null;
  return (
    <div style={{ background:"white", border:"2px solid #1e3a5f", borderRadius:12, padding:16, marginBottom:20 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#1e3a5f", textTransform:"uppercase", letterSpacing:"0.06em" }}>
          Query · {queryVars.length} variable{queryVars.length!==1?"s":""}
          {duplicateNames.size>0 && <span style={{ color:"#dc2626", marginLeft:8, fontSize:12, textTransform:"none", fontWeight:600 }}>⚠ {duplicateNames.size} duplicate name{duplicateNames.size>1?"s":""}</span>}
        </span>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:11, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>Label format:</span>
            <select value={labelFormat} onChange={e=>setLabelFormat(e.target.value)} style={{ ...selStyle, fontSize:12, padding:"4px 8px" }}>
              {LABEL_FORMAT_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button onClick={handleGenerate} style={{ background:"#7c3aed", color:"white", border:"none", borderRadius:7, padding:"7px 16px", cursor:"pointer", fontWeight:700, fontSize:13 }}>Generate Scripts</button>
          <button onClick={onClear} style={{ background:"white", color:"#dc2626", border:"1.5px solid #fca5a5", borderRadius:7, padding:"7px 12px", cursor:"pointer", fontSize:12, fontWeight:600 }}>Clear all</button>
        </div>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:genError||activeScript?12:0 }}>
        {queryVars.map(v=>(
          <VarChip key={v.uid} v={v} onRemove={()=>onRemove(v.uid)} onRename={name=>onRename(v.uid,name)} isDuplicate={duplicateNames.has(v.shortName)} />
        ))}
      </div>
      {genError && <p style={{ margin:"0 0 10px", fontSize:12, color:"#dc2626" }}>{genError}</p>}
      {(rScript||stataScript) && (
        <div style={{ background:"#1e1e2e", borderRadius:10, overflow:"hidden" }}>
          <div style={{ display:"flex", borderBottom:"1px solid #2d2d44" }}>
            {[{key:"r",label:"R  ·  tidycensus"},{key:"stata",label:"Stata  ·  getcensus"}].map(tab=>(
              <button key={tab.key} onClick={()=>setScriptType(tab.key)}
                style={{ padding:"9px 18px", fontSize:12, fontWeight:700, cursor:"pointer", border:"none", borderBottom:scriptType===tab.key?"2px solid #a78bfa":"2px solid transparent", background:"transparent", color:scriptType===tab.key?"#a78bfa":"#64748b", letterSpacing:"0.04em" }}>
                {tab.label}
              </button>
            ))}
            <div style={{ flex:1 }} />
            <button onClick={handleCopy} style={{ margin:"6px 10px", background:isCopied?"#10b981":"#7c3aed", color:"white", border:"none", borderRadius:6, padding:"5px 14px", cursor:"pointer", fontWeight:700, fontSize:12 }}>
              {isCopied?"✓ Copied!":"Copy"}
            </button>
          </div>
          <pre style={{ margin:0, padding:14, fontSize:12, color:"#e2e8f0", fontFamily:"monospace", whiteSpace:"pre-wrap", lineHeight:1.65, textAlign:"left" }}>{activeScript}</pre>
        </div>
      )}
    </div>
  );
}

// ── Reusable list panel ───────────────────────────────────────────────────────
function ListPanel({ header, items, onSelect, renderLeft, renderRight, isSelected, isPinned }) {
  return (
    <div style={{ background:"white", borderRadius:10, border:"1.5px solid #cbd5e1", overflow:"hidden", marginBottom:14 }}>
      <div style={{ padding:"9px 16px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
        <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{header} · {items.length}</span>
      </div>
      {items.map((item, i) => {
        const selected = isSelected ? isSelected(item) : false;
        const pinned   = isPinned   ? isPinned(item)   : false;
        return (
          <div key={i} onClick={()=>onSelect(item)}
            style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 16px", borderBottom:i<items.length-1?"1px solid #f1f5f9":"none", cursor:"pointer", background:selected?"#eff6ff":pinned?"#fafbff":"white" }}
            onMouseEnter={e=>{ if(!selected) e.currentTarget.style.background="#f8fafc"; }}
            onMouseLeave={e=>{ e.currentTarget.style.background=selected?"#eff6ff":pinned?"#fafbff":"white"; }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>{renderLeft(item)}</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0, marginLeft:12 }}>{renderRight(item)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [series, setSeries]             = useState("1yr");
  const [csvText, setCsvText]           = useState("");
  const [committed, setCommitted]       = useState("");
  const [loading, setLoading]           = useState(true);
  const [fetchError, setFetchError]     = useState("");

  // Navigation: 3 levels
  const [selectedBaseVar, setSelectedBaseVar] = useState(null); // { baseVar, label }
  const [selectedGroup, setSelectedGroup]     = useState(null); // { group, label }
  const [selectedVar, setSelectedVar]         = useState(null); // full row

  const [search, setSearch]     = useState("");
  const [added, setAdded]       = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [geography, setGeography]   = useState("");
  const [selState, setSelState]     = useState("");
  const [years, setYears]           = useState([]);
  const [wide, setWide]             = useState(false);
  const [queryVars, setQueryVars]   = useState([]);

  const activeSeries = ACS_SERIES.find(s => s.key === series);

  const resetNav = () => { setSelectedBaseVar(null); setSelectedGroup(null); setSelectedVar(null); };

  useEffect(() => {
    setLoading(true); setFetchError(""); setCommitted(""); setCsvText("");
    resetNav(); setSearch(""); setQueryVars([]);
    fetch(activeSeries.file)
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(text => { const t=text.replace(/\r\n/g,"\n").replace(/\r/g,"\n"); setCsvText(t); setCommitted(t); })
      .catch(e => setFetchError(e.message))
      .finally(() => setLoading(false));
  }, [series]);

  const parsed = useMemo(() => parseCSV(committed), [committed]);
  const rows   = parsed.rows || [];

  // Level 1
  const baseVars = useMemo(() => buildBaseVars(rows), [rows]);

  // Level 2
  const groupsForBase = useMemo(() =>
    selectedBaseVar ? buildGroupsForBaseVar(rows, selectedBaseVar.baseVar) : [],
  [rows, selectedBaseVar]);

  // Level 3
  const varsForGroup = useMemo(() =>
    selectedGroup ? getVarsForGroup(rows, selectedGroup.group) : [],
  [rows, selectedGroup]);

  // Search: match id, detailVar, label, baseVar
  const searchResults = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return rows.filter(r =>
      r.id.toLowerCase().includes(q) ||
      r.detailVar.toLowerCase().includes(q) ||
      r.label.toLowerCase().includes(q) ||
      r.baseVar.toLowerCase().includes(q)
    ).slice(0, 60);
  }, [rows, search]);

  const alreadyInQuery = selectedVar && queryVars.some(v => v.id === selectedVar.id);

  const handleAddToQuery = () => {
    if (!selectedVar || alreadyInQuery) return;
    const suggested = suggestShortName(selectedVar.bothVar || "", selectedVar.id);
    setQueryVars(prev => [...prev, {
      uid: selectedVar.id + "-" + Date.now(),
      id: selectedVar.id,
      shortName: suggested,
      displayName: selectedVar.detailVar || selectedVar.label,
      detailVar: selectedVar.detailVar,
      row: selectedVar,
    }]);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  const handleRename = (uid, newName) => {
    setQueryVars(prev => prev.map(v => v.uid===uid ? {...v, shortName:newName} : v));
  };

  const handleFile = e => {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{ const t=ev.target.result.replace(/\r\n/g,"\n").replace(/\r/g,"\n"); setCsvText(t); };
    reader.readAsText(file);
  };

  const hasData = rows.length > 0;
  const level = !selectedBaseVar ? 1 : !selectedGroup ? 2 : 3;
  const isPercent = selectedVar && (selectedVar.id.toUpperCase().endsWith("PE") || selectedVar.id.toUpperCase().endsWith("P"));

  return (
    <div style={{ fontFamily:"system-ui, sans-serif", maxWidth:900, margin:"0 auto", padding:24, background:"#f8fafc", minHeight:"100vh" }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
        <div>
          <h1 style={{ margin:0, fontSize:30, fontWeight:700, color:"#1e3a5f" }}>Variable Explorer</h1>
          <p style={{ margin:"4px 0 0", fontSize:13, color:"#64748b" }}>
            {hasData ? rows.length.toLocaleString()+" variables · "+baseVars.length+" tables" : "Upload your CSV to get started"}
          </p>
          <p style={{ margin:"8px 0 0", fontSize:13, color:"#475569", maxWidth:560, lineHeight:1.6 }}>
            Browse ACS tables and demographic breakdowns, select variables, and export a{" "}
            <code style={{ background:"#f1f5f9", padding:"1px 5px", borderRadius:4 }}>tidycensus</code> R or{" "}
            <code style={{ background:"#f1f5f9", padding:"1px 5px", borderRadius:4 }}>getcensus</code> Stata script.
          </p>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
          <button onClick={()=>setShowUpload(v=>!v)}
            style={{ background:showUpload?"#1e3a5f":"white", color:showUpload?"white":"#1e3a5f", border:"1.5px solid #1e3a5f", borderRadius:8, padding:"7px 16px", cursor:"pointer", fontSize:13, fontWeight:600 }}>
            {showUpload?"Hide Upload":"Upload CSV"}
          </button>
          <a href="https://github.com/kaleyjoss/acs_variable_explorer" target="_blank" rel="noopener noreferrer"
            style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:12, color:"#1e3a5f", textDecoration:"none", border:"1.5px solid #1e3a5f", borderRadius:7, padding:"5px 11px", background:"white", fontWeight:600 }}
            onMouseEnter={e=>{e.currentTarget.style.background="#f0f4f8";}}
            onMouseLeave={e=>{e.currentTarget.style.background="white";}}>
            <svg height="14" width="14" viewBox="0 0 16 16" fill="#1e3a5f">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            GitHub
          </a>
        </div>
      </div>

      {/* Upload */}
      {showUpload && (
        <div style={{ background:"white", border:"1.5px solid #cbd5e1", borderRadius:10, padding:16, marginBottom:20 }}>
          <p style={{ margin:"0 0 8px", fontSize:13, color:"#475569" }}>
            Upload <strong>{activeSeries.file.replace("/","")}</strong> — needs columns: <strong>id</strong>, <strong>group</strong>, <strong>label_clean</strong>, <strong>detail_varname</strong>, <strong>both_varname</strong>, <strong>base var</strong>, <strong>demographic letter</strong>.
          </p>
          <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ fontSize:13, marginBottom:8, display:"block" }} />
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} placeholder="…or paste CSV text here"
            style={{ width:"100%", height:100, fontSize:12, fontFamily:"monospace", border:"1px solid #cbd5e1", borderRadius:6, padding:8, boxSizing:"border-box", resize:"vertical" }} />
          {parsed.error && <p style={{ color:"#dc2626", fontSize:13, margin:"6px 0 0" }}>{parsed.error}</p>}
          <button onClick={()=>{ setCommitted(csvText); setShowUpload(false); resetNav(); }}
            style={{ marginTop:10, background:"#1e3a5f", color:"white", border:"none", borderRadius:7, padding:"8px 20px", cursor:"pointer", fontWeight:600, fontSize:13 }}>
            Load Data
          </button>
        </div>
      )}

      {loading  && <p style={{ color:"#64748b", fontSize:14 }}>Loading variables…</p>}
      {fetchError && <p style={{ color:"#dc2626", fontSize:13 }}>Could not auto-load CSV ({fetchError}) — upload manually above.</p>}
      {!hasData && !loading && !showUpload && <p style={{ color:"#dc2626", fontSize:14 }}>No data loaded.</p>}

      {hasData && (<>
        {/* Series tabs */}
        <div style={{ display:"flex", marginBottom:16, borderRadius:10, overflow:"hidden", border:"1.5px solid #cbd5e1" }}>
          {ACS_SERIES.map(s => (
            <button key={s.key} onClick={()=>setSeries(s.key)}
              style={{ flex:1, padding:"11px 0", fontSize:14, fontWeight:700, cursor:"pointer", border:"none", borderRight:s.key==="1yr"?"1.5px solid #cbd5e1":"none", background:series===s.key?s.color:"white", color:series===s.key?"white":"#64748b" }}>
              {s.label}
              {series===s.key && <span style={{ marginLeft:8, fontSize:11, opacity:0.85, fontWeight:400 }}>({rows.length.toLocaleString()} vars)</span>}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position:"relative", marginBottom:12 }}>
          <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"#94a3b8" }}>🔍</span>
          <input placeholder="Search variables, tables, or descriptions…" value={search}
            onChange={e=>{ setSearch(e.target.value); if(e.target.value) resetNav(); }}
            style={{ width:"100%", boxSizing:"border-box", padding:"11px 12px 11px 38px", fontSize:14, border:"1.5px solid #cbd5e1", borderRadius:10, outline:"none", background:"white" }} />
          {search && <button onClick={()=>setSearch("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:20, color:"#94a3b8" }}>×</button>}
        </div>

        {/* ACS Params */}
        <div style={{ background:"white", border:"1.5px solid #cbd5e1", borderRadius:10, padding:"12px 16px", marginBottom:16, display:"flex", flexWrap:"wrap", gap:12, alignItems:"center" }}>
          <span style={{ fontSize:12, fontWeight:700, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em", flexShrink:0 }}>ACS Params</span>
          <select value={geography} onChange={e=>setGeography(e.target.value)} style={selStyle}>
            <option value="">Geography… *</option>
            {GEOGRAPHIES.map(g=><option key={g} value={g}>{g}</option>)}
          </select>
          <select value={selState} onChange={e=>setSelState(e.target.value)} style={selStyle}>
            <option value="">State…</option>
            {STATES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <YearPicker years={years} onChange={setYears} />
          <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#334155", cursor:"pointer", userSelect:"none" }}>
            <input type="checkbox" checked={wide} onChange={e=>setWide(e.target.checked)} style={{ accentColor:"#1e3a5f", width:14, height:14 }} />Wide
          </label>
          {years.length>1 && <span style={{ fontSize:12, color:"#7c3aed", background:"#f5f3ff", border:"1px solid #ddd6fe", borderRadius:6, padding:"3px 9px", fontWeight:600 }}>map_dfr · {years.length} yrs</span>}
        </div>

        {/* Query basket */}
        <QueryBasket queryVars={queryVars}
          onRemove={uid=>setQueryVars(prev=>prev.filter(v=>v.uid!==uid))}
          onClear={()=>setQueryVars([])}
          onRename={handleRename}
          geography={geography} selState={selState} years={years} wide={wide} series={series} />

        {/* ── SEARCH RESULTS ── */}
        {search && (
          <div style={{ background:"white", borderRadius:10, border:"1.5px solid #cbd5e1", overflow:"hidden", marginBottom:16 }}>
            <div style={{ padding:"9px 16px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
              <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>RESULTS · {searchResults.length}{searchResults.length===60?" (first 60)":""}</span>
            </div>
            {searchResults.length===0
              ? <p style={{ padding:24, color:"#94a3b8", textAlign:"center", margin:0 }}>No results for "{search}"</p>
              : searchResults.map((r,i) => (
                <div key={r.id} onClick={()=>{ setSearch(""); setSelectedBaseVar({baseVar:r.baseVar,label:r.label}); setSelectedGroup({group:r.group,label:r.label}); setSelectedVar(r); }}
                  style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 16px", borderBottom:i<searchResults.length-1?"1px solid #f1f5f9":"none", cursor:"pointer", background:"white" }}
                  onMouseEnter={e=>{e.currentTarget.style.background="#f8fafc";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="white";}}>
                  <div>
                    <div style={{ fontSize:13, color:"#334155", fontWeight:500 }}>{r.detailVar||r.label}</div>
                    <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{r.baseVar} › {r.group}</div>
                  </div>
                  <code style={{ background:"#eff6ff", color:"#1e40af", padding:"3px 8px", borderRadius:5, fontSize:12, fontWeight:700, flexShrink:0, marginLeft:12 }}>{r.id}</code>
                </div>
              ))}
          </div>
        )}

        {/* ── MAIN BROWSER ── */}
        {!search && (<>

          {/* Breadcrumb */}
          {level > 1 && (
            <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:14, flexWrap:"wrap" }}>
              <NavBtn active={false} onClick={resetNav} label="All Tables" />
              {selectedBaseVar && (<>
                <span style={{ color:"#94a3b8" }}>›</span>
                <NavBtn active={level===2} onClick={()=>{ setSelectedGroup(null); setSelectedVar(null); }}
                  label={selectedBaseVar.baseVar + " — " + selectedBaseVar.label} />
              </>)}
              {selectedGroup && (<>
                <span style={{ color:"#94a3b8" }}>›</span>
                <NavBtn active={level===3} onClick={()=>setSelectedVar(null)}
                  label={selectedGroup.group} />
              </>)}
            </div>
          )}

          {/* Selected variable box */}
          {selectedVar && (
            <div style={{ background:"#eff6ff", border:"1.5px solid #bfdbfe", borderRadius:10, padding:"14px 18px", marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <p style={{ margin:0, fontSize:11, color:"#3b82f6", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Selected Variable</p>
                    {isPercent
                      ? <span style={{ background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0", borderRadius:4, padding:"1px 7px", fontSize:11, fontWeight:700 }}>% Percent</span>
                      : <span style={{ background:"#fefce8", color:"#92400e", border:"1px solid #fde68a", borderRadius:4, padding:"1px 7px", fontSize:11, fontWeight:700 }}>Estimate</span>}
                  </div>
                  <p style={{ margin:0, fontSize:22, fontWeight:700, color:"#1e40af", fontFamily:"monospace" }}>{selectedVar.id}</p>
                  <p style={{ margin:"3px 0 0", fontSize:13, color:"#334155" }}>{selectedVar.detailVar}</p>
                  <p style={{ margin:"2px 0 0", fontSize:11, color:"#94a3b8" }}>{selectedVar.baseVar} › {selectedVar.group} · {selectedVar.label}</p>
                </div>
                <button onClick={handleAddToQuery} disabled={!!alreadyInQuery}
                  style={{ background:added?"#10b981":alreadyInQuery?"#e2e8f0":"#1e3a5f", color:alreadyInQuery?"#94a3b8":"white", border:"none", borderRadius:8, padding:"10px 18px", cursor:alreadyInQuery?"default":"pointer", fontWeight:700, fontSize:13, whiteSpace:"nowrap", flexShrink:0 }}>
                  {added?"✓ Added!":alreadyInQuery?"Already in query":"+ Add to Query"}
                </button>
              </div>
            </div>
          )}

          {/* Level 1 — Base Var list */}
          {level===1 && (
            <ListPanel
              header="ALL TABLES"
              items={baseVars}
              onSelect={item=>{ setSelectedBaseVar(item); setSelectedGroup(null); setSelectedVar(null); }}
              renderLeft={item=>(
                <>
                  <code style={{ background:"#f1f5f9", color:"#1e3a5f", padding:"2px 7px", borderRadius:5, fontSize:12, fontWeight:700, flexShrink:0 }}>{item.baseVar}</code>
                  <span style={{ fontSize:14, color:"#334155" }}>{item.label}</span>
                </>
              )}
              renderRight={item=>{
                const cnt = rows.filter(r=>r.baseVar===item.baseVar).length;
                return (<>
                  <span style={{ fontSize:11, color:"#94a3b8", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:6, padding:"2px 8px" }}>{cnt} vars</span>
                  <span style={{ color:"#94a3b8", fontSize:18 }}>›</span>
                </>);
              }}
            />
          )}

          {/* Level 2 — Demographic groups for a base var */}
          {level===2 && (
            <ListPanel
              header={"DEMOGRAPHIC BREAKDOWNS OF " + selectedBaseVar.baseVar}
              items={groupsForBase}
              onSelect={item=>{ setSelectedGroup(item); setSelectedVar(null); }}
              renderLeft={item=>(
                <>
                  <code style={{ background:"#f1f5f9", color:"#5b21b6", padding:"2px 7px", borderRadius:5, fontSize:12, fontWeight:700, flexShrink:0 }}>{item.group}</code>
                  <span style={{ fontSize:14, color:"#334155" }}>{item.label}</span>
                </>
              )}
              renderRight={item=>{
                const cnt = rows.filter(r=>r.group===item.group).length;
                return (<>
                  <span style={{ fontSize:11, color:"#94a3b8", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:6, padding:"2px 8px" }}>{cnt} vars</span>
                  <span style={{ color:"#94a3b8", fontSize:18 }}>›</span>
                </>);
              }}
            />
          )}

          {/* Level 3 — Variables within a group */}
          {level===3 && (
            <ListPanel
              header={"VARIABLES IN " + selectedGroup.group}
              items={varsForGroup}
              onSelect={item=>setSelectedVar(item)}
              isSelected={item=>selectedVar?.id===item.id}
              renderLeft={item=>{
                const isP = item.id.toUpperCase().endsWith("PE")||item.id.toUpperCase().endsWith("P");
                const inQ = queryVars.some(v=>v.id===item.id);
                return (<>
                  {isP
                    ? <span style={{ background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0", borderRadius:4, padding:"0 5px", fontSize:10, fontWeight:700, flexShrink:0 }}>%</span>
                    : <span style={{ background:"#fefce8", color:"#92400e", border:"1px solid #fde68a", borderRadius:4, padding:"0 5px", fontSize:10, fontWeight:700, flexShrink:0 }}>est</span>}
                  <span style={{ fontSize:13, color:"#334155", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.bothVar || item.detailVar || "(no label)"}</span>
                  {inQ && <span style={{ fontSize:10, color:"#7c3aed", background:"#f5f3ff", border:"1px solid #ddd6fe", borderRadius:6, padding:"1px 6px", flexShrink:0 }}>in query</span>}
                </>);
              }}
              renderRight={item=>(
                <code style={{ background:"#eff6ff", color:"#1e40af", padding:"3px 8px", borderRadius:5, fontSize:12, fontWeight:700 }}>{item.id}</code>
              )}
            />
          )}

        </>)}
      </>)}
    </div>
  );
}
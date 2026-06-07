/* ============================================================
   AIInput — animated prompt composer, HelpLink-styled.
   Three layout variants: "stacked" | "inline" | "pill".
   Props: value, onChange, onSubmit, placeholder, variant,
          radius, showAttach, accentOnModel, model, onModel,
          busy, onStop, dense
   ============================================================ */
const { useState: aiUseState, useRef: aiUseRef, useEffect: aiUseEffect, useCallback: aiUseCallback } = React;

// This build only ever talks to a local Ollama instance — the dropdown is
// populated from /api/models at runtime. AI_MODELS stays empty so nothing
// fakes the presence of a cloud model when Ollama hasn't reported any yet.
const AI_MODELS = [];
window.AI_MODELS = AI_MODELS;

function useAutoResize(minH, maxH) {
  const ref = aiUseRef(null);
  const resize = aiUseCallback((reset) => {
    const el = ref.current;
    if (!el) return;
    if (reset) { el.style.height = minH + "px"; return; }
    el.style.height = minH + "px";
    el.style.height = Math.max(minH, Math.min(el.scrollHeight, maxH)) + "px";
  }, [minH, maxH]);
  aiUseEffect(() => { if (ref.current) ref.current.style.height = minH + "px"; }, [minH]);
  return [ref, resize];
}

function ModelDropdown({
  model, onModel, accentOnModel, openUp = true, compact = false,
  models = AI_MODELS, loading = false, error = null,
}) {
  const [open, setOpen] = aiUseState(false);
  const [search, setSearch] = aiUseState("");
  const wrapRef = aiUseRef(null);
  const searchRef = aiUseRef(null);
  const current = models.find(m => m.name === model) || null;
  const filtered = search.trim()
    ? models.filter(m => m.name.toLowerCase().includes(search.trim().toLowerCase()))
    : models;

  aiUseEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  aiUseEffect(() => {
    if (open) { setSearch(""); if (searchRef.current) searchRef.current.focus(); }
  }, [open]);

  const triggerStyle = {
    display: "inline-flex", alignItems: "center", gap: 7,
    height: 32, padding: compact ? "0 8px" : "0 10px", maxWidth: compact ? 32 : 220,
    fontFamily: "var(--font-body)", fontSize: "var(--text-sm)", fontWeight: 500,
    color: accentOnModel ? "var(--text)" : "var(--text-muted)",
    background: accentOnModel ? "var(--accent-soft)" : "transparent",
    border: accentOnModel ? "1px solid var(--accent-line)" : "1px solid transparent",
    borderRadius: "var(--radius-md)", cursor: "pointer", whiteSpace: "nowrap",
    transition: "background .15s ease, color .15s ease, border-color .15s ease",
  };

  const label = current ? current.name : loading ? "Loading models…" : error ? "Ollama unavailable" : "No local models";

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button type="button" style={triggerStyle} onClick={() => setOpen(o => !o)}
        className="ai-model-trigger"
        title={label}
        aria-haspopup="listbox" aria-expanded={open}>
        <span key={label} className="ai-model-label" style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <span style={{ display: "inline-flex", color: "var(--text)", flex: "none" }}><ModelIcon brand={current ? current.brand : "ollama"} size={16} /></span>
          {!compact && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>}
        </span>
        <span style={{ display: "inline-flex", flex: "none", transition: "transform .18s ease", transform: open ? "rotate(180deg)" : "none", opacity: .5 }}>
          <Icon name="chevronDown" size={14} />
        </span>
      </button>

      {open && (
        <div role="listbox" className="ai-menu" style={{
          position: "absolute", left: 0, zIndex: 60, width: 300,
          [openUp ? "bottom" : "top"]: "calc(100% + 8px)",
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {models.length > 6 && (
            <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
              <input ref={searchRef} type="search" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search local models…"
                style={{
                  width: "100%", padding: "8px 10px", borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)", background: "var(--surface-muted)",
                  color: "var(--text)", fontFamily: "var(--font-body)", fontSize: "var(--text-sm)",
                  outline: "none",
                }} />
            </div>
          )}
          <div style={{ maxHeight: 280, overflowY: "auto", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {error ? (
              <div style={{ padding: "10px 8px", fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>{error}</div>
            ) : loading && models.length === 0 ? (
              <div style={{ padding: "10px 8px", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Loading models from Ollama…</div>
            ) : models.length === 0 ? (
              <div style={{ padding: "10px 8px", fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                No local models found. Pull one with <code style={{ fontFamily: "var(--font-mono)" }}>ollama pull llama3.2</code>.
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "10px 8px", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No models match "{search}".</div>
            ) : filtered.map(m => {
              const sel = m.name === model;
              return (
                <button key={m.name} role="option" aria-selected={sel} type="button"
                  className="ai-menu-item"
                  onClick={() => { onModel && onModel(m.name); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%",
                    padding: "9px 10px", border: "none", borderRadius: "var(--radius-sm)",
                    background: sel ? "var(--surface-muted)" : "transparent", cursor: "pointer",
                    textAlign: "left", fontFamily: "var(--font-body)",
                  }}>
                  <span style={{ display: "inline-flex", color: "var(--text)" }}><ModelIcon brand={m.brand} size={18} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                    <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{m.note || "Local Ollama model"}</span>
                  </span>
                  {sel && <span style={{ display: "inline-flex", color: "var(--accent-ink)" }}><Icon name="check" size={16} /></span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AttachButton({ onFile, className = "ai-icon-btn", title = "Attach file" }) {
  return (
    <label className={className} aria-label={title} title={title} style={{ cursor: "pointer" }}>
      <input type="file" style={{ display: "none" }} onChange={e => {
        const f = e.target.files && e.target.files[0];
        if (f && onFile) onFile(f.name);
        e.target.value = "";
      }} />
      <Icon name="paperclip" size={18} />
    </label>
  );
}

function SendButton({ active, busy, onClick, onStop, variant }) {
  const round = variant === "pill";
  const size = round ? 40 : 36;
  if (busy) {
    return (
      <button type="button" onClick={onStop} aria-label="Stop" title="Stop generating"
        style={{
          width: size, height: size, borderRadius: round ? "var(--radius-pill)" : "var(--radius-md)",
          border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "var(--surface-muted)", color: "var(--text)", flex: "none",
        }}>
        <Icon name="square" size={16} />
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={!active} aria-label="Send"
      className="ai-send-btn"
      style={{
        width: size, height: size, borderRadius: round ? "var(--radius-pill)" : "var(--radius-md)",
        border: "none", cursor: active ? "pointer" : "default",
        display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none",
        background: active ? "var(--accent)" : "var(--surface-muted)",
        color: active ? "var(--text-on-accent)" : "var(--text-muted)",
        transition: "background .15s ease, color .15s ease, transform .12s ease",
      }}>
      <Icon name="arrowUp" size={18} stroke={2.25} />
    </button>
  );
}

function FileChip({ name, onRemove }) {
  return (
    <div className="ai-file-chip" style={{
      display: "inline-flex", alignItems: "center", gap: 8, maxWidth: 220,
      padding: "6px 8px 6px 10px", background: "var(--surface-muted)",
      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
    }}>
      <span style={{ display: "inline-flex", color: "var(--text-muted)" }}><Icon name="fileText" size={15} /></span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      <button type="button" onClick={onRemove} aria-label="Remove file" className="ai-icon-btn" style={{ width: 22, height: 22, padding: 0 }}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

function AIInput({
  value, onChange, onSubmit, placeholder = "Ask anything…",
  variant = "stacked", radius = 16, showAttach = true,
  accentOnModel = true, model, onModel, busy = false, onStop, openUp = true,
  models = window.AI_MODELS || [], modelsLoading = false, modelsError = null,
}) {
  const [innerVal, setInnerVal] = aiUseState("");
  const val = value !== undefined ? value : innerVal;
  const setVal = onChange || setInnerVal;
  const [files, setFiles] = aiUseState([]);
  const [taRef, resize] = useAutoResize(variant === "stacked" ? 56 : 24, 220);

  aiUseEffect(() => { resize(); }, [val, resize]);

  const canSend = (val.trim().length > 0 || files.length > 0) && !busy;
  const submit = () => {
    if (!canSend) return;
    onSubmit && onSubmit(val.trim(), files);
    if (value === undefined) setInnerVal("");
    setFiles([]);
    resize(true);
  };
  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };
  const addFile = (n) => setFiles(f => f.length >= 3 ? f : [...f, n]);
  const rmFile = (i) => setFiles(f => f.filter((_, idx) => idx !== i));

  const taStyle = {
    flex: 1, width: "100%", resize: "none", border: "none", outline: "none",
    background: "transparent", color: "var(--text)", fontFamily: "var(--font-body)",
    fontSize: "var(--text-base)", lineHeight: 1.5, padding: 0, margin: 0,
    maxHeight: 220, overflowY: "auto",
  };
  const shellRadius = variant === "pill" ? `min(${radius + 12}px, var(--radius-pill))` : radius + "px";

  const shell = {
    position: "relative", background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: shellRadius, boxShadow: "var(--shadow-sm)",
    transition: "border-color .15s ease, box-shadow .15s ease",
  };

  const fileRow = files.length > 0 && (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: variant === "stacked" ? 12 : 0 }}>
      {files.map((n, i) => <FileChip key={i} name={n} onRemove={() => rmFile(i)} />)}
    </div>
  );

  if (variant === "stacked") {
    return (
      <div className="ai-shell" style={shell}>
        <div style={{ padding: "16px 18px 0" }}>
          {fileRow}
          <textarea ref={taRef} value={val} placeholder={placeholder}
            onChange={e => { setVal(e.target.value); resize(); }} onKeyDown={onKey}
            rows={1} style={taStyle} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ModelDropdown model={model} onModel={onModel} accentOnModel={accentOnModel} openUp={openUp} models={models} loading={modelsLoading} error={modelsError} />
            {showAttach && (<>
              <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />
              <AttachButton onFile={addFile} />
            </>)}
          </div>
          <SendButton active={canSend} busy={busy} onClick={submit} onStop={onStop} variant={variant} />
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className="ai-shell" style={shell}>
        {fileRow && <div style={{ padding: "12px 14px 0" }}>{fileRow}</div>}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "8px 10px 8px 12px" }}>
          {showAttach && <div style={{ paddingBottom: 4 }}><AttachButton onFile={addFile} /></div>}
          <div style={{ flex: 1, display: "flex", alignItems: "center", minHeight: 40 }}>
            <textarea ref={taRef} value={val} placeholder={placeholder}
              onChange={e => { setVal(e.target.value); resize(); }} onKeyDown={onKey}
              rows={1} style={{ ...taStyle, paddingTop: 8, paddingBottom: 8 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 2 }}>
            <ModelDropdown model={model} onModel={onModel} accentOnModel={accentOnModel} openUp={openUp} compact models={models} loading={modelsLoading} error={modelsError} />
            <SendButton active={canSend} busy={busy} onClick={submit} onStop={onStop} variant={variant} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 10, paddingLeft: 4 }}>
        <ModelDropdown model={model} onModel={onModel} accentOnModel={accentOnModel} openUp={openUp} models={models} loading={modelsLoading} error={modelsError} />
      </div>
      <div className="ai-shell" style={{ ...shell, boxShadow: "var(--shadow-md)" }}>
        {fileRow && <div style={{ padding: "12px 16px 0" }}>{fileRow}</div>}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, padding: "8px 8px 8px 16px" }}>
          {showAttach && <div style={{ paddingBottom: 6 }}><AttachButton onFile={addFile} /></div>}
          <div style={{ flex: 1, display: "flex", alignItems: "center", minHeight: 44 }}>
            <textarea ref={taRef} value={val} placeholder={placeholder}
              onChange={e => { setVal(e.target.value); resize(); }} onKeyDown={onKey}
              rows={1} style={{ ...taStyle, paddingTop: 10, paddingBottom: 10 }} />
          </div>
          <SendButton active={canSend} busy={busy} onClick={submit} onStop={onStop} variant="pill" />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AIInput, ModelDropdown, AttachButton, SendButton, FileChip, useAutoResize });

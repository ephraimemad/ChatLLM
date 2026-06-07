/* ============================================================
   ChatView — full local LLM chat surface (sidebar + thread + composer).
   Talks to the local server, which proxies a running Ollama instance:
     GET  /api/conversations        — list saved conversations
     GET  /api/conversations/:id    — load one conversation
     POST /api/conversations        — create/update (upsert) a conversation
     DEL  /api/conversations/:id    — delete a conversation
     POST /api/chat                 — stream a reply from Ollama (ndjson)
   ============================================================ */
const { useState: cUseState, useRef: cUseRef, useEffect: cUseEffect, useCallback: cUseCallback } = React;

const HISTORY_VISIBLE_KEY = "llm-chat:historyVisible";

function renderRich(text) {
  const lines = text.split("\n");
  const blocks = [];
  let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };
  const inline = (s, k) => {
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
    return parts.map((p, i) => {
      if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} style={{ fontWeight: 600 }}>{p.slice(2, -2)}</strong>;
      if (p.startsWith("`") && p.endsWith("`")) return <code key={i} style={{ fontFamily: "var(--font-mono)", fontSize: ".88em", background: "var(--surface-muted)", padding: "1px 5px", borderRadius: 5 }}>{p.slice(1, -1)}</code>;
      return <span key={i}>{p}</span>;
    });
  };
  lines.forEach((ln, i) => {
    if (ln.trim().startsWith("- ")) {
      if (!list) list = <ul key={"l" + i} style={{ margin: "4px 0 4px", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 4 }} />;
      list = React.cloneElement(list, {}, [...(list.props.children || []), <li key={i} style={{ lineHeight: 1.55 }}>{inline(ln.trim().slice(2), i)}</li>]);
    } else {
      flush();
      if (ln.trim() === "") blocks.push(<div key={"sp" + i} style={{ height: 8 }} />);
      else blocks.push(<p key={i} style={{ margin: 0, lineHeight: 1.62 }}>{inline(ln, i)}</p>);
    }
  });
  flush();
  return blocks;
}

function readHistoryVisiblePref() {
  try {
    const raw = localStorage.getItem(HISTORY_VISIBLE_KEY);
    return raw === null ? true : raw === "1";
  } catch { return true; }
}

function toApiMessages(messages) {
  return messages.map(({ role, text }) => ({ role, content: text }));
}

function fromApiMessages(conversationId, messages) {
  return (messages || []).map((m, i) => ({
    id: `${conversationId}-${i}`, role: m.role, text: m.content || "",
  }));
}

function ChatView({ model, onModel, tweaks, models = [], modelsLoading = false, modelsError = null }) {
  const [conversations, setConversations] = cUseState([]);
  const [conversationId, setConversationId] = cUseState(null);
  const [messages, setMessages] = cUseState([]);
  const [busy, setBusy] = cUseState(false);
  const [chatError, setChatError] = cUseState(null);
  const [historyVisible, setHistoryVisible] = cUseState(readHistoryVisiblePref);
  const [historyError, setHistoryError] = cUseState(null);
  const scrollRef = cUseRef(null);
  const abortRef = cUseRef(null);

  cUseEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  cUseEffect(() => {
    try { localStorage.setItem(HISTORY_VISIBLE_KEY, historyVisible ? "1" : "0"); } catch {}
  }, [historyVisible]);

  const refreshConversations = cUseCallback(() => {
    fetch("/api/conversations")
      .then((res) => res.json())
      .then((data) => { setConversations(data.conversations || []); setHistoryError(null); })
      .catch((err) => setHistoryError(err.message || "Could not load chat history"));
  }, []);

  cUseEffect(() => { refreshConversations(); }, [refreshConversations]);

  const stopStream = () => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setBusy(false);
  };

  const newChat = () => {
    if (busy) stopStream();
    setConversationId(null);
    setMessages([]);
    setChatError(null);
  };

  const openConversation = (id) => {
    if (id === conversationId) return;
    if (busy) stopStream();
    setChatError(null);
    fetch(`/api/conversations/${encodeURIComponent(id)}`)
      .then((res) => res.json())
      .then((data) => {
        const conv = data.conversation;
        if (!conv) return;
        setConversationId(conv.id);
        setMessages(fromApiMessages(conv.id, conv.messages));
        if (conv.model) onModel(conv.model);
      })
      .catch((err) => setHistoryError(err.message || "Could not open that conversation"));
  };

  const deleteConversation = (e, id) => {
    e.stopPropagation();
    fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error("Could not delete conversation");
        setConversations((list) => list.filter((c) => c.id !== id));
        if (id === conversationId) newChat();
      })
      .catch((err) => setHistoryError(err.message || "Could not delete conversation"));
  };

  const persist = (finalMessages, finalModel) => {
    fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: conversationId, model: finalModel, messages: toApiMessages(finalMessages) }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.conversation) {
          setConversationId(data.conversation.id);
          refreshConversations();
        }
      })
      .catch(() => { /* history persistence is best-effort; the chat itself still works */ });
  };

  const send = async (text, files) => {
    if (busy || !model) return;
    const uid = Date.now();
    const aid = uid + 1;
    const userMsg = { id: uid, role: "user", text, files: files || [] };
    const placeholder = { id: aid, role: "assistant", text: "", model };
    const base = [...messages, userMsg];
    setMessages([...base, placeholder]);
    setBusy(true);
    setChatError(null);

    const controller = new AbortController();
    abortRef.current = controller;
    let full = "";
    let failed = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: toApiMessages(base) }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Ollama request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let chunk;
          try { chunk = JSON.parse(trimmed); } catch { continue; }
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.message && typeof chunk.message.content === "string" && chunk.message.content) {
            full += chunk.message.content;
            const snapshot = full;
            setMessages((m) => m.map((x) => (x.id === aid ? { ...x, text: snapshot } : x)));
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        // user pressed stop — keep whatever streamed in so far
      } else {
        failed = true;
        const friendly = err.message || "Something went wrong talking to Ollama.";
        setChatError(friendly);
        setMessages((m) => m.map((x) => (x.id === aid ? { ...x, text: full || `⚠️ ${friendly}`, error: true } : x)));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }

    if (!failed && full.trim()) {
      persist([...base, { ...placeholder, text: full }], model);
    }
  };

  const SUGGESTIONS = [
    "Explain a concept simply",
    "Draft a polite reply",
    "Review this snippet of code",
    "Brainstorm names for a project",
  ];

  const empty = messages.length === 0;

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {historyVisible && (
        <aside className="chat-sidebar" style={{
          width: 248, flex: "none", borderRight: "1px solid var(--border)",
          background: "var(--surface)", display: "flex", flexDirection: "column", minHeight: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 14px 12px" }}>
            <button className="chat-newbtn" onClick={newChat}
              style={{
                display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0,
                padding: "10px 12px", borderRadius: "var(--radius-md)", cursor: "pointer",
                background: "var(--surface)", border: "1px solid var(--border)",
                fontFamily: "var(--font-body)", fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text)",
              }}>
              <Icon name="edit" size={16} color="var(--text-muted)" /> New chat
            </button>
            <button className="ai-icon-btn" title="Hide history" aria-label="Hide chat history" onClick={() => setHistoryVisible(false)}
              style={{ flex: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", width: 38, height: 38 }}>
              <Icon name="panelLeft" size={17} />
            </button>
          </div>
          <div className="hl-label" style={{ padding: "4px 18px 8px", fontSize: 11 }}>Recent</div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
            {historyError ? (
              <div style={{ padding: "10px 10px", fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>{historyError}</div>
            ) : conversations.length === 0 ? (
              <div style={{ padding: "10px 10px", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No conversations yet — say hello.</div>
            ) : conversations.map((c) => {
              const active = c.id === conversationId;
              return (
                <div key={c.id} className="chat-conv-row" style={{ position: "relative", display: "flex" }}>
                  <button className="chat-conv" onClick={() => openConversation(c.id)} style={{
                    display: "flex", alignItems: "center", gap: 9, padding: "9px 36px 9px 10px", flex: 1, minWidth: 0, textAlign: "left",
                    border: "none", background: active ? "var(--surface-muted)" : "transparent",
                    borderRadius: "var(--radius-sm)", cursor: "pointer",
                    fontFamily: "var(--font-body)", fontSize: "var(--text-sm)", color: "var(--text)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    <Icon name="message" size={15} color="var(--text-muted)" />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title || "New chat"}</span>
                  </button>
                  <button className="ai-icon-btn chat-conv-delete" title="Delete conversation" aria-label={`Delete "${c.title || "New chat"}"`}
                    onClick={(e) => deleteConversation(e, c.id)}
                    style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 28, height: 28 }}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ padding: 10, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 30, height: 30, borderRadius: "var(--radius-pill)", background: "var(--surface-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
              <Icon name="user" size={16} />
            </span>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text)", fontWeight: 500 }}>Local session</span>
          </div>
        </aside>
      )}

      <section style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, position: "relative" }}>
        {!historyVisible && (
          <button className="ai-icon-btn" title="Show history" aria-label="Show chat history" onClick={() => setHistoryVisible(true)}
            style={{
              position: "absolute", top: 14, left: 14, zIndex: 5, width: 38, height: 38,
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-sm)",
            }}>
            <Icon name="panelLeft" size={17} />
          </button>
        )}

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {empty ? (
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 52, height: 52, margin: "0 auto 18px", borderRadius: "var(--radius-pill)", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="sparkles" size={24} color="var(--text-on-accent)" />
                </div>
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-3xl)", letterSpacing: "-0.02em", margin: 0, color: "var(--text)" }}>What can I help with?</h1>
                <p style={{ fontFamily: "var(--font-body)", fontSize: "var(--text-base)", color: "var(--text-muted)", margin: "10px 0 0" }}>
                  {model ? "Pick a starter or type your own below." : (modelsLoading ? "Loading your local Ollama models…" : (modelsError || "No local models found — pull one with `ollama pull llama3.2`."))}
                </p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", maxWidth: 560 }}>
                {SUGGESTIONS.map(s => (
                  <button key={s} className="chat-suggest" disabled={!model} onClick={() => send(s, [])} style={{
                    padding: "10px 16px", borderRadius: "var(--radius-pill)", cursor: model ? "pointer" : "default",
                    background: "var(--surface)", border: "1px solid var(--border)", opacity: model ? 1 : .5,
                    fontFamily: "var(--font-body)", fontSize: "var(--text-sm)", color: "var(--text)",
                  }}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: "100%", margin: "0 auto", padding: "30px 44px 44px", display: "flex", flexDirection: "column", gap: 26 }}>
              {messages.map(m => <Message key={m.id} m={m} busy={busy} models={models} />)}
            </div>
          )}
        </div>

        <div style={{ borderTop: empty ? "none" : "1px solid var(--border)", background: "var(--bg)" }}>
          <div style={{ maxWidth: "100%", margin: "0 auto", padding: "14px 44px 12px", width: "100%" }}>
            <AIInput
              variant={tweaks.inputVariant}
              radius={tweaks.radius}
              showAttach={tweaks.showAttach}
              accentOnModel={tweaks.accentOnModel}
              placeholder={tweaks.placeholder}
              model={model} onModel={onModel}
              models={models} modelsLoading={modelsLoading} modelsError={modelsError}
              busy={busy} onStop={stopStream}
              onSubmit={send} openUp
            />
            <p style={{ textAlign: "center", fontSize: 11, color: chatError ? "var(--danger, #b91c1c)" : "var(--text-muted)", margin: "8px 0 0", fontFamily: "var(--font-body)" }}>
              {chatError || "Assistant can make mistakes. Check important info."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Message({ m, busy, models = [] }) {
  const isUser = m.role === "user";
  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          {m.files && m.files.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
              {m.files.map((f, i) => <FileChip key={i} name={f} onRemove={() => {}} />)}
            </div>
          )}
          <div style={{
            background: "var(--surface-muted)", color: "var(--text)",
            padding: "11px 15px", borderRadius: "16px 16px 4px 16px",
            fontFamily: "var(--font-body)", fontSize: "var(--text-base)", lineHeight: 1.55,
          }}>{m.text}</div>
        </div>
      </div>
    );
  }
  const modelInfo = models.find(x => x.name === m.model) || { name: m.model || "Local model", brand: "ollama" };
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{ width: 32, height: 32, flex: "none", borderRadius: "var(--radius-pill)", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        <Icon name="sparkles" size={16} color="var(--text-on-accent)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--text)" }}>Assistant</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            <span style={{ display: "inline-flex", color: "var(--text)" }}><ModelIcon brand={modelInfo.brand} size={12} /></span>{modelInfo.name}
          </span>
        </div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--text-base)", color: m.error ? "var(--text-muted)" : "var(--text)" }}>
          {m.text === "" ? <ThinkingDots /> : renderRich(m.text)}
          {m.text !== "" && busy && <span className="ai-caret" />}
        </div>
        {m.text !== "" && !busy && !m.error && (
          <div className="msg-actions" style={{ display: "flex", gap: 4, marginTop: 12 }}>
            <button className="ai-icon-btn" title="Copy" onClick={() => navigator.clipboard && navigator.clipboard.writeText(m.text)}><Icon name="copy" size={15} /></button>
            <button className="ai-icon-btn" title="Good response"><Icon name="thumbUp" size={15} /></button>
            <button className="ai-icon-btn" title="Bad response"><Icon name="thumbDown" size={15} /></button>
            <button className="ai-icon-btn" title="Regenerate"><Icon name="refresh" size={15} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div style={{ display: "inline-flex", gap: 5, padding: "4px 0" }}>
      {[0, 1, 2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--more-than-a-week)", animation: `hlBlink 1.2s ${i * 0.18}s infinite` }} />)}
    </div>
  );
}

Object.assign(window, { ChatView, Message, renderRich });

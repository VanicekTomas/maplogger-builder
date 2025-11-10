
(function(){
  const CONFIG = window.MAPLOGGER_CONFIG || {};
  const ROLE = (window.MAPLOGGER_CONFIG && window.MAPLOGGER_CONFIG.role) || 'inline'; // host | child | inline
  const TASKS = Array.isArray(window.MAPLOGGER_TASKS) ? window.MAPLOGGER_TASKS : ["Task 1","Task 2"];
  const CSV_FILENAME = CONFIG.csvFilename || "maplogger_log.csv";
  const PUSH_FIXED = CONFIG.pushDownFixed !== false;
  const SESSION_KEY = CONFIG.sessionKey || "ml_default";
  const LS_KEY = "maplogger_session_" + SESSION_KEY;
  const TOOLBAR_MODE = CONFIG.toolbarMode || "inline"; // inline | overlay
  // Stable, predictable strategy: insert toolbar at very top of <body>
  const PLACEMENT_STRATEGY = 'top';
  const PLACEMENT_SELECTOR = CONFIG.toolbarPlacementSelector || 'header, nav, [role="navigation"], .navbar, .topbar';
  let ANCHOR_EL = null;
  let loggingEnabled = true; // allow turning off logging at end

  // Session state persisted in localStorage across pages
  let session = null; // {sessionId, t0_epoch_ms, taskIndex, taskRunning, taskStartEpochMs, records: []}
  let taskIndex = 0;
  let taskStartEpochMs = null;
  let t0EpochMs = Date.now();

  function isIndexPage(){
    try{
      const p = (location.pathname||"").toLowerCase();
      return /(^|\/)index\.x?html?$/.test(p) || p.endsWith("/");
    }catch(e){ return false; }
  }

  function loadSession(allowCreate){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if (raw){
        const s = JSON.parse(raw);
        // Minimal shape guard
        if (s && typeof s === 'object' && Array.isArray(s.records)){
          return s;
        }
      }
    }catch(e){ /* ignore parse errors; start fresh */ }
    if (!allowCreate){ return null; }
    // Create new session
    const s = { sessionId: Math.random().toString(36).slice(2) + Date.now().toString(36), t0_epoch_ms: Date.now(), taskIndex: 0, taskRunning: false, taskStartEpochMs: null, records: [], tasks_sig: Array.isArray(TASKS)? TASKS.join('|') : '' };
    saveSession(s);
    return s;
  }
  function saveSession(s){ try{ localStorage.setItem(LS_KEY, JSON.stringify(s)); }catch(e){ /* storage may be full or blocked */ } }

  function nowMs(){ return Math.max(0, Date.now() - t0EpochMs); }
  function localIso(){
    const d = new Date();
    const pad = (n, l=2)=> String(n).padStart(l, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth()+1);
    const dd = pad(d.getDate());
    const HH = pad(d.getHours());
    const MM = pad(d.getMinutes());
    const SS = pad(d.getSeconds());
    const ms = pad(d.getMilliseconds(), 3);
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const oh = pad(Math.floor(Math.abs(off)/60));
    const om = pad(Math.abs(off)%60);
    return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}.${ms}${sign}${oh}:${om}`;
  }
  function isoNow(){ return new Date().toISOString(); }
  function base(p){ return Object.assign({ session_id: (session && session.sessionId) || '', timestamp_ms_since_start: nowMs(), local_time: localIso(), iso_time: isoNow(), task_index: (taskIndex+1), task_label: TASKS[taskIndex] || ("Task " + (taskIndex+1)) }, p); }
  function record(evt){
    if (ROLE === 'child'){
      try{ window.parent && window.parent.postMessage({ __ml:true, kind:'evt', payload: evt, url: location.href }, '*'); }catch(e){}
      return;
    }
    if (!session || !loggingEnabled) return; // block logging until session exists or when disabled
    try{ session.records.push(evt); saveSession(session); }catch(e){ /* best-effort */ }
  }

  function ensureOffsetBelowToolbar(){ /* replaced by layoutBelowToolbar */ }

  function getToolbarHeight(){
    const tb = document.getElementById('ml-toolbar');
    if (!tb) return 0;
    const r = tb.getBoundingClientRect();
    return Math.ceil(r.height||0);
  }

  function ensureUniverseWrapper(){
    // No-op: keep original DOM structure intact to avoid breaking selectors like body > header
    return null;
  }

  function updateUniverseShift(){
    // Deprecated: no longer translate entire universe; we use padding + targeted adjustments.
  }

  // Removed universe offset shifting; body padding handles global offset

  function shrinkFullHeightElements(h){
    try{
  const candidates = Array.from(document.querySelectorAll('body *'));
      for (const el of candidates){
        if (!el || el.id === 'ml-toolbar') continue;
        if (el.classList && (el.classList.contains('ml-modal-backdrop') || el.classList.contains('ml-modal'))) continue;
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const topVal = parseFloat(cs.top||'0')||0;
  const isFixed = (cs.position === 'fixed');
  const isSticky = (cs.position === 'sticky');
        const isAbsolute = (cs.position === 'absolute');
        const nearTop = topVal <= 2;
        const usesVh = /vh/.test(el.style.height || '') || /vh/.test(cs.height || '');
        const hasBottomZero = (cs.bottom === '0px');

        // 1) Push true fixed bars below the toolbar (sticky stays in flow and is already pushed by body padding)
        if (isFixed && nearTop){
          const currentTop = parseFloat(cs.top||'0')||0;
          if (currentTop < h){ el.style.top = h + 'px'; }
        }

        // 2) Handle full-viewport absolute containers anchored to top
        if (isAbsolute && nearTop){
          // Case A: absolute fill (top:0; bottom:0) -> move top down, keep bottom:0
          if (hasBottomZero){
            el.style.top = h + 'px';
          } else if (usesVh){
            // Case B: height:100vh -> reduce height by toolbar height
            el.style.height = 'calc(100vh - '+h+'px)';
          }
        }
      }
    }catch(e){ /* noop */ }
  }

  function adjustLayoutForToolbar(){
    // Host layout is handled by the host shell (adj() sets iframe top). Avoid any global padding/margins here.
    if (ROLE === 'host') return;
    try{
      const h = getToolbarHeight();
      const body = document.body; if (body){
        body.classList.add('ml-toolbar-active');
        // Use CSS var and inline padding to push in-flow content
        document.documentElement.style.setProperty('--ml-toolbar-h', h + 'px');
        try{ body.style.setProperty('padding-top', h + 'px', 'important'); }catch(e){}
        try{ document.documentElement.style.setProperty('scroll-padding-top', h + 'px', 'important'); }catch(e){}
      }
      // Rely purely on padding + targeted fixes; do not insert spacers or margin shifts
      shrinkFullHeightElements(h);
    }catch(e){ /* noop */ }
  }

  function ensureToolbarSpacer(h){
    try{
      let spacer = document.getElementById('ml-toolbar-spacer');
      if (!spacer){
        spacer = document.createElement('div');
        spacer.id = 'ml-toolbar-spacer';
        spacer.style.width = '100%';
        spacer.style.height = '0px';
        spacer.style.boxSizing = 'content-box';
        const body = document.body;
        if (body.firstChild){ body.insertBefore(spacer, body.firstChild); }
        else { body.appendChild(spacer); }
      }
      const hh = Math.max(0, Number(h)||0);
      spacer.style.height = hh + 'px';
    }catch(e){ /* noop */ }
  }

  // removed pushDownTopFixedElements; earlier stable approach uses header shift + body padding

  // Removed dynamic fixed-top stacking logic; stable in-flow placement only.

  function placeToolbar(){
    if (ROLE === 'child'){ return; } // child pages do not manage toolbar
    if (TOOLBAR_MODE !== 'inline') return;
    const tb = document.getElementById('ml-toolbar'); if (!tb) return;
    try{
      const detectTopBar = ()=>{
        let best = null; let bestScore = -1;
        const nodes = Array.from(document.querySelectorAll('body *'));
        for (const el of nodes){
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
          const top = parseFloat(cs.top||'0');
          const rect = el.getBoundingClientRect();
          // Prefer široké prvky u horního okraje
          const nearTop = isNaN(top) ? (rect.top < 8) : (top >= -1 && top <= 8);
          const wide = rect.width >= innerWidth * 0.6;
          const tall = rect.height >= 24;
          if (!nearTop || !tall) continue;
          const score = (wide?2:0) + (cs.position==='fixed'?2:1) + Math.max(0, 200-rect.top);
          if (score > bestScore){ bestScore = score; best = el; }
        }
        return best;
      };

      let anchor = document.querySelector(PLACEMENT_SELECTOR);
      if (!anchor) anchor = detectTopBar();
      ANCHOR_EL = anchor || null;

      if (PLACEMENT_STRATEGY === 'top'){
        try{
          const body = document.body;
          if (body.firstChild !== tb){ body.insertBefore(tb, body.firstChild); }
          // Force fixed toolbar at the very top of the viewport
          tb.style.position = 'fixed';
          tb.style.left = '0';
          tb.style.right = '0';
          tb.style.top = '0px';
          tb.style.zIndex = '2147483647';
        }catch(e){ /* noop */ }
        // Wrap entire page content and shift it down by toolbar height
  const refresh = ()=> { /* keep DOM as-is */ adjustLayoutForToolbar(); };
        refresh();
        // Watch toolbar size changes (fonts/device DPI etc.) and reapply offsets
        try{
          if (typeof ResizeObserver !== 'undefined'){
            const ro = new ResizeObserver(()=> adjustLayoutForToolbar());
            ro.observe(tb);
          }
        }catch(e){ /* noop */ }
        window.addEventListener('resize', refresh);
        window.addEventListener('load', refresh);
        setTimeout(refresh, 50);
        setTimeout(refresh, 300);
        setTimeout(refresh, 1000);
        return;
      }

      // Default strategy: after anchor header/nav
      if (anchor && anchor.parentNode){
        if (anchor.nextSibling){ anchor.parentNode.insertBefore(tb, anchor.nextSibling); }
        else { anchor.parentNode.appendChild(tb); }
        // after-anchor path (currently unused), keep simple placement
      } else {
        // fallback: first child of body (in flow)
        try{ const body = document.body; if (body.firstChild !== tb){ body.insertBefore(tb, body.firstChild); } }catch(e){ /* noop */ }
      }
    }catch(e){ /* best-effort */ }
  }

  function showTaskModal(text, onStart){
    const backdrop = document.createElement("div"); backdrop.className = "ml-modal-backdrop";
    const modal = document.createElement("div"); modal.className = "ml-modal";
    modal.innerHTML = '<h3>Task</h3><p style="white-space:pre-wrap">'+ (text||"Read the instructions and start.") +'</p><div class="ml-actions"><button id="ml-start" class="ml-btn ml-accent">Start task</button></div>';
    backdrop.appendChild(modal); document.body.appendChild(backdrop);
    modal.querySelector("#ml-start").addEventListener("click", ()=>{ document.body.removeChild(backdrop); if (typeof onStart==="function") onStart(); });
  }

  function askParticipantId(onSubmit){
    const backdrop = document.createElement("div"); backdrop.className = "ml-modal-backdrop";
    const modal = document.createElement("div"); modal.className = "ml-modal";
    modal.innerHTML = '<h3>Finish study</h3>'+
      '<p>Please enter your participant ID to finish and export the log.</p>'+
      '<div style="margin:.5rem 0"><input id="ml-participant-id" class="ml-input" placeholder="e.g. P01" style="width:100%"/></div>'+
      '<div class="ml-actions"><button id="ml-cancel" class="ml-btn">Cancel</button><button id="ml-save" class="ml-btn ml-accent">Export CSV</button></div>';
    backdrop.appendChild(modal); document.body.appendChild(backdrop);
    const input = modal.querySelector('#ml-participant-id'); input.focus();
    const done = (ok)=>{
      if (!ok){ document.body.removeChild(backdrop); return; }
      const id = (input.value||'').trim();
      if (!id){ input.classList.add('ml-invalid'); input.focus(); return; }
      document.body.removeChild(backdrop);
      if (typeof onSubmit === 'function') onSubmit(id);
    };
    modal.querySelector('#ml-cancel').addEventListener('click', ()=> done(false));
    modal.querySelector('#ml-save').addEventListener('click', ()=> done(true));
    input.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') done(true); });
  }

  function showThankYou(){
    const backdrop = document.createElement("div"); backdrop.className = "ml-modal-backdrop";
    const modal = document.createElement("div"); modal.className = "ml-modal";
    modal.innerHTML = '<h3>Thank you!</h3><p>Your responses have been recorded. You can close this window now.</p>'+
      '<div class="ml-actions"><button id="ml-close" class="ml-btn ml-accent">Close</button></div>';
    backdrop.appendChild(modal); document.body.appendChild(backdrop);
    modal.querySelector('#ml-close').addEventListener('click', ()=>{ document.body.removeChild(backdrop); });
  }

  function initToolbar(){
    const label = document.getElementById("ml-task-label");
    const next = document.getElementById("ml-next");
    const end = document.getElementById("ml-end");

    // If session not started, disable controls and hint to start from index
  if (ROLE === 'child'){ return; }
  if (!session){
      if (label) label.textContent = "Open index.html to start";
      if (next){ next.disabled = true; next.title = "Start from index.html"; next.addEventListener("click", ()=> location.href = "./index.html"); }
      if (end){ end.disabled = true; end.title = "Start from index.html"; end.addEventListener("click", ()=> location.href = "./index.html"); }
      ensureOffsetBelowToolbar();
      return;
    }

    function refresh(){
      if (label) label.textContent = TASKS[taskIndex] || ("Task " + (taskIndex+1));
      if (end){ if (taskIndex === TASKS.length - 1) end.classList.remove("ml-hidden"); else end.classList.add("ml-hidden"); }
      ensureOffsetBelowToolbar();
    }

    next && next.addEventListener("click", ()=>{
      if (taskStartEpochMs != null){ const duration = Date.now() - taskStartEpochMs; record(base({event_type:"task_end", extra_json: JSON.stringify({duration_ms: duration})})); }
      if (taskIndex < TASKS.length - 1){
        taskIndex++; session.taskIndex = taskIndex; session.taskRunning = false; session.taskStartEpochMs = null; saveSession(session);
        refresh();
        showTaskModal(TASKS[taskIndex], ()=>{ taskStartEpochMs = Date.now(); session.taskRunning = true; session.taskStartEpochMs = taskStartEpochMs; saveSession(session); record(base({event_type:"task_start"})); });
        record(base({event_type:"task_next"}));
      } else { toast("Last task – press END to export."); }
    });

    end && end.addEventListener("click", ()=>{
      // finalize current task if running
      if (taskStartEpochMs != null){ const duration = Date.now() - taskStartEpochMs; record(base({event_type:"task_end", extra_json: JSON.stringify({duration_ms: duration})})); }
      // ask for participant ID, then export
      askParticipantId((pid)=>{
        // Override session id across all existing records BEFORE logging end events
        session.participantId = pid; session.sessionId = pid;
        if (Array.isArray(session.records)){
          for (const r of session.records){ if (r && typeof r === 'object') r.session_id = pid; }
        }
        saveSession(session);
        // Log end events while logging is still enabled
        record(base({event_type:"end_clicked", extra_json: JSON.stringify({participant_id: pid})}));
        record(base({event_type:"session_end", extra_json: JSON.stringify({participant_id: pid})}));
        // stop further logging
        loggingEnabled = false;
        session.taskRunning = false; session.taskStartEpochMs = null; saveSession(session);
        exportCsv(pid);
        showThankYou();
      });
    });

    refresh();
    if (!CONFIG.deferStart) maybeShowTaskModal();
  }

  let toastEl;
  function toast(msg){
    if (!toastEl){
      toastEl = document.createElement("div"); toastEl.style.cssText = "position:fixed;right:.75rem;bottom:.75rem;background:#0c1422;color:#dfe8f7;padding:.6rem .8rem;border:1px solid #1d2940;border-radius:10px;z-index:2147483647;font:12px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg; toastEl.style.display = "block"; clearTimeout(toastEl._t); toastEl._t = setTimeout(()=> toastEl.style.display="none", 1800);
  }

  function cssPath(el){
    if (!el || !el.nodeType) return "";
    const path=[]; while (el && el.nodeType===1 && path.length<10){ const name=el.nodeName.toLowerCase(); if(!el.parentNode){ path.unshift(name); break;}
      let idx=1,sib=el.previousElementSibling; while(sib){ if(sib.nodeName.toLowerCase()===name) idx++; sib=sib.previousElementSibling; }
      path.unshift(name+":nth-of-type("+idx+")"); el=el.parentNode; }
    return path.join(" > ");
  }

  function elementInfo(el){
    try{
      const tag = (el && el.nodeName) ? el.nodeName.toLowerCase() : '';
      const id = (el && el.id) ? String(el.id) : '';
      const cls = (el && el.classList && el.classList.length) ? Array.from(el.classList).slice(0,5).join('.') : '';
      let text = '';
      if (el && el.textContent){ text = el.textContent.trim().replace(/\s+/g,' '); }
      if (text.length > 80) text = text.slice(0,77) + '…';
      return { element_tag: tag, element_id: id, element_classes: cls, element_text: text };
    }catch(e){ return { element_tag:'', element_id:'', element_classes:'', element_text:'' }; }
  }

  function buttonDetails(e){
    if (!e || typeof e.button !== 'number'){ return {}; }
    const btnIndex = e.button | 0;
    let btnLabel;
    if (btnIndex === 0) btnLabel = 'left';
    else if (btnIndex === 1) btnLabel = 'middle';
    else if (btnIndex === 2) btnLabel = 'right';
    else btnLabel = String(btnIndex);
    return { button: btnIndex, button_label: btnLabel };
  }

  function initDomListeners(){
    document.addEventListener("click", (e)=>{
      const inf = elementInfo(e.target);
      const btn = buttonDetails(e);
      record(base(Object.assign({event_type:"click", css_path: cssPath(e.target), x:e.clientX, y:e.clientY, viewport_w: innerWidth, viewport_h: innerHeight}, inf, btn)));
    }, true);

    document.addEventListener("dblclick", (e)=>{
      const inf = elementInfo(e.target);
      const btn = buttonDetails(e);
      record(base(Object.assign({event_type:"dblclick", css_path: cssPath(e.target), x:e.clientX, y:e.clientY, viewport_w: innerWidth, viewport_h: innerHeight}, inf, btn)));
    }, true);

    document.addEventListener("contextmenu", (e)=>{
      const inf = elementInfo(e.target);
      const btn = buttonDetails(e);
      record(base(Object.assign({event_type:"contextmenu", css_path: cssPath(e.target), x:e.clientX, y:e.clientY, viewport_w: innerWidth, viewport_h: innerHeight}, inf, btn)));
    }, true);
    document.addEventListener("keydown", (e)=>{ const inf = elementInfo(e.target); record(base(Object.assign({event_type:"keydown", css_path: cssPath(e.target), key:e.key, code:e.code, ctrl:!!e.ctrlKey, alt:!!e.altKey, shift:!!e.shiftKey}, inf))); }, true);
    document.addEventListener("wheel", (e)=>{
      const direction = (e.deltaY < 0) ? 'up' : (e.deltaY > 0 ? 'down' : 'none');
      const zoomHint = (direction==='up') ? 'zoom_in' : (direction==='down' ? 'zoom_out' : '');
      const inf = elementInfo(e.target);
      record(base(Object.assign({event_type:"wheel", css_path: cssPath(e.target), x:e.clientX, y:e.clientY, viewport_w: innerWidth, viewport_h: innerHeight, deltaY:e.deltaY, deltaMode:e.deltaMode, wheel_direction: direction, zoom_hint: zoomHint}, inf)));
    }, {passive:true, capture:true});
    document.addEventListener("visibilitychange", ()=>{ record(base({event_type:"visibility", extra_json: JSON.stringify({hidden: document.hidden})})); });
    window.addEventListener("focus", ()=>{ record(base({event_type:"focus"})); });
    window.addEventListener("blur", ()=>{ record(base({event_type:"blur"})); });
    window.addEventListener("resize", ()=>{ ensureOffsetBelowToolbar(); record(base({event_type:"resize", viewport_w: innerWidth, viewport_h: innerHeight})); });
    // session_start or session_page will be recorded in bootstrap below
  }

  function exportCsv(preferredName){
    const headers = [
      "session_id","timestamp_ms_since_start","local_time","iso_time","task_index","task_label","event_type",
      "element_tag","element_id","element_classes","element_text","css_path","x","y","viewport_w","viewport_h",
      "button","button_label","deltaY","deltaMode","wheel_direction","zoom_hint","key","code","ctrl","alt","shift","extra_json"
    ];
    const lines = [headers.join(",")];
    const recs = Array.isArray(session && session.records) ? session.records : [];
    for (const r of recs){
      const row = headers.map(h => { const v = (r[h]!==undefined && r[h]!==null) ? String(r[h]) : ""; return (v.includes(",")||v.includes('"')||v.includes("\n")) ? ('"'+v.replace(/"/g,'""')+'"') : v; }).join(",");
      lines.push(row);
    }
    // Prepend UTF-8 BOM so spreadsheet apps on Windows (Excel) correctly detect UTF-8 and show diacritics
    const utf8bom = "\ufeff";
    const blob = new Blob([utf8bom, lines.join("\n")], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a");
    const name = (preferredName && String(preferredName).trim()) || (session && session.participantId) || CSV_FILENAME;
    a.download = name.endsWith('.csv') ? name : (name + '.csv');
    a.href = URL.createObjectURL(blob); a.click();
    toast("CSV exported");
  }

  function maybeShowTaskModal(){
    if (!session){
      const backdrop = document.createElement("div"); backdrop.className = "ml-modal-backdrop";
      const modal = document.createElement("div"); modal.className = "ml-modal";
      modal.innerHTML = '<h3>Experiment not started</h3><p>Please open <strong>index.html</strong> and start the experiment there. Then you can navigate between pages freely.</p><div class="ml-actions"><a class="ml-btn ml-accent" href="./index.html">Go to index</a></div>';
      backdrop.appendChild(modal); document.body.appendChild(backdrop);
      return;
    }
    if (!session.taskRunning){
      showTaskModal(TASKS[taskIndex], ()=>{ taskStartEpochMs = Date.now(); session.taskRunning = true; session.taskStartEpochMs = taskStartEpochMs; saveSession(session); record(base({event_type:"task_start"})); });
    } else {
      // Continue running task; ensure local variables reflect persisted state
      taskStartEpochMs = session.taskStartEpochMs || null;
    }
  }

  window.addEventListener("DOMContentLoaded", ()=>{
    // Bootstrap session (create only on index unless explicitly allowed)
    const requireIndexStart = CONFIG.requireIndexStart !== false; // default true
    const allowCreate = (!requireIndexStart) || isIndexPage();
    session = loadSession(allowCreate);

    // If an existing session looks completed or from a different task set, start fresh
    try{
      const tasksSig = Array.isArray(TASKS)? TASKS.join('|') : '';
      const last = (session && Array.isArray(session.records) && session.records.length) ? session.records[session.records.length-1] : null;
      const ended = last && (last.event_type === 'session_end' || last.event_type === 'end_clicked');
      const mismatched = session && session.tasks_sig && session.tasks_sig !== tasksSig;
      if ((ended || mismatched) && allowCreate){
        session = { sessionId: Math.random().toString(36).slice(2) + Date.now().toString(36), t0_epoch_ms: Date.now(), taskIndex: 0, taskRunning: false, taskStartEpochMs: null, records: [], tasks_sig: tasksSig };
        saveSession(session);
      } else if (session && !session.tasks_sig){
        // backfill tasks signature for older sessions
        session.tasks_sig = tasksSig; saveSession(session);
      }
    }catch(e){ /* noop */ }

    if (session){
      t0EpochMs = session.t0_epoch_ms;
      taskIndex = Math.min(Math.max(0, session.taskIndex|0), Math.max(0, TASKS.length-1));
      taskStartEpochMs = session.taskRunning ? (session.taskStartEpochMs || null) : null;

      // Mark page join vs fresh session
      const isFresh = session.records.length === 0;
      if (isFresh){
        record(base({event_type:"session_start", extra_json: JSON.stringify({ua:navigator.userAgent, viewport_w: innerWidth, viewport_h: innerHeight, url: location.href, session_id: session.sessionId})}));
      } else {
        record(base({event_type:"session_page", extra_json: JSON.stringify({viewport_w: innerWidth, viewport_h: innerHeight, url: location.href})}));
      }
    }

  if (ROLE === 'host'){
    if (document.getElementById("ml-toolbar")) { placeToolbar(); initToolbar(); }
    // Listen for child events from iframe(s)
    window.addEventListener('message', (e)=>{
      try{
        const d = e && e.data; if (!d || !d.__ml) return;
        if (d.kind === 'evt'){
          const payload = d.payload || {};
          // Remove child task labeling so host authoritative task_label/task_index are used
          delete payload.task_label;
          delete payload.task_index;
          const merged = Object.assign({}, payload, { child_url: String(d.url||'') });
          record(base(merged));
        }
      }catch(err){ /* ignore */ }
    });
    // Expose a deferred bootstrap to start task flow on user Start click in host
    window.__ML_HOST_BOOT = function(){ try{ maybeShowTaskModal(); }catch(e){} };
  } else if (ROLE === 'inline') {
    if (document.getElementById("ml-toolbar")) { placeToolbar(); initToolbar(); }
      else maybeShowTaskModal();
  } else {
    // child: no toolbar, minimal session bootstrap, rely on host for tasks
  }

  if (ROLE !== 'host') initDomListeners();
    ensureOffsetBelowToolbar();
    setTimeout(ensureOffsetBelowToolbar, 250); // in case app reflows late
  });
})();
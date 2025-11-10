
(function(){
  const dz = document.getElementById('dropzone');
  const fi = document.getElementById('file-input');
  const list = document.getElementById('file-list');
  const countEl = document.getElementById('file-count');
  const totalSizeEl = document.getElementById('file-total-size');
  const tasksListEl = document.getElementById('tasks-list');
  const addTaskBtn = document.getElementById('add-task');
  const taskPreviewLabel = document.getElementById('task-preview-label');
  const tasksCountEl = document.getElementById('tasks-count');
  const workflowEl = document.getElementById('workflow');
  const autoEntryIndexEl = document.getElementById('autoEntryIndex');
  const welcomeMessageEl = document.getElementById('welcomeMessage');
  const outputNameEl = document.getElementById('outputName');
  const buildBtn = document.getElementById('build');
  const buildLog = document.getElementById('build-log');
  const envWarning = document.getElementById('env-warning');
  const clearBtn = document.getElementById('clear-files');
  let files = [];
  let currentZipName = '';
  let commonBase = '';
  let taskInputs = [];
  const DEFAULT_TASK = 'Freely explore the site and familiarise yourself with the interface.';
  const textDecoder = new TextDecoder();

  function splitPath(p){ return String(p||'').split('/').filter(Boolean); }
  function joinPath(){
    const parts = Array.from(arguments).filter(Boolean);
    return parts.length ? parts.join('/') : '';
  }
  function dirnamePath(p){
    const parts = splitPath(p);
    parts.pop();
    return parts.join('/');
  }
  function trimTrailingSlash(p){ if (!p) return ''; return p.endsWith('/') ? p.slice(0,-1) : p; }
  function relativePath(fromPath, toPath){
    const fromSegs = splitPath(fromPath);
    const toSegs = splitPath(toPath);
    let i = 0;
    while (i < fromSegs.length && i < toSegs.length && fromSegs[i] === toSegs[i]) i++;
    const ups = new Array(fromSegs.length - i).fill('..');
    const downs = toSegs.slice(i);
    const segs = ups.concat(downs);
    return segs.length ? segs.join('/') : '';
  }
  function computeCommonBase(paths){
    const filtered = paths.map(splitPath).filter(arr => arr.length);
    if (!filtered.length) return '';
    let base = filtered[0].slice();
    for (let i=1;i<filtered.length && base.length;i++){
      const parts = filtered[i];
      let j=0;
      while (j<base.length && j<parts.length && base[j] === parts[j]) j++;
      base = base.slice(0,j);
    }
    return base.length ? base.join('/')+'/' : '';
  }

  function log(msg){ buildLog.textContent += msg + "\n"; }
  function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }
  function formatBytes(n){
    const units=['B','KB','MB','GB'];
    let i=0, x=Number(n)||0; while(x>=1024 && i<units.length-1){ x/=1024; i++; }
    return (i===0? x.toString(): x.toFixed(1))+' '+units[i];
  }
  function normalizePath(path){
    if (!path) return '';
    return String(path).replace(/\\/g, '/').replace(/^\/+/,'');
  }
  function slugifyName(s){
    try{ s = (s||'').trim(); }catch{ s=''; }
    try{ s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g,''); }catch{}
    s = s.replace(/\s+/g,'-').replace(/[^A-Za-z0-9_\-.]+/g,'-').replace(/-+/g,'-').replace(/^[\-_.]+|[\-_.]+$/g,'');
    if (!s) s = 'MapLogger-instrumented';
    if (s.length>80) s = s.slice(0,80);
    return s;
  }

  function summarizeType(item){
    if (!item) return 'unknown';
    if (item.binary) return 'binary';
    if (/\.html?$/i.test(item.path)) return 'html';
    if (/\.css$/i.test(item.path)) return 'css';
    if (/\.js$/i.test(item.path)) return 'javascript';
    return 'text';
  }

  function renderList(){
    countEl.textContent = String(files.length);
    const total = files.reduce((sum, item)=> sum + (item.size || 0), 0);
    if (totalSizeEl) totalSizeEl.textContent = formatBytes(total);
    if (!files.length){
      const message = currentZipName
        ? 'The uploaded ZIP '+esc(currentZipName)+' does not contain any files.'
        : 'Upload a ZIP file containing your project.';
      list.innerHTML = '<div class="empty">'+message+'</div>';
      return;
    }
    list.innerHTML = files.map((item, index)=>{
      const displayPath = item.path || 'unknown';
      const typeLabel = summarizeType(item);
      const sizeLabel = formatBytes(item.size || 0);
      return '<div class="item">\
<span class="name">'+esc(displayPath)+'</span>\
<span class="meta">'+esc(typeLabel)+', '+sizeLabel+'</span>\
<button class="remove" data-index="'+index+'" aria-label="Remove '+esc(displayPath)+'" title="Remove">×</button>\
</div>';
    }).join('');
  }

  function clearSelection(){
    files = [];
    currentZipName = '';
    commonBase = '';
    renderList();
    if (fi) fi.value = '';
  }

  list.addEventListener('click', (e)=>{
    const btn = e.target && e.target.closest && e.target.closest('button.remove');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-index'));
    if (Number.isInteger(idx) && idx >= 0 && idx < files.length){
      files.splice(idx, 1);
      renderList();
    }
  });
  if (clearBtn){
    clearBtn.addEventListener('click', ()=>{
      clearSelection();
      log('ZIP selection cleared.');
    });
  }

  function isZipFile(file){
    return file && typeof file.name === 'string' && /\.zip$/i.test(file.name);
  }

  async function loadZipFile(file){
    if (!file){
      log('Please select a ZIP file.');
      return;
    }
    if (!isZipFile(file)){
      log('Unsupported file type. Please provide a .zip archive.');
      return;
    }
    buildBtn.disabled = true;
    try{
      buildLog.textContent = '';
      log('Reading '+file.name+' ...');
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      const entries = [];
      const names = Object.keys(zip.files).sort((a,b)=> a.localeCompare(b));
      for (const name of names){
        const entry = zip.files[name];
        if (!entry || entry.dir) continue;
        const buffer = await entry.async('uint8array');
        entries.push({
          path: normalizePath(name),
          content: buffer,
          size: buffer.byteLength,
          binary: !isTextual(name)
        });
      }
      const htmlPaths = entries.filter(e=>isHtml(e.path)).map(e=>e.path);
      commonBase = computeCommonBase((htmlPaths.length ? htmlPaths : entries.map(e=>e.path)));
      files = entries;
      currentZipName = file.name;
      renderList();
      log('Loaded '+entries.length+' files from '+file.name+'.');
    } catch(err){
      files = [];
      currentZipName = '';
      commonBase = '';
      renderList();
      log('Failed to read ZIP: '+ (err && err.message ? err.message : err));
    } finally {
      buildBtn.disabled = false;
    }
  }

  window.addEventListener('dragover', e=>{ e.preventDefault(); });
  window.addEventListener('drop', async e=>{
    if (!e.dataTransfer) return;
    e.preventDefault();
    const candidates = Array.from(e.dataTransfer.files || []);
    const zipFile = candidates.find(isZipFile);
    if (!zipFile){
      log('Please drop a ZIP archive.');
      return;
    }
    await loadZipFile(zipFile);
  });
  dz.addEventListener('click', e=>{ if (e.target === dz && fi) fi.click(); });
  if (fi){
    fi.addEventListener('change', async e=>{
      const file = e.target && e.target.files ? e.target.files[0] : null;
      if (file) await loadZipFile(file);
      fi.value = '';
    });
  }

  renderList();

  // Show environment warning if opened via file:// (fetch of client bundle may be blocked)
  if (envWarning){
    if (location.protocol === 'file:'){
      envWarning.classList.remove('hidden');
      envWarning.innerHTML = 'You are opening the builder from <code>file://</code>. Some browsers block loading local files via <code>fetch()</code>, which can cause “Failed to fetch” when bundling the MapLogger client. Please run this page through a local server (e.g., VS Code “Live Server”) and open it via <code>http://localhost/...</code>.';
    }
  }
  // ---- Tasks (bubbles) ----
  function createTaskItem(value){
    const wrap = document.createElement('div');
    wrap.className = 'task-item';
    wrap.setAttribute('draggable','true');
    const input = document.createElement('input');
    input.className = 'task-input';
    input.type = 'text';
    input.placeholder = 'Describe the task (e.g., Find nearest pharmacy in Olomouc)';
    if (value) input.value = value;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove-task';
    btn.setAttribute('aria-label','Remove task');
    btn.title = 'Remove';
    btn.textContent = '×';
    wrap.appendChild(input);
    wrap.appendChild(btn);
    // events
    input.addEventListener('input', updateTaskPreview);
    btn.addEventListener('click', ()=>{
      const idx = taskInputs.indexOf(input);
      if (idx !== -1){ taskInputs.splice(idx,1); }
      wrap.remove();
      ensureAtLeastOneTask();
      updateTaskPreview();
    });
    // Drag events
    wrap.addEventListener('dragstart', (e)=>{
      wrap.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(taskInputs.indexOf(input)));
    });
    wrap.addEventListener('dragend', ()=>{ wrap.classList.remove('dragging'); });
    return {wrap, input};
  }
  function addTask(value){
    const {wrap, input} = createTaskItem(value||'');
    tasksListEl.appendChild(wrap);
    taskInputs.push(input);
    input.focus();
    updateTaskPreview();
  }
  function ensureAtLeastOneTask(){
    if (!taskInputs.length){ addTask(''); }
  }
  function getTasks(){
    return taskInputs.map(i=>i.value.trim()).filter(Boolean);
  }
  function updateTaskPreview(){
    const tasks = getTasks();
    const first = tasks.length ? tasks[0] : '';
    if (taskPreviewLabel){ taskPreviewLabel.textContent = first ? ('Task 1 – ' + first) : 'Task 1'; }
    if (tasksCountEl){ tasksCountEl.textContent = String(tasks.length); }
    updateWorkflow();
  }
  function updateWorkflow(){
    if (!workflowEl) return;
    const parts = [];
    const hasWelcome = !!(welcomeMessageEl && welcomeMessageEl.value && welcomeMessageEl.value.trim());
    if (hasWelcome){ parts.push({type:'welcome', label:'Welcome'}); }
    const tasks = getTasks();
    for (let i=0;i<tasks.length;i++){
      parts.push({type:'task', num:i+1, label:'Task '+(i+1)});
    }
    const html = parts.map((p,idx)=>{
      const step = '<span class="wf-step'+(p.type==='welcome'?' welcome':'')+'">'+(p.type==='task'?'<span class="num">'+p.num+'</span>':'')+'<span class="label">'+p.label+'</span></span>';
      const sep = (idx<parts.length-1)?'<span class="wf-sep">→</span>':'';
      return step+sep;
    }).join('');
    workflowEl.innerHTML = html || '<span class="help">No tasks yet. Add at least one task to start the flow.</span>';
  }
  if (welcomeMessageEl){ welcomeMessageEl.addEventListener('input', updateTaskPreview); }
  if (addTaskBtn){ addTaskBtn.addEventListener('click', ()=> addTask('')); }
  // initial task bubbles: one default exploratory task (editable) to encourage warm-up, can be deleted
  if (tasksListEl){ addTask(DEFAULT_TASK); }

  // Handle drag-over reordering
  tasksListEl.addEventListener('dragover', (e)=>{
    e.preventDefault();
    const dragging = tasksListEl.querySelector('.task-item.dragging');
    if (!dragging) return;
    const afterEl = Array.from(tasksListEl.querySelectorAll('.task-item:not(.dragging)'))
      .find(el => e.clientY < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2);
    if (afterEl){ tasksListEl.insertBefore(dragging, afterEl); }
    else { tasksListEl.appendChild(dragging); }
  });
  tasksListEl.addEventListener('drop', ()=>{
    // Recompute order of taskInputs based on DOM order
    const inputsOrdered = Array.from(tasksListEl.querySelectorAll('.task-item .task-input'));
    taskInputs = inputsOrdered;
    updateTaskPreview();
  });

  function isHtml(name){ return /\.x?html?$/i.test(name); }
  function isTextual(name){ return isHtml(name) || /\.(css|js|json|md)$/i.test(name); }

  function readFileAsText(item){
    try{
      return Promise.resolve(textDecoder.decode(item.content));
    }catch(e){
      return Promise.resolve(textDecoder.decode(item.content));
    }
  }

  async function loadClientBundle(){
    async function getText(path){ const res = await fetch(path); if(!res.ok) throw new Error('Failed to fetch '+path+' '+res.status); return await res.text(); }
    const [clientJs, clientCss] = await Promise.all([
      getText('client/maplogger-client.js'),
      getText('client/maplogger.css')
    ]);
    return {"client/maplogger-client.js": clientJs, "client/maplogger.css": clientCss};
  }

  const LICENSE_TXT = "MIT License included with MapLogger.";
  const README_MD = "# MapLogger\nThis ZIP was generated by MapLogger Builder.";

  function injectIntoHtml(html, tasks, sessionKey, welcomeMessage, includeClient=true, includeWelcomeStyle=false, csvBaseName, pushDownFixed){
    const tasksJson = JSON.stringify(tasks);
    const welcomeStyle = includeWelcomeStyle ? ('<style>.ml-welcome{background:#0e1521;border:1px solid #1d2938;border-radius:12px;margin:1rem auto;padding:1rem;max-width:900px}.ml-welcome-inner h2{margin:.2rem 0 .5rem;font-size:1.1rem;color:#1a1a1a}.ml-welcome-inner p{margin:0}</style>') : '';
    let headInject;
    if (includeClient){
      // We disable the strict requirement to start on index.html because the index page intentionally does NOT load the client when a welcome intro is used.
      headInject = '<link rel="stylesheet" href="client/maplogger.css">\n' +
  '<script>window.MAPLOGGER_TASKS='+tasksJson+'; window.MAPLOGGER_CONFIG={ aoi:{minArea:48}, csvFilename:"'+(csvBaseName? csvBaseName+".csv" : "maplogger_log.csv")+'", pushDownFixed:'+ (pushDownFixed? 'true':'false') +', toolbarMode:"inline", toolbarPlacementStrategy:"top", toolbarPlacementSelector:"header, nav, [role=\\"navigation\\"], .navbar, .topbar", sessionKey:"'+(sessionKey||'ml_default')+'", welcomeMessage:'+JSON.stringify(welcomeMessage||'')+', requireIndexStart:false };</'+'script>\n' +
        '<script defer src="client/maplogger-client.js"></'+'script>' + welcomeStyle;
    } else {
      headInject = welcomeStyle;
    }
    let modified = html;
    if (/<\/head>/i.test(html)) modified = html.replace(/<\/head>/i, headInject+"\n</head>");
    else modified = headInject + "\n" + html;
    {
      const toolbar = '<div id="ml-toolbar" class="ml-toolbar" role="region" aria-label="Experiment task toolbar">\
<div class="ml-left"><strong id="ml-task-label">Task 1</strong></div>\
<div class="ml-right"><button id="ml-next" class="ml-btn ml-accent" aria-label="Next task">Next →</button>\
<button id="ml-end" class="ml-btn ml-danger ml-hidden" aria-label="End experiment">END</button></div></div>';
      if (/<body[^>]*>/i.test(modified)) modified = modified.replace(/<body([^>]*)>/i, (m,a)=>'<body'+a+'>'+toolbar);
      else modified = toolbar + modified;
    }
    return modified;
  }

  // New: child-only injection (no toolbar in page). Page runs inside an iframe; events are forwarded to host via postMessage.
  function injectChildIntoHtml(html, sessionKey, csvBaseName, cssHref, jsSrc){
    const cssPath = cssHref || 'client/maplogger.css';
    const jsPath = jsSrc || 'client/maplogger-client.js';
    const headInject = '<link rel="stylesheet" href="'+cssPath+'">\n'
      + '<script>window.MAPLOGGER_TASKS=[]; window.MAPLOGGER_CONFIG={ role:"child", csvFilename:"'+(csvBaseName? csvBaseName+".csv" : "maplogger_log.csv")+'", sessionKey:"'+(sessionKey||'ml_default')+'", requireIndexStart:false };</'+'script>\n'
      + '<script defer src="'+jsPath+'"></'+'script>';
    let modified = html;
    if (/<\/head>/i.test(html)) modified = html.replace(/<\/head>/i, headInject+"\n</head>");
    else modified = headInject + "\n" + html;
    return modified;
  }

  // New: host shell with fixed toolbar on top and iframe below filling the viewport
  function synthesizeHostShell(pages, tasks, sessionKey, csvBaseName, welcomeMsg, assets){
    const cssHref = (assets && assets.cssHref) || 'client/maplogger.css';
    const jsSrc = (assets && assets.jsSrc) || 'client/maplogger-client.js';
    const tasksJson = JSON.stringify(tasks && tasks.length ? tasks : ["Task 1"]);
    const pagesJson = JSON.stringify(Array.isArray(pages)? pages : []);
  const css = '.host-body{margin:0;background:#0b111b;color:#e7ecf3;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Helvetica,Arial,sans-serif;overflow:hidden}#ml-toolbar{position:fixed;top:0;left:0;right:0;z-index:2147483647}.host-main{position:fixed;left:0;right:0;bottom:0;top:0}#ml-frame-wrap{position:absolute;left:0;right:0;bottom:0;top:0;background:transparent}#ml-frame{border:0;display:block;width:100%;height:100%}.host-welcome{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;padding:1rem} .host-card{max-width:900px;width:min(92%,900px);background:#0e1521;border:1px solid #1d2938;border-radius:14px;box-shadow:0 20px 80px rgba(0,0,0,.45);padding:1rem 1.25rem} .host-card h1{margin:.2rem 0 .6rem;font-size:1.2rem;color:#e7ecf3} .host-card p{color:#a3b1c6;margin:.4rem 0 .8rem} .host-row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap} .host-select{background:#0e1521;border:1px solid #1d2938;border-radius:10px;color:#e7ecf3;padding:.45rem .6rem;font:inherit} .host-btn{background:#7df0a6;color:#05311b;border:0;border-radius:12px;padding:.55rem .9rem;font-weight:800;cursor:pointer} .host-hidden{display:none!important}';
    const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>MapLogger – Host</title>'
      + '<link rel="stylesheet" href="'+cssHref+'">'
      + '<style>'+css+'</style>'
  + '<script>window.MAPLOGGER_TASKS='+tasksJson+'; window.MAPLOGGER_CONFIG={ role:"host", deferStart:true, csvFilename:"'+(csvBaseName? csvBaseName+".csv" : "maplogger_log.csv")+'", sessionKey:"'+(sessionKey||'ml_default')+'", requireIndexStart:false, pages:'+pagesJson+' };</'+'script>'
      + '<script defer src="'+jsSrc+'"></'+'script>';
  // Toolbar starts hidden (will be revealed after user clicks Start)
  const toolbar = '<div id="ml-toolbar" class="ml-toolbar host-hidden" role="region" aria-label="Experiment task toolbar">\
<div class="ml-left"><strong id="ml-task-label">Task 1</strong></div>\
<div class="ml-right"><button id="ml-next" class="ml-btn ml-accent" aria-label="Next task">Next →</button>\
<button id="ml-end" class="ml-btn ml-danger ml-hidden" aria-label="End experiment">END</button></div></div>';
    const bodyScript = '(function(){\n' +
      ' try{ if (window.top !== window) window.top.location = window.location.href; }catch(e){}\n' +
      ' var pages = (window.MAPLOGGER_CONFIG && window.MAPLOGGER_CONFIG.pages) || [];\n' +
      ' var sel = document.getElementById("ml-page");\n' +
      ' for (var i=0;i<pages.length;i++){ var o=document.createElement("option"); o.value=pages[i]; o.textContent=pages[i]; sel.appendChild(o); }\n' +
      ' function adj(){ var tb=document.getElementById("ml-toolbar"); var fw=document.getElementById("ml-frame-wrap"); if(!tb||!fw) return; var r=tb.getBoundingClientRect(); fw.style.top = Math.ceil(r.height||0)+"px"; }\n' +
  ' function start(){ var v = sel && sel.value ? sel.value : (pages[0]||""); var fw=document.getElementById("ml-frame-wrap"); var fr=document.getElementById("ml-frame"); var wl=document.getElementById("ml-welcome"); var tb=document.getElementById("ml-toolbar"); if (v){ fr.src = v; fw.classList.remove("host-hidden"); wl.classList.add("host-hidden"); if (tb) tb.classList.remove("host-hidden"); adj(); setTimeout(function(){ if (window.__ML_HOST_BOOT) window.__ML_HOST_BOOT(); }, 30); } }\n' +
      ' document.getElementById("ml-start").addEventListener("click", start);\n' +
      ' window.addEventListener("load", adj); window.addEventListener("resize", adj); setTimeout(adj,50); setTimeout(adj,300);\n' +
      '})();';
    const body = '<body class="host-body">'+toolbar+'<main class="host-main"><div id="ml-welcome" class="host-welcome"><div class="host-card">'
      + '<h1>Welcome</h1><p>'+ (welcomeMsg ? String(welcomeMsg).replace(/</g,'&lt;') : 'Select a page to begin the study.') +'</p>'
      + '<div class="host-row"><label for="ml-page">Start page:</label><select id="ml-page" class="host-select"></select><button id="ml-start" class="host-btn">Start</button></div>'
      + '</div></div><div id="ml-frame-wrap" class="host-hidden"><iframe id="ml-frame"></iframe></div></main>'
      + '<script>'+bodyScript+'</'+'script>'
      + '</body>';
    return '<!doctype html><html lang="en"><head>'+head+'</head>'+body+'</html>';
  }

  function injectWelcomeBlock(html, message){
    if (!message) return html;
    const welcome = '<section class="ml-welcome" role="region" aria-label="Welcome"><div class="ml-welcome-inner">'+
      '<h2>Welcome</h2><p>'+message.replace(/</g,'&lt;')+'</p></div></section>';
    if (/<body[^>]*>/i.test(html)) return html.replace(/<body([^>]*)>/i, (m,a)=>'<body'+a+'>'+welcome);
    return welcome + html;
  }

  function synthesizeIndexPage(htmlNames, sessionKey, tasks, welcomeMsg, csvBaseName){
    const links = htmlNames.map(n => '<li><a href="'+n+'">'+n+'</a></li>').join('\n');
    const tasksJson = JSON.stringify(tasks && tasks.length ? tasks : ["Open a page to begin."]);
    const welcomeHtml = (welcomeMsg && welcomeMsg.trim()) ? ('<section class="ml-welcome" role="region" aria-label="Welcome"><div class="ml-welcome-inner"><h2>Welcome</h2><p>'+String(welcomeMsg).replace(/</g,'&lt;')+'</p></div></section>') : '';
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\
<title>MapLogger – Experiment</title><style>.ml-welcome{background:#0e1521;border:1px solid #1d2938;border-radius:12px;margin:1rem auto;padding:1rem;max-width:900px}.ml-welcome-inner h2{margin:.2rem 0 .5rem;font-size:1.1rem;color:#e7ecf3}.ml-welcome-inner p{margin:0;color:#a3b1c6}</style></head>\
<body>'+welcomeHtml+'\
<main style="max-width:900px;margin:4rem auto 2rem;padding:0 1rem;font:16px/1.5 system-ui">\
<h1>Experiment entry</h1><p>Select a page to begin the study.</p><ul>'+links+'</ul></main></body></html>';
  }

  // session key is now derived automatically from output name; helper kept minimal
  function deriveSessionKey(outBase){ return (outBase||'ml_default').toLowerCase(); }

  // Heuristic for inline injection no longer used in host/iframe architecture.

  buildBtn.addEventListener('click', async ()=>{
    buildLog.textContent = "";
    // Basic validations and confirmations
  if (!files.length){ log("No ZIP archive loaded."); return; }
    const hasHtml = files.some(f => isHtml(f.path));
    if (!hasHtml){ log("No HTML files found. Please add at least one HTML page to inject."); return; }
  const tasks = getTasks();
    if (!tasks.length){ log("No tasks provided. Please add at least one task."); return; }
    if (tasks.length===1 && tasks[0]===DEFAULT_TASK){
      const proceed = window.confirm("You are using the default exploratory Task 1 without changes. Do you want to continue?");
      if (!proceed) return;
    }
    const welcomeEmpty = !(welcomeMessageEl && welcomeMessageEl.value && welcomeMessageEl.value.trim());
    if (welcomeEmpty){
      const proceed = window.confirm("No Welcome message set. The entry page will start without an introduction. Continue anyway?");
      if (!proceed) return;
    }
    const outBase = slugifyName(outputNameEl && outputNameEl.value);
    if (!outBase){ log("Please provide an output name."); return; }
    const sessionKey = deriveSessionKey(outBase);
    // Prevent double-clicks during build
    buildBtn.disabled = true;
    const zip = new JSZip();
    const clientCssTarget = 'client/maplogger.css';
    const clientJsTarget = 'client/maplogger-client.js';
    try{
      const clientFiles = await loadClientBundle();
      for (const [p,c] of Object.entries(clientFiles)) zip.file(p, c);
      zip.file("LICENSE", LICENSE_TXT);
      zip.file("README.md", README_MD);
    } catch (e){
      log("Error loading client bundle: " + (e && e.message ? e.message : e));
      return;
    }
  // First pass: read all HTML texts (for reuse below)
    const htmlSources = new Map();
    for (const f of files){
      if (isHtml(f.path)){
        try{ const txt = await readFileAsText(f); htmlSources.set(f.path, txt); }catch(e){ log("Error reading "+f.path+": "+e); }
      }
    }
    if (!htmlSources.size){
      log("No HTML files found in the uploaded ZIP. Please include at least one .html page.");
      buildBtn.disabled = false;
      return;
    }
  // In host/iframe mode, layout heuristics are not needed; no log noise.

    let htmlNames = [];
    let originalIndexName = null;
    for (const f of files){
      try{
        if (isTextual(f.path)){
          const cached = htmlSources.get(f.path);
          const txt = isHtml(f.path) ? (cached !== undefined ? cached : await readFileAsText(f)) : await readFileAsText(f);
          if (isHtml(f.path)){
            const isIndex = /(^|\/)index\.?html?$/i.test(f.path);
            if (isIndex) originalIndexName = f.path;
            const dir = dirnamePath(f.path);
            const cssHref = relativePath(dir, clientCssTarget) || 'client/maplogger.css';
            const jsSrc = relativePath(dir, clientJsTarget) || 'client/maplogger-client.js';
            // New framing approach: inject child-only client (no toolbar) into every HTML page
            const modified = injectChildIntoHtml(txt, sessionKey, outBase, cssHref, jsSrc);
            zip.file(f.path, modified);
            htmlNames.push(f.path);
            log("Prepared child client in " + f.path);
          } else {
            zip.file(f.path, txt);
            log("Added " + f.path);
          }
        } else {
          zip.file(f.path, f.content);
          log("Added binary " + f.path);
        }
      } catch (e){
        log("Error processing " + f.path + ": " + (e && e.message ? e.message : e));
      }
    }
    // Create host shell as the entry point (ml-host.html) targeting original index.html if present, else first HTML file
    if (htmlNames.length){
      const hostDir = originalIndexName ? dirnamePath(originalIndexName) : trimTrailingSlash(commonBase);
      const hostFileName = originalIndexName ? "ml-host.html" : "index.html";
      const hostPath = joinPath(hostDir, hostFileName);
      const hostCssHref = relativePath(hostDir, clientCssTarget) || 'client/maplogger.css';
      const hostJsSrc = relativePath(hostDir, clientJsTarget) || 'client/maplogger-client.js';
      const hostPages = htmlNames.map(name => relativePath(hostDir, name) || name);
      const welcomeMsg = (welcomeMessageEl && welcomeMessageEl.value) ? welcomeMessageEl.value.trim() : '';
      const hostHtml = synthesizeHostShell(hostPages, tasks, sessionKey, outBase, welcomeMsg, { cssHref: hostCssHref, jsSrc: hostJsSrc });
      zip.file(hostPath, hostHtml);
      log("Created host shell "+hostPath+" (open this file to run the study).");
    }
    const blob = await zip.generateAsync({type:"blob"});
    saveAs(blob, outBase + ".zip");
    log("Done. ZIP generated.");
    buildBtn.disabled = false;
  });
})();
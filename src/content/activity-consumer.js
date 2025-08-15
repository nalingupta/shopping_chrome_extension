
  var tracker = null;
  var isOn = false;
  var _boundMove = null;
  var _lastPoint = null;
  var _lastEl = null;
  var _bucket = [];
  var _bucketTimerId = null;
  var _bucketWindowMs = (function(){ try { return (window && window.__MOUSE_BUCKET_FLUSH_MS__) || 1000; } catch(e) { return 1000; } })(); // groups ~5 samples at 100ms
  var _bucketIndex = 0;
  var _startedAtMs = 0;
  var _nodeSelect = null;
  var _lastVisualTs = 0;
  var _visualMinGapMs = 150; // throttle visual pings


  function safeGet(obj, key) {
    try { return obj && obj[key]; } catch (e) { return undefined; }
  }

  function ensureNodeSelect() {
    if (_nodeSelect) return _nodeSelect;
    try {
      if (typeof NodeSelect !== 'undefined') {
        _nodeSelect = new NodeSelect({ outlineColor: 'red', outlineMs: 1000 });
      }
    } catch (e) {}
    return _nodeSelect;
  }

  function processWithNodeSelect(node) {
    var ns = ensureNodeSelect();
    try {
      if (ns && typeof ns.process === 'function') {
        return ns.process(node);
      }
    } catch (e) {}

  }

  function buildBucketSummary(items, meta) {
    var links = [];
    var texts = [];
    try {
      var len = (items && items.length) || 0;
      for (var i = 0; i < len; i++) {
        var it = items[i];
        if (!it || !it.node) continue;
        var section = null;
        try { section = it.node.section; } catch (e) { section = null; }
        if (!section) continue;

        // Collect text from section
        try {
          var t = section.text != null ? section.text : section.textSnippet;
          if (t) {
            t = String(t).replace(/\s+/g, ' ').trim();
            if (t) { texts.push(t); }
          }
        } catch (e2) {}

        // Collect links from section
        try {
          var ls = Array.isArray(section.links) ? section.links : [];
          for (var j = 0; j < ls.length; j++) {
            var l = ls[j];
            if (!l || !l.href) continue;
            var href = String(l.href);
            if (!href || /^\s*$/.test(href)) continue;
            if (href.toLowerCase().indexOf('javascript:') === 0) continue;
            var lt = '';
            try { lt = (l.text || l.title || '').toString().replace(/\s+/g, ' ').trim(); } catch (e3) { lt = ''; }
            links.push({ href: href, text: lt });
          }
        } catch (e4) {}
      }
    } catch (e5) {}

    // Dedupe links by href|text and texts by value, preserving order
    var seenLink = Object.create(null);
    var uniqueLinks = [];
    for (var a = 0; a < links.length; a++) {
      var lk = links[a];
      var key = (lk.href || '') + '|' + (lk.text || '');
      if (seenLink[key]) continue;
      seenLink[key] = true;
      uniqueLinks.push(lk);
    }

    var seenText = Object.create(null);
    var uniqueTexts = [];
    for (var b = 0; b < texts.length; b++) {
      var tv = texts[b];
      if (!tv) continue;
      if (seenText[tv]) continue;
      seenText[tv] = true;
      uniqueTexts.push(tv);
    }

    return { links: uniqueLinks, texts: uniqueTexts };
  }


  function ensureTracker() {
    if (tracker) return tracker;
    try {
      tracker = new MouseActivityTracker({ debug: true });
    } catch (e) {
      try { console.warn('MouseActivityTracker unavailable', e); } catch (e2) {}
      tracker = null;
    }
    return tracker;
  }

  function start() {
    if (isOn) return { ok: true, already: true };
    var t = ensureTracker();
    if (!t) return { ok: false, error: 'tracker-not-available' };
    try { t.setDebug(false); } catch (e) {}
    try { t.start(); isOn = true; } catch (e) { return { ok: false, error: 'start-failed' }; }

    // Track the current element under cursor for hover summaries
    if (!_boundMove) {
      _boundMove = function (event) {
        var x = event && (event.clientX || (event.touches && event.touches[0] && event.touches[0].clientX) || 0);
        var y = event && (event.clientY || (event.touches && event.touches[0] && event.touches[0].clientY) || 0);
        _lastPoint = { x: x, y: y };
        try {
          var el = (typeof document.elementFromPoint === 'function') ? document.elementFromPoint(x, y) : null;
          _lastEl = el || (event && event.target) || null;
        } catch (e) { _lastEl = (event && event.target) || null; }
      };
      try { document.addEventListener('mousemove', _boundMove, false); } catch (e) {}
      // Optional: also track touchmove if needed
      try { document.addEventListener('touchmove', _boundMove, false); } catch (e) {}
    }

    // Initialize bucketing state and timer
    _startedAtMs = Date.now();
    _bucket = [];
    _bucketIndex = 0;
    if (_bucketTimerId) { try { clearInterval(_bucketTimerId); } catch (e) {} }
    _bucketTimerId = setInterval(function flushBucket() {
      if (!_bucket || _bucket.length === 0) return;
      var items = _bucket.slice(0);
      _bucket.length = 0;
      var firstRel = items[0] && typeof items[0].tsRelMs === 'number' ? items[0].tsRelMs : 0;
      var lastRel = items[items.length - 1] && typeof items[items.length - 1].tsRelMs === 'number' ? items[items.length - 1].tsRelMs : firstRel;
      var payload = {
        startedAtMs: _startedAtMs,
        bucketMs: _bucketWindowMs,
        index: _bucketIndex++,
        rangeRelMs: { start: firstRel, end: lastRel },
        items: items
      };


      try {
        payload.summary = buildBucketSummary(items, payload);
      } catch (e) {}
      try { chrome.runtime.sendMessage({ type: 'HOVER_CAPTURE_BUCKET_FLUSH', data: payload }); } catch (e) {}
    }, _bucketWindowMs);

    // Subscribe to tracker events and take decisions
    if (!t._decisionUnsub) {
      t._decisionUnsub = t.events$.subscribe(function (ev) {
        if (!ev) return;
        // Primary state decisions
        if (ev.kind === 'state') {
          // Accumulate every sample into current bucket
          
          if (ev.state === 'Idle') {
            // Don't handle these event
          } else if (ev.state === 'Hovering') {
            // Visual ping on Hovering (throttled)
            try {
              var nowHover = Date.now();
              if (nowHover - _lastVisualTs >= _visualMinGapMs) {
                try {
                  var now = Date.now();
                  var entry = {
                    tsAbsMs: now,
                    tsRelMs: Math.max(0, now - _startedAtMs),
                    state: ev.state,
                    distancePx: ev.distancePx,
                    intervalMs: ev.intervalMs,
                    changed: !!ev.changed,
                    node: processWithNodeSelect(_lastEl)
                  };
                  
                } catch (e) {}
                _bucket.push(entry);
                _lastVisualTs = nowHover;
              }
            } catch (e) {}
          } else if (ev.state === 'Moving') {
            // Example decision: hide tooltip, reset hover timers
          } else if (ev.state === 'Clicking') {
            // Example decision: lock interactions briefly
          }
        }
        // Sub-event transitions
        else if (ev.kind === 'sub') {
          if (ev.name === 'MovementStarted') {
            // Example: start duration timer
          } else if (ev.name === 'MovementEnded') {
            // Example: commit movement summary
          } else if (ev.name === 'ClickStarted') {
            // Example: start click UX
          } else if (ev.name === 'ClickEnded') {
            // Example: end click UX
          }
        }

      });
    }
    return { ok: true };
  }

  function stop() {
    if (!isOn) return { ok: true, already: true };
    if (tracker) {
      // Cleanup decision subscription before destroying
      try { tracker._decisionUnsub && tracker._decisionUnsub(); } catch (e) {}
      try { delete tracker._decisionUnsub; } catch (e) {}
      try { tracker.destroy(); } catch (e) {}
    }
    // Remove cursor tracking listeners
    try { _boundMove && document.removeEventListener('mousemove', _boundMove, false); } catch (e) {}
    try { _boundMove && document.removeEventListener('touchmove', _boundMove, false); } catch (e) {}
    _boundMove = null;
    _lastPoint = null;
    _lastEl = null;
    // Stop bucketing
    if (_bucketTimerId) { try { clearInterval(_bucketTimerId); } catch (e) {} _bucketTimerId = null; }
    _bucket = [];
    _bucketIndex = 0;
    _startedAtMs = 0;
    tracker = null;
    isOn = false;
    return { ok: true };
  }

  function updateConfig(cfg) {
    if (!tracker) return { ok: false, error: 'not-running' };
    try { tracker.updateConfig(cfg || {}); return { ok: true }; } catch (e) { return { ok: false, error: 'update-failed' }; }
  }

  function onSessionModeChanged(mode) {
    try {
      if (mode === 'ACTIVE') {
        start();
      } else if (mode === 'IDLE') {
        stop();
      }
    } catch (e) {}
  }

  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    switch (message && message.action) {
      case 'mouse:start':
        sendResponse && sendResponse(start());
        break;
      case 'mouse:stop':
        sendResponse && sendResponse(stop());
        break;
      case 'mouse:status':
        sendResponse && sendResponse({ ok: true, on: isOn });
        break;
      case 'mouse:updateConfig':
        sendResponse && sendResponse(updateConfig(message.config));
        break;
    }
  });

  try {
    chrome.runtime.onMessage.addListener(function(msg) {
      try {
        if (msg && msg.type === 'SESSION_MODE_CHANGED') {
          onSessionModeChanged(msg.mode);
        }
      } catch (e) {}
    });
  } catch (e) {}

  try {
    chrome.storage.onChanged.addListener(function(changes, namespace) {
      try {
        if (namespace === 'local' && changes && changes.sessionMode) {
          onSessionModeChanged(changes.sessionMode.newValue);
        }
      } catch (e) {}
    });
  } catch (e) {}

  try {
    chrome.storage.local.get(['sessionMode'], function(res) {
      try {
        var m = res && res.sessionMode;
        if (m) onSessionModeChanged(m);
      } catch (e) {}
    });
  } catch (e) {}


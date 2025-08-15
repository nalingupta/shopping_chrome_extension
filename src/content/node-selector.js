(function (global) {
  'use strict';

  function NodeSelect(options) {
      this.options = options || {};
  }

  NodeSelect.prototype.process = function (node) {
      var selectedEl = toElement(node);
      // Identify a containing "section" ancestor that has a visual boundary (border or box-shadow)
      var sectionPick = findSectionAncestor(selectedEl);
      // Visual feedback on the picked section (not the leaf selection)
      
      // try { highlightElement(sectionPick && sectionPick.el, this.options); } catch (e) {}

      // Build a rich summary including upward path and key children of the section
      var summary = buildSectionSummary({ selectedEl: selectedEl, sectionEl: sectionPick && sectionPick.el, reason: sectionPick && sectionPick.reason });
      // try {
      //     if (typeof console !== 'undefined' && console.log) {
      //         console.log('[NodeSelect] process', summary);
      //     }
      // } catch (e) {}
      return summary;
  };

  function summarizeNode(node) {
      // Only collect text and links inside the node
      if (!node) return { text: '', links: [] };

      var rootEl = null;
      try {
          if (node.nodeType === 1) {
              rootEl = node;
          } else if (node.nodeType === 3 && node.parentElement) {
              rootEl = node.parentElement;
          }
      } catch (e) {}

      // If we cannot resolve an element container, fallback to node value
      if (!rootEl) {
          var fallbackText = '';
          try { fallbackText = (node.nodeValue || '').trim(); } catch (e2) {}
          return { text: fallbackText, links: [] };
      }

      // Collect text content
      var text = '';
      try {
          // Prefer textContent for cross-browser consistency; normalize whitespace
          text = (rootEl.textContent || '').replace(/\s+/g, ' ').trim();
      } catch (e3) { text = ''; }
      // For images, textContent is empty. Fall back to alt/aria-label/title/filename
      try {
          var isImg = String(rootEl.tagName || '').toUpperCase() === 'IMG';
          if ((!text || text.length === 0) && isImg) {
              var alt = rootEl.getAttribute && (rootEl.getAttribute('alt') || '');
              var ariaLabel = rootEl.getAttribute && (rootEl.getAttribute('aria-label') || '');
              var titleAttr = rootEl.getAttribute && (rootEl.getAttribute('title') || '');
              var src = rootEl.getAttribute && (rootEl.getAttribute('src') || '');
              var fileName = '';
              try { fileName = src ? src.split('/').pop().split('?')[0] : ''; } catch (e4) { fileName = ''; }
              var fallback = (alt || ariaLabel || titleAttr || fileName || '').replace(/\s+/g, ' ').trim();
              if (fallback) text = fallback;
          }
      } catch (e5) {}

      // Collect links within the element (including if root is a link)
      var links = [];
      try {
          // Include the root if it is an anchor with href
          if (rootEl.tagName === 'A' && rootEl.href) {
              var rootText = (rootEl.textContent || '').replace(/\s+/g, ' ').trim();
              links.push({ href: rootEl.href, text: rootText });
          }
          var anchors = rootEl.querySelectorAll ? rootEl.querySelectorAll('a[href]') : [];
          for (var i = 0; i < anchors.length; i++) {
              var a = anchors[i];
              try {
                  if (!a || !a.href) continue;
                  var href = a.href;
                  if (!href || /^\s*$/.test(href)) continue;
                  // Skip javascript: links
                  if ((href + '').toLowerCase().indexOf('javascript:') === 0) continue;
                  var t = (a.textContent || '').replace(/\s+/g, ' ').trim();
                  links.push({ href: href, text: t });
              } catch (e4) {}
          }
      } catch (e5) {}
      // If there are no descendant or root links, include nearest wrapping anchor (e.g., <a><img/></a>)
      try {
          if (!links.length && rootEl.closest) {
              var wrappingA = rootEl.closest('a[href]');
              if (wrappingA && wrappingA.href) {
                  var wrapText = (wrappingA.textContent || '').replace(/\s+/g, ' ').trim();
                  links.push({ href: wrappingA.href, text: wrapText });
              }
          }
      } catch (e6) {}

      return { text: text, links: links };
  }

  function safeGet(obj, key) {
      try { return obj && obj[key]; } catch (e) { return undefined; }
  }


  function toElement(node) {
      try {
          if (!node) return null;
          if (node.nodeType === 1) return node;
          if (node.nodeType === 3 && node.parentElement) return node.parentElement;
      } catch (e) {}
      return null;
  }

  function highlightElement(node, options) {
      if (!node) return;
      var el = null;
      try {
          if (node.nodeType === 1) {
              el = node;
          } else if (node.nodeType === 3 && node.parentElement) {
              el = node.parentElement;
          }
      } catch (e) {}
      if (!el || !el.style) return;
      var color = (options && options.outlineColor) || '#22c55e';
      var ms = (options && options.outlineMs) || 400;
      var prevOutline = el.style.outline;
      var prevOffset = el.style.outlineOffset;
      try {
          el.style.outline = '2px solid ' + color;
          el.style.outlineOffset = '2px';
      } catch (e) {}
      try {
          setTimeout(function () {
              try { el.style.outline = prevOutline || ''; } catch (e2) {}
              try { el.style.outlineOffset = prevOffset || ''; } catch (e3) {}
          }, ms);
      } catch (e) {}
  }

  function hasVisualBoundary(el) {
      if (!el || !el.ownerDocument) return { ok: false };
      try {
          var cs = el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle ? el.ownerDocument.defaultView.getComputedStyle(el) : null;
          if (!cs) return { ok: false };
          var borders = ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].map(function (k) { return parseFloat(cs[k]) || 0; });
          var anyBorder = borders.some(function (w) { return w > 0.1; }) && ['borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle'].some(function (k) { return (cs[k] || 'none') !== 'none'; });
          var boxShadow = cs.boxShadow || cs.webkitBoxShadow || 'none';
          var hasShadow = !!boxShadow && boxShadow !== 'none';
          if (anyBorder) return { ok: true, reason: 'border' };
          if (hasShadow) return { ok: true, reason: 'box-shadow' };
          return { ok: false };
      } catch (e) { return { ok: false }; }
  }

  function findSectionAncestor(startEl) {
      var el = startEl;
      var lastGood = null;
      while (el && el !== el.ownerDocument.documentElement) {
        // console.log(el , "-> ")
          var b = hasVisualBoundary(el);
          if (b.ok) { lastGood = { el: el, reason: b.reason }; break; }
          el = el.parentElement;
      }
      return lastGood || (startEl ? { el: startEl, reason: 'fallback' } : null);
  }

  function buildSectionSummary(ctx) {
      var selectedEl = ctx && ctx.selectedEl;
      var sectionEl = ctx && ctx.sectionEl;
      var reason = ctx && ctx.reason;
      var summary = {
          selected: summarizeNode(selectedEl || null),
          section: summarizeNode(sectionEl || null),
          sectionPickReason: reason || null,
          ancestors: [],
          childrenWithText: []
      };

      return summary;
  }

  // UMD export
  if (typeof module !== 'undefined' && module.exports) {
      module.exports = NodeSelect;
  } else {
      global.NodeSelect = NodeSelect;
  }
})(typeof window !== 'undefined' ? window : this);



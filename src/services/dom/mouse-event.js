// Lightweight mouse activity tracker with Rx-like Subject and debug logger
// - Primary states: Idle, Moving, Hovering, Clicking
// - Sub-events: MovementStarted, MovementEnded, ClickStarted, ClickEnded
// - Foundation: distance traveled per sample interval (default 100ms)
// - Extensible: addDerivedEvent(name, evaluator)
// - Debug mode: optional console logger, separate from stream logic


  var DEFAULTS = {
      sampleIntervalMs: 100,
      movementThresholdPx: 300, // >= this => Moving
      hoverThresholdPx: 200,    // >0 and <= this => Hovering
      debug: false
  };

  var PrimaryStates = {
      Idle: 'Idle',
      Moving: 'Moving',
      Hovering: 'Hovering',
      Clicking: 'Clicking'
  };

  var SubEventNames = {
      MovementStarted: 'MovementStarted',
      MovementEnded: 'MovementEnded',
      ClickStarted: 'ClickStarted',
      ClickEnded: 'ClickEnded'
  };

  // Minimal Subject (Rx-like)
  function Subject() {
      this._subscribers = [];
  }
  
  Subject.prototype.subscribe = function(handler) {
      if (typeof handler !== 'function') return function(){};
      var list = this._subscribers;
      list.push(handler);
      var isActive = true;
      return function unsubscribe() {
          if (!isActive) return;
          isActive = false;
          for (var i = 0; i < list.length; i++) {
              if (list[i] === handler) {
                  list.splice(i, 1);
                  break;
              }
          }
      };
  };
  Subject.prototype.next = function(value) {
      var list = this._subscribers.slice(0);
      for (var i = 0; i < list.length; i++) {
          try { list[i](value); } catch (e) {}
      }
  };

  function nowTs() {
      return Date.now ? Date.now() : new Date().getTime();
  }

  function extend(target) {
      for (var i = 1; i < arguments.length; i++) {
          var src = arguments[i] || {};
          for (var k in src) {
              if (Object.prototype.hasOwnProperty.call(src, k)) {
                  target[k] = src[k];
              }
          }
      }
      return target;
  }

  function distance(a, b) {
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      return Math.sqrt(dx * dx + dy * dy);
  }

  function MouseActivityTracker(options) {
      this.config = extend({}, DEFAULTS, options || {});
      this.events$ = new Subject(); // unified event stream

      this._isRunning = false;
      this._clicking = false;
      this._currentState = PrimaryStates.Idle;
      this._previousState = PrimaryStates.Idle;
      this._intervalId = null;

      this._movementAccumPx = 0;
      this._lastPoint = null;

      this._customEvaluators = []; // [{ name, evaluator(snapshot) }]

      // Bind handlers
      this._boundMove = this._handleMouseMove.bind(this);
      this._boundDown = this._handleMouseDown.bind(this);
      this._boundUp = this._handleMouseUp.bind(this);
      this._boundTick = this._onTick.bind(this);

      this._logger = null;
      if (this.config.debug) {
          this._logger = new MouseActivityConsoleLogger(this);
          this._logger.enable();
      }
  }

  MouseActivityTracker.PrimaryStates = PrimaryStates;
  MouseActivityTracker.SubEventNames = SubEventNames;

  MouseActivityTracker.prototype.start = function() {
      if (this._isRunning) return;
      this._isRunning = true;
      try {
          // Use capture=false for compatibility
          document.addEventListener('mousemove', this._boundMove, false);
          document.addEventListener('mousedown', this._boundDown, false);
          document.addEventListener('mouseup', this._boundUp, false);
      } catch (e) {}
      this._intervalId = setInterval(this._boundTick, this.config.sampleIntervalMs);
      // Emit initial state
      this._emitState(this._currentState, 0);
  };

  MouseActivityTracker.prototype.stop = function() {
      if (!this._isRunning) return;
      this._isRunning = false;
      try {
          document.removeEventListener('mousemove', this._boundMove, false);
          document.removeEventListener('mousedown', this._boundDown, false);
          document.removeEventListener('mouseup', this._boundUp, false);
      } catch (e) {}
      if (this._intervalId) {
          clearInterval(this._intervalId);
          this._intervalId = null;
      }
  };

  MouseActivityTracker.prototype.destroy = function() {
      this.stop();
      if (this._logger) {
          this._logger.disable();
          this._logger = null;
      }
      this._customEvaluators = [];
  };

  MouseActivityTracker.prototype.setDebug = function(enabled) {
      if (enabled && !this._logger) {
          this._logger = new MouseActivityConsoleLogger(this);
          this._logger.enable();
      } else if (!enabled && this._logger) {
          this._logger.disable();
          this._logger = null;
      }
  };

  MouseActivityTracker.prototype.updateConfig = function(partial) {
      var prev = this.config;
      this.config = extend({}, prev, partial || {});
      if (this._isRunning && partial && Object.prototype.hasOwnProperty.call(partial, 'sampleIntervalMs')) {
          // Restart timer to apply new interval
          clearInterval(this._intervalId);
          this._intervalId = setInterval(this._boundTick, this.config.sampleIntervalMs);
      }
  };

  // Allow adding derived/extension events based on each tick snapshot
  // evaluator(snapshot) => truthy (boolean) or an object { name?, detail? }
  MouseActivityTracker.prototype.addDerivedEvent = function(name, evaluator) {
      if (!name || typeof evaluator !== 'function') return function(){};
      var entry = { name: name, evaluator: evaluator };
      this._customEvaluators.push(entry);
      var list = this._customEvaluators;
      return function remove() {
          for (var i = 0; i < list.length; i++) {
              if (list[i] === entry) { list.splice(i, 1); break; }
          }
      };
  };

  MouseActivityTracker.prototype._handleMouseMove = function(event) {
      var x = event && (event.clientX || (event.touches && event.touches[0] && event.touches[0].clientX) || 0);
      var y = event && (event.clientY || (event.touches && event.touches[0] && event.touches[0].clientY) || 0);
      if (this._lastPoint) {
          this._movementAccumPx += distance(this._lastPoint, { x: x, y: y });
      }
      this._lastPoint = { x: x, y: y };
  };

  MouseActivityTracker.prototype._handleMouseDown = function(event) {
      this._clicking = true;
      var ts = nowTs();
      this.events$.next({
          kind: 'sub',
          name: SubEventNames.ClickStarted,
          ts: ts,
          state: PrimaryStates.Clicking,
          detail: { button: event && typeof event.button === 'number' ? event.button : null }
      });
      // Reflect clicking as current state immediately
      this._emitState(PrimaryStates.Clicking, 0);
  };

  MouseActivityTracker.prototype._handleMouseUp = function(/*event*/) {
      this._clicking = false;
      var ts = nowTs();
      this.events$.next({
          kind: 'sub',
          name: SubEventNames.ClickEnded,
          ts: ts,
          state: this._currentState
      });
      // State will be resolved on next tick
  };

  MouseActivityTracker.prototype._onTick = function() {
      var dist = this._movementAccumPx;
      this._movementAccumPx = 0;
      var nextState = this._decidePrimaryState(dist);
      this._emitState(nextState, dist);

      // Custom/derived evaluators
      if (this._customEvaluators.length) {
          var snapshot = {
              ts: nowTs(),
              intervalMs: this.config.sampleIntervalMs,
              distancePx: dist,
              clicking: this._clicking,
              state: this._currentState,
              previousState: this._previousState
          };
          for (var i = 0; i < this._customEvaluators.length; i++) {
              var entry = this._customEvaluators[i];
              try {
                  var result = entry.evaluator(snapshot);
                  if (result) {
                      var ev = (typeof result === 'object') ? result : { };
                      this.events$.next({
                          kind: 'sub',
                          name: ev.name || entry.name,
                          ts: snapshot.ts,
                          state: this._currentState,
                          detail: ev.detail
                      });
                  }
              } catch (e) {}
          }
      }
  };

  MouseActivityTracker.prototype._decidePrimaryState = function(distancePx) {
      if (this._clicking) return PrimaryStates.Clicking;
      if (!distancePx) return PrimaryStates.Idle;
      if (distancePx >= this.config.movementThresholdPx) return PrimaryStates.Moving;
      if (distancePx > 0 && distancePx <= this.config.hoverThresholdPx) return PrimaryStates.Hovering;
      // Between hoverThreshold and movementThreshold: treat as Moving (more intentional)
      return PrimaryStates.Moving;
  };

  MouseActivityTracker.prototype._emitState = function(nextState, distancePx) {
      var ts = nowTs();
      var prev = this._currentState;
      var changed = nextState !== prev;
      if (changed) {
          this._previousState = prev;
          this._currentState = nextState;
          // Movement sub-events on transitions
          if (prev !== PrimaryStates.Moving && nextState === PrimaryStates.Moving) {
              this.events$.next({ kind: 'sub', name: SubEventNames.MovementStarted, ts: ts, state: nextState });
          }
          if (prev === PrimaryStates.Moving && nextState !== PrimaryStates.Moving) {
              this.events$.next({ kind: 'sub', name: SubEventNames.MovementEnded, ts: ts, state: nextState });
          }
      }

      this.events$.next({
          kind: 'state',
          ts: ts,
          state: this._currentState,
          previousState: this._previousState,
          distancePx: distancePx,
          intervalMs: this.config.sampleIntervalMs,
          changed: changed
      });
  };

  // Optional logger kept separate from the activity stream
  function MouseActivityConsoleLogger(tracker, consoleLike) {
      this.tracker = tracker;
      this.console = consoleLike || (typeof console !== 'undefined' ? console : null);
      this._unsub = null;
  }
  MouseActivityConsoleLogger.prototype.enable = function() {
      if (!this.console || this._unsub) return;
      var c = this.console;
      return null;
      this._unsub = this.tracker.events$.subscribe(function(ev) {
          if (!ev) return;
          var ts = ev.ts || nowTs();
          if (ev.kind === 'state') {
              c.log('[MouseActivity]', ts, 'STATE', ev.state, ev.changed ? '(changed)' : '', 'dist=', Math.round(ev.distancePx || 0), 'ms=', ev.intervalMs);
          } else if (ev.kind === 'sub') {
              c.log('[MouseActivity]', ts, 'SUB', ev.name, 'state=', ev.state, ev.detail ? ev.detail : '');
          }
      });
  };
  MouseActivityConsoleLogger.prototype.disable = function() {
      if (this._unsub) { try { this._unsub(); } catch (e) {} this._unsub = null; }
  };

  // UMD export
  var exported = {
      MouseActivityTracker: MouseActivityTracker,
      MouseActivityConsoleLogger: MouseActivityConsoleLogger
  };
  if (typeof module !== 'undefined' && module.exports) {
      module.exports = exported;
  } else {
      (typeof window !== 'undefined' ? window : globalThis).MouseActivityTracker = MouseActivityTracker;
      (typeof window !== 'undefined' ? window : globalThis).MouseActivityConsoleLogger = MouseActivityConsoleLogger;
  }



module.exports = function tracker(preload, charset, cstamp,
stallXhr, stallTimeout, stallInterval, stallFrame,
emit) {
	var EV = {
		init: 0,
		ready: 1,
		load: 2,
		idle: 3,
		busy: 4,
		unload: 5
	};
	var lastEvent = EV.init;
	var lastRunEvent = EV.init;
	var hasLoaded = false;
	var hasReady = false;
	var missedEvent;
	var preloadList = [], observer;

	var intervals = {len: 0, stall: 0, inc: 1};
	var timeouts = {len: 0, stall: 0, inc: 1};
	var frames = {len: 0, stall: 0, ignore: !stallFrame};
	var requests = {len: 0, stall: 0};

	if (preload) disableExternalResources();

	var w = {};
	['setTimeout', 'clearTimeout',
	'setInterval', 'clearInterval',
	'XMLHttpRequest', 'WebSocket',
	'requestAnimationFrame', 'cancelAnimationFrame'].forEach(function(meth) {
		w[meth] = window[meth];
	});
	window['hasRunEvent_' + cstamp] = function(event) {
		if (EV[event] > lastRunEvent) {
			lastRunEvent = EV[event];
			check('lastrun' + event);
		}
	};

	document.charset = charset;

	window['ignore_' + cstamp] = ignoreListener;

	if (document.readyState != 'loading') readyListener();
	else document.addEventListener('DOMContentLoaded', readyListener, false);

	if (document.readyState == 'complete') loadListener();
	else window.addEventListener('load', loadListener, false);

	function disableExternalResources() {
		function jumpAuto(node) {
			var tag = node.nodeName.toLowerCase();
			var params = {
				body: ["onload", null],
				link: ["rel", ""],
				script: ["type", "text/plain"]
			}[tag];
			if (!params) return;
			var att = params[0];
			var val = node.hasAttribute(att) ? node[att] : undefined;
			if (lastEvent == EV.init) {
				node[att] = params[1];
				preloadList.push({node: node, val: val, att: att});
			}
		}
		observer = new MutationObserver(function(mutations) {
			var node, list;
			for (var m=0; m < mutations.length; m++) {
				list = mutations[m].addedNodes;
				if (!list) continue;
				for (var i=0; i < list.length; i++) {
					node = list[i];
					if (node.nodeType != 1) continue;
					jumpAuto(node);
				}
			}
		});
		observer.observe(document, {
			childList: true,
			subtree: true
		});
	}

	function loadListener() {
		if (hasLoaded) return;
		window.removeEventListener('load', loadListener, false);
		hasLoaded = true;
		if (lastEvent == EV.ready) {
			check('load');
		} else if (lastEvent < EV.ready) {
			missedEvent = EV.load;
		}
	}
	function readyListener() {
		if (hasReady) return;
		document.removeEventListener('DOMContentLoaded', readyListener, false);
		hasReady = true;
		if (lastEvent != EV.init) return;

		if (preloadList.length) {
			w.setTimeout.call(window, function() {
				preloadList.forEach(function(obj) {
					if (obj.val === undefined) obj.node.removeAttribute(obj.att);
					else obj.node[obj.att] = obj.val;
				});
				preloadList = [];
				check("ready");
				if (missedEvent == EV.load) {
					w.setTimeout.call(window, check.bind(this, 'load'), 0);
				}
			}, 0);
		} else {
			check("ready");
			if (missedEvent == EV.load) {
				w.setTimeout.call(window, check.bind(this, 'load'), 0);
			}
		}
	}

	function absolute(url) {
		return (new URL(url, document.location)).href;
	}

	function ignoreListener(uri) {
		if (!uri) return;
		if (!requests[uri]) requests[uri] = {count: 0};
		requests[uri].stall = true;
	}

	function checkTimeouts() {
		delete timeouts.to;
		timeouts.ignore = true;
		if (lastEvent == EV.load) check('timeout');
	}

	function doneTimeout(id) {
		var t;
		var obj = id != null && timeouts[id];
		if (obj) {
			if (obj.stall) timeouts.stall--;
			delete timeouts[id];
			timeouts.len--;
			if (timeouts.len <= timeouts.stall && !timeouts.ignore) {
				check('timeout');
			}
			t = obj.t;
		} else {
			t = id;
		}
		return t;
	}
	window.setTimeout = function setTimeout(fn, timeout) {
		var args = Array.from(arguments);
		var stall = false;
		timeout = timeout || 0;
		if (timeout >= stallTimeout) {
			stall = true;
			timeouts.stall++;
		}
		timeouts.len++;
		var obj = {
			fn: fn
		};
		args[0] = function(obj) {
			var err;
			try {
				obj.fn.apply(null, Array.from(arguments).slice(1));
			} catch (e) {
				err = e;
			}
			doneTimeout(obj.id);
			if (err) throw err; // rethrow
		}.bind(null, obj);
		var t = w.setTimeout.apply(window, args);
		var id = ++timeouts.inc;
		timeouts[id] = {stall: stall, t: t};
		obj.id = id;
		return id;
	};
	window.clearTimeout = function(id) {
		var t = doneTimeout(id);
		return w.clearTimeout.call(window, t);
	};

	function checkIntervals() {
		delete intervals.to;
		intervals.ignore = true;
		if (lastEvent == EV.load) check('interval');
	}

	window.setInterval = function(fn, interval) {
		var args = Array.from(arguments);
		interval = interval || 0;
		var stall = false;
		if (interval >= stallInterval) {
			stall = true;
			intervals.stall++;
		}
		intervals.len++;
		var t = w.setInterval.apply(window, args);
		var id = ++intervals.inc;
		intervals[id] = {stall: stall, t: t};
		return id;
	};
	window.clearInterval = function(id) {
		var t;
		var obj = id != null && intervals[id];
		if (obj) {
			if (obj.stall) intervals.stall--;
			delete intervals[id];
			intervals.len--;
			if (intervals.len <= intervals.stall && !intervals.ignore) {
				check('interval');
			}
			t = obj.t;
		} else {
			t = id;
		}
		return w.clearInterval.call(window, t);
	};

	function doneFrame(id) {
		if (id && frames[id]) {
			delete frames[id];
			frames.len--;
			if (frames.len <= frames.stall && !frames.ignore) {
				check('frame');
			}
		}
	}
	window.requestAnimationFrame = function(fn) {
		var id = w.requestAnimationFrame.call(window, function(ts) {
			var err;
			doneFrame(id);
			try {
				fn(ts);
			} catch (e) {
				err = e;
			}
			if (err) throw err; // rethrow
		});
		if (!frames.ignore) {
			frames.len++;
			frames[id] = true;
		}
		if (!frames.timeout && !frames.ignore) {
			frames.timeout = w.setTimeout.call(window, function() {
				frames.ignore = true;
				check('frame');
			}, stallFrame);
		}
		return id;
	};
	window.cancelAnimationFrame = function(id) {
		doneFrame(id);
		return w.cancelAnimationFrame.call(window, id);
	};

	if (window.WebSocket) window.WebSocket = function() {
		var ws = new w.WebSocket(Array.from(arguments));
		function checkws() {
			check('websocket');
		}
		function uncheckws() {
			this.removeEventListener('message', checkws);
			this.removeEventListener('close', uncheckws);
		}
		ws.addEventListener('message', checkws);
		ws.addEventListener('close', uncheckws);
		return ws;
	};

	var wopen = window.XMLHttpRequest.prototype.open;
	window.XMLHttpRequest.prototype.open = function(method, url, async) {
		if (this._private) xhrClean.call(this);
		this.addEventListener("progress", xhrProgress);
		this.addEventListener("load", xhrChange);
		this.addEventListener("error", xhrClean);
		this.addEventListener("abort", xhrClean);
		this.addEventListener("timeout", xhrClean);
		this._private = {url: absolute(url)};
		var ret = wopen.apply(this, Array.from(arguments));
		return ret;
	};
	var wsend = window.XMLHttpRequest.prototype.send;
	window.XMLHttpRequest.prototype.send = function() {
		var priv = this._private;
		if (!priv) return;
		requests.len++;
		try {
			wsend.apply(this, Array.from(arguments));
		} catch (e) {
			xhrClean.call(this);
			return;
		}
		var req = requests[priv.url];
		if (req) {
			if (req.stall) requests.stall++;
		} else {
			req = requests[priv.url] = {};
		}
		req.count = (req.count || 0) + 1;
		priv.timeout = xhrTimeout(priv.url);
	};
	function xhrTimeout(url) {
		return w.setTimeout.call(window, function() {
			var req = requests[url];
			if (req) {
				if (!req.stall) requests.stall++;
				req.count--;
				check('xhr timeout', url);
			}
		}, stallXhr);
	}
	function xhrProgress(e) {
		var priv = this._private;
		if (!priv) return;
		if (e.totalSize > 0 && priv.timeout) {
			// set a new timeout
			w.clearTimeout.call(window, priv.timeout);
			priv.timeout = xhrTimeout(priv.url);
		}
	}
	function xhrChange(e) {
		if (this.readyState != this.DONE) return;
		xhrClean.call(this);
	}
	function xhrClean() {
		var priv = this._private;
		if (!priv) return;
		this.removeEventListener("progress", xhrProgress);
		this.removeEventListener("load", xhrChange);
		this.removeEventListener("abort", xhrClean);
		this.removeEventListener("error", xhrClean);
		this.removeEventListener("timeout", xhrClean);
		if (priv.timeout) w.clearTimeout.call(window, priv.timeout);
		var req = requests[priv.url];
		if (req) {
			req.count--;
			if (req.stall) requests.stall--;
		}
		delete this._private;
		requests.len--;
		check('xhr clean');
	}

	function check(from, url) {
		var info = {
			timeouts: timeouts.len - timeouts.stall,
			intervals: intervals.len - intervals.stall,
			frames: frames.len - frames.stall,
			requests: requests.len - requests.stall,
			lastEvent: lastEvent,
			lastRunEvent: lastRunEvent
		};
		if (document.readyState == "complete") {
			// if loading was stopped (location change or else) the load event
			// is not emitted but readyState is complete
			hasLoaded = true;
		}
		w.setTimeout.call(window, function() {
			if (lastEvent <= lastRunEvent) {
				if (lastEvent == EV.load) {
					if ((timeouts.ignore || timeouts.len <= timeouts.stall)
						&& (intervals.ignore || intervals.len <= intervals.stall)
						&& (frames.ignore || frames.len <= frames.stall)
						&& requests.len <= requests.stall) {
						lastEvent += 1;
						emit("idle", from, url, info);
					}
				} else if (lastEvent == EV.idle) {
					emit("busy", from, url);
				} else if (lastEvent == EV.init && hasReady) {
					lastEvent += 1;
					emit("ready", from, url, info);
				} else if (lastEvent == EV.ready && hasLoaded) {
					lastEvent += 1;
					emit("load", from, url, info);
					intervals.to = w.setTimeout.call(window, checkIntervals, stallInterval);
					timeouts.to = w.setTimeout.call(window, checkTimeouts, stallTimeout);
				} else {
					return;
				}
			}
		});
	}
};

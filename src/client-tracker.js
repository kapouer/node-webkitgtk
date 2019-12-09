module.exports = function tracker(preload, cstamp, stallXhr, stallTimeout, stallInterval, stallFrame, emit) {
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
	var preloadList = [];
	var observer;

	var intervals = {len: 0, stall: 0, inc: 1};
	var timeouts = {len: 0, stall: 0, inc: 1};
	var immediates = {len: 0, inc: 1};
	var tasks = {len: 0, inc: 1};
	var frames = {len: 0, stall: 0, ignore: !stallFrame};
	var requests = {len: 0, stall: 0};
	var tracks = {len: 0, stall: 0};
	var fetchs = {len: 0};

	if (preload) disableExternalResources();
	else trackExternalResources();

	if (!window.setImmediate) window.setImmediate = window.setTimeout;
	if (!window.clearImmediate) window.clearImmediate = window.clearTimeout;

	var w = {};
	['setImmediate', 'clearImmediate',
	'queueMicrotask',
	'setTimeout', 'clearTimeout',
	'setInterval', 'clearInterval',
	'XMLHttpRequest', 'WebSocket', 'fetch',
	'requestAnimationFrame', 'cancelAnimationFrame'].forEach(function(meth) {
		if (window[meth]) w[meth] = window[meth].bind(window);
	});
	window['hasRunEvent_' + cstamp] = function(event) {
		if (EV[event] > lastRunEvent) {
			lastRunEvent = EV[event];
			check('lastrun' + event);
		}
	};

	window['ignore_' + cstamp] = ignoreListener;

	window['cancel_' + cstamp] = cancelListener;

	if (document.readyState != 'loading') readyListener();
	else document.addEventListener('DOMContentLoaded', readyListener, false);

	if (document.readyState == 'complete') loadListener();
	else window.addEventListener('load', loadListener, false);

	function disableExternalResources() {
		function jumpAuto(node) {
			var tag = node.nodeName.toLowerCase();
			var params = {
				body: ["onload", null],
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
		observer.observe(document.documentElement || document, {
			childList: true,
			subtree: true
		});
	}

	function trackExternalResources() {
		observer = new MutationObserver(function(mutations) {
			var node, list;
			for (var m=0; m < mutations.length; m++) {
				list = mutations[m].addedNodes;
				if (!list) continue;
				for (var i=0; i < list.length; i++) {
					node = list[i];
					if (node.nodeType != 1) continue;
					trackNode(node);
				}
			}
		});
		observer.observe(document.documentElement || document, {
			childList: true,
			subtree: true
		});
	}

	function closeObserver() {
		if (!observer) return;
		observer.disconnect();
		observer = null;
	}

	function ignoreListener(uri) {
		if (!uri || uri.slice(0, 5) == "data:") return;
		var req = requests[uri];
		if (!req) req = requests[uri] = {count: 0};
		req.stall = true;
		var tra = tracks[uri];
		if (!tra) tra = tracks[uri] = {count: 0};
		tra.ignore = true;
	}

	function cancelListener(uri) {
		if (!uri || uri.slice(0, 5) == "data:") return;
		var obj = tracks[uri];
		if (!obj) obj = tracks[uri] = {count:0};
		if (obj.cancel) return;
		obj.cancel = true;
		var count = obj.count;
		tracks.stall += count;
		obj.count = 0;
		if (tracks.len <= tracks.stall) check('tracks');
	}

	function trackNodeDone() {
		var uri = this.src || this.href;
		if (!uri) {
			console.error("trackNodeDone called on a node without uri");
			return;
		}
		var obj = tracks[uri];
		if (!obj) {
			console.error("trackNodeDone called on untracked uri", uri);
			return;
		}
		if (obj.ignore) return;
		if (!obj.cancel) {
			tracks.len--;
			obj.count--;
		}
		if (tracks.len <= tracks.stall) check('tracks');
		this.removeEventListener('load', trackNodeDone);
		this.removeEventListener('error', trackNodeDone);
	}

	function trackNode(node) {
		if (node.nodeName == "LINK") {
			if (!node.href || node.rel != "import" && node.rel != "stylesheet") return;
			// do not track when not supported
			if (node.rel == "import" && !node.import && !window.HTMLImports) return;
		} else if (node.nodeName == "SCRIPT") {
			if (!node.src || node.type && node.type != "text/javascript") return;
		} else {
			return;
		}
		var uri = node.src || node.href;
		if (!uri || uri.slice(0, 5) == "data:") return;
		var obj = tracks[uri];
		if (!obj) obj = tracks[uri] = {count: 0};
		if (obj.cancel) {
			node.dispatchEvent(new CustomEvent('error', {bubbles: false}));
			return;
		}
		if (obj.ignore) return;
		tracks.len++;
		obj.count++;
		node.addEventListener('load', trackNodeDone);
		node.addEventListener('error', trackNodeDone);
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
			closeObserver();
			w.setTimeout(function() {
				preloadList.forEach(function(obj) {
					if (obj.val === undefined) obj.node.removeAttribute(obj.att);
					else obj.node[obj.att] = obj.val;
				});
				preloadList = [];
				check("ready");
				if (missedEvent == EV.load) {
					w.setTimeout(check.bind(this, 'load'));
				}
			});
		} else {
			check("ready");
			if (missedEvent == EV.load) {
				w.setTimeout(check.bind(this, 'load'));
			}
		}
	}

	function absolute(url) {
		return (new URL(url, document.location)).href;
	}

	function doneImmediate(id) {
		var t = id !== null && immediates[id];
		if (t) {
			delete immediates[id];
			immediates.len--;
			if (immediates.len == 0) {
				check('immediate');
			}
		} else {
			t = id;
		}
		return t;
	}
	window.setImmediate = function setImmediate(fn) {
		immediates.len++;
		var obj = {
			fn: fn
		};
		var fnobj = function(obj) {
			doneImmediate(obj.id);
			var err;
			try {
				obj.fn.apply(null, Array.from(arguments).slice(1));
			} catch (e) {
				err = e;
			}
			if (err) throw err; // rethrow
		}.bind(null, obj);
		var t = w.setImmediate(fnobj);
		var id = ++immediates.inc;
		immediates[id] = t;
		obj.id = id;
		return id;
	};

	window.clearImmediate = function(id) {
		var t = doneImmediate(id);
		return w.clearImmediate(t);
	};

	window.queueMicrotask = function(fn) {
		tasks.len++;
		return w.queueMicrotask(function() {
			var err;
			try {
				fn();
			} catch(ex) {
				err = ex;
			}
			tasks.len--;
			if (tasks.len == 0) {
				check('task');
			}
			if (err) throw err;
		});
	};

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
			if (timeouts.len <= timeouts.stall) {
				check('timeout');
			}
			t = obj.t;
		} else {
			t = id;
		}
		return t;
	}
	window.setTimeout = function setTimeout(fn, timeout) {
		var stall = false;
		timeout = timeout || 0;
		if (timeout >= stallTimeout || timeouts.ignore && timeout > 0) {
			stall = true;
			timeouts.stall++;
		}
		timeouts.len++;
		var obj = {
			fn: fn
		};
		var fnobj = function(obj) {
			var err;
			try {
				obj.fn.apply(null, Array.from(arguments).slice(1));
			} catch (e) {
				err = e;
			}
			doneTimeout(obj.id);
			if (err) throw err; // rethrow
		}.bind(null, obj);
		var t = w.setTimeout(fnobj, timeout);
		var id = ++timeouts.inc;
		timeouts[id] = {stall: stall, t: t};
		obj.id = id;
		return id;
	};
	window.clearTimeout = function(id) {
		var t = doneTimeout(id);
		return w.clearTimeout(t);
	};

	function checkIntervals() {
		delete intervals.to;
		intervals.ignore = true;
		if (lastEvent == EV.load) check('interval');
	}

	window.setInterval = function(fn, interval) {
		interval = interval || 0;
		var stall = false;
		if (interval >= stallInterval) {
			stall = true;
			intervals.stall++;
		}
		intervals.len++;
		var t = w.setInterval(fn, interval);
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
		return w.clearInterval(t);
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
	if (w.requestAnimationFrame) window.requestAnimationFrame = function(fn) {
		var id = w.requestAnimationFrame(function(ts) {
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
			frames.timeout = w.setTimeout(function() {
				frames.ignore = true;
				check('frame');
			}, stallFrame);
		}
		return id;
	};
	if (w.cancelAnimationFrame) window.cancelAnimationFrame = function(id) {
		doneFrame(id);
		return w.cancelAnimationFrame(id);
	};

	if (w.WebSocket) window.WebSocket = function() {
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

	if (w.fetch) window.fetch = function(url, obj) {
		requests.len++;
		var req = {
			done: false,
			url: url
		};
		req.timeout = w.setTimeout(function() {
			req.stalled = true;
			cleanFetch(req);
		}, stallXhr);

		return new Promise(function(resolve, reject) {
			fetchs.len++;
			w.fetch(url, obj).catch(function(ex) {
				reject(ex);
				cleanFetch(req);
			}).then(function(res) {
				resolve(res);
				cleanFetch(req);
			});
		});
	};
	function cleanFetch(req) {
		if (req.timeout) {
			clearTimeout(req.timeout);
			delete req.timeout;
		}
		if (req.stalled) {
			requests.stall++;
			req.done = true;
		}
		if (!req.done) {
			req.done = true;
			requests.len--;
		}
		check('fetch');
		w.setTimeout(function() {
			fetchs.len--;
		});
	}

	var wopen = window.XMLHttpRequest.prototype.open;
	window.XMLHttpRequest.prototype.open = function(method, url) {
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
		return w.setTimeout(function() {
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
			w.clearTimeout(priv.timeout);
			priv.timeout = xhrTimeout(priv.url);
		}
	}
	function xhrChange() {
		if (this.readyState != this.DONE) return;
		xhrClean.call(this);
	}
	function xhrClean() {
		var priv = this._private;
		if (!priv) return;
		delete this._private;
		this.removeEventListener("progress", xhrProgress);
		this.removeEventListener("load", xhrChange);
		this.removeEventListener("abort", xhrClean);
		this.removeEventListener("error", xhrClean);
		this.removeEventListener("timeout", xhrClean);
		if (priv.timeout) w.clearTimeout(priv.timeout);
		var req = requests[priv.url];
		if (req) {
			req.count--;
			if (req.stall) requests.stall--;
		}
		requests.len--;
		check('xhr clean');
	}

	function check(from, url) {
		w.queueMicrotask(function() {
			checkNow(from, url);
		});
	}

	function checkNow(from, url) {
		var info = {
			immediates: immediates.len == 0,
			tasks: tasks.len == 0,
			fetchs: fetchs.len == 0,
			timeouts: timeouts.len <= timeouts.stall,
			intervals: intervals.len <= intervals.stall || intervals.ignore,
			frames: frames.len <= frames.stall || frames.ignore,
			requests: requests.len <= requests.stall,
			tracks: tracks.len <= tracks.stall,
			lastEvent: lastEvent,
			lastRunEvent: lastRunEvent
		};

		if (document.readyState == "complete") {
			// if loading was stopped (location change or else) the load event
			// is not emitted but readyState is complete
			hasLoaded = true;
		}
		if (lastEvent <= lastRunEvent) {
			if (lastEvent == EV.load) {
				if (info.tracks && info.immediates && info.tasks && info.fetchs && info.timeouts && info.intervals && info.frames && info.requests) {
					lastEvent += 1;
					closeObserver();
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
				intervals.to = w.setTimeout(checkIntervals, stallInterval);
				timeouts.to = w.setTimeout(checkTimeouts, stallTimeout);
			} else {
				return;
			}
		}
	}
};

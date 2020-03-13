var debug = require('debug')('webkitgtk');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var stream = require('stream');
var fs = require('fs');
var path = require('path');
var url = require('url');
var toSource = require('tosource');
var clientConsole = require('./client-console');
var clientError = require('./client-error');
var clientTracker = require('./client-tracker');
var clientPromise = fs.readFileSync(path.join(__dirname, '../lib/promise.js'));

// available after init
var debugStall;
var debugWarn;
var debugError;

// internal state, does not match readyState
var CREATED = 0;
var INITIALIZING = 1;
var INITIALIZED = 2;
var LOADING = 3;

var availableDisplays = {};
var instances = 0;

var hasRunEvent = '(' + function(name, event) {
	try {
		var func = window && window['hasRunEvent_' + name];
		if (func) func(event);
	} catch (ex) {
		// ignore
	}
}.toString() + ')("%name", "%event")';

function WebKit(opts, cb) {
	if (!(this instanceof WebKit)) {
		var inst = new WebKit();
		if (arguments.length) return inst.init(opts, cb);
		return inst;
	}
	this.priv = initialPriv();
	if (arguments.length) throw new Error("Use WebKit(opts, cb) as short-hand for (new Webkit()).init(opts, cb)");
}

util.inherits(WebKit, EventEmitter);

try {
	WebKit.navigator = require(path.join(__dirname, '../navigator.json'));
} catch(ex) {
	WebKit.navigator = {};
}

WebKit.load = function(uri, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = null;
	}
	var inst = new WebKit();
	var pcb = promet(inst, cb);
	inst.init(opts, function(err, w) {
		if (err) return pcb.cb(err, w);
		inst.load(uri, opts, pcb.cb);
	});
	return pcb.ret;
};

WebKit.prototype.init = function(opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = null;
	}
	if (opts == null) opts = {};
	else if (typeof opts != "object") opts = {display: opts};

	var pcb = promet(this, cb);

	if (opts.verbose) {
		debugStall = console.warn;
		debugWarn = console.warn;
		debugError = console.error;
	} else {
		debugStall = require('debug')('webkitgtk:timeout');
		debugWarn = require('debug')('webkitgtk:warn');
		debugError = require('debug')('webkitgtk:error');
	}

	var priv = this.priv;
	if (priv.state >= INITIALIZING) return pcb.cb(new Error("init must not be called twice"), this);
	priv.state = INITIALIZING;

	if (opts.debug) {
		priv.debug = true;
		opts.offscreen = false;
		opts.inspector = true;
	}

	if (opts.offscreen == null) opts.offscreen = true;

	if (opts.offscreen) {
		// as of webkitgtk version 2.14,
		// compositing mode has huge performance impact on initialization,
		// and it is useless in offscreen mode
		process.env.WEBKIT_DISABLE_COMPOSITING_MODE = "1";
	}

	debug('init');
	this.binding(opts, {
		cstamp: priv.cstamp,
		receiveDataListener: receiveDataDispatcher.bind(this),
		responseListener: responseDispatcher.bind(this),
		eventsListener: eventsDispatcher.bind(this),
		policyListener: policyDispatcher.bind(this),
		authListener: authDispatcher.bind(this),
		closedListener: closedListener.bind(this),
		cookiePolicy: opts.cookiePolicy || "",
		cacheDir: opts.cacheDir,
		cacheModel: opts.cacheModel,
		offscreen: opts.offscreen,
		resizing: opts.resizing,
		inspector: opts.inspector
	}, function(err) {
		priv.state = INITIALIZED;
		pcb.cb(err, this);
	}.bind(this));
	return pcb.ret;
};

WebKit.prototype.binding = function(opts, cfg, cb) {
	display.call(this, opts, function(err, child, newDisplay) {
		if (err) return cb(err);
		debug('display found', newDisplay);
		var priv = this.priv;
		if (child) priv.xvfb = child;
		process.env.DISPLAY = ":" + newDisplay;
		var Bindings = require(path.join(__dirname, '../lib/webkitgtk.node'));
		cfg.webextension = path.join(__dirname, '../lib/ext');
		this.webview = new Bindings(cfg);
		instances++;
		debug('new instance created');
		cb();
	}.bind(this));
};

function initialPriv() {
	return {
		state: CREATED,
		pendingRequests: 0,
		ticket: 0,
		tickets: {},
		cstamp: uran(),
		idling: false,
		emittedEvents: {}
	};
}

function done(ev, cb) {
	var priv = this.priv;
	var emitted = priv.emittedEvents;
	if (emitted[ev] || priv.state == LOADING || ev != 'ready' && this.readyState == null) return cb();
	emitted[ev] = true;
	debug("let tracker process event after", ev);
	if (this.readyState != "unloading") {
		this.webview.runSync(hasRunEvent.replace('%name', priv.cstamp).replace('%event', ev));
	}
	cb();
}

function closedListener(what) {
	var priv = this.priv;
	switch (what) {
	case "inspector":
		priv.inspecting = false;
		return;
	case "window":
		delete this.webview;
		destroy.call(this, priv.destroyCb);
		priv.tickets = cleanTickets(priv.tickets);
		this.priv = initialPriv();
		break;
	case "crash":
		this.emit('crash');
		break;
	}
}

function receiveDataDispatcher(curstamp, binding, length) {
	var priv = this.priv;
	var res = new Response(this, binding);
	res.clength = length;
	if (!res.uri) {
		return;
	}
	if (curstamp != priv.stamp) {
		debug("stamp mismatch - ignore data dispatch", curstamp, priv.stamp, res.uri);
		return;
	}
	var info = priv.uris && priv.uris[res.uri];
	if (info) {
		if (!info.mtime || info.mtime == Infinity) return;
		info.mtime = Date.now();
	} else if (this.uri && this.uri != res.uri) {
		debug("ignored data event", this.uri, res.uri);
		return;
	}
	this.emit('data', res);
}

function authDispatcher(request) {
	// ignore auth request synchronously
	if (this.listeners('authenticate').length == 0) return true;
	this.emit('authenticate', request);
	return false;
}

function policyDispatcher(type, uri) {
	// prevents navigation once a view has started loading (if navigation is false)
	if (uri == "" || uri == "about:blank" || uri == this.uri) return false;
	if (type == "navigation" && this.priv.state == INITIALIZED) {
		if (this.listeners('navigate').length > 0) this.emit('navigate', uri);
		if (this.priv.navigation == false) {
			debug("policy ignore", type, uri);
			return true;
		}
	}
	return false;
}

function checkIdle() {
	var priv = this.priv;
	if (priv.pendingRequests == 0) {
		if (priv.idling) {
			this.readyState = "idling";
			priv.idling = false;
			this.emit('idle');
		}
	}
}

function errorReviver(key, val) {
	if (!val || typeof val != "object") return val;
	var name = val.name;
	if (!name || /Error$/.test(name) == false || !global[name]) return val;
	var err = new (global[name])();
	if (!val.stack) delete err.stack;
	err.stack = val.stack;
	err.toString = function() {
		return this.name + ': ' + (this.message || "") + (this.stack ? "\n    " + this.stack : "");
	};
	err.inspect = function() {
		return this.toString();
	};
	delete val.name;
	Object.assign(err, val);
	return err;
}

function eventsDispatcher(err, json) {
	var priv = this.priv;
	if (err) {
		debugError("Error in event dispatcher", err, json);
		if (priv.debug) {
			debugWarn("This error might occur because of HTTP response Header Content-Security-Policy");
		}
		return;
	}
	if (!priv.stamp) {
		// no stamp means nothing is expected
		return;
	}
	var obj, parseError;
	try {
		obj = JSON.parse(json, errorReviver);
	} catch(e) {
		parseError = e;
	}

	if (!obj) {
		debugError("received invalid event", json, parseError);
		return;
	}
	if (obj.stamp && obj.stamp != priv.stamp) {
		// typically happens when a page was stopped / unloaded
		return;
	}
	var args = obj.args || [];
	if (obj.event) {
		var from = args[0];
		var url = args[1];
		var debugArgs = ['event from dom', obj.event];
		if (from) debugArgs.push('from', from);
		if (url) debugArgs.push(url);
		debug.apply(this, debugArgs);
		args.unshift(obj.event);
		if (obj.event == "ready") {
			this.readyState = "interactive";
			this.emit(obj.event);
		} else  if (obj.event == "load") {
			this.readyState = "complete";
			this.emit(obj.event);
		} else if (obj.event == "idle") {
			priv.idling = true;
			checkIdle.call(this);
			debug("reached idle", this.uri);
		} else if (obj.event == "busy") {
			// not a life event
			this.emit(obj.event);
		} else if (obj.event == "request") {
			requestDispatcher.call(this, from);
		} else {
			this.emit.apply(this, args);
		}
	} else if (obj.ticket) {
		var cbObj = priv.tickets[obj.ticket];
		if (cbObj) {
			delete priv.tickets[obj.ticket];
			if (cbObj.timeout) {
				clearTimeout(cbObj.timeout);
				delete cbObj.timeout;
			}
			if (!cbObj.cb) return; // already called by timeout
			args.unshift(obj.error);
			try {
				cbObj.cb.apply(this, args);
			} catch(e) {
				setImmediate(function(ex) {throw ex;}.bind(null, e));
			}
		} else {
			// could be reached by dropped events
			debug("event without pending ticket", json);
		}
	}
}

function logError(msg, file, line, col, err) {
	if (err && err.name) msg = err.name + ': ' + msg;
	if (file) {
		msg += " in " + file;
		if (line) msg += ':' + line;
		if (col) msg += ':' + col;
	}
	if (err && err.stack) msg += '\n ' + err.stack.replace(/\n/g, '\n ');
	debugError("webkitgtk ", msg);
}

Object.defineProperty(WebKit.prototype, "uri", {
	get: function() {
		if (this.webview) {
			var uri = this.webview.uri;
			if (uri == "about:blank") uri = "";
			return uri;
		}	else {
			return undefined;
		}
	}
});

function defineCachedGet(proto, prop, name) {
	var hname = '_' + name;
	Object.defineProperty(proto, name, {
		get: function() {
			if (this[hname] == undefined) this[hname] = this[prop][name];
			return this[hname];
		}
	});
}

function Response(view, binding) {
	this.binding = binding;
	this.view = view;
}

Response.prototype.data = function(cb) {
	if (!cb) throw new Error("Missing callback");
	this.binding.data(cb);
	return this;
};

"uri status mime headers length filename stall".split(' ').forEach(
	defineCachedGet.bind(null, Response.prototype, "binding")
);

function requestDispatcher(req) {
	var priv = this.priv;
	if (!priv.uris) return;
	var mainUri = this.uri || "about:blank";
	if (mainUri == "about:blank") return;
	var uri = req.uri;
	if (!uri) return;

	debug('request', uri.substring(0, 255));

	var info = priv.uris[uri];

	var from = req.from;
	if (from != null) {
		var rinfo = priv.uris[from];
		if (rinfo) {
			info = priv.uris[uri] = priv.uris[from];
		}
		if (mainUri && from == mainUri) {
			mainUri = this.uri = uri;
		}
	}

	this.emit('request', req);

	if (!info) {
		info = priv.uris[uri] = {
			mtime: Date.now(),
			count: 0,
			remote: isNetworkProtocol(uri)
		};
		if (req.ignore) {
			info.loaded = true;
			info.ignore = true;
		}
	} else if (!info.count && info.mtime != Infinity) {
		info.mtime = Date.now();
	}
	info.count++;

	if (!info.ignore && info.remote && this.readyState != "idle") {
		priv.pendingRequests++;
		debug("counted as pending", priv.pendingRequests, uri, info);
	}
}

function responseDispatcher(curstamp, binding) {
	var priv = this.priv;
	if (!priv.uris) return;
	var mainUri = this.uri || "about:blank";
	if (mainUri == "about:blank") return;
	var res = new Response(this, binding);
	var uri = res.uri;
	if (!uri) return;
	var status = res.status;
	if (uri[0] == '#') {
		// came from webextension, this uri is cancelled
		uri = res._uri = uri.substring(1);
		if (status != 0) {
			console.error("Cancelled response but non-zero status", uri, status);
		}
	}
	if (!uri) return;

	if (curstamp != priv.stamp) {
		debug("stamp mismatch - ignore response", uri, curstamp, priv.stamp, this.uri);
		return;
	}

	debug('response', uri.substring(0, 255));

	var info = priv.uris[uri];

	if (!info) {
		if (status == 0) {
			debug('ignored response', uri);
			return;
		} else if (uri != mainUri) {
			if (uri.slice(0, 5) != "data:") {
				// ignore data-uri for that warning
				console.warn(this.uri, "had an untracked response", uri, status);
			}
			return;
		} else {
			info = priv.uris[uri] = {
				main: true,
				count: 1
			};
		}
	}

	var stalled = false;
	var decrease = 0;
	if (info.main || !info.remote || info.ignore) {
		// pass
	} else if (info.mtime == Infinity) {
		stalled = true;
		decrease = -info.count;
		info.count = 0;
	} else if (info.count) {
		decrease = -1;
		info.count--;
	} else {
		debug("should not happen", uri, info);
	}

	if (decrease != 0) {
		priv.pendingRequests += decrease;
		debug('counted as ending pending', priv.pendingRequests, uri, info);
		if (priv.pendingRequests < 0) console.warn("counting more responses than requests with", uri, this.uri);
	}
	if (!stalled && status > 0) this.emit('response', res);
	checkIdle.call(this);
}

function isNetworkProtocol(uri) {
	var p = uri.split(':', 1).pop();
	if (p == 'http' || p == 'https' || p == 'file') {
		return true;
	} else {
		debug("is not network protocol", p);
		return false;
	}
}

function noop(err) {
	if (err) console.error(err);
}

function display(opts, cb) {
	var display = opts.display != null ? opts.display : process.env.DISPLAY;
	if (typeof display == "string") {
		var match = /^(?:(\d+)x(\d+)x(\d+))?:(\d+)$/.exec(display);
		if (match) {
			if (match[1] != null) opts.width = match[1];
			if (match[2] != null) opts.height = match[2];
			if (match[3] != null) opts.depth = match[3];
			if (match[4] != null) display = match[4];
		}
	}
	display = parseInt(display);
	if (isNaN(display)) display = 0;
	opts.display = display;
	if (availableDisplays[display]) {
		return setImmediate(cb.bind(this, null, null, display));
	}
	fs.exists('/tmp/.X11-unix/X' + display, function(exists) {
		if (exists) {
			availableDisplays[display] = true;
			return cb(null, null, display);
		}
		require('headless')({
			display: {
				width: opts.width || 1024,
				height: opts.height || 768,
				depth: opts.depth || 32
			}
		}, display - 1, function(err, child, display) {
			if (err) cb(err);
			else {
				debugWarn("Spawned xvfb on DISPLAY=:" + display);
				cb(null, child, display);
				process.on('exit', function() {
					child.kill();
				});
			}
		});
	});
}

function errorLoad(state) {
	var msg;
	if (state == INITIALIZED) return;
	if (state < INITIALIZED) {
		msg = "cannot call method before init";
	} else if (state > INITIALIZED) {
		msg = "cannot call method during loading";
	}
	var error = new Error(msg);
	console.trace(error);
	return error;
}

WebKit.prototype.rawload = function(uri, opts, cb) {
	var priv = this.priv;
	priv.state = LOADING;
	if (opts.content != null && !opts.content || !uri) opts.content = "<html></html>";
	var cookies = opts.cookies;
	var pcb = promet(this, cb);
	var p = Promise.resolve();
	var clearCookies = true;
	if (cookies) {
		debug('load cookies');
		if (!Array.isArray(cookies)) cookies = [cookies];
		var script = cookies.map(function(cookie) {
			return 'document.cookie = "' + cookie.replace(/"/g, '\\"') + '"';
		}).concat(['']).join(";\n");
		if (!opts.content) { // blank load to be able to set cookies before real one
			clearCookies = false;
			p = p.then(function() {
				var content = `<html><head>
					<script type="text/javascript">${script}</script>
					</head></html>`;
				return new Promise(function(resolve, reject) {
					this.webview.load(uri, priv.stamp, {
						content: content,
						clearCookies: true
					}, function(err) {
						if (err) reject(err);
						else resolve();
					});
				}.bind(this));
			}.bind(this)).catch(function(err) {
				pcb.cb(err);
			});
		} else { // no main document loading, just set in user script
			if (!opts.script) opts.script = "";
			opts.script = script + opts.script;
		}
	} else if (!opts.preload) {
		if (!opts.script) opts.script = "";
	}
	p.then(function() {
		var deprecations = {
			ua: "user-agent",
			charset: "default-charset",
			private: "enable-private-browsing",
			images: "auto-load-images",
			localAccess: "allow-file-access-from-file-urls"
		};
		for (var key in deprecations) {
			if (opts[key] == null) continue;
			var newkey = deprecations[key];
			console.warn(key, "option is deprecated, please use", newkey);
			opts[newkey] = opts[key];
		}
		if (!opts['default-charset']) opts['default-charset'] = "utf-8";
		opts.clearCookies = clearCookies;
		this.webview.load(uri, this.priv.stamp, opts, function(err, inst) {
			priv.state = INITIALIZED;
			pcb.cb(err, inst);
		});
	}.bind(this));
	return pcb.ret;
};

WebKit.prototype.load = function(uri, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = null;
	}
	if (!opts) opts = {};
	var pcb = promet(this, cb);
	load.call(this, uri, opts, pcb.cb);
	return pcb.ret;
};

function initPromise(ev) {
	var prev = null;
	if (ev == "idle") prev = this.promises.load;
	if (ev == "load") prev = this.promises.ready;

	var holder = {
		pending: true
	};
	var initialPromise = holder.promise = new Promise(function(resolve) {
		holder.resolve = resolve;
	});
	this.promises[ev] = holder;
	if (prev) holder.promise = prev.promise.then(function() {
		return initialPromise;
	});

	this.once(ev, function() {
		var stamp = this.priv.stamp;
		holder.promise.catch(function(err) {
			// not logged - it's up to the client to catch its own errors
			// using .when(ev).catch()
		}).then(function() {
			if (stamp == this.priv.stamp) {
				done.call(this, ev, function(err) {
					if (err) console.error(err);
				});
			} else {
				// typically when a queued listener calls unload/load right away
			}
		}.bind(this));
		holder.pending = false;
		holder.resolve();
	});
}

function initWhen() {
	if (!this.promises) {
		this.promises = {};
	}
	['ready', 'load', 'idle'].forEach(function(ev) {
		var holder = this.promises[ev];
		if (!holder || !holder.pending) {
			initPromise.call(this, ev);
		}
	}.bind(this));
}

WebKit.prototype.when = function(ev, fn) {
	var self = this;
	if (!this.promises) initWhen.call(this);
	var holder = this.promises[ev];
	if (!fn) return holder.promise;
	var isThen = fn.length == 0;
	var thenable = isThen ? fn : function() {
		return new Promise(function(resolve, reject) {
			fn.call(self, function(err) {
				if (err) reject(err);
				else resolve();
			});
		});
	};
	holder.promise = holder.promise.then(thenable);
	if (isThen) return holder.promise;
	else return this;
};

WebKit.prototype.prepare = function() {
	this.promises = null;
};

function load(uri, opts, cb) {
	opts = Object.assign({}, opts);
	if (uri && !url.parse(uri).protocol) uri = 'http://' + uri;

	var priv = this.priv;
	var stateErr = errorLoad(priv.state);
	if (stateErr) return cb(stateErr, this);

	this.readyState = "loading";

	initWhen.call(this);

	priv.emittedEvents = {};
	priv.allow = opts.allow || "all";
	priv.stall = opts.stall != null ? opts.stall : 1000;
	priv.runTimeout = opts.runTimeout != null ? opts.runTimeout : 10000;
	priv.tickets = cleanTickets(priv.tickets);
	priv.stamp = uran();

	if (priv.responseInterval) {
		clearInterval(priv.responseInterval);
		delete priv.responseInterval;
	}
	priv.responseInterval = setInterval(function() {
		var now = Date.now();
		var info;
		for (var uri in priv.uris) {
			info = priv.uris[uri];
			if (!info) {
				continue;
			}
			if (info.remote && info.count && (now - info.mtime > priv.stall)) {
				info.mtime = Infinity;
				if (!info.ignore) debugStall("%s ms - %s", priv.stall, uri);
				responseDispatcher.call(this, priv.stamp, {uri: uri, status: 0});
			}
		}
	}.bind(this), 100); // let dom client cancel stalled xhr first
	priv.navigation = opts.navigation || false;
	priv.idling = false;
	priv.timeout = setTimeout(function() {
		debugStall("%s ms - %s", opts.timeout || 30000, uri);
		this.stop();
	}.bind(this), opts.timeout || 30000);

	priv.uris = {};
	priv.pendingRequests = 0;

	if (priv.debug) priv.inspecting = true;

	if (this.listeners('error').length == 0) {
		this.on('error', logError);
	}

	if (opts.console && this.listeners('console').length == 0) {
		this.on('console', function(level) {
			if (this.listeners('console').length <= 1) {
				var args = Array.from(arguments).slice(1).map(function(arg) {
					if (arg && arg.stack && arg.name) {
						return arg.name + ': ' + (arg.message ? arg.message + '\n ' : '')
							+ arg.stack.replace(/\n/g, '\n ');
					} else {
						return arg;
					}
				});
				var err = args.length > 0 && args[0];
				if (level == "trace") level = "error";
				console[level].apply(null, args);
			}
		});
	}
	var scripts = [];
	if (!priv.jsdom) scripts.push(clientError);
	if (opts.console && !priv.jsdom) scripts.push(clientConsole);

	var filters = opts.filters || [];
	if (opts.filter) filters.push(opts.filter);
	if (opts.allow) filters.push([allowFilter, opts.allow]);
	scripts.push(prepareFilters(priv.cstamp, filters));

	if (Buffer.isBuffer(opts.content)) opts.content = opts.content.toString();
	if (Buffer.isBuffer(opts.style)) opts.style = opts.style.toString();

	scripts.push(`
		var P = window.Promise;
		if (!window.queueMicrotask) window.queueMicrotask = function(fn) {
			P.resolve().then(fn);
		};
	`);

	scripts.push({
		fn: clientTracker,
		args: [
			opts.preload && !priv.jsdom,
			priv.cstamp,
			priv.stall,
			opts.stallTimeout != null ? opts.stallTimeout : 100,
			opts.stallInterval != null ? opts.stallInterval : 1000,
			opts.stallFrame != null ? opts.stallFrame : 1000
		]
	});
	// needed to track end of promises
	scripts.push("delete window.Promise;");
	scripts.push(clientPromise);
	if (opts.script) {
		scripts.push(opts.script);
	}
	if (Array.isArray(opts.scripts)) {
		scripts = scripts.concat(opts.scripts);
	} else if (opts.scripts) {
		console.warn("scripts option should be an array");
	}

	opts.script = scripts.map(function(fn) {
		return prepareRun(fn.fn || fn, null, fn.args || null, priv).script;
	}).join(';\n');

	debug('load', uri);
	priv.uris[uri] = {mtime: Date.now(), main: true};

	this.rawload(uri, opts, function(err, status) {
		debug('load done %s', uri, status);
		if (priv.timeout) {
			clearTimeout(priv.timeout);
			delete priv.timeout;
		}
		this.status = status;
		if (!err) {
			if (status === 0) err = new Error("Interrupted by user");
			else if (status < 200 || status >= 400) err = status;
		}
		cb(err, this);
		if (!err && priv.inspecting && this.webview.inspect) {
			this.webview.inspect();
		}
	}.bind(this));
}

function allowFilter(allow) {
	if (allow == null) return;
	if (allow == "none") {
		this.cancel = true;
	} else if (allow == "same-origin") {
		var obj = new URL(this.uri);
		if (obj.protocol != "data:" && obj.host != document.location.host) this.cancel = true;
	} else if (allow instanceof RegExp) {
		if (!allow.test(this.uri)) this.cancel = true;
	}
}

function prepareFilters(cstamp, filters) {
	return {
		fn: function(cstamp, filters, emit) {
			window["request_" + cstamp] = function(uri, from, headers) {
				var msg = {
					uri: uri,
					cancel: false,
					ignore: false,
					headers: headers || {} // none for now
				};
				if (from) msg.from = from;

				filters.forEach(function(filter) {
					if (!Array.isArray(filter)) filter = [filter];
					var func = filter[0];
					try {
						func.apply(msg, filter.slice(1));
					} catch(ex) {
						console.error("An error happened while filtering url with", func, ex);
					}
				});
				if (!msg.cancel) {
					delete msg.cancel;
				} else {
					var trackFunc = window['cancel_' + cstamp];
					if (trackFunc) trackFunc(uri);
				}
				if (!msg.ignore) {
					delete msg.ignore;
				} else {
					var ignFunc = window['ignore_' + cstamp];
					if (ignFunc) ignFunc(uri);
				}
				emit("request", msg);
				if (msg.cancel) return false;
				if (msg.uri != uri) return msg.uri;
				if (msg.ignore) return;
				return true;
			};
		},
		args: [cstamp, filters]
	};
}

WebKit.prototype.preload = function(uri, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = null;
	}
	if (!opts) opts = {};
	var pcb = promet(this, cb);
	var nopts = {};
	for (var key in opts) nopts[key] = opts[key];
	nopts.allow = "none";
	nopts.preload = true;
	load.call(this, uri, nopts, pcb.cb);
	return pcb.ret;
};

WebKit.prototype.stop = function(cb) {
	debug("stop");
	var priv = this.priv;
	var pcb = promet(this, cb);
	if (priv.state < INITIALIZED) return pcb.cb(errorLoad(priv.state));
	var wasLoading = false;
	var fincb = function(wasLoading) {
		debug("stop done", wasLoading);
		pcb.cb(null, wasLoading);
	}.bind(this);
	this.readyState = "stop";
	wasLoading = this.webview && this.webview.stop && this.webview.stop(fincb);
	debug("was loading", wasLoading);
	return pcb.ret;
};

WebKit.prototype.clearCache = function() {
	if (this.priv.state < INITIALIZED) throw errorLoad(this.priv.state);
	this.webview && this.webview.clearCache();
};

WebKit.prototype.reset = function(cb) {
	var pcb = promet(this, cb);
	var p = Promise.resolve();
	var priv = this.priv;
	if (priv.state == LOADING) {
		p = p.then(function() {
			return this.stop();
		}.bind(this)).catch(function(err) {
			console.error(err);
		});
	}
	p.then(function() {
		this.removeAllListeners();
		this.promises = null;
		this.readyState = null;
		if (priv.responseInterval) {
			clearInterval(priv.responseInterval);
			delete priv.responseInterval;
		}
		if (priv.uris) delete priv.uris;
		priv.idling = false;
		priv.tickets = cleanTickets(priv.tickets);
		this.status = null;
		setImmediate(pcb.cb);
	}.bind(this));
	return pcb.ret;
};

WebKit.prototype.unload = function(cb) {
	var priv = this.priv;
	this.readyState = "unloading";
	if (priv.responseInterval) {
		clearInterval(priv.responseInterval);
		delete priv.responseInterval;
	}
	if (priv.uris) delete priv.uris;
	var pcb = promet(this, cb);

	this.removeAllListeners('ready');
	this.removeAllListeners('load');
	this.removeAllListeners('idle');
	this.removeAllListeners('unload');
	this.removeAllListeners('busy');
	this.promises = null;

	priv.idling = false;

	cleanTickets(priv.tickets);

	var p = Promise.resolve();

	if (priv.state == LOADING) {
		p = p.then(function() {
			return this.stop();
		}.bind(this)).catch(function(err) {
			console.error(err);
		});
	}
	p.then(function() {
		delete priv.stamp;
		debug('unload');
		return this.rawload('about:blank', {
			content:'<html></html>'
		});
	}.bind(this)).catch(function(err) {
		console.error(err);
	}).then(function() {
		debug('unload done');
		this.readyState = null;
		this.status = null;
		priv.tickets = cleanTickets(priv.tickets);
		this.emit('unload');
		this.removeAllListeners();
		this.promises = null;
		setImmediate(pcb.cb);
	}.bind(this));
	return pcb.ret;
};

function cleanTickets(tickets) {
	for (var key in tickets) {
		var obj = tickets[key];
		if (!obj) continue;
		if (obj.timeout) {
			clearTimeout(obj.timeout);
			delete obj.timeout;
		}
	}
	return {};
}

function destroy(cb) {
	if (this.webview) {
		this.priv.destroyCb = cb;
		if (this.webview.destroy) {
			this.webview.destroy();
			instances--;
		}	else {
			setImmediate(closedListener.bind(this, 'window'));
		}
	} else {
		if (cb) setImmediate(cb);
	}
	if (this.priv.xvfb && instances == 0) {
		this.priv.xvfb.kill();
	}
}

WebKit.prototype.destroy = function(cb) {
	var pcb = promet(this, cb);
	destroy.call(this, pcb.cb);
	return pcb.ret;
};

WebKit.prototype.run = function(script, cb) {
	var args = Array.from(arguments).slice(1);
	var argType = args.length > 0 ? typeof args[args.length-1] : null;
	if (argType == "function") cb = args.pop();
	else cb = null;
	var pcb = promet(this, cb);
	runcb.call(this, script, args, pcb.cb);
	return pcb.ret;
};

WebKit.prototype.runev = function(script, cb) {
	var args = Array.from(arguments).slice(1);
	var argType = args.length > 0 ? typeof args[args.length-1] : null;
	if (argType == "function") cb = args.pop();
	else cb = null;
	var pcb = promet(this, cb);
	run.call(this, script, null, args, pcb.cb);
	return pcb.ret;
};

function runcb(script, args, cb) {
	var ticket = (++this.priv.ticket).toString();
	this.priv.tickets[ticket] = {cb: cb};
	run.call(this, script, ticket, args, cb);
}

function run(script, ticket, args, cb) {
	var priv = this.priv;
	cb = cb || noop;
	if (priv.state == LOADING) {
		return cb(new Error("running a script during loading is not a good idea\n" + script));
	}
	var obj;
	try {
		obj = prepareRun(script, ticket, args, this.priv);
	} catch(e) {
		return cb(e);
	}

	// run on next loop so one can setup event listeners before
	setImmediate(function() {
		if (!this.webview) return cb(new Error("WebKit uninitialized"));
		if (!this.webview.run) {
			return cb(new Error("webview not available yet"));
		}
		if (obj.sync) {
			this.webview.runSync(obj.script, obj.ticket);
		} else {
			this.webview.run(obj.script, obj.ticket);
		}
	}.bind(this));

	if (!obj.ticket) {
		// the script is an event emitter, so we do not expect a reply
		setImmediate(cb);
	} else if (priv.runTimeout && !obj.sync) {
		priv.tickets[obj.ticket].stamp = priv.stamp;
		priv.tickets[obj.ticket].timeout = setTimeout(function() {
			var cbObj = priv.tickets[obj.ticket];
			if (!cbObj) return; // view unloaded before
			var cb = cbObj.cb;
			if (!cb) {
				// this should never happen
				console.error('FIXME - timeout after the script has already been run');
			}
			delete cbObj.cb;
			if (cbObj.stamp != this.priv.stamp) return;
			cb.call(this, new Error("script timed out\n" + obj.inscript));
		}.bind(this), priv.runTimeout);
	}
}

function prepareRun(script, ticket, args, priv) {
	args = args || [];
	var argc = args.length;
	args = args.map(function(arg) {return toSource(arg);});

	var arity = 0;
	var isfunction = false;
	var isUserScript = false;
	if (Buffer.isBuffer(script)) script = script.toString();
	if (typeof script == "function") {
		arity = script.length;
		isfunction = true;
	} else if (typeof script == "string") {
		if (ticket) {
			var match = /^\s*function(\s+\w+)?\s*\(((?:\s*\w+\s*,)*(?:\s*\w+\s*))\)/.exec(script);
			if (match && match.length == 3) {
				isfunction = true;
				arity = match[2].split(',').length;
			}
		} else {
			isUserScript = true;
		}
	}
	var async;
	if (arity == argc) {
		async = false;
	} else if (arity == argc + 1) {
		async = true;
	} else {
		throw new Error(".run(script, ...) where script will miss arguments");
	}

	if (typeof script == "function") script = script.toString();

	if (!async && isfunction && !ticket) {
		args.push(toSource(function(s) {}));
		async = true;
	}

	var obj = {
		sync: !async,
		ticket: ticket
	};
	if (isUserScript) {
		obj.script = '(function() {\n' + script + '})();';
	} else if (!async) {
		if (isfunction) script = '(' + script + ')(' + args.join(', ') + ')';
		else script = '(function() { return ' + script + '; })()';
		var wrapSync = function() {
			var ticket = TICKET;
			var stamp = STAMP;
			var message = {stamp: stamp};
			if (ticket) message.ticket = ticket;
			try {
				message.args = [ SCRIPT ];
			} catch(err) {
				message.error = err;
			}
			var msg;
			try {
				msg = JSON.stringify(message);
			} catch (ex) {
				delete message.args;
				message.error = ex;
				msg = JSON.stringify(message);
			}
			return msg;
		}.toString()
		.replace('TICKET', JSON.stringify(ticket))
		.replace('SCRIPT', script)
		.replace('STAMP', JSON.stringify(priv.stamp));
		obj.script = '(' + wrapSync + ')()';
	} else {
		obj.inscript = script.substring(0, 255); // useful for debugging timeouts
		var wrapAsync = function(err) {
			var ticket = TICKET;
			var stamp = STAMP;
			var message = {stamp: stamp};
			if (!ticket) {
				message.event = err;
			} else {
				message.ticket = ticket;
				if (err) message.error = err;
			}
			message.args = Array.from(arguments).slice(1).map(function(arg) {
				if (arg instanceof window.Node) {
					var cont = arg.ownerDocument.createElement('div');
					cont.appendChild(arg.cloneNode(true));
					return cont.innerHTML;
				}
				try {
					JSON.stringify(arg);
				} catch(ex) {
					return undefined;
				}
				return arg;
			});
			var msg;
			try {
				msg = JSON.stringify(message);
			} catch (ex) {
				delete message.args;
				message.error = ex;
				msg = JSON.stringify(message);
			}
			var ww = window && window.webkit;
			ww = ww && ww.messageHandlers && ww.messageHandlers.events;
			if (ww && ww.postMessage) try { ww.postMessage(msg); } catch(ex) {}
		}.toString()
		.replace('TICKET', JSON.stringify(ticket))
		.replace('STAMP', JSON.stringify(priv.stamp));
		args.push(wrapAsync);
		obj.script = '(' + script + ')(' + args.join(', ') + ');';
	}
	return obj;
}

WebKit.prototype.png = function(obj, cb) {
	var wstream;
	var pcb = promet(this, cb);
	if (typeof obj == "string") {
		wstream = fs.createWriteStream(obj);
		wstream.on('error', function(err) {
			fs.unlink(obj, function() {
				pcb.cb(err);
			});
		});
	} else if (obj instanceof stream.Writable || obj instanceof stream.Duplex) {
		wstream = obj;
	} else {
		return pcb.cb(new Error("png() first arg must be either a writableStream or a file path"));
	}
	png.call(this, wstream, pcb.cb);
	return pcb.ret;
};

function png(wstream, cb) {
	this.webview.png(function(err, buf) {
		if (err) {
			wstream.emit('error', err);
		} else if (buf == null) {
			if (wstream instanceof stream.Readable) {
				cb();
			} else {
				wstream.once('finish', cb);
			}
			wstream.end();
		} else {
			wstream.write(buf);
		}
	}.bind(this));
}

WebKit.prototype.html = function(cb) {
	debug('output html');
	var pcb = promet(this, cb);
	this.run(function() {
		var dtd = document.doctype;
		var html = "";
		if (dtd) {
			html = "<!DOCTYPE "	+ dtd.name
			+ (dtd.publicId ? ' PUBLIC "' + dtd.publicId + '"' : '')
			+ (!dtd.publicId && dtd.systemId ? ' SYSTEM' : '')
			+ (dtd.systemId ? ' "' + dtd.systemId + '"' : '')
			+ '>\n';
		}
		html += document.documentElement.outerHTML;
		return html;
	}, function(err, str) {
		debug('output html done');
		pcb.cb(err, str);
	});
	return pcb.ret;
};

WebKit.prototype.pdf = function(filepath, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = null;
	}
	if (!opts) opts = {};
	var pcb = promet(this, cb);
	pdf.call(this, filepath, opts, pcb.cb);
	return pcb.ret;
};

function pdf(filepath, opts, cb) {
	var margins = opts.margins;
	if (margins == null) margins = 0;
	if (typeof margins == "string" || typeof margins == "number") {
		var num = parseFloat(margins);
		margins = {
			top: num,
			left: num,
			bottom: num,
			right: num,
			unit: margins.toString().slice(num.toString().length)
		};
	}
	opts.margins = margins;

	this.webview.pdf("file://" + path.resolve(filepath), opts, function(err) {
		cb(err);
	}.bind(this));
}

function uran() {
	return (Date.now() * 1e4 + Math.round(Math.random() * 1e4)).toString();
}

function promet(self, cb) {
	var def = {};
	def.promise = new Promise(function(resolve, reject) {
		def.resolve = resolve;
		def.reject = reject;
	});
	def.cb = function(err) {
		var args = Array.from(arguments);
		if (cb) cb.apply(this, args);
		else if (err) def.reject(err);
		else def.resolve.apply(null, args.slice(1));
		return def.ret; // so that return pcb.cb() is still possible
	};
	def.ret = cb ? self : def.promise;

	// keep some compatibility with code that used to load without cb and chain
	if (self.once) def.promise.once = self.once.bind(self);
	if (self.on) def.promise.on = self.on.bind(self);
	if (self.when) def.promise.when = self.when.bind(self);

	return def;
}
WebKit.promet = promet;





module.exports = WebKit;

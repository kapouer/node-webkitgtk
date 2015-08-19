var util = require('util');
var EventEmitter = require('events').EventEmitter;
var stream = require('stream');
var fs = require('fs');
var path = require('path');
var url = require('url');
var Q = require('q');
var debug = require('debug')('webkitgtk');

// available after init
var debugStall;
var debugError;

// internal state, does not match readyState
var CREATED = 0;
var INITIALIZING = 1;
var INITIALIZED = 2;
var LOADING = 3;

var RegEvents = /^(ready|load|idle|unload)$/;

var availableDisplays = {};

function WebKit(opts, cb) {
	if (!(this instanceof WebKit)) {
		var inst = new WebKit();
		if (arguments.length) inst.init(opts, cb);
		return inst;
	}
	this.priv = initialPriv();
	initWhen.call(this);
	if (arguments.length) throw new Error("Use WebKit(opts, cb) as short-hand for (new Webkit()).init(opts, cb)");
}

util.inherits(WebKit, EventEmitter);

WebKit.load = function(uri, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = null;
	}
	var display = opts && opts.display || {};
	display.cacheDir = opts && opts.cacheDir || undefined;
	var inst = WebKit(display, function(err, w) {
		if (err) return cb(err, w);
		w.load(uri, opts, cb);
	});
	initWhen.call(inst);
	return inst;
};

WebKit.prototype.init = function(opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = null;
	}
	if (opts == null) opts = {};
	else if (typeof opts != "object") opts = {display: opts};

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
	if (priv.state >= INITIALIZING) return cb(new Error("init must not be called twice"), this);
	priv.state = INITIALIZING;

	if (opts.offscreen == null) opts.offscreen = true;
	if (opts.debug) {
		priv.debug = true;
		opts.offscreen = false;
		opts.inspector = true;
	}
	debug('init');
	this.binding(opts, {
		eventName: priv.eventName,
		requestListener: requestDispatcher.bind(this),
		receiveDataListener: receiveDataDispatcher.bind(this),
		responseListener: responseDispatcher.bind(this),
		eventsListener: eventsDispatcher.bind(this),
		policyListener: policyDispatcher.bind(this),
		authListener: authDispatcher.bind(this),
		closedListener: closedListener.bind(this),
		cookiePolicy: opts.cookiePolicy || "",
		cacheDir: opts.cacheDir,
		offscreen: opts.offscreen,
		inspector: opts.inspector
	}, function(err) {
		priv.state = INITIALIZED;
		cb(null, this);
	}.bind(this));
	return this;
};

WebKit.prototype.binding = function(opts, cfg, cb) {
	display.call(this, opts, function(err, child, newDisplay) {
		if (err) return cb(err);
		debug('display found', newDisplay);
		var priv = this.priv;
		if (child) priv.xvfb = child;
		process.env.DISPLAY = ":" + newDisplay;
		var Bindings = require(__dirname + '/lib/webkitgtk.node');
		cfg.webextension = __dirname + '/lib/ext';
		this.webview = new Bindings(cfg);
		debug('new instance created');
		cb();
	}.bind(this));
};

function initialPriv() {
	return {
		state: CREATED,
		pendingRequests: 0,
		loopForCallbacks: 0,
		loopForLife: false,
		loopCount: 0,
		idleCount: 0,
		ticket: 0,
		tickets: {},
		eventName: "webkitgtk" + uran(),
		loopTimeout: null,
		loopImmediate: null,
		wasBusy: false,
		idling: false,
		previousEvents: {},
		lastEvent: null,
		nextEvents: {},
		emittedEvents: {}
	};
}

function done(ev, cb) {
	var emitted = this.priv.emittedEvents;
	if (emitted[ev]) return cb();
	emitted[ev] = true;
	debug("let tracker process event after", ev);
	this.run(hasRunEvent, this.priv.eventName, ev, cb);
}

function emitLifeEvent(event) {
	var priv = this.priv;
	if (priv.lastEvent) priv.previousEvents[priv.lastEvent] = true;
	priv.lastEvent = event;
	var ne = priv.nextEvents || {}; // in case load or preload wasn't called
	var willStop = event == "unload" || this.listeners('unload').length == 0 && !ne.unload && (
		event == "idle" || this.listeners('idle').length == 0 && !ne.idle && (
			event == "load" || this.listeners('load').length == 0 && !ne.load &&
				event == "ready"
			)
		);
	if (willStop && priv.loopForLife) {
		priv.loopForLife = false;
	}
	debug('emit event', event);
	this.emit(event);
}

function hasRunEvent(name, event, done) {
	try {
		var func = window['hasRunEvent_' + name];
		if (func) func(event);
	} catch (e) {
		return done(e);
	}
	done();
}

function closedListener(what) {
	var priv = this.priv;
	switch (what) {
		case "inspector":
			priv.inspecting = false;
		return;
		case "window":
			if (priv.loopTimeout) {
				clearTimeout(priv.loopTimeout);
				priv.loopTimeout = null;
			}
			if (priv.loopImmediate) {
				clearImmediate(priv.loopImmediate);
				priv.loopImmediate = null;
			}
			delete this.webview;
			destroy.call(this, priv.destroyCb);
			this.priv = initialPriv();
		break;
	}
}

function receiveDataDispatcher(curuticket, uri, length) {
	var priv = this.priv;
	if (!uri) return;
	if (curuticket != priv.uticket) {
		debug("ignore data from other uticket", curuticket, priv.uticket, uri);
		return;
	}
	var info = priv.uris && priv.uris[uri];
	if (!info) return;
	if (!info.mtime || info.mtime == Infinity) return;
	info.mtime = Date.now();
}

function authDispatcher(request) {
	// ignore auth request synchronously
	if (this.listeners('authenticate').length == 0) return true;
	this.emit('authenticate', request);
}

function policyDispatcher(type, uri) {
	// prevents navigation once a view has started loading (if navigation is false)
	if (type == "navigation" && this.priv.navigation == false && this.priv.state > LOADING) {
		debug("policy ignore", type, uri);
		return true;
	}
}

function checkIdle() {
	var priv = this.priv;
	if (priv.idling && priv.pendingRequests == 0) {
		this.readyState = "idling";
		priv.idling = false;
		emitLifeEvent.call(this, 'idle');
	}
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
	var obj = JSON.parse(json);
	if (!obj) {
		debugError("received invalid event", json);
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
		var info = args[2];
		var debugArgs = ['event from dom', obj.event];
		if (from) debugArgs.push('from', from);
		if (url) debugArgs.push(url);
		debug.apply(this, debugArgs);
		args.unshift(obj.event);
		if (obj.event == "ready") {
			this.readyState = "interactive";
			emitLifeEvent.call(this, obj.event);
		} else  if (obj.event == "load") {
			this.readyState = "complete";
			emitLifeEvent.call(this, obj.event);
		} else if (obj.event == "idle") {
			priv.idling = true;
			checkIdle.call(this);
			debug("reached idle", this.uri);
		} else if (obj.event == "busy") {
			// not a life event
			this.emit(obj.event);
		} else {
			this.emit.apply(this, args);
		}
	} else if (obj.ticket) {
		var cb = priv.tickets[obj.ticket];
		if (cb) {
			loop.call(this, false);
			delete priv.tickets[obj.ticket];
			if (obj.error && !util.isError(obj.error)) {
				var typeErr = obj.error.type || 'Error';
				var customErr = new global[typeErr]();
				for (var k in obj.error) customErr[k] = obj.error[k];
				obj.error = customErr;
			}
			args.unshift(obj.error);
			try {
				cb.apply(this, args);
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
			return;
		}
	}
});

function Response(view, binding) {
	this.binding = binding;
	this.view = view;
}
"uri status mime headers length filename stall".split(' ').forEach(
	defineCachedGet.bind(null, Response.prototype, "binding")
);
function defineCachedGet(proto, prop, name) {
	var hname = '_' + name;
	Object.defineProperty(proto, name, {
		get: function() {
			if (this[hname] == undefined) this[hname] = this[prop][name];
			return this[hname];
		}
	});
}

Response.prototype.data = function(cb) {
	if (!cb) throw new Error("Missing callback");
	var view = this.view;
	loop.call(view, true);
	this.binding.data(function(err, data) {
		loop.call(view, false);
		cb(err, data);
	});
	return this;
};

function Request(uri, binding) {
	this.headers = binding;
	this.uri = uri;
	this.cancel = false;
}

function requestDispatcher(binding) {
	var priv = this.priv;
	if (!priv.uris) return;
	var uri = binding.uri;
	if (!uri) return; // ignore empty uri

	debug('request', uri.substring(0, 255));

	var mainUri = this.uri || "";

	var info = priv.uris[uri];

	var origuri = binding.origuri;
	if (origuri != null) {
		var originfo = priv.uris[origuri];
		if (originfo) {
			info = priv.uris[uri] = priv.uris[origuri];
		}
		if (mainUri && origuri == mainUri) {
			mainUri = this.uri = uri;
		}
	}

	var cancel = false;
	var allow = priv.allow;
	if (allow == "none") {
		if (uri != mainUri) cancel = true;
	} else if (allow == "same-origin") {
		if (url.parse(uri).host != url.parse(mainUri).host) cancel = true;
	} else if (allow instanceof RegExp) {
		if (uri != mainUri && !allow.test(uri)) cancel = true;
	} else if (typeof allow == "string" && allow != "all") {
		debugError("Unknown allow value", allow);
	}
	if (cancel) {
		debug("cancelled before dispatch", uri);
		binding.cancel = "1";
		return;
	}
	var req = new Request(uri, binding);

	this.emit('request', req);

	if (req.uri == null) { // compat with older versions
		req.cancel = true;
	} else if (uri != req.uri) {
		uri = req.uri;
		binding.uri = uri;
	}

	if (req.ignore) {
		debug("ignore request");
		binding.ignore = "1";
	}

	if (req.cancel) {
		debug("cancelled after dispatch");
		binding.cancel = "1";
		return;
	}

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

function responseDispatcher(curuticket, binding) {
	var priv = this.priv;
	if (!priv.uris) return;
	var res = new Response(this, binding);
	var uri = res.uri;
	if (!uri) return;

	if (curuticket != priv.uticket) {
		debug("ignore response from other uticket", uri, curuticket, priv.uticket, this.uri);
		return;
	}

	debug('response', uri.substring(0, 255));

	var info = priv.uris[uri];

	if (!info) {
		if (res.status == 0) {
			debug('ignored response', uri);
		} else {
			console.warn(this.uri, "had an untracked response", uri, res.status);
		}
		return;
	}

	var stalled = false;
	var decrease = 0;
	if (info.main || !info.remote || info.ignore) {

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
	if (!stalled) this.emit('response', res);
	checkIdle.call(this);
}

function isNetworkProtocol(uri) {
	var p = uri.split(':', 1).pop();
	if (p == 'http' || p == 'https') {
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
		var match = /^(?:(\d+)x(\d+)x(\d+))?\:(\d+)$/.exec(display);
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
	priv.uticket = uran();
	var cookies = opts.cookies;
	if (cookies) {
		debug('load cookies');
		if (!Array.isArray(cookies)) cookies = [cookies];
		var script = cookies.map(function(cookie) {
			return 'document.cookie = "' + cookie.replace(/"/g, '\\"') + '"';
		});
		script.push('');
		loop.call(this, true);
		this.webview.load(uri, priv.uticket, {
			script: script.join(';\n'),
			content: "<html></html>",
			waitFinish: true
		}, function(err) {
			loop.call(this, false);
			debug('load cookies done', err);
			next.call(this, err);
		}.bind(this));
	} else {
		next.call(this);
	}
	function next(err) {
		if (err) return cb(err);
		loop.call(this, true);
		this.webview.load(uri, this.priv.uticket, opts, function(err, status) {
			loop.call(this, false);
			cb(err, status);
		}.bind(this));
	}
};

WebKit.prototype.load = function(uri, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = null;
	}
	if (!opts) opts = {};
	if (!cb) cb = noop;
	load.call(this, uri, opts, cb);
	return this;
};

function initPromise(ev) {
	var prev = null;
	if (ev == "idle") prev = this.promises.load;
	if (ev == "load") prev = this.promises.ready;

	var evDfr = Q.defer();
	var list = [evDfr.promise];
	if (prev) list.push(prev);

	this.promises[ev] = Q.all(list);

	this.once(ev, function() {
		this.promises[ev].fail(function(err) {
			if (err) console.error(err);
		}).fin(function() {
			done.call(this, ev, function(err) {
				if (err) console.error(err);
			});
		}.bind(this));
		evDfr.resolve();
	});
}

function initWhen() {
	if (!this.promises) this.promises = {};
	['ready', 'load', 'idle'].forEach(function(ev) {
		var promise = this.promises[ev];
		// get rid of non-pending promises
		if (!promise || !promise.isPending()) {
			initPromise.call(this, ev);
		}
	}.bind(this));
}

WebKit.prototype.when = function(ev, fn) {
	var self = this;
	this.promises[ev] = this.promises[ev].then(function() {
		var deferred = Q.defer();
		fn.call(self, deferred.makeNodeResolver());
		return deferred.promise;
	});
	return this;
};

function load(uri, opts, cb) {
	if (uri && !url.parse(uri).protocol) uri = 'http://' + uri;

	var priv = this.priv;
	var stateErr = errorLoad(priv.state);
	if (stateErr) return cb(stateErr, this);

	this.readyState = "loading";

	initWhen.call(this);

	priv.state = LOADING;
	priv.previousEvents = {};
	priv.emittedEvents = {};
	priv.lastEvent = null;
	priv.allow = opts.allow || "all";
	priv.stall = opts.stall || 1000;

	if (priv.stallInterval) {
		clearInterval(priv.stallInterval);
		delete priv.stallInterval;
	}
	priv.stallInterval = setInterval(function() {
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
				responseDispatcher.call(this, priv.uticket, {uri: uri, status: 0});
			}
		}
	}.bind(this), 100); // let dom client cancel stalled xhr first
	priv.navigation = opts.navigation || false;
	priv.idling = false;
	priv.loopForLife = true;
	priv.timeout = setTimeout(function() {
		debugStall("%s ms - %s", opts.timeout || 30000, uri);
		this.stop();
	}.bind(this), opts.timeout || 30000);

	priv.uris = {};
	priv.pendingRequests = 0;
	priv.stamp = uran();
	if (priv.debug) priv.inspecting = true;

	if (this.listeners('error').length == 0) {
		this.on('error', logError);
	}

	if (opts.console && this.listeners('console').length == 0) {
		this.on('console', function(level) {
			if (this.listeners('console').length <= 1) {
				console[level].apply(null, Array.prototype.slice.call(arguments, 1));
			}
		});
	}
	if (Buffer.isBuffer(opts.content)) opts.content = opts.content.toString();
	if (Buffer.isBuffer(opts.style)) opts.style = opts.style.toString();
	if (Buffer.isBuffer(opts.script)) opts.script = opts.script.toString();
	var scripts = [];
	if (!priv.jsdom) scripts.push(errorEmitter);
	if (opts.console && !priv.jsdom) scripts.push(consoleEmitter);
	scripts.push({
		fn: stateTracker,
		args: [opts.preload && !priv.jsdom, opts.charset || "utf-8", priv.eventName, priv.stall, 200, 200]
	});
	if (!opts.script) opts.script = "";
	opts.script += '\n' + scripts.map(function(fn) {
		return prepareRun(fn.fn || fn, null, fn.args || null, priv).script;
	}).join('\n');

	debug('load', uri);
	priv.uticket = uran();
	priv.uris[uri] = {mtime: Date.now(), main: true};
	this.rawload(uri, opts, function(err, status) {
		debug('load done %s', uri);
		priv.state = INITIALIZED;
		if (priv.timeout) {
			clearTimeout(priv.timeout);
			delete priv.timeout;
		}
		this.status = status;
		if (!err && status < 200 || status >= 400) err = status;
		cb(err, this);
		if (!err && priv.inspecting && this.webview.inspect) {
			this.webview.inspect();
		}
	}.bind(this));
}

WebKit.prototype.preload = function(uri, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = null;
	}
	if (!opts) opts = {};
	if (!cb) cb = noop;
	var nopts = {};
	for (var key in opts) nopts[key] = opts[key];
	nopts.allow = "none";
	nopts.preload = true;
	load.call(this, uri, nopts, cb);
	return this;
};

WebKit.prototype.stop = function(cb) {
	debug("stop");
	var priv = this.priv;
	cb = cb || noop;
	if (priv.state < INITIALIZED) return cb(errorLoad(priv.state));
	loop.call(this, true);
	var wasLoading = false;
	var fincb = function() {
		loop.call(this, false);
		debug("stop done");
		cb(null, wasLoading);
	}.bind(this);
	wasLoading = this.webview && this.webview.stop && this.webview.stop(fincb);
	// immediately returned
	if (!wasLoading) setImmediate(fincb);
	this.readyState = "stop";
	return this;
};

WebKit.prototype.unload = function(cb) {
	var priv = this.priv;
	if (priv.stallInterval) {
		clearInterval(priv.stallInterval);
		delete priv.stallInterval;
	}
	if (priv.uris) delete priv.uris;
	cb = cb || noop;

	this.removeAllListeners('ready');
	this.removeAllListeners('load');
	this.removeAllListeners('idle');
	this.removeAllListeners('unload');
	this.removeAllListeners('busy');
	this.promises = {};

	if (priv.state == LOADING) {
		this.stop(function(err, wasLoading) {
			if (err) console.error(err);
			next.call(this);
		}.bind(this));
	} else {
		next.call(this);
	}

	function next() {
		priv.state = INITIALIZED;
		delete priv.stamp;
		debug('unload');
		this.load('', {content:'<html></html>'}, function(err) {
			if (err) console.error(err);
			debug('unload listen ready');
			loop.call(this, true);
			this.once('ready', function() {
				loop.call(this, false);
				debug('unload done');
				this.readyState = null;
				this.status = null;
				priv.state = INITIALIZED;
				priv.tickets = {};
				emitLifeEvent.call(this, 'unload');
				priv.loopForCallbacks = 0;
				this.removeAllListeners();
				this.promises = {};
				setImmediate(cb);
			}.bind(this));
		}.bind(this));
	}
	return this;
};

function destroy(cb) {
	if (this.webview) {
		this.priv.destroyCb = cb;
		if (this.webview.destroy) this.webview.destroy();
		else setImmediate(closedListener.bind(this, 'window'));
	} else {
		setImmediate(cb);
	}
	if (this.priv.xvfb) {
		this.priv.xvfb.kill();
	}
}

WebKit.prototype.destroy = function(cb) {
	destroy.call(this, cb);
	return this;
};

function loop(start) {
	if (!this.webview || !this.webview.loop) return;
	var priv = this.priv;
	if (start) {
		priv.loopForCallbacks++;
	} else if (start === false) {
		priv.loopForCallbacks--;
	}
	var loopFun = function() {
		if (!priv.loopImmediate && !priv.loopTimeout) {
			return;
		}
		priv.loopImmediate = null;
		priv.loopTimeout = null;
		priv.loopCount++;
		if (priv.loopForCallbacks < 0) {
			console.error("FIXME loopForCallbacks should be >= 0");
			priv.loopForCallbacks = 0;
		}
		if (priv.pendingRequests < 0) {
			console.error("FIXME pendingRequests should be >= 0");
			priv.pendingRequests = 0;
		}
		if (!this.webview) {
			return;
		}
		if (priv.loopForCallbacks == 0 && !priv.loopForLife) {
			priv.loopCount = 0;
			debug("loop stopped - no pending callbacks - no next life event to listen to");
			if (!priv.debug || !priv.inspecting) return;
		}
		var busy = this.webview.loop(true);
		if (busy) {
			priv.idleCount = 0;
		} else if (!priv.wasBusy) {
			priv.idleCount++;
		}
		priv.wasBusy = busy;
		if (busy) {
			priv.loopImmediate = setImmediate(loopFun);
		} else {
			var delay = priv.idleCount * 4;
			priv.loopTimeout = setTimeout(loopFun, Math.min(delay, 300));
		}
	}.bind(this);

	if (priv.loopTimeout) {
		clearTimeout(priv.loopTimeout);
		priv.loopTimeout = null;
	}
	if (!priv.loopImmediate) {
		priv.loopImmediate = setImmediate(loopFun);
	}
}

WebKit.prototype.run = function(script, cb) {
	var args = Array.prototype.slice.call(arguments, 1);
	if (args.length > 0 && typeof args[args.length-1] == "function") cb = args.pop();
	runcb.call(this, script, args, cb);
	return this;
};

WebKit.prototype.runev = function(script, cb) {
	var args = Array.prototype.slice.call(arguments, 1);
	if (args.length > 0 && typeof args[args.length-1] == "function") cb = args.pop();
	run.call(this, script, null, args, cb);
	return this;
};

function runcb(script, args, cb) {
	var ticket = (++this.priv.ticket).toString();
	this.priv.tickets[ticket] = cb;
	run.call(this, script, ticket, args, cb);
}

function run(script, ticket, args, cb) {
	cb = cb || noop;
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
			loop.call(this, true);
			this.webview.run(obj.script, obj.ticket);
		} else {
			this.webview.run(obj.script, obj.ticket);
			if (obj.ticket) loop.call(this, true);
			else setImmediate(cb);
		}
	}.bind(this));
}

function prepareRun(script, ticket, args, priv) {
	args = args || [];
	args = args.map(function(val) {
		if (val === undefined) return 'undefined';
		var str = JSON.stringify(val);
		if (str === undefined) {
			throw new Error("impossible to pass argument to script " + val);
		}
		return str;
	});
	var arity = 0;
	var isfunction = false;
	if (Buffer.isBuffer(script)) script = script.toString();
	if (typeof script == "function") {
		arity = script.length;
		isfunction = true;
	} else if (typeof script == "string") {
		var match = /^\s*function(\s+\w+)?\s*\(((?:\s*\w+\s*,)*(?:\s*\w+\s*))\)/.exec(script);
		if (match && match.length == 3) {
			isfunction = true;
			arity = match[2].split(',').length;
		}
	}
	var async;
	if (arity == args.length) {
		async = false;
	} else if (arity == args.length + 1) {
		async = true;
	} else {
		throw new Error(".run(script, ...) where script will miss arguments");
	}

	if (typeof script == "function") script = script.toString();
	if (!async && !ticket) {
		throw new Error("cannot call runev without a script that accepts a listener function as last parameter");
	}
	// KeyboardEvent is the only event that can carry an arbitrary string
	// If it isn't supported any more, send an empty event and make the webextension fetch
	// the data (stored in a global window variable).
	var dispatcher = '\
		var msg, en = "' + priv.eventName + '", evt = document.createEvent("KeyboardEvent"); \
		try { msg = JSON.stringify(message); } catch (e) { msg = JSON.stringify(message + "");} \
		if (evt.initKeyboardEvent) evt.initKeyboardEvent(en, false, true, null, msg); \
		else { evt.initEvent(en, false, true); evt.char = msg; }\
		window.dispatchEvent(evt);';
	var obj = {
		sync: !async,
		ticket: ticket
	};
	if (!async) {
		if (isfunction) script = '(' + script + ')(' + args.join(', ') + ')';
		else script = '(function() { return ' + script + '; })()';
		var wrap = function() {
			var message = {stamp: STAMP};
			if (TICKET) message.ticket = TICKET;
			try {
				message.args = [ SCRIPT ];
			} catch(e) {
				message.error = {
					message: e.message,
					name: e.name,
					description: e.description,
					lineNumber: e.lineNumber,
					columnNumber: e.columnNumber,
					stack: e.stack
				};
			}
			DISPATCHER
		}.toString()
		.replace(/TICKET/g, JSON.stringify(ticket))
		.replace('SCRIPT', script)
		.replace('DISPATCHER', dispatcher)
		.replace('STAMP', '"' + priv.stamp + '"');
		obj.script = '(' + wrap + ')()';
	} else {
		var wrap = function(err, result) {
			var message = {stamp: STAMP};
			message.args = Array.prototype.slice.call(arguments, 1);
			if (!TICKET) {
				message.event = err;
			} else {
				message.ticket = TICKET;
				if (err) message.error = err;
			}
			DISPATCHER
		}.toString()
		.replace(/TICKET/g, JSON.stringify(ticket))
		.replace('DISPATCHER', dispatcher)
		.replace('STAMP', '"' + priv.stamp + '"');
		args.push(wrap);
		obj.script = '(' + script + ')(' + args.join(', ') + ');';
	}
	return obj;
}

WebKit.prototype.png = function(obj, cb) {
	var wstream;
	if (typeof obj == "string") {
		wstream = fs.createWriteStream(obj);
	} else if (obj instanceof stream.Writable || obj instanceof stream.Duplex) {
		wstream = obj;
	} else {
		cb(new Error("png() first arg must be either a writableStream or a file path"));
		return this;
	}
	cb = cb || noop;
	png.call(this, wstream, cb);
	return this;
};

function png(wstream, cb) {
	loop.call(this, true);
	this.webview.png(function(err, buf) {
		if (err) {
			loop.call(this, false);
			wstream.emit('error', err);
			cb(err);
		} else if (buf == null) {
			loop.call(this, false);
			wstream.end();
			if (wstream instanceof stream.Readable) {
				cb();
			} else {
				wstream.once('finish', cb);
			}
		} else {
			wstream.write(buf);
		}
	}.bind(this));
}

WebKit.prototype.html = function(cb) {
	debug('output html');
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
		cb(err, str);
	});
	return this;
};

WebKit.prototype.pdf = function(filepath, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = null;
	}
	if (!opts) opts = {};
	if (!cb) cb = noop;
	pdf.call(this, filepath, opts, cb);
	return this;
};

function pdf(filepath, opts, cb) {
	loop.call(this, true);
	this.webview.pdf("file://" + path.resolve(filepath), opts, function(err) {
		loop.call(this, false);
		cb(err);
	}.bind(this));
}

function uran() {
	return (Date.now() * 1e4 + Math.round(Math.random() * 1e4)).toString();
}

function errorEmitter(emit) {
	var lastError;
	var OriginalError = window.Error;
	window.Error = function Error(message) {
		var err = new OriginalError(message);
		var isParent = Object.getPrototypeOf(this) == Error.prototype;
		// remove parts that comes from these error functions
		this.stack = err.stack.split('\n').slice(isParent ? 1 : 2).join('\n');
		this.message = err.message;
		this.name = err.name;
		lastError = this;
		return this;
	};
	Error.prototype = Object.create(OriginalError.prototype);
	Error.prototype.constructor = Error;

	window.URIError = function URIError(message) {
		Error.call(this, message);
		return this;
	};
	URIError.prototype = Object.create(Error.prototype);
	URIError.prototype.constructor = URIError;

	window.TypeError = function TypeError(message) {
		Error.call(this, message);
		return this;
	};
	TypeError.prototype = Object.create(Error.prototype);
	TypeError.prototype.constructor = TypeError;

	window.SyntaxError = function SyntaxError(message) {
		Error.call(this, message);
		return this;
	};
	SyntaxError.prototype = Object.create(Error.prototype);
	SyntaxError.prototype.constructor = SyntaxError;

	window.ReferenceError = function ReferenceError(message) {
		Error.call(this, message);
		return this;
	};
	ReferenceError.prototype = Object.create(Error.prototype);
	ReferenceError.prototype.constructor = ReferenceError;

	window.RangeError = function RangeError(message) {
		Error.call(this, message);
		return this;
	};
	RangeError.prototype = Object.create(Error.prototype);
	RangeError.prototype.constructor = RangeError;

	window.EvalError = function EvalError(message) {
		Error.call(this, message);
		return this;
	};
	EvalError.prototype = Object.create(Error.prototype);
	EvalError.prototype.constructor = EvalError;

	window.onerror = function(message, file, line, col, err) {
		var ret = ["error", message, file, line, col];
		if (!err && lastError) {
			err = lastError;
			lastError = null;
		}
		ret.push(err);
		emit.apply(null, ret);
	};
}

function consoleEmitter(emit) {
	if (!window.console) return;
	['log', 'error', 'info', 'warn'].forEach(function(meth) {
		window.console[meth] = function() {
			var args = ['console', meth].concat(Array.prototype.slice.call(arguments));
			emit.apply(null, args);
		};
	});
}

function stateTracker(preload, charset, eventName, staleXhrTimeout, stallTimeout, stallInterval, emit) {
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
	var frames = {len: 0};
	var requests = {len: 0, stall: 0};

	if (preload) disableExternalResources();

	var w = {};
	['setTimeout', 'clearTimeout',
	'setInterval', 'clearInterval',
	'XMLHttpRequest', 'WebSocket',
	'requestAnimationFrame', 'cancelAnimationFrame'].forEach(function(meth) {
		w[meth] = window[meth];
	});
	window['hasRunEvent_' + eventName] = function(event) {
		if (EV[event] > lastRunEvent) {
			lastRunEvent = EV[event];
			check('lastrun' + event);
		}
	};

	document.charset = charset;

	window.addEventListener('r' + eventName, ignoreListener, false);

	if (document.readyState != 'loading') readyListener();
	else document.addEventListener('DOMContentLoaded', readyListener, false);

	if (document.readyState == 'complete') loadListener();
	else window.addEventListener('load', loadListener, false);

	function disableExternalResources() {
		var count = 0;
		function jumpAuto(node) {
			var att = {
				body: "onload",
				link: "rel",
				script: "type"
			}[node.nodeName.toLowerCase()];
			if (!att) return;
			var val = node.hasAttribute(att) ? node[att] : null;
			if (lastEvent == EV.init) {
				node[att] = undefined;
				preloadList.push({node: node, val: val, att: att});
			} else {
				node[att] = val;
			}
		}
		observer = new MutationObserver(function(mutations) {
			var node, val, list, att;
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
					obj.node[obj.att] = obj.val;
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

	function ignoreListener(e) {
		var uri = e && e.keyIdentifier;
		if (!uri) return;
		if (!requests[uri]) requests[uri] = {count: 0};
		requests[uri].stall = true;
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
		var args = Array.prototype.slice.call(arguments, 0);
		var stall = false;
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
				obj.fn.apply(null, Array.prototype.slice.call(arguments, 1));
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

	window.setInterval = function(fn, interval) {
		var args = Array.prototype.slice.call(arguments, 0);
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
			if (intervals.len <= intervals.stall) {
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
			if (frames.len == 0) {
				check('frame');
			}
		}
	}
	window.requestAnimationFrame = function(fn) {
		frames.len++;
		var id = w.requestAnimationFrame.call(window, function(ts) {
			var err;
			try {
				fn(ts);
			} catch (e) {
				err = e;
			}
			doneFrame(id);
			if (err) throw err; // rethrow
		});
		frames[id] = true;
		return id;
	};
	window.cancelAnimationFrame = function(id) {
		doneFrame(id);
		return w.cancelAnimationFrame.call(window, id);
	};

	if (window.WebSocket) window.WebSocket = function() {
		var ws = new w.WebSocket(Array.prototype.slice.call(arguments, 0));
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
		var ret = wopen.apply(this, Array.prototype.slice.call(arguments, 0));
		return ret;
	};
	var wsend = window.XMLHttpRequest.prototype.send;
	window.XMLHttpRequest.prototype.send = function() {
		var priv = this._private;
		if (!priv) return;
		requests.len++;
		try {
			wsend.apply(this, Array.prototype.slice.call(arguments, 0));
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
		}, staleXhrTimeout);
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
			frames: frames.len,
			requests: requests.len - requests.stall,
			lastEvent: lastEvent,
			lastRunEvent: lastRunEvent
		};
		if (lastEvent <= lastRunEvent) {
			if (lastEvent == EV.load) {
				if (timeouts.len <= timeouts.stall && intervals.len <= intervals.stall
					&& frames.len == 0 && requests.len <= requests.stall) {
					lastEvent += 1;
					emitNext("idle", from, url, info);
				}
			} else if (lastEvent == EV.idle) {
				emitNext("busy", from, url);
			} else if (lastEvent == EV.init && hasReady) {
				lastEvent += 1;
				emitNext("ready", from, url, info);
			} else if (lastEvent == EV.ready && hasLoaded) {
				lastEvent += 1;
				emitNext("load", from, url, info);
			} else {
				return;
			}
		}
	}

	function emitNext(ev, from, url, info) {
		w.setTimeout.call(window, function() {
			emit(ev, from, url, info);
		}, 0);
	}
}

module.exports = WebKit;

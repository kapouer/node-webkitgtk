var util = require('util');
var EventEmitter = require('events').EventEmitter;
var stream = require('stream');
var fs = require('fs');
var path = require('path');
var url = require('url');
var debug = require('debug')('webkitgtk');
var debugStall = console.warn;
var debugError = console.error;

// internal state, does not match readyState
var CREATED = 0;
var INITIALIZING = 1;
var INITIALIZED = 2;
var LOADING = 3;

var RegEvents = /^(ready|load|idle|unload)$/;

var availableDisplays = {};

function WebKit(opts, cb) {
	if (!(this instanceof WebKit)) {
		var chainit = require('chainit3');
		var ChainableWebKit = chainit(WebKit);
		var _load = ChainableWebKit.prototype.load;
		var _preload = ChainableWebKit.prototype.preload;
		chainit.add(ChainableWebKit, "wait", function(ev, cb) {
			var priv = this.priv;
			if (priv.lastEvent == ev || priv.previousEvents[ev]) {
				return (cb || noop)();
			} else if (this.readyState == "stop") {
				throw new Error("Loading was stopped");
			} else {
				EventEmitter.prototype.once.call(this, ev, cb);
			}
		}, function(ev) {
			if (!RegEvents.test(ev)) throw new Error("call .wait(ev) with ev like " + RegEvents);
			if (!this.chainState) throw new Error("call .wait(ev) after .load(...)");
			this.chainState[ev] = true;
		});
		chainit.add(ChainableWebKit, "load", function(uri, cb) {
			_load.apply(this, Array.prototype.slice.call(arguments));
			this.priv.nextEvents = this.chainState;
		}, function(uri) {
			this.chainState = {};
		});
		chainit.add(ChainableWebKit, "preload", function(uri, cb) {
			_preload.apply(this, Array.prototype.slice.call(arguments));
			this.priv.nextEvents = this.chainState;
		}, function(uri) {
			this.chainState = {};
		});

		var inst = new ChainableWebKit();

		if (cb) return inst.init(opts, cb);
		else return inst.init(opts);
	}
	this.priv = initialPriv();
	if (opts) throw new Error("Use WebKit(opts, cb) as short-hand for Webkit().init(opts, cb)");
}

util.inherits(WebKit, EventEmitter);

WebKit.prototype.init = function(opts, cb) {
	var priv = this.priv;
	if (priv.state >= INITIALIZING) return cb(new Error("init must not be called twice"), this);
	priv.state = INITIALIZING;
	if (opts == null) opts = {};
	else if (typeof opts != "object") opts = {display: opts};
	var ndis = opts.display != null ? opts.display : process.env.DISPLAY;
	if (typeof ndis == "string") {
		var match = /^(?:(\d+)x(\d+)x(\d+))?\:(\d+)$/.exec(ndis);
		if (match) {
			if (match[1] != null) opts.width = match[1];
			if (match[2] != null) opts.height = match[2];
			if (match[3] != null) opts.depth = match[3];
			if (match[4] != null) ndis = match[4];
		}
	}
	ndis = parseInt(ndis);
	if (isNaN(ndis)) ndis = 0;
	opts.display = ndis;
	if (opts.offscreen == null) opts.offscreen = true;
	if (opts.debug) {
		priv.debug = true;
		opts.offscreen = false;
		opts.inspector = true;
	}
	if (opts.manual) {
		priv.manual = true;
	}
	debug('find display');
	display.call(this, opts, function(err, child, newDisplay) {
		if (err) return cb(err);
		debug('display found', newDisplay);
		if (child) priv.xvfb = child;
		process.env.DISPLAY = ":" + newDisplay;
		var Bindings = require(__dirname + '/lib/webkitgtk.node');
		this.webview = new Bindings({
			webextension: __dirname + '/lib/ext',
			eventName: priv.eventName,
			requestListener: requestDispatcher.bind(this),
			receiveDataListener: receiveDataDispatcher.bind(this),
			responseListener: responseDispatcher.bind(this),
			eventsListener: eventsDispatcher.bind(this),
			policyListener: policyDispatcher.bind(this),
			authListener: authDispatcher.bind(this),
			closedListener: closedListener.bind(this),
			cacheDir: opts.cacheDir,
			offscreen: opts.offscreen,
			inspector: opts.inspector
		});
		debug('new instance created');
		priv.state = INITIALIZED;
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
		eventName: "webkitgtk" + Date.now(),
		loopTimeout: null,
		loopImmediate: null,
		wasBusy: false,
		wasIdle: false,
		idling: false,
		previousEvents: {},
		lastEvent: null,
		nextEvents: {},
		emittedEvents: {}
	};
}

function done(ev) {
	var emitted = this.priv.emittedEvents;
	if (emitted[ev]) return;
	if (ev == "idle" || ev == "load") if (!emitted.ready) return done.call(this, "ready");
	if (ev == "idle" && !emitted.load) return done.call(this, "load");
	emitted[ev] = true;
	runcb.call(this, hasRunEvent, [this.priv.eventName, ev], function() {
		// this catches the errors
		if (!arguments.length) return;
		var cb = arguments[arguments.length - 1];
		if (typeof cb == "function") cb();
	});
}

WebKit.prototype.done = function(ev, cb) {
	done.call(this, ev);
	if (cb) setImmediate(cb);
};

function emitLifeEvent(event) {
	var priv = this.priv;
	if (priv.lastEvent) priv.previousEvents[priv.lastEvent] = true;
	priv.lastEvent = event;
	setImmediate(function() {
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
	}.bind(this));
	debug('emit event', event);
	EventEmitter.prototype.emit.call(this, event);
	if (!priv.manual) {
		setImmediate(done.bind(this, event));
	}
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
			emitAllEvents.call(this);
			destroy.call(this, priv.destroyCb);
			this.priv = initialPriv();
		break;
	}
}

function receiveDataDispatcher(uri, length) {
	if (uri && this.priv.uris && uri != this.uri) this.priv.uris[uri] = Date.now();
}

function authDispatcher(request) {
	// ignore auth request synchronously
	if (this.listeners('authenticate').length == 0) return true;
	EventEmitter.prototype.emit.call(this, 'authenticate', request);
}

function policyDispatcher(type, uri) {
	// prevents navigation once a view has started loading (if navigation is false)
	if (type == "navigation" && this.priv.navigation == false && this.priv.state > LOADING) {
		debug("policy ignore", type, uri);
		return true;
	}
}

function eventsDispatcher(err, json) {
	var priv = this.priv;
	if (err) {
		console.error("Error in event dispatcher", err, json);
		if (priv.debug) {
			console.info("This error might occur because of HTTP response Header Content-Security-Policy");
		}
		return;
	}
	var obj = JSON.parse(json);
	if (!obj) {
		console.error("received invalid event", json);
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
			debug("reached idle", this.uri, info);
		} else if (obj.event == "busy") {
			// not a life event
			EventEmitter.prototype.emit.call(this, obj.event);
		} else {
			EventEmitter.prototype.emit.apply(this, args);
		}
	} else if (obj.ticket) {
		var cb = priv.tickets[obj.ticket];
		if (cb) {
			loop.call(this, false);
			delete priv.tickets[obj.ticket];
			args.unshift(obj.error);
			cb.apply(this, args);
		} else {
			// could be reached by dropped events
			console.warn("event without pending ticket", json);
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
"uri status mime headers length filename".split(' ').forEach(
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
};

function Request(uri, binding) {
	this.headers = binding;
	this.uri = uri;
	this.cancel = false;
}

function requestDispatcher(binding) {
	var priv = this.priv;
	var uri = binding.uri;
	if (!uri) return; // ignore empty uri
	debug("request", uri);
	var mainUri = this.uri || "";

	var cancel = false;
	if (priv.allow == "none") {
		if (uri != mainUri) cancel = true;
	} else if (priv.allow == "same-origin") {
		if (url.parse(uri).host != url.parse(mainUri).host) cancel = true;
	} else if (priv.allow instanceof RegExp) {
		if (uri != mainUri && !priv.allow.test(uri)) cancel = true;
	}
	if (cancel) {
		debug("cancelled before dispatch");
		binding.cancel = "1";
		return;
	}
	var req = new Request(uri, binding);

	EventEmitter.prototype.emit.call(this, 'request', req);

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
	if (uri != mainUri) {
		if (priv.uris) priv.uris[uri] = Date.now();
	}
	if (uri && isNetworkProtocol(uri)) {
		debug("counted as pending");
		priv.pendingRequests++;
	}
}

function responseDispatcher(binding) {
	var res = new Response(this, binding);
	var uri = res.uri;
	if (!uri) return;
	debug('response', uri);
	var priv = this.priv;
	if (priv.uris) {
		var lastMod = priv.uris[uri];
		if (lastMod == Infinity) return;
		if (lastMod) delete priv.uris[uri];
		else if (uri != this.uri) return console.warn(this.uri, "had an untracked response", uri, res.status, res.headers);
	}
	if (res.status == 0 && !res.stall) {
		debug('status 0, ignored');
		return;
	}
	if (uri && isNetworkProtocol(uri)) {
		debug('counted as ending pending');
		priv.pendingRequests--;
	}
	EventEmitter.prototype.emit.call(this, 'response', res);
}

function isNetworkProtocol(uri) {
	var p = uri.split(':', 1).pop();
	if (p == 'http' || p == 'https') {
		return true;
	} else {
		debug("is not network protocol", uri);
	}
}

function noop(err) {
	if (err) console.error(err);
}

function display(opts, cb) {
	var display = opts.display;
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
				console.log("Spawned xvfb on DISPLAY=:" + display);
				cb(null, child, display);
				process.on('exit', function() {
					child.kill();
				});
			}
		});
	});
}

function errorLoad(state) {
	if (state < INITIALIZED) {
		return "cannot call method before init";
	} else if (state > INITIALIZED) {
		return "cannot call method during loading";
	}
}

WebKit.prototype.load = function(uri, cb) {
	var opts = {};
	if (typeof cb != "function") {
		opts = cb;
		if (typeof arguments[2] == "function") {
			cb = arguments[2];
		} else {
			cb = noop;
		}
	}
	var cookies = opts.cookies;
	if (cookies) {
		debug('load cookies');
		if (!Array.isArray(cookies)) cookies = [cookies];
		var script = cookies.map(function(cookie) {
			return 'document.cookie = "' + cookie.replace(/"/g, '\\"') + '"';
		});
		script.push('');
		preload.call(this, uri, {script: script.join(';\n'), content:"<html></html>"}, function(err) {
			debug('load cookies done', err);
			if (err) return cb(err, this);
			setImmediate(function() {
				load.call(this, uri, opts, cb);
			}.bind(this));
		}.bind(this));
	} else {
		load.call(this, uri, opts, cb);
	}
};

function load(uri, opts, cb) {
	if (uri && !url.parse(uri).protocol) uri = 'http://' + uri;

	var priv = this.priv;
	if (priv.state != INITIALIZED) return cb(new Error(errorLoad(priv.state)), this);

	this.readyState = "loading";
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
		for (var uri in priv.uris) {
			if (now - priv.uris[uri] > priv.stall) {
				priv.uris[uri] = Infinity;
				debugStall("Timeout %s after %s ms", uri, priv.stall);
				responseDispatcher.call(this, {uri: uri, status: 0, stall: true});
			}
		}
	}.bind(this), priv.stall); // let dom client cancel stalled xhr first
	priv.navigation = opts.navigation || false;
	priv.wasIdle = false;
	priv.idling = false;
	priv.loopForLife = true;
	priv.timeout = setTimeout(stop.bind(this), opts.timeout || 30000);
	priv.uris = {};
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
	var scripts = [errorEmitter];
	if (opts.console) scripts.push(consoleEmitter);
	scripts.push({fn: stateTracker, args: [opts.preload, opts.charset || "utf-8", priv.eventName, priv.stall, 200, 200]});
	if (!opts.script) opts.script = "";
	opts.script += '\n' + scripts.map(function(fn) {
		return prepareRun(fn.fn || fn, null, fn.args || null, priv).script;
	}).join('\n');
	loop.call(this, true);
	debug('load', uri);
	this.webview.load(uri, opts, function(err, status) {
		loop.call(this, false);
		debug('load %s done', uri);
		priv.state = INITIALIZED;
		if (priv.timeout) {
			clearTimeout(priv.timeout);
			delete priv.timeout;
		}
		this.status = status;
		if (!err && status < 200 || status >= 400) err = status;
		cb(err, this);
		if (!err && priv.inspecting) {
			this.webview.inspect();
		}
	}.bind(this));
}

WebKit.prototype.preload = function(cb) {
	var opts = {}, uri;
	if (typeof cb == "function") {
		uri = "";
	} else if (typeof arguments[1] == "function") {
		uri = cb;
		cb = arguments[1];
	} else {
		uri = cb;
		opts = arguments[1];
		cb = arguments[2];
	}
	if (!cb) cb = noop;
	preload.call(this, uri, opts, cb);
};

function preload(uri, opts, cb) {
	var nopts = {};
	for (var key in opts) nopts[key] = opts[key];
	nopts.allow = "none";
	nopts.preload = true;
	load.call(this, uri, nopts, cb);
}

function stop(cb) {
	var priv = this.priv;
	cb = cb || noop;
	if (priv.state < INITIALIZED) return cb(new Error(errorLoad(priv.state)));
	loop.call(this, true);
	var wasLoading = false;
	var fincb = function() {
		if (wasLoading) priv.loopForLife = false; // because it will never call back
		loop.call(this, false);
		cb(null, wasLoading);
	}.bind(this);
	wasLoading = this.webview.stop(fincb);
	// immediately returned
	if (!wasLoading) setImmediate(fincb);
	this.readyState = "stop";
	emitAllEvents.call(this);
}

WebKit.prototype.stop = function(cb) {
	stop.call(this, cb);
};

function emitAllEvents() {
	var priv = this.priv;
	if (!priv.lastEvent) emitLifeEvent.call(this, 'ready');
	if (priv.lastEvent == "ready") emitLifeEvent.call(this, 'load');
	if (priv.lastEvent == "load") emitLifeEvent.call(this, 'idle');
	if (priv.lastEvent == "idle") emitLifeEvent.call(this, 'unload');
}

WebKit.prototype.unload = function(cb) {
	var priv = this.priv;
	if (priv.stallInterval) {
		clearInterval(priv.stallInterval);
		delete priv.stallInterval;
	}
	if (priv.uris) delete priv.uris;
	cb = cb || noop;
	if (priv.state != INITIALIZED) return cb(new Error(errorLoad(priv.state)), this);
	priv.state = LOADING;
	this.readyState = null;
	this.status = null;
	debug('unload');
	loop.call(this, true);
	this.webview.load('', {content:'<html></html>'}, function(err) {
		debug('unload done', err);
		loop.call(this, false);
		priv.state = INITIALIZED;
		priv.tickets = {};
		priv.loopForCallbacks = 0;
		emitLifeEvent.call(this, 'unload');
		setImmediate(cb);
	}.bind(this));
};

function destroy(cb) {
	if (this.webview) {
		this.priv.destroyCb = cb;
		this.webview.destroy();
	} else {
		setImmediate(cb);
	}
	if (this.priv.xvfb) {
		this.priv.xvfb.kill();
	}
}

WebKit.prototype.destroy = function(cb) {
	destroy.call(this, cb);
};

function loop(start) {
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
		if (priv.idling && !priv.wasIdle && !priv.inspecting && priv.idleCount > 0) {
			priv.wasIdle = true;
			this.readyState = "idling";
			priv.idling = false;
			emitLifeEvent.call(this, 'idle');
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

WebKit.prototype.run = function(script, params, done, cb) {
	if (!cb && typeof done == "function") {
		cb = done;
		done = null;
	}
	if (typeof params == "function") {
		if (!cb) {
			cb = params;
			done = null;
		}	else {
			done = params;
		}
		params = null;
	}
	if (params != null && !Array.isArray(params)) params = [params];
	runcb.call(this, script, params, function(err) {
		if (done) {
			var args = Array.prototype.slice.call(arguments);
			args.push(cb);
			done.apply(this, args);
		} else {
			cb(err);
		}
	});
};

WebKit.prototype.runev = function(script, cb) {
	var args = Array.prototype.slice.call(arguments, 1);
	if (args.length > 0 && typeof args[args.length-1] == "function") cb = args.pop();
	run.call(this, script, null, args, cb);
};

function runcb(script, args, cb) {
	var ticket = (this.priv.ticket++).toString();
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
	setImmediate(function() {
		if (!this.webview) return cb(new Error("WebKit uninitialized"));
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
	var arity = null;
	if (typeof script == "function") {
		if (script.length > args.length + 1) throw new Error(".run(script, ...) where script will miss arguments");
	}

	if (typeof script == "function" || Buffer.isBuffer(script)) script = script.toString();
	var async = /^\s*function(\s+\w+)?\s*\((\s*\w+\s*,)*(\s*\w+\s*)\)/.test(script);
	if (!async && !ticket) {
		throw new Error("cannot call runev without function(emit) {} script signature");
	}
	// KeyboardEvent is the only event that can carry an arbitrary string
	// If it isn't supported any more, send an empty event and make the webextension fetch
	// the data (stored in a global window variable).
	var dispatcher = '\
		var msg, evt = document.createEvent("KeyboardEvent"); \
		try { msg = JSON.stringify(message); } catch (e) { msg = JSON.stringify(message + "");} \
		evt.initKeyboardEvent("' + priv.eventName + '", false, true, null, msg); \
		window.dispatchEvent(evt); \
		';
	var obj = {
		sync: !async,
		ticket: ticket
	};
	if (!async) {
		if (/^\s*function(\s+\w+)?\s*\(\s*\)/.test(script)) script = '(' + script + ')()';
		else script = '(function() { return ' + script + '; })()';
		var wrap = function() {
			var message = {};
			if (TICKET) message.ticket = TICKET;
			try {
				message.args = [ SCRIPT ];
			} catch(e) {
				message.error = e;
			}
			DISPATCHER
		}.toString()
		.replace(/TICKET/g, JSON.stringify(ticket))
		.replace('SCRIPT', script)
		.replace('DISPATCHER', dispatcher);
		obj.script = '(' + wrap + ')()';
	} else {
		var wrap = function(err, result) {
			var message = {};
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
		.replace('DISPATCHER', dispatcher);
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
		return cb(new Error("png() first arg must be either a writableStream or a file path"));
	}
	cb = cb || noop;
	png.call(this, wstream, cb);
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
	runcb.call(this, function() {
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
	}, null, function(err, str) {
		debug('output html done');
		cb(err, str);
	});
};

WebKit.prototype.pdf = function(filepath, cb) {
	var opts = {};
	if (typeof cb != "function") {
		opts = cb;
		cb = arguments[2];
	}
	if (!cb) cb = noop;
	pdf.call(this, filepath, opts, cb);
};

function pdf(filepath, opts, cb) {
	loop.call(this, true);
	this.webview.pdf("file://" + path.resolve(filepath), opts, function(err) {
		loop.call(this, false);
		cb(err);
	}.bind(this));
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
	['log', 'error', 'info', 'warn'].forEach(function(meth) {
		console[meth] = function() {
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
	var missedEvent;
	var preloadList = [], observer;

	if (preload) disableExternalResources();

	var w = {};
	['setTimeout', 'clearTimeout',
	'setInterval', 'clearInterval',
	'XMLHttpRequest', 'WebSocket',
	'requestAnimationFrame', 'cancelAnimationFrame'].forEach(function(meth) {
		w[meth] = window[meth];
	});
	window['hasRunEvent_' + eventName] = function(event) {
		lastRunEvent = EV[event];
		check('lastrun');
	};

	document.charset = charset;

	window.addEventListener('load', loadListener, false);
	window.addEventListener('r' + eventName, ignoreListener, false);
	document.addEventListener('DOMContentLoaded', readyListener, false);

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
			node[att] = 'null';
			if (lastEvent == EV.init) {
				node[att] = 'null';
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
		if (lastEvent == EV.ready) {
			window.removeEventListener('load', loadListener, false);
			check('load');
		} else {
			missedEvent = EV.load;
		}
	}
	function readyListener() {
		if (lastEvent != EV.init) return;
		document.removeEventListener('DOMContentLoaded', readyListener, false);
		if (preloadList.length) {
			w.setTimeout.call(window, function() {
				preloadList.forEach(function(obj) {
					obj.node[obj.att] = obj.val;
				});
				preloadList = [];
				check("ready");
				if (missedEvent == EV.load) {
					if (!preload) {
						console.error("load event should not happen before ready event", document.location.toString());
					}
					loadListener();
				}
			}, 0);
		} else {
			check("ready");
		}
	}

	var timeouts = {len: 0, stall: 0};
	function doneTimeout(id) {
		if (id && timeouts[id]) {
			if (timeouts[id].stall) timeouts.stall--;
			delete timeouts[id];
			timeouts.len--;
			if (timeouts.len <= timeouts.stall) {
				check('timeout');
			}
		}
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
		var id = w.setTimeout.apply(window, args);
		timeouts[id] = {stall: stall};
		obj.id = id;
		return id;
	};
	window.clearTimeout = function(id) {
		doneTimeout(id);
		return w.clearTimeout.call(window, id);
	};

	var intervals = {len: 0, stall: 0};
	window.setInterval = function(fn, interval) {
		var args = Array.prototype.slice.call(arguments, 0);
		var stall = false;
		if (interval >= stallInterval) {
			stall = true;
			intervals.stall++;
		}
		intervals.len++;
		var id = w.setInterval.apply(window, args);
		intervals[id] = {stall: stall};
		return id;
	};
	window.clearInterval = function(id) {
		if (id && intervals[id]) {
			if (intervals[id].stall) intervals.stall--;
			delete intervals[id];
			intervals.len--;
			if (intervals.len <= intervals.stall) {
				check('interval');
			}
		}
		return w.clearInterval.call(window, id);
	};

	var frames = {len: 0};
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

	window.WebSocket = function() {
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

	var requests = {len: 0, stall: 0};

	function absolute(url) {
		return (new URL(url, document.location)).href;
	}

	function ignoreListener(e) {
		var uri = e && e.keyIdentifier;
		if (!uri) return;
		if (!requests[uri]) requests[uri] = {count: 0};
		requests[uri].stall = true;
	}
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
		w.setTimeout.call(window, function() {
			check('xhr clean');
		});
	}

	function check(from, url) {
		w.setTimeout.call(window, function() {
			if (timeouts.len <= timeouts.stall && intervals.len <= intervals.stall
			&& frames.len == 0 && requests.len <= requests.stall
			&& (preload || lastEvent <= lastRunEvent)) {
				var info = {
					timeouts: timeouts,
					intervals: intervals,
					frames: frames,
					requests: requests
				};
				if (lastEvent == EV.load) {
					lastEvent += 1;
					emitNext("idle", from, url, info);
				} else if (lastEvent == EV.idle) {
					emitNext("busy", from, url);
				} else if (lastEvent == EV.init) {
					lastEvent += 1;
					emitNext("ready", from, url);
				} else if (lastEvent == EV.ready) {
					lastEvent += 1;
					emitNext("load", from, url);
				} else {
					return;
				}
			}
		}, 0);
	}

	function emitNext(ev, from, url, info) {
		w.setTimeout.call(window, function() {
			emit(ev, from, url, info);
		}, 0);
	}
}

module.exports = WebKit;

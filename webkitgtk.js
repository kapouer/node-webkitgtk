var util = require('util');
var EventEmitter = require('events').EventEmitter;
var stream = require('stream');
var fs = require('fs');
var path = require('path');
var url = require('url');

// internal state, does not match readyState
var CREATED = 0;
var INITIALIZING = 1;
var INITIALIZED = 2;
var LOADING = 3;

var RegEvents = /^(ready|load|idle|unload)$/;

var ChainableWebKit;

function WebKit(opts, cb) {
	if (!(this instanceof WebKit)) {
		var chainit = require('chainit3');

		if (!ChainableWebKit) {
			ChainableWebKit = chainit(WebKit);
			chainit.add(ChainableWebKit, "wait", function(ev, cb) {
				var priv = this.priv;
				if (priv.lastEvent == ev) return (cb || noop)();
				else if (this.readyState == "stop") {
					throw new Error("Loading was stopped");
				} else if (priv.previousEvents[ev]) {
					throw new Error("do not wait() an event that already happened:" + ev);
				} else {
					EventEmitter.prototype.once.call(this, ev, cb);
				}
			}, function(ev, cb) {
				if (!RegEvents.test(ev)) return cb(new Error("call .wait(ev) with ev like " + RegEvents));
				if (!this.chainState) return cb(new Error("call .wait(ev) after .load(...)"));
				this.chainState[ev] = true;
			});
			chainit.add(ChainableWebKit, "load", function(uri, cb) {
				WebKit.prototype.load.apply(this, Array.prototype.slice.call(arguments));
				this.priv.nextEvents = this.chainState;
			}, function(uri, cb) {
				this.chainState = {};
			});
			chainit.add(ChainableWebKit, "preload", function(uri, cb) {
				WebKit.prototype.preload.apply(this, Array.prototype.slice.call(arguments));
				this.priv.nextEvents = this.chainState;
			}, function(uri, cb) {
				this.chainState = {};
			});
		}

		var inst = new ChainableWebKit();

		if (cb) return inst.init(opts, cb);
		else return inst.init(opts);
	}
	if (opts) throw new Error("Use WebKit(opts, cb) as short-hand for Webkit().init(opts, cb)");
	var priv = this.priv = initialPriv();
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
	display.call(this, opts, function(err, child, newDisplay) {
		if (err) return cb(err);
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
		nextEvents: {}
	};
}

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
	this.emit(event);
}

function closedListener(what) {
	var priv = this.priv;
	if (what == "inspector") {
		priv.inspecting = false;
	}	else if (what == "window") {
		if (priv.loopTimeout) {
			clearTimeout(priv.loopTimeout);
			priv.loopTimeout = null;
		}
		if (priv.loopImmediate) {
			clearImmediate(priv.loopImmediate);
			priv.loopImmediate = null;
		}
		destroy.call(this);
	}
}

function receiveDataDispatcher(uri, length) {
	if (uri != this.uri) this.priv.uris[uri] = Date.now();
}

function authDispatcher(request) {
	// ignore auth request synchronously
	if (this.listeners('authenticate').length == 0) return true;
	this.emit('authenticate', request);
}

function policyDispatcher(type, uri) {
	// prevents navigation once a view has started loading (if navigation is false)
	if (type == "navigation" && this.navigation == false && this.priv.state > LOADING) {
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
		args.unshift(obj.event);
		if (obj.event == "ready") {
			this.readyState = "interactive";
			emitLifeEvent.call(this, obj.event);
		} else  if (obj.event == "load") {
			this.readyState = "complete";
			emitLifeEvent.call(this, obj.event);
		} else if (obj.event == "idle") {
			priv.idling = true;
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
			args.unshift(obj.error);
			cb.apply(this, args);
		} else {
			// could be reached by dropped events
			console.notice("event without pending ticket", json);
		}
	}
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
	if (uri != this.uri) {
		if (priv.uris) priv.uris[uri] = Date.now();
	}

	var cancel = false;
	if (priv.allow == "none") {
		if (uri != this.uri) cancel = true;
	} else if (priv.allow == "same-origin") {
		if (url.parse(uri).host != url.parse(this.uri).host) cancel = true;
	} else if (priv.allow instanceof RegExp) {
		if (uri != this.uri && !priv.allow.test(uri)) cancel = true;
	}
	if (cancel) {
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
	if (req.cancel) {
		binding.cancel = "1";
		return;
	}
	if (uri && isNetworkProtocol(uri)) {
		priv.pendingRequests++;
	}
}

function responseDispatcher(binding) {
	var res = new Response(this, binding);
	var uri = res.uri;
	if (uri && this.priv.uris) delete this.priv.uris[uri];
	if (res.status == 0) {
		return;
	}
	if (uri && isNetworkProtocol(uri)) {
		this.priv.pendingRequests--;
	}
	this.emit('response', res);
}

function isNetworkProtocol(uri) {
	var p = uri.split(':', 1).pop();
	if (p == 'http' || p == 'https') {
		return true;
	} else if (p != "data" && p != "about") {
		console.info("Unknown protocol in", uri);
		console.info("Please report issue to https://github.com/kapouer/node-webkitgtk/issues");
	}
}

function noop(err) {
	if (err) console.error(err);
}

function display(opts, cb) {
	var display = opts.display;
	fs.exists('/tmp/.X' + display + '-lock', function(exists) {
		if (exists) return cb(null, null, display);
		if (display == 0) return cb("Error - do not spawn xvfb on DISPLAY 0");
		require('headless')({
			display: {
				width: opts.width || 1024,
				height: opts.height || 768,
				depth: opts.depth || 32
			}
		}, display, function(err, child, display) {
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
	if (state < INITIALIZED) return "cannot call method before init";
	else if (state > INITIALIZED) return "cannot call method during loading";
}

WebKit.prototype.load = function(uri, cb) {
	var opts = {};
	if (typeof cb != "function") {
		opts = cb;
		cb = arguments[2];
	}
	if (!cb) cb = noop;
	var cookies = opts.cookies;
	if (cookies) {
		if (!Array.isArray(cookies)) cookies = [cookies];
		var script = cookies.map(function(cookie) {
			return 'document.cookie = "' + cookie.replace(/"/g, '\\"') + '"';
		}).join(';') + ';';
		preload.call(this, uri, {content:"<html></html>"}, function(err) {
			if (err) return cb(err, this);
			runcb.call(this, script, null, function(err) {
				if (err) return cb(err, this);
				load.call(this, uri, opts, cb);
			}.bind(this));
		}.bind(this));
	} else {
		load.call(this, uri, opts, cb);
	}
};

function load(uri, opts, cb) {
	var priv = this.priv;
	if (priv.state != INITIALIZED) return cb(new Error(errorLoad(priv.state)), this);

	this.readyState = "loading";
	priv.state = LOADING;
	priv.previousEvents = {};
	priv.lastEvent = null;
	priv.allow = opts.allow || "all";
	priv.stall = opts.stall || 1000;
	priv.navigation = opts.navigation || false;
	priv.wasIdle = false;
	priv.idling = false;
	priv.loopForLife = true;
	priv.timeout = setTimeout(stop.bind(this), opts.timeout || 30000);
	priv.uris = {};
	if (priv.debug) priv.inspecting = true;

	if (this.listeners('error').length == 0) {
		this.on('error', function(msg, uri, line, column) {
			if (this.listeners('error').length <= 1) {
				console.error(msg, "\n", uri, "line", line, "column", column);
			}
		});
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
	scripts.push({fn: stateTracker, args: [priv.stall]});
	if (!opts.script) opts.script = "";
	opts.script += '\n' + scripts.map(function(fn) {
		return prepareRun(fn.fn || fn, null, fn.args || null, priv).script;
	}).join('\n');
	loop.call(this, true);
	this.webview.load(uri, opts, function(err, status) {
		loop.call(this, false);
		priv.state = INITIALIZED;
		if (priv.timeout) {
			clearTimeout(priv.timeout);
			delete priv.timeout;
		}
		this.status = status;
		if (!err && status < 200 || status >= 400) err = status;
		cb(err, this);
		if (err) return;
		if (priv.inspecting) {
			this.webview.inspect();
		}
	}.bind(this));
}

WebKit.prototype.preload = function(uri, cb) {
	var opts = {};
	if (typeof cb != "function") {
		opts = cb;
		cb = arguments[2];
	}
	if (!cb) cb = noop;
	preload.call(this, uri, opts, cb);
};

function preload(uri, opts, cb) {
	var nopts = {};
	for (var key in opts) nopts[key] = opts[key];
	nopts.allow = "none";
	nopts.script = disableAllScripts;
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
	if (!priv.lastEvent) emitLifeEvent.call(this, 'ready');
	if (priv.lastEvent == "ready") emitLifeEvent.call(this, 'load');
	if (priv.lastEvent == "load") emitLifeEvent.call(this, 'idle');
	if (priv.lastEvent == "idle") emitLifeEvent.call(this, 'unload');
}

WebKit.prototype.stop = function(cb) {
	stop.call(this, cb);
};

WebKit.prototype.unload = function(cb) {
	var priv = this.priv;
	cb = cb || noop;
	if (priv.state != INITIALIZED) return cb(new Error(errorLoad(priv.state)), this);
	priv.state = LOADING;
	this.readyState = null;
	this.status = null;
	loop.call(this, true);
	this.webview.load('', {}, function(err) {
		loop.call(this, false);
		priv.state = INITIALIZED;
		priv.tickets = {};
		priv.loopForCallbacks = 0;
		emitLifeEvent.call(this, 'unload');
		setImmediate(cb);
	}.bind(this));
};

function destroy() {
	this.priv = initialPriv();
	if (this.webview) {
		this.webview.destroy();
		delete this.webview;
	}
	if (this.priv.xvfb) {
		this.priv.xvfb.kill();
	}
}

WebKit.prototype.destroy = function(cb) {
	destroy.call(this, cb);
};

function stalled() {
	var priv = this.priv;
	var now = Date.now();
	var count = 0;
	for (var uri in priv.uris) {
		if (now > priv.uris[uri] + priv.stall) {
			count++;
		}
	}
	return count;
}

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

WebKit.prototype.run = function(script, cb) {
	var args = Array.prototype.slice.call(arguments, 1);
	if (args.length > 0 && typeof args[args.length-1] == "function") cb = args.pop();
	runcb.call(this, script, args, cb);
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
		var str = JSON.stringify(val);
		if (str === undefined) throw new Error("impossible to pass argument to script " + val);
		return str;
	});
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
	}, null, cb);
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
	window.onerror = function() {
		var ret = Array.prototype.slice.call(arguments, 0);
		ret.unshift("error");
		emit.apply(null, ret);
	};
}

function consoleEmitter(emit) {
	['log', 'error', 'info', 'warn'].forEach(function(meth) {
		console[meth] = function() {
			var args = Array.prototype.slice.call(arguments, 0);
			args.unshift(meth);
			args.unshift('console');
			emit.apply(null, args);
		};
	});
}

function stateTracker(staleXhrTimeout, emit) {
	var lastEvent = "";

	window.addEventListener('load', loadListener, false);
	document.addEventListener('DOMContentLoaded', readyListener, false);

	function loadListener() {
		if (lastEvent == "ready") {
			lastEvent = "load";
			window.removeEventListener('load', loadListener, false);
			emitNextFrame("load");
			check(); // this one makes it crash
		}
	}
	function readyListener() {
		if (lastEvent == "") {
			lastEvent = "ready";
			document.removeEventListener('DOMContentLoaded', readyListener, false);
			emitNextFrame("ready");
		}
	}

	var w = {};
	['setTimeout', 'clearTimeout',
	'setInterval', 'clearInterval',
	'XMLHttpRequest', 'WebSocket',
	'requestAnimationFrame', 'cancelAnimationFrame'].forEach(function(meth) {
		w[meth] = window[meth];
	});

	var timeouts = {len: 0, stall: 0};
	function doneTimeout(id) {
		if (id && timeouts[id]) {
			if (timeouts[id].stall) timeouts.stall--;
			delete timeouts[id];
			timeouts.len--;
			if (timeouts.len == 0) {
				check();
			}
		}
	}
	window.setTimeout = function setTimeout(fn, timeout) {
		var args = Array.prototype.slice.call(arguments, 0);
		var stall = false;
		if (timeout < 200) args[1] = 0; // collapse timeouts
		else {
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

	var intervals = {len: 0};
	window.setInterval = function(fn, interval) {
		var args = Array.prototype.slice.call(arguments, 0);
	  if (interval < 200) args[1] = 0; // collapse intervals
		intervals.len++;
		var id = w.setInterval.apply(window, args);
		intervals[id] = true;
		return id;
	};
	window.clearInterval = function(id) {
		if (id && intervals[id]) {
			delete intervals[id];
			intervals.len--;
			if (intervals.len == 0) {
				check();
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
				check();
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

	var requests = {len: 0, stall: 0};
	var wopen = window.XMLHttpRequest.prototype.open;
	window.XMLHttpRequest.prototype.open = function(method, url, async) {
		if (this.url) xhrClean.call(this);
		this.addEventListener("progress", xhrProgress);
		this.addEventListener("load", xhrChange);
		this.addEventListener("error", xhrClean);
		this.addEventListener("abort", xhrClean);
		this.addEventListener("timeout", xhrClean);
		this.url = url;
		return wopen.apply(this, Array.prototype.slice.call(arguments, 0));
	};
	var wsend = window.XMLHttpRequest.prototype.send;
	window.XMLHttpRequest.prototype.send = function() {
		try {
			wsend.apply(this, Array.prototype.slice.call(arguments, 0));
		} catch (e) {
			xhrClean.call(this);
			return;
		}
		requests[this.url] = w.setTimeout.call(window, function(url) {
			requests.stall++;
			delete requests[url];
			check();
		}.bind(null, this.url), staleXhrTimeout);
		requests.len++;
	};
	function xhrProgress(e) {
		if (e.totalSize > 0 && requests[this.url]) {
			w.clearTimeout.call(window, requests[this.url]);
			delete requests[this.url];
		}
	}
	function xhrChange(e) {
		if (this.readyState != this.DONE) return;
		xhrClean.call(this);
	}
	function xhrClean() {
		if (!this.url) return;
		this.removeEventListener("progress", xhrProgress);
		this.removeEventListener("load", xhrChange);
		this.removeEventListener("abort", xhrClean);
		this.removeEventListener("error", xhrClean);
		this.removeEventListener("timeout", xhrClean);
		delete this.url;
		requests.len--;
		if (requests.len == 0) check();
	}

	function check() {
		w.setTimeout.call(window, function() {
			if (timeouts.len <= timeouts.stall && intervals.len == 0 && frames.len == 0) {
				if (lastEvent == "load" && requests.len <= requests.stall) {
					lastEvent = "idle";
					emitNextFrame("idle");
				} else if (lastEvent == "idle" && requests.len == 0) {
					emitNextFrame("busy");
				}
			}
		}, 0);
	}

	function emitNextFrame(ev) {
		w.requestAnimationFrame.call(window, function(ts) {
			emit(ev);
		});
	}
}

var disableAllScripts = '(' + function() {
	var disableds = [];
	window.preloading = true;
	var observer = new MutationObserver(function(mutations) {
		var node, val, list, att;
		for (var m=0; m < mutations.length; m++) {
			list = mutations[m].addedNodes;
			if (!list) continue;
			for (var i=0; i < list.length; i++) {
				node = list[i];
				if (node.nodeType != 1) continue;
				switch (node.nodeName) {
					case "SCRIPT":
						att = node.attributes.getNamedItem('type');
						if (att) val = att.nodeValue;
						else val = null;
						node.type = "disabled";
						disableds.push({node: node, val: val});
					break;
					case "BODY":
						val = node.onload;
						if (val) {
							node.onload = "";
							disableds.push({node: node, val: val});
						}
					break;
				}
			}
		}
	});
	function prereadyListener(e) {
		document.removeEventListener('DOMContentLoaded', prereadyListener, false);
		observer.disconnect();
		for (var i=0, item, len=disableds.length; i < len; i++) {
			item = disableds[i];
			switch (item.node.nodeName) {
				case "SCRIPT":
					item.node.type = item.val;
				break;
				case "BODY":
					setTimeout(function(item) {
						item.node.onload = item.val;
					}.bind(window, item), 0);
				break;
			}
		}
		delete window.preloading;
	}
	document.addEventListener('DOMContentLoaded', prereadyListener, false);
	observer.observe(document, {
		childList: true,
		subtree: true
	});
}.toString() + ')();';

module.exports = WebKit;

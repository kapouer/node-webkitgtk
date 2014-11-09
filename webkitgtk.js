var util = require('util');
var EventEmitter = require('events').EventEmitter;
var stream = require('stream');
var fs = require('fs');
var path = require('path');
var url = require('url');

// different ways of running commands
var RUN_SYNC = 0;
var RUN_ASYNC = 1;
var RUN_PATH = 2;

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
				else if (priv.previousEvents[ev]) {
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
	if (typeof opts == "string") {
		var match = /^(\d+)x(\d+)x(\d+)\:(\d+)$/.exec(opts);
		if (!match) {
			var ndis = parseInt(opts);
			if (!isNaN(ndis)) opts = ndis;
		} else opts = {
			width: match[1],
			height: match[2],
			depth: match[3],
			display: match[4]
		};
	}
	if (typeof opts == "number") {
		opts = { display: opts };
	} else if (!opts) {
		opts = {};
	}
	if (opts.offscreen == null) opts.offscreen = true;
	if (opts.debug) {
		priv.debug = true;
		opts.offscreen = false;
		opts.inspector = true;
	}
	opts.display = opts.display || 0;
	display.call(this, opts, function(err, child) {
		if (err) return cb(err);
		if (child) priv.xvfb = child;
		process.env.DISPLAY = ":" + opts.display;
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
		previousEvents: {}
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
		this.destroy();
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
	if (err) return console.error("Error in event dispatcher", err, json);
	var obj = JSON.parse(json);
	if (!obj) {
		console.error("received invalid event", json);
		return;
	}
	if (obj.event) {
		obj.args.unshift(obj.event);
		this.emit.apply(this, obj.args);
	} else if (obj.ticket) {
		var cb = this.priv.tickets[obj.ticket];
		if (cb) {
			loop.call(this, false);
			delete this.priv.tickets[obj.ticket];
			cb(obj.error, obj.result);
		} else {
			// could be reached by dropped events
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
	if (res.status == 0) return;
	if (uri && isNetworkProtocol(uri)) this.priv.pendingRequests--;
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
		if (exists) return cb();
		if (display == 0) return cb("Error - do not spawn xvfb on DISPLAY 0");
		console.log("Spawning xvfb on DISPLAY=:" + display);
		require('headless')({
			display: {
				width: opts.width || 1024,
				height: opts.height || 768,
				depth: opts.depth || 32
			}
		}, display, function(err, child, display) {
			if (err) cb(err);
			else {
				cb(null, child);
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
			runcb.call(this, script, function(err) {
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
	if (Buffer.isBuffer(opts.content)) opts.content = opts.content.toString();
	if (Buffer.isBuffer(opts.style)) opts.style = opts.style.toString();
	if (Buffer.isBuffer(opts.script)) opts.script = opts.script.toString();

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

		run.call(this, function(emit) {
			window.onerror = function() {
				var ret = Array.prototype.slice.call(arguments, 0);
				ret.unshift("error");
				emit.apply(null, ret);
			};
		});

		var emitEvents = function(result) {
			this.readyState = result;
			emitLifeEvent.call(this, 'ready');
			if (result == "complete") {
				emitLifeEvent.call(this, 'load');
			}	else {
				runcb.call(this, function(done) {
					if (document.readyState == "complete") done(null, document.readyState);
					else {
						function loadListener() {
							window.removeEventListener('load', loadListener, false);
							done(null, "complete");
						}
						window.addEventListener('load', loadListener, false);
					}
				}, function(err, result) {
					if (err) console.error(err);
					this.readyState = result;
					emitLifeEvent.call(this, 'load');
				}.bind(this));
			}
		}.bind(this);

		setImmediate(function() {
			runcb.call(this, function(done) {
				function after(state) {
					if (window.preloading) setTimeout(after, 10);
					else setTimeout(done.bind(window, null, state), 0);
				}
				if (/interactive|complete/.test(document.readyState)) {
					after(document.readyState);
				} else {
					function readyListener() {
						document.removeEventListener('DOMContentLoaded', readyListener, false);
						after("interactive");
					}
					document.addEventListener('DOMContentLoaded', readyListener, false);
				}
			}, function(err, result) {
				if (err) console.error(err);
				if (priv.inspecting) {
					this.webview.inspect();
					var checkDebugger = function() {
						if (!priv.inspecting) {
							console.error("Inspector crashed, please try again.\nContinuing page load...");
							return emitEvents(result);
						}
						var start = Date.now();
						runcb.call(this, function test(done) {
							debugger;
							done();
						}, function() {
							if (Date.now() - start > 2000) emitEvents(result);
							else setTimeout(checkDebugger, 10);
						});
					}.bind(this);
					checkDebugger();
				} else {
					emitEvents(result);
				}
			}.bind(this));
		}.bind(this));


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

WebKit.prototype.destroy = function(cb) {
	this.priv = initialPriv();
	if (this.webview) {
		this.webview.destroy();
		delete this.webview;
	}
	if (this.priv.xvfb) {
		this.priv.xvfb.kill();
	}
	if (cb) setImmediate(cb);
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
		if (!priv.loopImmediate && !priv.loopTimeout) return;
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
		if (!this.webview) return;
		if (priv.loopForCallbacks == 0 && !priv.loopForLife) {
			priv.loopCount = 0;
			if (!priv.debug || !priv.inspecting) return;
		}

		var busy = this.webview.loop(true);
		if (busy) priv.idleCount = 0;
		else if (!priv.wasBusy) priv.idleCount++;

		if (priv.idleCount >= 1 && this.readyState == "complete" && !priv.wasIdle) {
			if (!priv.inspecting && priv.pendingRequests <= stalled.call(this)) {
				priv.wasIdle = true;
				emitLifeEvent.call(this, 'idle');
			}
		} else {
			priv.wasBusy = busy;
		}
		if (busy)	{
			priv.loopImmediate = setImmediate(loopFun);
		} else {
			var delay = (priv.idleCount + 1) * 5;
			priv.loopTimeout = setTimeout(loopFun, Math.min(delay, 1000));
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
	runcb.call(this, script, cb);
};

function runcb(script, cb) {
	var message = {
		ticket: (this.priv.ticket++).toString()
	};
	this.priv.tickets[message.ticket] = cb;
	run.call(this, script, message, cb);
}

WebKit.prototype.runev = function(script, cb) {
	run.call(this, script, {}, cb);
};

function run(script, message, cb) {
	var priv = this.priv;
	if (typeof script == "function" || Buffer.isBuffer(script)) script = script.toString();
	cb = cb || noop;
	message = message || {};

	var mode = RUN_SYNC;
	if (/^\s*function(\s+\w+)?\s*\(\s*\w+\s*\)/.test(script)) mode = RUN_ASYNC;

	if (mode != RUN_ASYNC && !message.ticket) {
		return cb(new Error("cannot call runev without function(emit) {} script signature"));
	}

	message.mode = mode;

	// KeyboardEvent is the only event that can carry an arbitrary string
	// If it isn't supported any more, send an empty event and make the webextension fetch
	// the data (stored in a global window variable).
	var dispatcher = '\
		var evt = document.createEvent("KeyboardEvent"); \
		evt.initKeyboardEvent("' + priv.eventName + '", false, true, null, JSON.stringify(message)); \
		window.dispatchEvent(evt); \
		';
	var initialMessage = JSON.stringify(message);

	setImmediate(function() {
		if (!this.webview) return;
		if (mode == RUN_SYNC) {
			if (/^\s*function(\s+\w+)?\s*\(\s*\)/.test(script)) script = '(' + script + ')()';
			else script = '(function() { return ' + script + '; })()';
			var wrap = '\
			(function() { \
				var message = ' + initialMessage + '; \
				try { \
					message.result = ' + script + '; \
				} catch(e) { \
					message.error = e; \
				} \
				' + dispatcher + '\
			})()';
			loop.call(this, true);
			this.webview.run(wrap, initialMessage);
		} else if (mode == RUN_ASYNC) {
			var fun = 'function(err, result) {\
				var message = ' + initialMessage + ';\
				if (!message.ticket) { \
					message.event = err; \
					message.args = Array.prototype.slice.call(arguments, 1); \
				} else { \
					if (err) message.error = err; \
					message.result = result; \
				} \
				' + dispatcher + '\
			}';
			var wrap = '(' + script + ')(' + fun + ');';
			wrap = 'eval(' + JSON.stringify(wrap) + ');';
			// events work only if webview is alive, see lifecycle events
			this.webview.run(wrap, initialMessage);
			if (message.ticket) loop.call(this, true);
			else setImmediate(cb);
		}
	}.bind(this));
};

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
	runcb.call(this, "document.documentElement.outerHTML;", cb);
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

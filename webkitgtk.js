var util = require('util');
var events = require('events');
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

var ChainableWebKit;

// chainit helper, see below
function Listener() {}
Listener.prototype.listen = function() {
	var args = Array.prototype.slice.call(arguments, 0);
	if (this.cb) this.cb.apply(null, args);
	else this.args = args;
};

function WebKit(opts, cb) {
	if (!(this instanceof WebKit)) {
		var chainit = require('chainit3');

		WebKit.prototype.wait = function(obj, cb) {
			// lstn.args is set, event fired, callback now
			if (obj.args) cb.apply(null, obj.args);
			else obj.cb = cb;
		};
		if (!ChainableWebKit) ChainableWebKit = chainit(WebKit);

		var inst = new ChainableWebKit();

		// work around https://github.com/vvo/chainit/issues/12
		var wait = inst.wait;
		inst.wait = function(ev, cb) {
			var lstn = new Listener();
			this.once(ev, lstn.listen.bind(lstn));
			if (cb) return wait.call(this, lstn, cb);
			else return wait.call(this, lstn);
		};
		if (cb) return inst.init(opts, cb);
		else return inst.init(opts);
	}
	if (opts) throw new Error("Use WebKit(opts, cb) as short-hand for Webkit().init(opts, cb)");
	var priv = this.priv = initialPriv();
}
util.inherits(WebKit, events.EventEmitter);

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
			responseListener: responseDispatcher.bind(this),
			eventsListener: eventsDispatcher.bind(this),
			policyListener: policyDispatcher.bind(this),
			authListener: authDispatcher.bind(this),
			cacheDir: opts.cacheDir
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
		preloading: null,
		wasBusy: false,
		wasIdle: false
	};
}

function emitLifeEvent(event) {
	setImmediate(function() {
		var willStop = event == "unload" || this.listeners('unload').length == 1 && (
			event == "idle" || this.listeners('idle').length == 1 && (
				event == "load" || this.listeners('load').length == 1 &&
					event == "ready"
				)
			);
		if (willStop && this.priv.loopForLife && !this.priv.preloading) {
			// not when preloading because it would stop the second load right after calling it
			this.priv.loopForLife = false;
		}
	}.bind(this));
	this.emit(event);
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

function Request(uri) {
	this.uri = uri;
}

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

function requestDispatcher(uri) {
	var priv = this.priv;
	if (priv.preloading && uri != this.uri) {
		return;
	}
	var cancel = false;
	if (this.allow == "none") {
		if (uri != this.uri) cancel = true;
	} else if (this.allow == "same-origin") {
		if (url.parse(uri).host != url.parse(this.uri).host) cancel = true;
	} else if (this.allow instanceof RegExp) {
		if (!this.allow.test(uri)) cancel = true;
	}
	if (cancel) {
		return;
	}

	var req = new Request(uri);
	this.emit('request', req);
	if (req.uri) {
		var protocol = req.uri.split(':', 1).pop();
		if (protocol == 'http' || protocol == 'https') {
			priv.pendingRequests++;
		} else if (protocol != "data" && protocol != "about") {
			console.info("Request with unknown protocol", protocol);
			console.info("Please report issue to https://github.com/kapouer/node-webkitgtk/issues");
		}
	}
	return req.uri;
}

function responseDispatcher(binding) {
	if (this.priv.preloading) return;
	var res = new Response(this, binding);
	if (res.status == 0) return; // was actually cancelled
	this.priv.pendingRequests--;
	this.emit('response', res);
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
	load.call(this, uri, opts, cb);
};

function load(uri, opts, cb) {
	var priv = this.priv;
	if (priv.state != INITIALIZED) return cb(new Error(errorLoad(priv.state)), this);

	priv.state = LOADING;

	this.allow = opts.allow || "all";
	this.navigation = opts.navigation || false;
	this.readyState = "loading";
	priv.wasIdle = false;

	preload.call(this, uri, opts, cb);
	(function(next) {
		if (opts.stylesheet) {
			fs.readFile(opts.stylesheet, function(err, css) {
				if (err) console.error(err);
				if (opts.css) console.error("stylesheet option overwrites css option");
				if (css) opts.css = css.toString();
				next();
			});
		} else {
			next();
		}
	})(function() {
		priv.loopForLife = true;
		loop.call(this);
		priv.timeout = setTimeout(stop.bind(this), opts.timeout || 30000);
		if (!priv.preloading && this.listeners('error').length == 0) {
			this.on('error', function(msg, uri, line, column) {
				if (this.listeners('error').length <= 1) {
					console.error(msg, "\n", uri, "line", line, "column", column);
				}
			});
		}
		this.webview.load(uri, opts, function(err, status) {
			priv.state = INITIALIZED;
			if (priv.timeout) {
				clearTimeout(priv.timeout);
				delete priv.timeout;
			}
			this.status = status;
			if (!priv.preloading) {
				priv.preloading = null;
				if (!err && status < 200 || status >= 400) err = status;
				cb(err, this);
				if (err) return;
			}
			setImmediate(function() {
				if (priv.state != INITIALIZED) {
					return;
				}
				run.call(this, function(emit) {
					window.onerror = function() {
						var ret = Array.prototype.slice.call(arguments, 0);
						ret.unshift("error");
						emit.apply(null, ret);
					};
				});
				runcb.call(this, function(done) {
					if (/interactive|complete/.test(document.readyState)) done(null, document.readyState);
					else document.addEventListener('DOMContentLoaded', function() { done(null, "interactive"); }, false);
				}, function(err, result) {
					if (err) console.error(err);
					this.readyState = result;
					if (!priv.preloading) emitLifeEvent.call(this, 'ready');
					if (result == "complete") {
						if (!priv.preloading) emitLifeEvent.call(this, 'load');
						else this.emit('preload');
					}	else {
						runcb.call(this, function(done) {
							if (document.readyState == "complete") done(null, document.readyState);
							else window.addEventListener('load', function() { done(null, "complete"); }, false);
						}, function(err, result) {
							if (err) console.error(err);
							this.readyState = result;
							if (!priv.preloading) emitLifeEvent.call(this, 'load');
							else this.emit('preload');
						}.bind(this));
					}
				}.bind(this));
			}.bind(this));
		}.bind(this));
	}.bind(this));
};

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
		cb();
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
		if (priv.loopForCallbacks == 0 && !priv.loopForLife || !this.webview) {
			priv.loopCount = 0;
			return;
		}
		var busy = this.webview.loop(true);
		if (busy) priv.idleCount = 0;
		else if (!priv.wasBusy) priv.idleCount++;

		if (priv.pendingRequests == 0 && priv.idleCount >= 1 && this.readyState == "complete" && !priv.wasIdle) {
			priv.wasIdle = true;
			if (!priv.preloading) emitLifeEvent.call(this, 'idle');
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
	if (typeof script == "function") script = script.toString();
	cb = cb || noop;
	message = message || {};

	var mode = RUN_SYNC;
	if (/^\s*function(\s+\w+)?\s*\(\s*\w+\s*\)/.test(script)) mode = RUN_ASYNC;
	else if (/^(file|http|https):/.test(script)) mode = RUN_PATH;

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
			// events work only if webview is alive, see lifecycle events
			this.webview.run(wrap, initialMessage);
			if (message.ticket) loop.call(this, true);
			else setImmediate(cb);
		} else if (mode == RUN_PATH) {
			console.log("TODO");
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

function preload(uri, opts, cb) {
	var priv = this.priv;
	if (!opts.cookies || priv.preloading !== null) return;
	priv.preloading = true;
	this.once('preload', function() {
		var cookies = opts.cookies;
		if (!Array.isArray(cookies)) cookies = [cookies];
		var script = cookies.map(function(cookie) {
			return 'document.cookie = "' + cookie.replace(/"/g, '\\"') + '"';
		}).join(';') + ';';
		runcb.call(this, script, function(err) {
			if (err) return cb(err);
			priv.preloading = false;
			load.call(this, uri, opts, cb);
		}.bind(this));
	});
}

module.exports = WebKit;

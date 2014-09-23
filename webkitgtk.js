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

function WebKit(opts, cb) {
	if (!(this instanceof WebKit)) {
		if (!ChainableWebKit) ChainableWebKit = require('chainit')(WebKit);
		var inst = new ChainableWebKit();
		if (cb) return inst.init(opts, cb);
		else return inst.init(opts);
	}
	if (opts) throw new Error("Use WebKit(opts, cb) as short-hand for Webkit().init(opts, cb)");
	var priv = this.priv = initialPriv();
	this.on('error', function(msg, uri, line, column) {
		if (this.listeners('error').length <= 1) {
			console.error(msg, "\n", uri, "line", line, "column", column);
		}
	});
	this.on('ready', lifeEventHandler.bind(this, 'ready'));
	this.on('load', lifeEventHandler.bind(this, 'load'));
	this.on('idle', lifeEventHandler.bind(this, 'idle'));
	this.on('unload', lifeEventHandler.bind(this, 'unload'));
}
util.inherits(WebKit, events.EventEmitter);

WebKit.prototype.init = function(opts, cb) {
	var priv = this.priv;
	if (priv.state >= INITIALIZING) return cb(new Error("init must not be called twice"), this);
	priv.state = INITIALIZING;
	if (typeof opts == "string") {
		var match = /^(\d+)x(\d+)x(\d+)\:(\d+)$/.match(opts);
		opts = {
			width: match[1],
			height: match[2],
			depth: match[3],
			display: match[4]
		};
	} else if (typeof opts == "number") {
		opts = { display: opts };
	} else if (!opts) opts = {};
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
			policyListener: policyDispatcher.bind(this)
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
	};
}

function lifeEventHandler(event) {
	var willStop = event == "unload" || this.listeners('unload').length == 1 && (
		event == "idle" || this.listeners('idle').length == 1 && (
			event == "load" || this.listeners('load').length == 1 &&
				event == "ready"
			)
		);
	if (willStop && this.priv.loopForLife) {
		this.priv.loopForLife = false;
	}
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
Object.defineProperty(Response.prototype, "uri", {
  get: function() {
		if (this._uri == null) this._uri = this.binding.uri;
		return this._uri;
	}
});
Object.defineProperty(Response.prototype, "status", {
  get: function() {
		if (this._status == null) this._status = this.binding.status;
		return this._status;
	}
});
Object.defineProperty(Response.prototype, "mime", {
  get: function() {
		if (this._mime == null) this._mime = this.binding.mime;
		return this._mime;
	}
});
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
	if (req.uri) priv.pendingRequests++;
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

WebKit.prototype.load = function(uri, opts, cb) {
	load.call(this, uri, opts, cb);
};

function load(uri, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = {};
	} else if (!opts) {
		opts = {};
	}
	if (!cb) cb = noop;
	var priv = this.priv;
	if (priv.state != INITIALIZED) return cb(new Error(errorLoad(priv.state)), this);

	priv.state = LOADING;

	this.allow = opts.allow || "all";
	this.navigation = opts.navigation || false;
	this.readyState = "loading";

	preload.call(this, uri, opts, cb);
	(function(next) {
		if (opts.stylesheet) {
			fs.readFile(opts.stylesheet, function(err, css) {
				if (err) console.error(err);
				if (opts.css) console.error("stylesheet option overwrites css option");
				if (css) opts.css = css;
				next();
			});
		} else {
			next();
		}
	})(function() {
		priv.loopForLife = true;
		loop.call(this);
		this.webview.load(uri, opts, function(err, status) {
			this.status = status;
			if (!priv.preloading) {
				priv.preloading = null;
				if (!err && status < 200 || status >= 400) err = status;
				cb(err, this);
			}
			priv.state = INITIALIZED;
			setImmediate(function() {
				if (priv.state != INITIALIZED) {
					return;
				}
				run.call(this, function(emit) {
					window.onerror = function() {
						emit.apply(null, "error", Array.prototype.slice.call(arguments, 0));
					};
				});
				runcb.call(this, function(done) {
					if (/interactive|complete/.test(document.readyState)) done(null, document.readyState);
					else document.addEventListener('DOMContentLoaded', function() { done(null, "interactive"); }, false);
				}, function(err, result) {
					if (err) console.error(err);
					this.readyState = result;
					var prefix = priv.preloading ? "pre" : "";
					this.emit(prefix + 'ready');
					if (result == "complete") {
						this.emit(prefix + 'load');
					}	else {
						runcb.call(this, function(done) {
							if (document.readyState == "complete") done(null, document.readyState);
							else window.addEventListener('load', function() { done(null, "complete"); }, false);
						}, function(err, result) {
							if (err) console.error(err);
							this.readyState = result;
							this.emit(prefix + 'load');
						}.bind(this));
					}
				}.bind(this));
			}.bind(this));
		}.bind(this));
	}.bind(this));
};

WebKit.prototype.stop = function(cb) {
	var priv = this.priv;
	cb = cb || noop;
	if (priv.state < INITIALIZED) return cb(new Error(errorLoad(priv.state)));
	loop.call(this, true);
	var wasLoading = false;
	var fincb = function() {
		if (wasLoading) this.priv.loopForLife = false; // because it will never call back
		loop.call(this, false);
		cb();
	}.bind(this);
	wasLoading = this.webview.stop(fincb);
	// immediately returned
	if (!wasLoading) setImmediate(fincb);
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
		this.emit('unload');
		cb();
	}.bind(this));
};

WebKit.prototype.destroy = function(cb) {
	if (this.priv.xvfb) {
		this.priv.xvfb.kill();
	}
	this.priv = initialPriv();
	this.webview.destroy();
	delete this.webview;
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
		if (priv.loopForCallbacks == 0 && !priv.loopForLife) {
			priv.loopCount = 0;
			return;
		}
		var busy = this.webview.loop(true);
		if (busy) priv.idleCount = 0;
		else if (!priv.wasBusy) priv.idleCount++;

		if (priv.pendingRequests == 0 && priv.idleCount >= 1 && this.readyState == "complete") {
			this.emit('idle');
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

	// this is a hack because it leaks information between worlds
	// the good way of doing this is sending an empty event
	// then the webextension execute some JS to fetch the data that has
	// been stored somewhere as global... FIXME the day it doesn't work any more/:
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
	if (!this.readyState || this.readyState == "loading") {
		this.on('load', function() {
			png.call(this, wstream, cb);
		});
	} else {
		png.call(this, wstream, cb);
	}
};

function png(wstream, cb) {
	loop.call(this, true);
	wstream.on('finish', cb).on('error', cb);
	this.webview.png(function(err, buf) {
		if (err) {
			loop.call(this, false);
			wstream.emit('error', err);
		} else if (buf == null) {
			loop.call(this, false);
			wstream.end();
		} else {
			wstream.write(buf);
		}
	}.bind(this));
}

WebKit.prototype.html = function(cb) {
	if (!this.readyState || this.readyState == "loading") {
		this.on('ready', function() {
			html.call(this, cb);
		});
	} else {
		html.call(this, cb);
	}
};

function html(cb) {
	runcb.call(this, "document.documentElement.outerHTML;", cb);
}

WebKit.prototype.pdf = function(filepath, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = {};
	} else if (!opts) {
		opts = {};
	}
	if (!cb) cb = noop;
	if (!this.readyState || this.readyState == "loading") {
		this.on('load', function() {
			pdf.call(this, filepath, opts, cb);
		});
	} else {
		pdf.call(this, filepath, opts, cb);
	}
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

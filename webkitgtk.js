var util = require('util');
var events = require('events');
var stream = require('stream');
var fs = require('fs');
var path = require('path');
var url = require('url');

var RUN_SYNC = 0;
var RUN_ASYNC = 1;
var RUN_PATH = 2;

function WebKit(uri, opts, cb) {
	if (!(this instanceof WebKit)) return new WebKit(uri, opts, cb);
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = {};
	}
	if (typeof uri != "string") {
		opts = uri;
		uri = null;
	}
	if (!cb) cb = noop;
	opts = opts || {};
	this.pendingRequests = 0;
	this.looping = 0;
	this.ticket = 0;
	this.tickets = {};
	this.eventName = "webkitgtk" + Date.now();
	var self = this;
	this.on('error', function(msg, uri, line, column) {
		if (this.listeners('error').length <= 1) {
			console.error(msg, "\n", uri, "line", line, "column", column);
		}
	});
	this.on('ready', lifeEventHandler.bind(this, 'ready'));
	this.on('load', lifeEventHandler.bind(this, 'load'));
	this.on('idle', lifeEventHandler.bind(this, 'idle'));
	this.on('unload', lifeEventHandler.bind(this, 'unload'));

	if (uri) this.load(uri, opts, cb);
	else if (opts.display != null) initialize.call(this, opts, cb);
}
util.inherits(WebKit, events.EventEmitter);

Object.defineProperty(WebKit.prototype, "uri", {
  get: function() {
		if (this.webview) return this.webview.uri;
		else return;
	}
});

function initialize(opts, cb) {
	if (this.initializing) return cb(new Error("Initialized twice"));
	this.initializing = true;
	var self = this;
	display.call(this, opts.display || 0, opts, function(err, display) {
		if (err) return cb(err);
		process.env.DISPLAY = ":" + display;
		var Bindings = require(__dirname + '/lib/webkitgtk.node');
		self.webview = new Bindings({
			webextension: __dirname + '/lib/ext',
			eventName: self.eventName,
			requestListener: requestDispatcher.bind(self),
			responseListener: responseDispatcher.bind(self),
			eventsListener: eventsDispatcher.bind(self)
		});
		delete self.initializing;
		cb();
		if (self.initCb) {
			var fun = self.initCb;
			delete self.initCb;
			fun();
		}
	});
}

function lifeEventHandler(event) {
	var condition = event == "unload" || this.listeners('unload').length == 1 && (
		event == "idle" || this.listeners('idle').length == 1 && (
			event == "load" || this.listeners('load').length == 1 &&
				event == "ready"
			)
		);
	if (condition) this.defaultLoop = false;
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
		this.loop(false);
		var cb = this.tickets[obj.ticket];
		delete this.tickets[obj.ticket];
		cb(obj.error, obj.result);
	}
}

function Request(uri) {
	this.uri = uri;
}

function requestDispatcher(uri) {
	if (this.preloading && uri != this.uri) {
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
	if (cancel) return;

	var req = new Request(uri);
	this.emit('request', req);
	if (req.uri) this.pendingRequests++;
	return req.uri;
}

function responseDispatcher(res) {
	if (this.preloading) return;
	this.pendingRequests--;
	this.emit('response', res);
}

function noop(err) {
	if (err) console.error(err);
}

function display(display, opts, cb) {
	var self = this;
	fs.exists('/tmp/.X' + display + '-lock', function(exists) {
		if (exists) return cb(null, display);
		if (display == 0) return cb("Error - do not spawn xvfb on DISPLAY 0");
		if (opts.xfb) {
			console.log("Unsafe xfb option is spawning xvfb...");
			require('headless')({
				display: {
					width: opts.xfb.width || 1024,
					height: opts.xfb.height || 768,
					depth: opts.xfb.depth || 32
				}
			}, display, function(err, child, display) {
				cb(err, display);
				if (!err) process.on('exit', function() {
					child.kill();
				});
			});
		}
	});
}

WebKit.prototype.load = function(uri, opts, cb) {
	if (this.readyState == "opening") throw new Error("Cannot call load while loading");
	this.readyState = null;
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = {};
	} else if (!opts) {
		opts = {};
	}
	if (!cb) cb = noop;
	if (!this.webview) {
		// if this happens some other code is broken
		if (this.initCb) throw new Error("Bad state: already queued a load after initialize");
		this.initCb = this.load.bind(this, uri, opts, cb);
		if (!this.initializing) initialize.call(this, opts, function(err) {
			if (err) cb(err); // propagate error
		});
		return;
	}
	this.readyState = "opening";
	this.allow = opts.allow || "all";
	var self = this;
	this.once('response', function(res) {
		var status = res.status;
		if (res.uri == self.uri && (status < 200 || status >= 400)) {
			self.status = status;
		}
	});
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
		self.loop(true);
		self.webview.load(uri, opts, function(err) {
			self.loop(false);
			if (!self.preloading) {
				cb(err || self.status, self);
			}
			self.readyState = "loading";
			self.run(function(emit) {
				window.onerror = function() {
					emit.apply(null, Array.prototype.slice.call(arguments, 0));
				};
			}, "error");
			self.run(function(done) {
				// this function is executed in the window context of the current view - it cannot access local scopes
				if (/interactive|complete/.test(document.readyState)) done(null, document.readyState);
				else document.addEventListener('DOMContentLoaded', function() { done(null, "interactive"); }, false);
			}, function(err, result) {
				if (err) console.error(err);
				self.readyState = result;
				var prefix = self.preloading ? "pre" : "";
				self.emit(prefix + 'ready');
				if (result == "complete") {
					self.emit(prefix + 'load');
				}	else {
					self.run(function(done) {
						if (document.readyState == "complete") done(null, document.readyState);
						else window.addEventListener('load', function() { done(null, "complete"); }, false);
					}, function(err, result) {
						if (err) console.error(err);
						self.readyState = result;
						self.emit(prefix + 'load');
					});
				}
			});
		});
	});
	return this;
};

WebKit.prototype.unload = function(cb) {
	this.load('about:blank', cb);
	delete this.uri;
	delete this.status;
	delete this.readyState;
};

WebKit.prototype.close = function() {
	this.closed = true;
	this.loop(false);
	this.webview.close();
	delete this.webview;
	function disabled() {
		throw new Error("Cannot use a closed WebKit view");
	}
	for (var prop in WebKit.prototype) {
		this[prop] = disabled;
	}
};

WebKit.prototype.loop = function(start, block) {
	if (start) {
		this.looping++;
	} else if (start === false) {
		this.looping--;
	}
	if (!this.looping) {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		return;
	}
	var self = this;
	var busy = this.webview.loop(block);
	if (!busy && this.pendingRequests == 0 && !this.wasBusy && this.readyState == "complete") {
		setImmediate(function() {
			self.emit('idle');
		});
		this.looping--;
		return;
	} else {
		self.wasBusy = busy;
	}
	if (!self.timeoutId) self.timeoutId = setTimeout(function() {
		self.timeoutId = null;
		self.loop(null, block);
	}, 20);
};

WebKit.prototype.run = function(script, cb) {
	if (typeof script == "function") script = script.toString();
	cb = cb || noop;

	var message = {};
	if (typeof cb == "string") {
		message.event = cb;
	} else {
		message.ticket = (this.ticket++).toString();
		this.tickets[message.ticket] = cb;
	}

	var mode = RUN_SYNC;
	if (/^\s*function(\s+\w+)?\s*\(\s*\w+\s*\)/.test(script)) mode = RUN_ASYNC;
	else if (/^(file|http|https):/.test(script)) mode = RUN_PATH;

	message.mode = mode;

	// this is a hack because it leaks information between worlds
	// the good way of doing this is sending an empty event
	// then the webextension execute some JS to fetch the data that has
	// been stored somewhere as global TODO the day it doesn't work any more/:
	var dispatcher = '\
		var evt = document.createEvent("KeyboardEvent"); \
		evt.initKeyboardEvent("' + this.eventName + '", false, true, null, JSON.stringify(message)); \
		window.dispatchEvent(evt); \
		';
	var initialMessage = JSON.stringify(message);

	var self = this;
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
			self.loop(true);
			self.webview.run(wrap, initialMessage);
		} else if (mode == RUN_ASYNC) {
			var fun = 'function(err, result) {\
				var message = ' + initialMessage + ';\
				if (message.event) { \
					message.args = Array.prototype.slice.call(arguments, 0); \
				} else { \
					if (err) message.error = err; \
					message.result = result; \
				} \
				' + dispatcher + '\
			}';
			var wrap = '(' + script + ')(' + fun + ');';
			if (!message.event) self.loop(true);
			self.webview.run(wrap, initialMessage);
		} else if (mode == RUN_PATH) {
			console.log("TODO");
		}
	});
	return this;
};

function save(rstream, filename, cb) {
	cb = cb || noop;
	var wstream = fs.createWriteStream(filename);
	rstream.pipe(wstream).on('finish', cb).on('error', cb);
	return this;
}

WebKit.prototype.png = function() {
	var self = this;
	function close(err) {
		self.loop(false);
	}
	var passthrough = new stream.PassThrough();
	passthrough.save = save.bind(this, passthrough);
	if (!this.readyState || this.readyState == "opening" || this.readyState == "loading") {
		this.on('load', function() {
			this.png().pipe(passthrough);
		});
	} else {
		this.loop(true, true);
		this.webview.png(function(err, buf) {
			if (err) {
				self.loop(false);
				passthrough.emit('error', err);
			}
			else if (buf == null) {
				self.loop(false);
				passthrough.end();
			} else {
				passthrough.write(buf);
			}
		});
	}
	return passthrough;
};

WebKit.prototype.html = function(cb) {
	if (!this.readyState || this.readyState == "opening" || this.readyState == "loading") {
		this.on('ready', function() {
			this.html(cb);
		});
	} else {
		this.run("document.documentElement.outerHTML;", cb);
	}
	return this;
};

WebKit.prototype.pdf = function(filepath, opts, cb) {
	if (!cb && typeof opts == "function") {
		cb = opts;
		opts = {};
	} else if (!opts) {
		opts = {};
	}
	if (!cb) cb = noop;
	var self = this;
	if (!this.readyState || this.readyState == "opening" || this.readyState == "loading") {
		this.on('load', function() {
			this.pdf(filepath, opts, cb);
		});
	} else {
		this.loop(true, true);
		this.webview.pdf("file://" + path.resolve(filepath), opts, function(err) {
			self.loop(false);
			cb(err);
		});
	}
	return this;
};

function preload(uri, opts, cb) {
	if (!opts.cookies || this.preloading !== undefined) return;
	this.preloading = true;
	this.once('preload', function() {
		var cookies = opts.cookies;
		if (!Array.isArray(cookies)) cookies = [cookies];
		var script = cookies.map(function(cookie) {
			return 'document.cookie = "' + cookie.replace(/"/g, '\\"') + '"';
		}).join(';') + ';';
		var self = this;
		this.run(script, function(err) {
			if (err) return cb(err);
			self.preloading = false;
			self.load(uri, opts, cb);
		});
	});
}

module.exports = WebKit;

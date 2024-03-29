const debug = require('debug')('webkitgtk');
const EventEmitter = require('events').EventEmitter;
const stream = require('stream');
const fs = require('fs');
const path = require('path');
const url = require('url');
const toSource = require('tosource');
const Constants = require('constants');
const clientConsole = require('./client-console');
const clientError = require('./client-error');
const clientTracker = require('./client-tracker');
const clientPromise = fs.readFileSync(path.join(__dirname, '../lib/promise.js'));
const Response = require('./response');

// available after init
let debugStall;
let debugWarn;
let debugError;

// internal state, does not match readyState
const CREATED = 0;
const INITIALIZING = 1;
const INITIALIZED = 2;
const LOADING = 3;

const availableDisplays = {};
let instances = 0;

const hasRunEvent = '(' + function(name, event) {
	try {
		const func = window && window['hasRunEvent_' + name];
		if (func) func(event);
	} catch (ex) {
		// ignore
	}
}.toString() + ')("%name", "%event")';

class WebKit extends EventEmitter {
	static get navigator() {
		return require(path.join(__dirname, '../navigator.json'));
	}

	constructor() {
		super();
		this.priv = initialPriv();
	}

	static load(uri, opts, cb) {
		if (!cb && typeof opts == "function") {
			cb = opts;
			opts = null;
		}
		const inst = new WebKit();
		const pcb = promet(inst, cb);
		inst.init(opts, (err, w) => {
			if (err) return pcb.cb(err, w);
			inst.load(uri, opts, pcb.cb);
		});
		return pcb.ret;
	}

	get uri() {
		if (this.webview) {
			let uri = this.webview.uri;
			if (uri == "about:blank") uri = "";
			return uri;
		}	else {
			return undefined;
		}
	}

	init(opts, cb) {
		if (!cb && typeof opts == "function") {
			cb = opts;
			opts = null;
		}
		if (opts == null) opts = {};
		else if (typeof opts != "object") opts = { display: opts };

		const pcb = promet(this, cb);

		if (opts.verbose) {
			debugStall = console.warn; // eslint-disable-line
			debugWarn = console.warn; // eslint-disable-line
			debugError = console.error; // eslint-disable-line
		} else {
			debugStall = require('debug')('webkitgtk:timeout');
			debugWarn = require('debug')('webkitgtk:warn');
			debugError = require('debug')('webkitgtk:error');
		}

		const priv = this.priv;
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
		if (!process.env.JSC_SIGNAL_FOR_GC) {
			process.env.JSC_SIGNAL_FOR_GC = Constants.SIGUSR2;
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
		}, (err) => {
			priv.state = INITIALIZED;
			pcb.cb(err, this);
		});
		return pcb.ret;
	}

	binding(opts, cfg, cb) {
		display.call(this, opts, (err, child, newDisplay) => {
			if (err) return cb(err);
			debug('display found', newDisplay);
			const priv = this.priv;
			if (child) priv.xvfb = child;
			process.env.DISPLAY = ":" + newDisplay;
			const Bindings = require(path.join(__dirname, '../lib/webkitgtk.node'));
			cfg.webextension = path.join(__dirname, '../lib/ext');
			this.webview = new Bindings(cfg);
			instances++;
			debug('new instance created');
			cb();
		});
	}

	rawload(uri, opts, cb) {
		const priv = this.priv;
		priv.state = LOADING;
		if (opts.content != null && !opts.content || !uri) opts.content = "<html></html>";
		let cookies = opts.cookies;
		const pcb = promet(this, cb);
		let p = Promise.resolve();
		let clearCookies = true;
		if (cookies) {
			debug('load cookies');
			if (!Array.isArray(cookies)) cookies = [cookies];
			const script = cookies.map((cookie) => {
				return 'document.cookie = "' + cookie.replace(/"/g, '\\"') + '"';
			}).concat(['']).join(";\n");
			if (!opts.content) { // blank load to be able to set cookies before real one
				clearCookies = false;
				p = p.then(() => {
					const content = `<html><head>
						<script type="text/javascript">${script}</script>
						</head></html>`;
					return new Promise((resolve, reject) => {
						this.webview.load(uri, priv.stamp, {
							content: content,
							clearCookies: true
						}, (err) => {
							if (err) reject(err);
							else resolve();
						});
					});
				}).catch((err) => {
					pcb.cb(err);
				});
			} else { // no main document loading, just set in user script
				if (!opts.script) opts.script = "";
				opts.script = script + opts.script;
			}
		} else if (!opts.preload) {
			if (!opts.script) opts.script = "";
		}
		p.then(() => {
			const deprecations = {
				ua: "user-agent",
				charset: "default-charset",
				private: "enable-private-browsing",
				images: "auto-load-images",
				localAccess: "allow-file-access-from-file-urls"
			};
			for (const key in deprecations) {
				if (opts[key] == null) continue;
				const newkey = deprecations[key];
				// eslint-disable-next-line
				console.warn(key, "option is deprecated, please use", newkey);
				opts[newkey] = opts[key];
			}
			if (!opts['default-charset']) opts['default-charset'] = "utf-8";
			opts.clearCookies = clearCookies;
			this.webview.load(uri, this.priv.stamp, opts, (err, inst) => {
				priv.state = INITIALIZED;
				pcb.cb(err, inst);
			});
		});
		return pcb.ret;
	}

	load(uri, opts, cb) {
		if (!cb && typeof opts == "function") {
			cb = opts;
			opts = null;
		}
		if (!opts) opts = {};
		const pcb = promet(this, cb);
		load.call(this, uri, opts, pcb.cb);
		return pcb.ret;
	}

	when(ev, fn) {
		const self = this;
		if (!this.promises) initWhen.call(this);
		const holder = this.promises[ev];
		if (!fn) return holder.promise;
		const isThen = fn.length == 0;
		const thenable = isThen ? fn : function() {
			return new Promise((resolve, reject) => {
				fn.call(self, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		};
		holder.promise = holder.promise.then(thenable);
		if (isThen) return holder.promise;
		else return this;
	}

	prepare() {
		this.promises = null;
	}

	preload(uri, opts, cb) {
		if (!cb && typeof opts == "function") {
			cb = opts;
			opts = null;
		}
		if (!opts) opts = {};
		const pcb = promet(this, cb);
		const nopts = {};
		for (const key in opts) nopts[key] = opts[key];
		nopts.allow = "none";
		nopts.preload = true;
		load.call(this, uri, nopts, pcb.cb);
		return pcb.ret;
	}

	stop(cb) {
		debug("stop");
		const priv = this.priv;
		const pcb = promet(this, cb);
		if (priv.state < INITIALIZED) return pcb.cb(errorLoad(priv.state));
		let wasLoading = false;
		const fincb = function(wasLoading) {
			debug("stop done", wasLoading);
			pcb.cb(null, wasLoading);
		}.bind(this);
		if (this.readyState != "stop") {
			this.readyState = "stop";
			wasLoading = this.webview && this.webview.stop && this.webview.stop(fincb);
			debug("was loading", wasLoading);
		} else {
			debug("was already stopped");
		}
		return pcb.ret;
	}

	clearCache() {
		if (this.priv.state < INITIALIZED) throw errorLoad(this.priv.state);
		this.webview && this.webview.clearCache();
	}

	reset(cb) {
		const pcb = promet(this, cb);
		let p = Promise.resolve();
		const priv = this.priv;
		if (priv.state == LOADING) {
			p = p.then(() => {
				return this.stop();
			}).catch((err) => {
				// eslint-disable-next-line
				console.error(err);
			});
		}
		p.then(() => {
			this.removeAllListeners();
			this.promises = null;
			this.readyState = null;
			privReset(priv);
			this.status = null;
			setImmediate(pcb.cb);
		});
		return pcb.ret;
	}

	unload(cb) {
		const priv = this.priv;
		this.readyState = "unloading";
		privReset(priv);
		const pcb = promet(this, cb);

		this.removeAllListeners('ready');
		this.removeAllListeners('load');
		this.removeAllListeners('idle');
		this.removeAllListeners('unload');
		this.removeAllListeners('busy');
		this.promises = null;

		let p = Promise.resolve();

		if (priv.state == LOADING) {
			p = p.then(() => {
				return this.stop();
			}).catch((err) => {
				// eslint-disable-next-line
				console.error(err);
			});
		}
		p.then(() => {
			delete priv.stamp;
			debug('unload');
			return this.rawload('about:blank', {
				content:'<html></html>'
			});
		}).catch((err) => {
			// eslint-disable-next-line
			console.error(err);
		}).then(() => {
			debug('unload done');
			this.readyState = null;
			this.status = null;
			priv.tickets = cleanTickets(priv.tickets);
			this.emit('unload');
			this.removeAllListeners();
			this.promises = null;
			setImmediate(pcb.cb);
		});
		return pcb.ret;
	}

	destroy(cb) {
		const pcb = promet(this, cb);
		destroy.call(this, pcb.cb);
		return pcb.ret;
	}

	run(script, cb) {
		const args = Array.from(arguments).slice(1);
		const argType = args.length > 0 ? typeof args[args.length - 1] : null;
		if (argType == "function") cb = args.pop();
		else cb = null;
		const pcb = promet(this, cb);
		runcb.call(this, script, args, pcb.cb);
		return pcb.ret;
	}

	runev(script, cb) {
		const args = Array.from(arguments).slice(1);
		const argType = args.length > 0 ? typeof args[args.length - 1] : null;
		if (argType == "function") cb = args.pop();
		else cb = null;
		const pcb = promet(this, cb);
		run.call(this, script, null, args, pcb.cb);
		return pcb.ret;
	}

	png(obj, cb) {
		let wstream;
		const pcb = promet(this, cb);
		if (typeof obj == "string") {
			wstream = fs.createWriteStream(obj);
			wstream.on('error', (err) => {
				fs.unlink(obj, () => {
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
	}

	html(cb) {
		debug('output html');
		const pcb = promet(this, cb);
		this.run(() => {
			const dtd = document.doctype;
			let html = "";
			if (dtd) {
				html = "<!DOCTYPE "	+ dtd.name
				+ (dtd.publicId ? ' PUBLIC "' + dtd.publicId + '"' : '')
				+ (!dtd.publicId && dtd.systemId ? ' SYSTEM' : '')
				+ (dtd.systemId ? ' "' + dtd.systemId + '"' : '')
				+ '>\n';
			}
			html += document.documentElement.outerHTML;
			return html;
		}, (err, str) => {
			debug('output html done');
			pcb.cb(err, str);
		});
		return pcb.ret;
	}

	pdf(filepath, opts, cb) {
		if (!cb && typeof opts == "function") {
			cb = opts;
			opts = null;
		}
		if (!opts) opts = {};
		const pcb = promet(this, cb);
		pdf.call(this, filepath, opts, pcb.cb);
		return pcb.ret;
	}
}

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
	const priv = this.priv;
	const emitted = priv.emittedEvents;
	if (emitted[ev] || priv.state == LOADING || ev != 'ready' && this.readyState == null) return cb();
	emitted[ev] = true;
	debug("let tracker process event after", ev);
	if (this.readyState != "unloading") {
		this.webview.runSync(hasRunEvent.replace('%name', priv.cstamp).replace('%event', ev));
	}
	cb();
}

function closedListener(what) {
	const priv = this.priv;
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
	const priv = this.priv;
	const res = new Response(this, binding);
	res.clength = length;
	if (!res.uri) {
		return;
	}
	if (curstamp != priv.stamp) {
		debug("stamp mismatch - ignore data dispatch", curstamp, priv.stamp, res.uri);
		return;
	}
	const info = priv.uris && priv.uris[res.uri];
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
	const priv = this.priv;
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
	const name = val.name;
	if (!name || /Error$/.test(name) == false || !global[name]) return val;
	const err = new (global[name])();
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
	const priv = this.priv;
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
	let obj, parseError;
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
	const args = obj.args || [];
	if (obj.event) {
		const from = args[0];
		const url = args[1];
		const debugArgs = ['event from dom', obj.event];
		if (from) debugArgs.push('from', from);
		if (url) debugArgs.push(url);
		debug.apply(this, debugArgs);
		args.unshift(obj.event);
		if (obj.event == "ready") {
			this.readyState = "interactive";
			this.emit(obj.event);
		} else if (obj.event == "load") {
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
		const cbObj = priv.tickets[obj.ticket];
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
				setImmediate(((ex) => {throw ex;}).bind(null, e));
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

function requestDispatcher(req) {
	const priv = this.priv;
	if (!priv.uris) return;
	let mainUri = this.uri || "about:blank";
	if (mainUri == "about:blank") return;
	const uri = req.uri;
	if (!uri) return;

	debug('request', uri.substring(0, 255));

	let info = priv.uris[uri];

	const from = req.from;
	let rinfo;
	if (from != null) {
		rinfo = priv.uris[from];
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
	if (!rinfo)	info.count++;

	if (!info.ignore && info.remote && this.readyState != "idle" && !rinfo) {
		priv.pendingRequests++;
		debug("counted as pending", priv.pendingRequests, uri, info);
	}
}

function responseDispatcher(curstamp, binding) {
	const priv = this.priv;
	if (!priv.uris) return;
	const mainUri = this.uri || "about:blank";
	if (mainUri == "about:blank") return;
	const res = new Response(this, binding);
	let uri = res.uri;
	if (!uri) return;
	const status = res.status;
	if (uri[0] == '#') {
		// came from webextension, this uri is cancelled
		uri = res._uri = uri.substring(1);
		if (status != 0) {
			// eslint-disable-next-line
			console.error("Cancelled response but non-zero status", uri, status);
		}
	}
	if (!uri) return;

	if (curstamp != priv.stamp) {
		debug("stamp mismatch - ignore response", uri, curstamp, priv.stamp, this.uri);
		return;
	}

	debug('response', uri.substring(0, 255));

	let info = priv.uris[uri];

	if (!info) {
		if (status == 0) {
			debug('ignored response', uri);
			return;
		} else if (uri != mainUri) {
			if (uri.slice(0, 5) != "data:") {
				// ignore data-uri for that warning
				// eslint-disable-next-line
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

	let stalled = false;
	let decrease = 0;
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
		if (priv.pendingRequests < 0) {
			// eslint-disable-next-line
			console.warn("counting more responses than requests with", uri, this.uri);
		}
	}
	if (!stalled && status > 0) this.emit('response', res);
	checkIdle.call(this);
}

function isNetworkProtocol(uri) {
	const p = uri.split(':', 1).pop();
	if (p == 'http' || p == 'https' || p == 'file') {
		return true;
	} else {
		debug("is not network protocol", p);
		return false;
	}
}

function noop(err) {
	// eslint-disable-next-line
	if (err) console.error(err);
}

function display(opts, cb) {
	let display = opts.display != null ? opts.display : process.env.DISPLAY;
	if (typeof display == "string") {
		const match = /^(?:(\d+)x(\d+)x(\d+))?:(\d+)$/.exec(display);
		if (match) {
			if (match[1] != null) opts.width = match[1];
			if (match[2] != null) opts.height = match[2];
			if (match[3] != null) opts.depth = match[3];
			if (match[4] != null) display = match[4];
		}
	}
	display = parseInt(display);
	if (Number.isNaN(display)) display = 0;
	opts.display = display;
	if (availableDisplays[display]) {
		return setImmediate(cb.bind(this, null, null, display));
	}
	fs.exists('/tmp/.X11-unix/X' + display, (exists) => {
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
		}, display - 1, (err, child, display) => {
			if (err) cb(err);
			else {
				debugWarn("Spawned xvfb on DISPLAY=:" + display);
				cb(null, child, display);
				process.on('exit', () => {
					child.kill();
				});
			}
		});
	});
}

function errorLoad(state) {
	let msg;
	if (state == INITIALIZED) return;
	if (state < INITIALIZED) {
		msg = "cannot call method before init";
	} else if (state > INITIALIZED) {
		msg = "cannot call method during loading";
	}
	const error = new Error(msg);
	console.trace(error); // eslint-disable-line
	return error;
}

function initPromise(ev) {
	let prev = null;
	if (ev == "idle") prev = this.promises.load;
	if (ev == "load") prev = this.promises.ready;

	const holder = {
		pending: true
	};
	const initialPromise = holder.promise = new Promise((resolve) => {
		holder.resolve = resolve;
	});
	this.promises[ev] = holder;
	if (prev) holder.promise = prev.promise.then(() => {
		return initialPromise;
	});

	this.once(ev, function() {
		const stamp = this.priv.stamp;
		holder.promise.catch((err) => {
			// not logged - it's up to the client to catch its own errors
			// using .when(ev).catch()
		}).then(() => {
			if (stamp == this.priv.stamp) {
				done.call(this, ev, (err) => {
					// eslint-disable-next-line
					if (err) console.error(err);
				});
			} else {
				// typically when a queued listener calls unload/load right away
			}
		});
		holder.pending = false;
		holder.resolve();
	});
}

function initWhen() {
	if (!this.promises) {
		this.promises = {};
	}
	['ready', 'load', 'idle'].forEach((ev) => {
		const holder = this.promises[ev];
		if (!holder || !holder.pending) {
			initPromise.call(this, ev);
		}
	});
}

function load(uri, opts, cb) {
	opts = Object.assign({}, opts);
	if (uri && !url.parse(uri).protocol) uri = 'http://' + uri;

	const priv = this.priv;
	const stateErr = errorLoad(priv.state);
	if (stateErr) return cb(stateErr, this);

	this.readyState = "loading";

	initWhen.call(this);

	priv.emittedEvents = {};
	priv.allow = opts.allow || "all";
	priv.stall = opts.stall != null ? opts.stall : 1000;
	priv.runTimeout = opts.runTimeout != null ? opts.runTimeout : 10000;
	priv.stamp = uran();
	privReset(priv);
	priv.responseInterval = setInterval(() => {
		const now = Date.now();
		let info;
		for (const uri in priv.uris) {
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
	}, 100); // let dom client cancel stalled xhr first
	priv.responseInterval.unref();
	priv.navigation = opts.navigation || false;
	priv.timeout = setTimeout(() => {
		debugStall("%s ms - %s", opts.timeout || 30000, uri);
		this.stop();
	}, opts.timeout || 30000);
	priv.timeout.unref();

	priv.uris = {};
	priv.pendingRequests = 0;

	if (priv.debug) priv.inspecting = true;

	if (this.listeners('error').length == 0) {
		this.on('error', logError);
	}

	if (opts.console && this.listeners('console').length == 0) {
		this.on('console', function(level) {
			if (this.listeners('console').length <= 1) {
				const args = Array.from(arguments).slice(1).map((arg) => {
					if (arg && arg.stack && arg.name) {
						return arg.name + ': ' + (arg.message ? arg.message + '\n ' : '')
							+ arg.stack.replace(/\n/g, '\n ');
					} else {
						return arg;
					}
				});
				// var err = args.length > 0 && args[0];
				if (level == "trace") level = "error";
				// eslint-disable-next-line
				console[level].apply(null, args);
			}
		});
	}
	let scripts = [];
	if (!priv.jsdom) scripts.push(clientError);
	if (opts.console && !priv.jsdom) scripts.push(clientConsole);

	const filters = opts.filters || [];
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
		// eslint-disable-next-line
		console.warn("scripts option should be an array");
	}

	opts.script = scripts.map((fn) => {
		return prepareRun(fn.fn || fn, null, fn.args || null, priv).script;
	}).join(';\n');

	debug('load', uri);
	priv.uris[uri] = {mtime: Date.now(), main: true};

	this.rawload(uri, opts, (err, status) => {
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
	});
}

function allowFilter(allow) {
	if (allow == null) return;
	if (allow == "none") {
		this.cancel = true;
	} else if (allow == "same-origin") {
		const obj = new URL(this.uri);
		if (obj.protocol != "data:" && obj.host != document.location.host) this.cancel = true;
	} else if (allow instanceof RegExp) {
		if (!allow.test(this.uri)) this.cancel = true;
	}
}

function prepareFilters(cstamp, filters) {
	return {
		fn: function(cstamp, filters, emit) {
			window["request_" + cstamp] = function(uri, from, headers) {
				const msg = {
					uri: uri,
					cancel: false,
					ignore: false,
					headers: headers || {} // none for now
				};
				if (from) msg.from = from;

				filters.forEach((filter) => {
					if (!Array.isArray(filter)) filter = [filter];
					const func = filter[0];
					try {
						func.apply(msg, filter.slice(1));
					} catch(ex) {
						// eslint-disable-next-line
						console.error("An error happened while filtering url with", func, ex);
					}
				});
				if (!msg.cancel) {
					delete msg.cancel;
				} else {
					const trackFunc = window['cancel_' + cstamp];
					if (trackFunc) trackFunc(uri);
				}
				if (!msg.ignore) {
					delete msg.ignore;
				} else {
					const ignFunc = window['ignore_' + cstamp];
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

function privReset(priv) {
	if (priv.responseInterval) {
		clearInterval(priv.responseInterval);
		delete priv.responseInterval;
	}
	if (priv.timeout) {
		clearTimeout(priv.timeout);
		delete priv.timeout;
	}
	delete priv.uris;
	priv.idling = false;
	priv.tickets = cleanTickets(priv.tickets);
}


function cleanTickets(tickets) {
	for (const key in tickets) {
		const obj = tickets[key];
		if (!obj) continue;
		if (obj.timeout) {
			clearTimeout(obj.timeout);
			delete obj.timeout;
		}
	}
	return {};
}

function destroy(cb) {
	privReset(this.priv);
	if (this.webview) {
		this.priv.destroyCb = cb;
		if (this.webview.destroy) {
			this.webview.destroy();
			instances--;
		}	else {
			setImmediate(closedListener.bind(this, 'window'));
		}
	} else if (cb) setImmediate(cb);
	if (this.priv.xvfb && instances == 0) {
		this.priv.xvfb.kill();
	}
}


function runcb(script, args, cb) {
	const ticket = (++this.priv.ticket).toString();
	this.priv.tickets[ticket] = {cb: cb};
	run.call(this, script, ticket, args, cb);
}

function run(script, ticket, args, cb) {
	const priv = this.priv;
	cb = cb || noop;
	if (priv.state == LOADING) {
		return cb(new Error("running a script during loading is not a good idea\n" + script));
	}
	let obj;
	try {
		obj = prepareRun(script, ticket, args, this.priv);
	} catch(e) {
		return cb(e);
	}

	// run on next loop so one can setup event listeners before
	setImmediate(() => {
		if (!this.webview) return cb(new Error("WebKit uninitialized"));
		if (!this.webview.run) {
			return cb(new Error("webview not available yet"));
		}
		if (obj.sync) {
			this.webview.runSync(obj.script, obj.ticket);
		} else {
			this.webview.run(obj.script, obj.ticket);
		}
	});

	if (!obj.ticket) {
		// the script is an event emitter, so we do not expect a reply
		setImmediate(cb);
	} else if (priv.runTimeout && !obj.sync) {
		priv.tickets[obj.ticket].stamp = priv.stamp;
		priv.tickets[obj.ticket].timeout = setTimeout(() => {
			const cbObj = priv.tickets[obj.ticket];
			if (!cbObj) return; // view unloaded before
			const cb = cbObj.cb;
			if (!cb) {
				// this should never happen
				// eslint-disable-next-line
				console.error('FIXME - timeout after the script has already been run');
			}
			delete cbObj.cb;
			if (cbObj.stamp != this.priv.stamp) return;
			cb.call(this, new Error("script timed out\n" + obj.inscript));
		}, priv.runTimeout);
		priv.tickets[obj.ticket].timeout.unref();
	}
}

function prepareRun(script, ticket, args, priv) {
	args = args || [];
	const argc = args.length;
	args = args.map((arg) => {return toSource(arg);});

	let arity = 0;
	let isfunction = false;
	let isUserScript = false;
	if (Buffer.isBuffer(script)) script = script.toString();
	if (typeof script == "function") {
		arity = script.length;
		isfunction = true;
	} else if (typeof script == "string") {
		if (ticket) {
			const match = /^\s*function(\s+\w+)?\s*\(((?:\s*\w+\s*,)*(?:\s*\w+\s*))\)/.exec(script);
			if (match && match.length == 3) {
				isfunction = true;
				arity = match[2].split(',').length;
			}
		} else {
			isUserScript = true;
		}
	}
	let async;
	if (arity == argc) {
		async = false;
	} else if (arity == argc + 1) {
		async = true;
	} else {
		throw new Error(".run(script, ...) where script will miss arguments");
	}

	if (typeof script == "function") script = script.toString();

	if (!async && isfunction && !ticket) {
		args.push(toSource((s) => {}));
		async = true;
	}

	const obj = {
		sync: !async,
		ticket: ticket
	};
	if (isUserScript) {
		obj.script = '(function() {\n' + script + '})();';
	} else if (!async) {
		if (isfunction) script = '(' + script + ')(' + args.join(', ') + ')';
		else script = '(function() { return ' + script + '; })()';
		const wrapSync = function () {
			// eslint-disable-next-line no-undef
			const ticket = TICKET;
			// eslint-disable-next-line no-undef
			const stamp = STAMP;
			const message = {stamp: stamp};
			if (ticket) message.ticket = ticket;
			try {
				// eslint-disable-next-line no-undef
				message.args = [ SCRIPT ];
			} catch(err) {
				message.error = err;
			}
			let msg;
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
		const wrapAsync = function (err) {
			// eslint-disable-next-line no-undef
			const ticket = TICKET;
			// eslint-disable-next-line no-undef
			const stamp = STAMP;
			const message = {stamp: stamp};
			if (!ticket) {
				message.event = err;
			} else {
				message.ticket = ticket;
				if (err) message.error = err;
			}
			message.args = Array.from(arguments).slice(1).map((arg) => {
				if (arg instanceof window.Node) {
					const cont = arg.ownerDocument.createElement('div');
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
			let msg;
			try {
				msg = JSON.stringify(message);
			} catch (ex) {
				delete message.args;
				message.error = ex;
				msg = JSON.stringify(message);
			}
			let ww = window && window.webkit;
			ww = ww && ww.messageHandlers && ww.messageHandlers.events;
			if (ww && ww.postMessage) try {
				ww.postMessage(msg);
			} catch(ex) {
				/* pass */
			}
		}.toString()
			.replace('TICKET', JSON.stringify(ticket))
			.replace('STAMP', JSON.stringify(priv.stamp));
		args.push(wrapAsync);
		obj.script = '(' + script + ')(' + args.join(', ') + ');';
	}
	return obj;
}

function png(wstream, cb) {
	this.webview.png((err, buf) => {
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
	});
}

function pdf(filepath, opts, cb) {
	let margins = opts.margins;
	if (margins == null) margins = 0;
	if (typeof margins == "string" || typeof margins == "number") {
		const num = parseFloat(margins);
		margins = {
			top: num,
			left: num,
			bottom: num,
			right: num,
			unit: margins.toString().slice(num.toString().length)
		};
	}
	opts.margins = margins;

	this.webview.pdf("file://" + path.resolve(filepath), opts, (err) => {
		cb(err);
	});
}

function uran() {
	return (Date.now() * 1e4 + Math.round(Math.random() * 1e4)).toString();
}

function promet(self, cb) {
	const def = {};
	def.promise = new Promise((resolve, reject) => {
		def.resolve = resolve;
		def.reject = reject;
	});
	def.cb = function(err) {
		const args = Array.from(arguments);
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



function WebKitCaller(opts, cb) {
	const inst = new WebKit();
	if (this instanceof WebKitCaller) {
		return inst;
	} else {
		return inst.init(opts, cb);
	}
}
Object.defineProperty(WebKitCaller, "navigator", {
	get: function() {
		return WebKit.navigator;
	}
});
WebKitCaller.load = WebKit.load;
WebKitCaller.promet = WebKit.promet;

module.exports = WebKitCaller;

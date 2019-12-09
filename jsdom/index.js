const debug = require('debug')('webkitgtk');
const {JSDOM, ResourceLoader, VirtualConsole} = require('jsdom');
const vm = require("vm");
const httpCodes = require('http').STATUS_CODES;
const URL = require('url');
const AuthRequest = require('./auth-request');
const clientFetch = require('fs').readFileSync(require.resolve('whatwg-fetch/dist/fetch.umd.js')).toString();

const request = function() { // lazy loading request
	var request;
	try {
		request = require('request');
	} catch(e) {
		console.error("Please `npm install request` to be able to load remote documents");
		process.exit(1);
	}
	return request;
};

module.exports = function(WebKit) {

WebKit.prototype.binding = function(opts, cfg, cb) {
	this.priv.cfg = cfg;
	this.priv.jsdom = true;
	cb();
};

WebKit.prototype.rawload = function(uri, opts, cb) {
	if (this.webview) this.webview.close();
	var pcb = WebKit.promet(this, cb);
	uri = URL.format(URL.parse(uri));
	var jsdomOpts = {
		concurrentNodeIterators: 10000,
		runScripts: "dangerously",
		resources: new CustomResourceLoader({
			// jsdom opts
		}, {
			opts: opts,
			inst: this
		})
	};
	if (!opts.console) jsdomOpts.virtualConsole = new VirtualConsole();
	var priv = this.priv;

	jsdomOpts.url = uri || "about:blank";
	var cookies = opts.cookies;
	if (cookies) {
		if (!Array.isArray(cookies)) cookies = [cookies];
		if (cookies.length) cookies = cookies.join(';');
		else cookies = null;
	}

	jsdomOpts.beforeParse = (window) => {
		this.webview = window;
		window.raise = function(ev, msg, obj) {
			if (obj && obj.error) {
				throw obj.error;
			}
		};
		window.destroy = window.close;
		window.eval(clientFetch);

		window.run = window.eval.bind(window);
		window.uri = uri;
		window.runSync = function(script, ticket) {
			var ret;
			try {
				ret = window.run(script);
			} catch(ex) {
				ret = JSON.stringify({ticket: ticket, error: ex.toString()});
			}
			if (ret !== undefined) window.webkit.messageHandlers.events.postMessage(ret);
		};

		if (cookies) {
			debug('load cookies');
			window.document.cookie = cookies;
			window.document._cookieDomain = window.document.location.hostname;
		}
		if (opts.console) window.console = console;

		window.webkit = {
			messageHandlers: {
				events: {
					postMessage: function(value) {
						priv.cfg.eventsListener(null, value);
					}.bind(this)
				}
			}
		};
		if (opts.script) {
			window.eval(opts.script);
		}
		var runlist = this._webview && this._webview._runlist;
		delete this._webview;
		if (runlist) runlist.forEach(function(arr) {
			try {
				window.eval(arr);
			} catch(e) {
				console.error(e);
			}
		});
	};

	this._webview = this.webview = {
		uri: uri,
		_runlist: [],
		run: function(script, ticket) {
			this._runlist.push(script);
		},
		runSync: function(script, ticket) {
			this._runlist.push(script);
		},
		close: function() {}
	};

	if ((!uri || uri == "about:blank") && opts.content == null) {
		opts.content = '<html><head></head><body></body></html>';
	}

	setImmediate(() => {
		if (opts.content != null) {
			createJSDOM.call(this, opts.content, opts, jsdomOpts);
			pcb.cb(null, 200);
		} else {
			// trick to have a main uri before loading main doc
			this.webview.loading = true;
			var req = resourceLoader.call({inst:this, opts: opts}, uri, {
				cookie: cookies
			}, (err, body) => {
				this.webview.loading = false;
				var status = 200;
				if (err) {
					status = err.code || 0;
					if (typeof status == "string") status = 0;
				}
				if (status < 200 || status >= 400) err = status;
				if (err || status != 200) return pcb.cb(err, status);
				createJSDOM.call(this, body, opts, jsdomOpts);
				pcb.cb(null, 200);
			});
			this.webview.stop = (cb) => {
				if (this.webview.loading) {
					this.webview.loading = false;
					req.abort();
					setImmediate(() => {
						cb(true);
					});
					pcb.cb(new Error("Aborted"), 0);
				} else {
					setImmediate(() => {
						cb(false);
					});
					return false;
				}
				// return nothing and WebKit.stop will callback on our behalf
			};
		}
	});
	return pcb.ret;
};

};

function createJSDOM(content, opts, jsdomOpts) {
	var inst = new JSDOM(content, jsdomOpts);
	this.status = 200;
	return inst;
}

function HTTPError(code) {
	Error.call(this, httpCodes[code]);
	this.code = code;
	return this;
}

HTTPError.prototype = Object.create(Error.prototype);
HTTPError.prototype.constructor = HTTPError;

class CustomResourceLoader extends ResourceLoader {
	constructor(jsdomOpts, opts) {
		super(jsdomOpts);
		Object.assign(this, opts);
		return this;
	}
	fetch(url, opts) {
		return new Promise((resolve, reject) => {
			resourceLoader.call(this, url, opts, function(err, body) {
				if (err) return reject(err);
				return resolve(typeof body == "string" ? Buffer.from(body) : body);
			});
		});
	}
}

function resourceLoader(uri, opts, cb) {
	// Checking if the ressource should be loaded
	debug("resource loader", uri);
	if (this.opts.preload) {
		cb(null, null);
		return;
	}
	var priv = this.inst.priv;
	var stamp = priv.stamp;
	var funcFilterStr = 'window.request_' + priv.cstamp;
	var result = true;
	if (this.inst.webview.run('!!(' + funcFilterStr + ')')) {
		result = this.inst.webview.run(funcFilterStr + '("' + uri + '", null)');
	}
	if (result === false) {
		var err = new Error("Ressource canceled");
		err.statusCode = 0;
		cb(err);
		priv.cfg.responseListener(stamp, {uri: uri, length: 0, headers: {}, status: 0});
		return;
	} else if (typeof result == "string") {
		uri = result;
	}
	// actual get
	var req = request()(uri, opts, (err, res, body) => {
		var status = res && res.statusCode || 0;
		if (!err && status != 200) {
			err = new HTTPError(status);
			if (status == 401) {
				// what ?
			}
		}
		var headers = res && res.headers || {};
		var uheaders = {};
		for (var name in headers) {
			uheaders[name.split('-').map(function(str) { return str[0].toUpperCase() + str.substring(1); }).join('-')] = headers[name];
		}
		priv.cfg.responseListener(stamp, {
			uri: uri,
			headers: uheaders,
			length: body ? body.length : 0,
			mime: headers['content-type'],
			status: status,
			data: function(cb) {
				cb(null, body);
			}
		});
		if (err === 200) err = null;
		cb(err, body);
	})
	.on('data', (chunk) => {
		var headers = req.response.headers;
		var res =  {
			uri: uri,
			length: headers['content-length'] || 0,
			mime: (headers['content-type'] || '').split(';').shift(),
			status: req.response.statusCode
		};
		priv.cfg.receiveDataListener(stamp, res, chunk ? chunk.length : 0);
	});
	/* FIXME this has surely changed
	var authResponse = req._auth.onResponse;
	var self = this;
	req._auth.onResponse = function(response) {
		if (this.sentAuth) return null;
		self.emit('authenticate', new AuthRequest(req, response));
		if (!this.hasAuth) return null;
		return authResponse.call(this, response);
	}.bind(req._auth);
	*/
	return req;
}


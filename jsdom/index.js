var debug = require('debug')('webkitgtk');
var jsdom = require('jsdom').jsdom;
var idlUtils = require("jsdom/lib/jsdom/living/generated/utils");
var DocumentFeatures = require('jsdom/lib/jsdom/browser/documentfeatures');
var vm = require("vm");
var httpCodes = require('http').STATUS_CODES;
var URL = require('url');
var AuthRequest = require('./auth-request');

var request = function() { // lazy loading request
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
	this.priv.jsdom = {
		MutationEvents : '2.0',
		QuerySelector : true
	};
	this.priv.cfg = cfg;
	cb();
};

WebKit.prototype.rawload = function(uri, opts, cb) {
	var pcb = WebKit.promet(this, cb);
	var p = Promise.resolve();
	uri = URL.format(URL.parse(uri));
	var jsdomOpts = {
		resourceLoader: resourceLoader.bind(this),
		features: {}
	};
	var priv = this.priv;

	for (var jk in priv.jsdom) jsdomOpts.features[jk] = priv.jsdom[jk];
	if (opts.preload) {
		jsdomOpts.features.FetchExternalResources = [];
		jsdomOpts.features.ProcessExternalResources = [];
	} else {
		jsdomOpts.features.FetchExternalResources = ['script'];
		jsdomOpts.features.ProcessExternalResources = ['script'];
	}

	jsdomOpts.url = uri || "about:blank";
	var cookies = opts.cookies;
	if (cookies) {
		if (!Array.isArray(cookies)) cookies = [cookies];
		if (cookies.length) cookies = cookies.join(';');
		else cookies = null;
	}

	jsdomOpts.created = function(err, window) {
		this.webview = window;
		window.raise = function(ev, msg, obj) {
			if (obj && obj.error) {
				throw obj.error;
			}
		};
		if (err) return pcb.cb(err);

		var windowImpl;
		if (opts.preload) {
			jsdomOpts.features.ProcessExternalResources = ['script'];
			var docImpl = idlUtils.implForWrapper(window.document);
			DocumentFeatures.applyDocumentFeatures(docImpl, jsdomOpts.features);
			windowImpl = docImpl._global;
			delete docImpl._global;
			jsdomOpts.features.ProcessExternalResources = [];
			DocumentFeatures.applyDocumentFeatures(docImpl, jsdomOpts.features);
		}

		if (!window.run) {
			window.run = window.eval ? window.eval.bind(window) : function(code) {
				return vm.runInContext(code, windowImpl);
			};
		}

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
		require('./xhr').call(this, window);

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
			window.run(opts.script);
		}
		var runlist = this._webview && this._webview._runlist;
		delete this._webview;
		this.webview = window;
		if (runlist) runlist.forEach(function(arr) {
			try {
				window.run(script);
			} catch(e) {
			}
		});

		this.status = 200;
		pcb.cb(null, 200);
	}.bind(this);

	this._webview = this.webview = {
		uri: uri,
		_runlist: [],
		run: function(script, ticket) {
			this._runlist.push(script);
		},
		runSync: function(script, ticket) {
			this._runlist.push(script);
		}
	};

	if ((!uri || uri == "about:blank") && opts.content == null) {
		opts.content = '<html><head></head><body></body></html>';
	}

	setImmediate(function() {
		if (opts.content != null) {
			var doc = jsdom(opts.content, jsdomOpts);
			this.webview = doc.defaultView;
		} else {
			// trick to have a main uri before loading main doc
			this.webview.loading = true;
			var loader = resourceLoader.call(this, {
				url: { href: uri },
				cookie: cookies
			}, function(err, body) {
				this.webview.loading = false;
				var status = 200;
				if (err) {
					status = err.code || 0;
					if (typeof status == "string") status = 0;
				}
				if (err || status != 200) return pcb.cb(err, status);
				var doc = jsdom(body, jsdomOpts);
				this.webview = doc.parentWindow || doc.defaultView;
			}.bind(this));
			this.webview.stop = function stop(cb) {
				if (this.webview.loading) {
					this.webview.loading = false;
					if (loader.req) loader.req.abort();
					setImmediate(cb);
					return true;
				} else {
					return false;
				}
				// return nothing and WebKit.stop will callback on our behalf
			}.bind(this);
		}
	}.bind(this));
	return pcb.ret;
};

};

function runShim(context, script) {
	var vmscript = new (require('vm').Script)(script);
	return vmscript.runInContext(context);
}

function HTTPError(code) {
	Error.call(this, httpCodes[code]);
	this.code = code;
	return this;
};
HTTPError.prototype = Object.create(Error.prototype);
HTTPError.prototype.constructor = HTTPError;

function resourceLoader(resource, cb) {
	// Checking if the ressource should be loaded
	var uri = resource.url && resource.url.href;
	debug("resource loader", uri);
	var priv = this.priv;
	var stamp = priv.stamp;
	var reqHeaders = {Accept: "*/*"};
	var funcFilterStr = 'window.request_' + priv.cstamp;
	var result = true;
	if (this.webview.run('!!(' + funcFilterStr + ')')) {
		result = this.webview.run(funcFilterStr + '("' + uri + '", null)');
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
	var reqOpts = {
		url: uri,
		headers: reqHeaders,
		jar: request().jar()
	};
	if (resource.cookie) {
		reqOpts.jar.setCookie(request().cookie(resource.cookie), uri);
	}
	var req = request()(reqOpts, function(err, res, body) {
		var status = res && res.statusCode || 0;
		if (!err && status != 200) {
			err = new HTTPError(status);
			if (status == 401) {

			}
		}
		var headers = res && res.headers || {};
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
		cb(err, body);
	}.bind(this))
	.on('data', function(chunk) {
		var headers = req.response.headers;
		var res =  {
			uri: uri,
			length: headers['content-length'] || 0,
			mime: (headers['content-type'] || '').split(';').shift(),
			status: req.response.statusCode
		};
		priv.cfg.receiveDataListener(stamp, res, chunk ? chunk.length : 0);
	}.bind(this));
	var authResponse = req._auth.onResponse;
	var self = this;
	req._auth.onResponse = function(response) {
		if (this.sentAuth) return null;
		self.emit('authenticate', new AuthRequest(req, response));
		if (!this.hasAuth) return null;
		return authResponse.call(this, response);
	}.bind(req._auth);
	return req;
}


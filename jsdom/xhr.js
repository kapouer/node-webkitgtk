var jsdom = require('jsdom').jsdom;

module.exports = function handleXhr(window) {
	var webview = this;
	var priv = this.priv;
	var stamp = priv.stamp;
	var cstamp = priv.cstamp;
	var wxhr = window.XMLHttpRequest;
	window.XMLHttpRequest = function() {
		var xhr = new wxhr();
		var xhrSend = xhr.send;
		var xhrOpen = xhr.open;
		var xhrDispatch = xhr.dispatchEvent;
		var xhrSetRequestHeader = xhr.setRequestHeader;
		var privUrl;
		var reqHeaders = {
			Accept: "*/*"
		};
		function listenXhr(e) {
			if (this.readyState != this.DONE) return;
			// crash - probably a node-xmlhttprequest bug
			// this.removeEventListener("readystatechange", listenXhr, false);
			var headers = {};
			var contentType;
			this.getAllResponseHeaders().split('\r\n').map(function(line) {
				return line.split(':').shift();
			}).forEach(function(name) {
				var val = this.getResponseHeader(name);
				if (name.toLowerCase() == "content-type") contentType = val;
				if (val != null) headers[name] = val;
			}.bind(this));
			if (this.responseType == 'document' && contentType.indexOf('text/html') >= 0) {
				this.responseXML = jsdom(this.responseText, webview.priv.jsdom);
			}
			priv.cfg.responseListener(stamp, {
				uri: privUrl,
				status: this.status,
				headers: headers,
				mime: contentType
			});
		}
		xhr.open = function(method, url) {
			try {
				privUrl = (new window.URL(url, window.document.URL)).href;
			} catch(e) {
				console.error(e);
			}
			return xhrOpen.apply(this, Array.prototype.slice.call(arguments, 0));
		}.bind(xhr);
		xhr.setRequestHeader = function(name, val) {
			var ret = xhrSetRequestHeader.call(xhr, name, val);
			reqHeaders[name] = val;
			return ret;
		}.bind(xhr);
		xhr.send = function(data) {
			// while xhr is typically not reused, it can happen, so support it
			var ret, err;
			try {
				ret = xhrSend.call(this, data);
			} catch(e) {
				err = e;
			}
			var funcFilter = window['request_' + cstamp];
			var result = true;
			if (funcFilter) {
				// TODO second argument in case of redirection
				result = funcFilter(privUrl, null, reqHeaders);
			}
			if (result === false) {
				this.abort();
			} else if (typeof result == "string") {
				throw new Error("Unimplemented xhr request url rewriting");
			}

			if (this.readyState == 4 || err) {
				// free it now
				listenXhr.call(this, err);
			} // else the call was asynchronous and no error was thrown
			if (err) throw err; // rethrow
			return ret;
		}.bind(xhr);
		xhr.dispatchEvent = function() {
			listenXhr.call(this);
			xhrDispatch.apply(this, Array.prototype.slice.call(arguments));
		}.bind(xhr);
		return xhr;
	};
};

var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("request listener", function suite() {
	it("should cancel the request when uri set to null or empty string", function(done) {
		this.timeout(15000);
		var cancelledRequests = 0;
		WebKit(function(err, w) {
			w.load("http://www.selmer.fr").on("request", function(request) {
				if (/\.js$/.test(request.uri)) {
					cancelledRequests++;
					request.uri = null;
				}
			}).on("response", function(response) {
				expect(/\.js$/.test(response.uri)).to.not.be(true);
			}).once("load", function() {
				expect(cancelledRequests).to.be.greaterThan(3);
				done();
			}).on("error", function() {
				// just ignore errors here
			});
		});
	});

	it("should ignore stalled requests", function(done) {
		this.timeout(6000);
		var doc = '<html><head>\
		<script type="text/javascript">var xhr = new XMLHttpRequest();\
			xhr.open("GET", "/test", true);\
			xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");\
			xhr.send();</script></head>\
	<body>move along</body></html>'
		var server = require('http').createServer(function(req, res) {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test") {
				res.statusCode = 200;
				setTimeout(function() {
					res.end('{"hello": "tata"}');
				}, 2000);
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(function() {
			WebKit(function(err, w) {
				w.load("http://localhost:" + server.address().port, {console:true, stall: 1000})
				.once('idle', function() {
					this.html(function(err, str) {
						expect(str).to.be(doc);
						setTimeout(function() {
							server.close();
							done();
						}, 100);
					});
				});
			});
		});
	});

	it("should allow to force ignore requests", function(done) {
		this.timeout(1000);
		var doc = '<html><head>\
		<script type="text/javascript">var xhr = new XMLHttpRequest();\
			xhr.open("GET", "/test", true);\
			xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");\
			xhr.send();</script></head>\
		<body>move along</body></html>'
		var server = require('http').createServer(function(req, res) {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test") {
				res.statusCode = 200;
				setTimeout(function() {
					res.end('{"hello": "tata"}');
				}, 3000);
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(function() {
			WebKit(function(err, w) {
				w.load("http://localhost:" + server.address().port, {console:true, stall: 2000})
				.on('request', function(req) {
					if (req.uri.indexOf('test') > 0) {
						req.ignore = true;
					}
				})
				.once('idle', function() {
					this.html(function(err, str) {
						expect(str).to.be(doc);
						setTimeout(function() {
							server.close();
							done();
						}, 100);
					});
				});
			});
		});
	});

	it("should cancel xhr requests immediately", function(done) {
		// this typically is not the case if ret = TRUE in src/webextension.cc
		// and works if uri is set to ""
		this.timeout(1000);
		var doc = '<html><head>\
		<script type="text/javascript">var xhr = new XMLHttpRequest();\
			xhr.open("GET", "/test", true);\
			xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");\
			xhr.send();</script></head>\
		<body>move along</body></html>';
		var server = require('http').createServer(function(req, res) {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test") {
				res.statusCode = 200;
				setTimeout(function() {
					res.end('{"hello": "tata"}');
				}, 3000);
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(function() {
			WebKit(function(err, w) {
				w.load("http://localhost:" + server.address().port, {console:true, stall: 2000})
				.on('request', function(req) {
					if (req.uri.indexOf('test') > 0) {
						req.cancel = true;
					}
				})
				.once('idle', function() {
					this.html(function(err, str) {
						expect(str).to.be(doc);
						setTimeout(function() {
							server.close();
							done();
						}, 100);
					});
				});
			});
		});
	});
});

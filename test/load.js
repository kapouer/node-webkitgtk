var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("load method", function suite() {
	it("should accept no arguments", function(done) {
		WebKit.load("", null, function(err, w) {
			done();
		});
	});

	it("should load html content", function(done) {
		WebKit.load("http://localhost", {content: '<p>test</p>'}).on('ready', function() {
			this.html(function(err, str) {
				expect(err).to.not.be.ok();
				expect(str).to.be("<html><head></head><body><p>test</p></body></html>");
				done();
			});
		});
	});

	it("should load html content and filter some requests", function(done) {
		this.timeout(1000);
		var haspng = false;
		var hasjs = false;

		WebKit.load("http://localhost", {
			content: '<script src="http://localhost/test.js"></script><img src="http://localhost/test.png" />'
		}, function(err) {
			expect(err).to.be(null);
		})
		.on('request', function(req) {
			req.cancel = /\.png$/.test(req.uri) || req.headers.Accept == "*/*";
		})
		.on('response', function(res) {
			if (/\.png$/.test(res.uri)) {
				haspng = true;
			}
			if (/\.js$/.test(res.uri)) {
				hasjs = true;
			}
		})
		.once('idle', function() {
			expect(haspng).to.not.be.ok();
			expect(hasjs).to.not.be.ok();
			done();
		});
	});

	it("should callback with error when url cannot be resolved", function(done) {
		this.timeout(10000);
		WebKit.load("http://atipepipapa-sdqdqsd.com", function(err) {
			expect(err).to.be.ok();
			done();
		});
	});

	it("should 404", function(done) {
		WebKit.load("http://google.com/sdfsdfsdf", function(err) {
			expect(err).to.be(404);
			done();
		});
	});

	it("should allow to load another uri just after", function(done) {
		this.timeout(5000);
		WebKit.load('http://google.com', function(err, w) {
			w.load('http://geoip.edagames.com', function() {
				w.once('response', function(res) {
					res.data(function(err, data) {
						expect(JSON.parse(data.toString()).country).to.be.ok();
						done();
					});
				});
			});
		});
	});

	it("should filter requests by regexp and let the main request go", function(done) {
		this.timeout(5000);
		var onlyjs = /\.js/;
		var hadmain = false;
		WebKit.load('http://github.com', {allow: onlyjs})
		.on('response', function(res) {
			if (res.uri == this.uri) hadmain = true;
		})
		.once('idle', function(err) {
			expect(err).to.not.be.ok();
			expect(hadmain).to.be(true);
			done();
		});
	});

	it("should time out", function(done) {
		this.timeout(500);
		WebKit.load('http://google.com', {timeout:50}, function(err, w) {
			expect(err).to.be.ok();
			expect(w.status).to.be(0);
			done();
		});
	});

	it("should time out then unload", function(done) {
		this.timeout(5000);
		WebKit.load('http://google.com', {timeout:50}, function(err, w) {
			expect(err).to.be.ok();
			expect(w.status).to.be(0);
			w.unload(function(err) {
				expect(err).to.not.be.ok();
				done();
			});
		});
	});

	it("should not stop after a stop call", function(done) {
		this.timeout(10000);
		var w = WebKit.load('http://google.com');
		setImmediate(function() {
			w.stop(function(err, wasLoading) {
				expect(w.readyState).to.be('stop');
				expect(err).to.not.be.ok();
				expect(wasLoading).to.be(true);
				done();
			});
		});
		// meaning of this ?
		/*
		w.once('idle', function() {
			setTimeout(function() {
				w.stop(function(err, wasLoading) {
					expect(err).to.not.be.ok();
					expect(wasLoading).to.be(false);
					done();
				});
			}, 1000);
		});
		*/
	});

	it("should fail gracefully", function(done) {
		var server = require('http').createServer(function(req, res) {
			res.statusCode = 501;
			res.end("fail");
		}).listen(function() {
			WebKit.load("http://localhost:" + server.address().port, function(err, w) {
				expect(err).to.be(501);
				setImmediate(function() {
					server.close();
					done();
				});
			});
		});
	});

	it("should fail gracefully even with a timeout", function(done) {
		var server = require('http').createServer(function(req, res) {
			setTimeout(function() {
				res.statusCode = 501;
				res.end("fail");
			}, 1000);
		}).listen(function() {
			WebKit.load("http://localhost:" + server.address().port, {timeout: 500}, function(err, w) {
				expect(err).not.to.be(501);
				w.stop(function(err, wasLoading) {
					expect(err).to.not.be.ok();
					expect(wasLoading).to.be(false);
				});
				setTimeout(function() {
					server.close();
					done();
				}, 1000);
			});
		});
	});

	it("should set request headers", function(done) {
		var server = require('http').createServer(function(req, res) {
			expect(req.headers.custom).to.be("tada");
			expect(req.headers.accept).to.be("text/tomo");
			expect(req.headers.cookie).to.be(undefined);
			res.statusCode = 200;
			res.end("<html><body>test</body></html>");
		}).listen(function() {
			WebKit.load("http://localhost:" + server.address().port)
			.on('request', function(req) {
				req.headers.custom = "tada";
				req.headers.Accept = "text/tomo";
				req.headers.Cookie = 'abc="xyzzy!"; Expires=Tue, 18 Oct 2511 07:05:03 GMT; Path=/;';
			})
			.once('ready', function(err) {
				setTimeout(function() {
					server.close();
					done();
				}, 100);
			});
		});
	});

	it("should receive console events", function(done) {
		WebKit.load('http://localhost', {
			content: '<html><body><script type="text/javascript">console.log(window.navigator, "two");</script></body></html>',
			console: true
		}).on('console', function(level, nav, two) {
			expect(level).to.be('log');
			expect(nav.appName).to.be('Netscape');
			expect(two).to.be('two');
			done();
		});
	});

	it("should fail to load immediately", function(done) {
		// for super weird reasons this test fails because of the particular
		// way the url is crafted (length of each component is critical).
		// it won't fail after 8745c188, though
		WebKit.load('http://localhost:16724/aaaaa/bbbbb?cccc=c', function(err) {
			expect(err).to.be.ok();
			done();
		});
	});

	it("should be able to load twice in a row", function(done) {
		this.timeout(10000);
		WebKit.load('http://google.com', function(err, w) {
			w.load('http://google.com', function(err) {
				expect(err).to.not.be.ok();
				done();
			});
		});
	});

	it("should be able to fail then load", function(done) {
		this.timeout(10000);
		WebKit.load('http://google.com/azertyuiop404', function(err, w) {
			expect(err).to.be(404);
			w.load('http://google.com', function(err) {
				expect(err).to.not.be.ok();
				done();
			});
		});
	});

	it("should be able to load a url with a default protocol", function(done) {
		this.timeout(4000);
		WebKit.load('www.debian.org', function(err) {
			expect(err).to.not.be.ok();
			done();
		});
	});
});

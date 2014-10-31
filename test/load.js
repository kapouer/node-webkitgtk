var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("load method", function suite() {
	it("should initialize display if it was not on instantiation", function(done) {
		this.timeout(10000);
		var called = false;
		WebKit(0, function(err) {
			expect(err).to.not.be.ok();
			called = true;
		}).load('http://google.com', function(err) {
			expect(this.status).to.be(200);
			expect(err).to.not.be.ok();
			expect(called).to.be.ok();
			done();
		});
	});
	it("should load html content", function(done) {
		this.timeout(1000);
		WebKit().load("http://localhost", {content: '<p>test</p>'}, function(err) {
			expect(err).to.be(null);
		}).wait('ready').html(function(err, html) {
			expect(err).to.not.be.ok();
			expect(html).to.be("<html><head></head><body><p>test</p></body></html>");
		}).wait('idle', done);
	});
	it("should load html content and filter some requests", function(done) {
		this.timeout(1000);
		var haspng = false;
		var hasjs = false;
		WebKit().load("http://localhost", {
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
		}).wait('idle', function() {
			expect(haspng).to.not.be.ok();
			expect(hasjs).to.not.be.ok();
			done();
		});
	});
	it("should callback with error when url cannot be resolved", function(done) {
		this.timeout(10000);
		WebKit().load("http://atipepipapa-sdqdqsd.com", function(err) {
			expect(err).to.be.ok();
			done();
		});
	});
	it("should 404", function(done) {
		this.timeout(1000);
		WebKit().load("http://google.com/sdfsdfsdf", function(err) {
			expect(err).to.be(404);
			done();
		});
	});
	it("should allow to load another uri just after", function(done) {
		this.timeout(5000);
		WebKit().load('http://google.com').load('http://geoip.edagames.com', function() {
			this.once('response', function(res) {
				res.data(function(err, data) {
					expect(JSON.parse(data.toString()).country).to.be.ok();
					done();
				});
			});
		});
	});
	it("should filter requests by regexp and let the main request go", function(done) {
		this.timeout(5000);
		var onlyjs = /\.js/;
		var hadmain = false;
		WebKit().on('response', function(res) {
			if (res.uri == this.uri) hadmain = true;
		}).load('http://github.com', {allow: onlyjs}).wait('idle', function(err) {
			expect(err).to.not.be.ok();
			expect(hadmain).to.be(true);
			done();
		});
	});
	it("should time out", function(done) {
		this.timeout(500);
		WebKit().load('http://google.com', {timeout:50}, function(err) {
			expect(err).to.be.ok();
			expect(this.status).to.be(0);
			done();
		});
	});
	it("should time out then unload", function(done) {
		this.timeout(5000);
		WebKit().load('http://google.com', {timeout:50}, function(err) {
			expect(err).to.be.ok();
			expect(this.status).to.be(0);
			this.unload(function(err) {
				expect(err).to.not.be.ok();
				done();
			});
		});
	});
	it("should not stop after a stop call", function(done) {
		this.timeout(21000);
		WebKit().load('http://google.com', function(err) {
			expect(err).to.not.be.ok();
			this.stop(function(err, wasLoading) {
				expect(err).to.not.be.ok();
				expect(wasLoading).to.be(true);
			});
		}).wait('load', function(err) {
			this.stop(function(err, wasLoading) {
				expect(wasLoading).to.be(false);
				done();
			});
		});
	});
	it("should fail gracefully", function(done) {
		var server = require('http').createServer(function(req, res) {
			res.statusCode = 501;
			res.end("fail");
		}).listen(8011);
			WebKit().load("http://localhost:8011", function(err, view) {
			expect(err).to.be(501);
			setImmediate(function() {
				server.close();
				done();
			});
		});
	});
	it("should fail gracefully even with a timeout", function(done) {
		var server = require('http').createServer(function(req, res) {
			setTimeout(function() {
				res.statusCode = 501;
				res.end("fail");
			}, 1000);
		}).listen(8012);
			WebKit().load("http://localhost:8012", {timeout: 500}, function(err, view) {
			expect(err).not.to.be(501);
			this.stop(function(err, wasLoading) {
				expect(err).to.not.be.ok();
				expect(wasLoading).to.be(false);
			});
			setTimeout(function() {
				server.close();
				done();
			}, 1000);
		});
	});
	it("should set request headers", function(done) {
		var server = require('http').createServer(function(req, res) {
			expect(req.headers.custom).to.be("tada");
			expect(req.headers.accept).to.be("text/tomo");
			expect(req.headers.cookie).to.be(undefined)
			res.statusCode = 200;
			res.end("<html><body>test</body></html>");
		}).listen(8018);
		WebKit().load("http://localhost:8018").on('request', function(req) {
			req.headers.custom = "tada";
			req.headers.Accept = "text/tomo";
			req.headers.Cookie = 'abc="xyzzy!"; Expires=Tue, 18 Oct 2511 07:05:03 GMT; Path=/;';
		}).wait('ready', function(err) {
			setTimeout(function() {
				server.close();
				done();
			}, 100);
		});
	});
});

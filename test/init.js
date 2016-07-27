var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

// this test doesn't really work

describe("init method", function suite() {
	it("should initialize cacheDir with call to init", function(done) {
		this.timeout(10000);
		var called = false;
		WebKit({cacheDir: "cache/test"}, function(err, w) {
			expect(err).to.not.be.ok();
			called = true;
			w.load('http://google.com', function(err) {
				fs.exists("./cache/test", function(yes) {
					expect(yes).to.be.ok();
					done();
				});
			});
		});
	});
	it("should clear cache", function(done) {
		var called = false;
		var port;
		var count = 0;
		var server = require('http').createServer(function(req, res) {
			if (req.url != '/') {
				res.statusCode = 404;
				res.end("Not Found");
			} else {
				res.statusCode = 200;
				res.setHeader('Cache-Control', 'public, max-age=100');
				count++;
				res.end("stored text");
			}
		}).listen(function() {
			port = server.address().port;
			var w;
			WebKit({cacheDir: "cache/test2"}).then(function(inst) {
				w = inst;
				return w.load("http://localhost:" + port);
			}).then(function() {
				return w.load("http://localhost:" + port);
			}).then(function() {
				expect(count).to.be(1);
				w.clearCache();
				return w.load("http://localhost:" + port);
			}).then(function() {
				expect(count).to.be(2);
				done();
			}).catch(function(err) {
				setImmediate(function() {
					throw err;
				});
			});
		});
	});
	it("should clear cache for next instance", function(done) {
		var called = false;
		this.timeout(6000);
		var port;
		var count = 0;
		var bigBuf = Buffer(2000000).fill("h");
		var server = require('http').createServer(function(req, res) {
			if (req.url != '/') {
				res.statusCode = 404;
				res.end("Not Found");
			} else {
				res.statusCode = 200;
				res.setHeader('Cache-Control', 'public, max-age=1000');
				count++;
				res.end(bigBuf);
			}
		}).listen(function() {
			port = server.address().port;
			var w;
			WebKit({cacheDir: "cache/test4"}).then(function(inst) {
				w = inst;
				return w.load("http://localhost:" + port);
			}).then(function() {
				return w.unload().then(function() {
					// clear cache after unloading or else resources are not freed
					w.clearCache();
					return w.destroy();
				});
			}).then(function() {
				w = null;
				return WebKit({cacheDir: "cache/test4"}).then(function(inst) {
					w = inst;
					return w.load("http://localhost:" + port);
				});
			}).then(function() {
				expect(count).to.be(2);
				done();
			}).catch(function(err) {
				setImmediate(function() {
					throw err;
				});
			});
		});
	});
});


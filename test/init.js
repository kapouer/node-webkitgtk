var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
var Path = require('path');
var glob = require('glob');
var rimraf = require('rimraf');

// this test doesn't really work

describe("init method", function suite() {
	before(function(done) {
		rimraf(Path.join(__dirname, '..', 'cache/test?'), done);
	});
	it("should initialize cacheDir with call to init", function(done) {
		this.timeout(10000);
		var called = false;
		WebKit({cacheDir: "cache/test1"}, function(err, w) {
			expect(err).to.not.be.ok();
			called = true;
			w.load('http://google.com', function(err) {
				fs.exists("./cache/test1", function(yes) {
					expect(yes).to.be.ok();
					done();
				});
			});
		});
	});
	it("should clear cache", function(done) {
		this.timeout(15000);
		var called = false;
		var port;
		var count = 0;
		var server = require('http').createServer(function(req, res) {
			if (req.url == '/index.html') {
				res.statusCode = 200;
				res.setHeader('Content-Type', 'text/html');
				res.setHeader('Cache-Control', 'public, max-age=100000');
				res.setHeader('Last-Modified', (new Date()).toUTCString());
				res.setHeader('Expires', (new Date(Date.now() + 100000000)).toUTCString());
				res.end("<!doctype html><html><head><script src='test.js'></script></head></html>");
			} else if (req.url == "/test.js") {
				res.setHeader('Content-Type', 'text/javascript');
				res.setHeader('Cache-Control', 'public, max-age=100000');
				res.setHeader('Last-Modified', (new Date()).toUTCString());
				res.setHeader('Expires', (new Date(Date.now() + 100000000)).toUTCString());
				res.end('console.log("me");');
				count++;
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(function() {
			var url = `http://localhost:${server.address().port}/index.html`;
			var w;
			WebKit({cacheDir: "cache/test2"}).then(function(inst) {
				w = inst;
				return w.load(url).when('idle');
			}).then(function() {
				return w.load(url).when('idle');
			}).then(function() {
				expect(count).to.be(1);
				w.clearCache();
				return new Promise(function(resolve) {
					setTimeout(resolve, 100);
				});
			}).then(function() {
				return w.load(url).when('idle');
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


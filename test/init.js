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
});


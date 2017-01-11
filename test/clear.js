var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
var Path = require('path');
var glob = require('glob');
var rimraf = require('rimraf');

// this test doesn't really work

describe("clear cache method", function suite() {
	before(function(done) {
		rimraf(Path.join(__dirname, '..', 'cache/test?'), done);
	});
	it("should clear cache for next instance", function(done) {
		var called = false;
		this.timeout(15000);
		var port;
		var count = 0;
		var bufSize = 1600000;
		var bigBuf = Buffer(bufSize).fill("h");
		var server = require('http').createServer(function(req, res) {
			if (req.url != '/') {
				res.statusCode = 404;
				res.end("Not Found");
			} else {
				res.statusCode = 200;
				res.setHeader('Cache-Control', 'public, max-age=1000');
				res.setHeader('Content-Type', 'text/plain');
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
					return new Promise(function(resolve, reject) {
						glob("cache/test4/**/*", {nodir: true}, function(err, list) {
							if (err) return reject(err);
							if (!list.length) return reject(new Error("no blob in cache"));
							fs.stat(list[0], function(err, stat) {
								if (err) return reject(err);
								expect(stat.size).to.be(bufSize);
								resolve();
							});
						});
					}).then(function() {
						// clear cache after unloading or else resources are not freed
						w.clearCache();
						return w.destroy();
					})
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


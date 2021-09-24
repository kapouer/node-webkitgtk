const WebKit = require('../');
const expect = require('expect.js');
const fs = require('fs');
const Path = require('path');
const glob = require('glob');
const rimraf = require('rimraf');

// this test doesn't really work

describe("clear cache method", () => {
	before((done) => {
		rimraf(Path.join(__dirname, '..', 'cache/test?'), done);
	});
	it("should clear cache for next instance", function(done) {
		this.timeout(15000);
		let port;
		let count = 0;
		const bufSize = 1600000;
		const bigBuf = Buffer.alloc(bufSize).fill("h");
		const server = require('http').createServer((req, res) => {
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
		}).listen(() => {
			port = server.address().port;
			let w;
			WebKit({cacheDir: "cache/test4"}).then((inst) => {
				w = inst;
				return w.load("http://localhost:" + port);
			}).then(() => {
				return w.unload().then(() => {
					return new Promise((resolve, reject) => {
						glob("cache/test4/**/Blobs/*", {nodir: true}, (err, list) => {
							if (err) return reject(err);
							if (!list.length) return reject(new Error("no blob in cache"));
							fs.stat(list[0], (err, stat) => {
								if (err) return reject(err);
								expect(stat.size).to.be(bufSize);
								resolve();
							});
						});
					}).then(() => {
						// clear cache after unloading or else resources are not freed
						w.clearCache();
						return w.destroy();
					});
				});
			}).then(() => {
				w = null;
				return WebKit({cacheDir: "cache/test4"}).then((inst) => {
					w = inst;
					return w.load("http://localhost:" + port);
				});
			}).then(() => {
				expect(count).to.be(2);
				done();
			}).catch((err) => {
				setImmediate(() => {
					throw err;
				});
			});
		});
	});
});


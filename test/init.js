const WebKit = require('../');
const expect = require('expect.js');
const fs = require('fs');
const Path = require('path');
const rimraf = require('rimraf');

// this test doesn't really work

describe("init method", () => {
	before((done) => {
		rimraf(Path.join(__dirname, '..', 'cache/test?'), done);
	});
	it("should initialize cacheDir with call to init", function(done) {
		this.timeout(10000);
		WebKit({cacheDir: "cache/test1"}, (err, w) => {
			expect(err).to.not.be.ok();
			w.load('http://google.com', (err) => {
				fs.exists("./cache/test1", (yes) => {
					expect(yes).to.be.ok();
					done();
				});
			});
		});
	});
	it("should clear cache", function(done) {
		this.timeout(15000);
		let count = 0;
		const server = require('http').createServer((req, res) => {
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
		}).listen(() => {
			const url = `http://localhost:${server.address().port}/index.html`;
			let w;
			WebKit({cacheDir: "cache/test2"}).then((inst) => {
				w = inst;
				return w.load(url).when('idle');
			}).then(() => {
				return w.load(url).when('idle');
			}).then(() => {
				expect(count).to.be(1);
				w.clearCache();
				return new Promise((resolve) => {
					setTimeout(resolve, 100);
				});
			}).then(() => {
				return w.load(url).when('idle');
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


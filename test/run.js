const WebKit = require('../');
const expect = require('expect.js');

describe("run method", () => {
	it("should emit two 'test' events with arguments", function(done) {
		this.timeout(1000);
		let countCalls = 1;
		WebKit.load("", (err, w) => {
			w.runev((emit) => {
				let count = 0;
				(function twice() {
					if (count > 0) emit('testev', count, "hello");
					if (++count == 3) return;
					setTimeout(twice, 100);
				})();
			})
				.on('testev', (count, hello) => {
					expect(hello).to.be("hello");
					expect(countCalls++).to.be(count);
					if (count == 2) done();
				});
		});
	});
	it("should pass fail when missing custom arguments mismatch script signature", (done) => {
		WebKit.load("http://localhost", {content:'<html></html>'}, (err, w) => {
			w.run((nonstringifyable, cb) => {
				// here the first argument is in fact cb, en cb is empty because nonstringifyable is missing
				cb(null, nonstringifyable); // won't actually be called
			}, (err, results) => {
				expect(err).to.be.ok();
				done();
			});
		});
	});
	it("should throw error when passing non-stringifyable custom argument", (done) => {
		WebKit.load("http://localhost", {content:'<html></html>'}, (err, w) => {
			w.run((obj, arr, str, done) => {
				done(null, obj.a, arr[1], str);
			}, {a:1}, ["a", 4], "testé\n", (err, a1, b4, ctest) => {
				expect(err).to.not.be.ok();
				expect(a1).to.be(1);
				expect(b4).to.be(4);
				expect(ctest).to.be("testé\n");
				done();
			});
		});
	});
	it("should just work with script and script callback", (done) => {
		WebKit.load("http://localhost", {content:'<html></html>'}, (err, w) => {
			w.run((done) => {
				done(null, "stuff");
			}, (err, stuff) => {
				expect(err).to.not.be.ok();
				expect(stuff).to.be("stuff");
				done();
			});
		});
	});
	it("should run sync", (done) => {
		WebKit.load("http://localhost", {content:'<html></html>'}, (err, w) => {
			w.run("document.body.outerHTML", (err, html, cb) => {
				expect(err).to.not.be.ok();
				expect(html).to.be("<body></body>");
				done();
			});
		});
	});
	it("should run sync with params and callback", (done) => {
		const doc = '<html><head></head><body>tato</body></html>';
		WebKit.load("http://localhost", {content: doc.replace('tato', '')}).once('ready', function() {
			const w = this;
			w.run((one, two) => {
				document.body.appendChild(document.createTextNode(one + two));
			}, 'ta', 'to', (err) => {
				expect(err).to.not.be.ok();
				w.html((err, str) => {
					expect(str).to.be(doc);
					done();
				});
			});
		});
	});
	it("should run long job between load and idle", function(done) {
		this.timeout(3000);
		const doc = '<html><head><script type="text/javascript" src="test.js"></script></head><body></body></html>';
		let state = 0;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test.js" || req.url == "/test2.js") {
				res.statusCode = 200;
				setTimeout(() => {
					res.setHeader('Content-Type', "application/javascript");
					res.write('document.documentElement.setAttribute("test", "toto");');
					res.end();
				}, 1000);
			} else {
				res.statusCode = 404;
				res.end();
			}
		}).listen(() => {
			WebKit((err, w) => {
				w.preload("http://localhost:" + server.address().port, {console: true}, (err) => {
					w.when('ready', (cb) => {
						w.run((bool, done) => {
							try {
								document.documentElement.className = "toto";
								document.querySelector('script').src = 'test2.js';
							} catch(ex) {
								done(ex.toString());
								return;
							}
							done(null, "param");
						}, false, (err, parm) => {
							expect(err).to.not.be.ok();
							setTimeout(() => {
								state = 1;
								cb();
							}, 1000);
						});
					});
				});
			}).once('idle', function() {
				expect(state).to.be(1);
				state = 2;
				this.html((err, str) => {
					expect(str).to.be('<html class="toto"><head><script type="text/javascript" src="test2.js"></script></head><body></body></html>');
					done();
				});
			});
		});
	});
	it("should run async and time out", (done) => {
		WebKit.load("http://localhost", {runTimeout: 500, content: "<html></html>"}).once('ready', function() {
			this.run((done) => {
				setTimeout(() => {
					done();
				}, 700);
			}, (err) => {
				expect(err).to.be.ok();
				expect(err instanceof Error).to.be(true);
				done();
			});
		});
	});

	it("should run simple script", (done) => {
		WebKit.load("http://localhost", {script: "(function() {window.test = true;})()", content: "<html></html>"}).once('ready', function() {
			this.run(() => {
				return window.test;
			}, (err, val) => {
				expect(val).to.be.ok();
				done();
			});
		});
	});

	it("should run and return promise", (done) => {
		WebKit.load("http://localhost", {script: "(function() {window.test = true;})()", content: "<html></html>"}).once('ready', function() {
			this.run(() => {
				return window.test;
			}).catch((err) => {
				expect(err).to.be.not.ok();
			}).then((val) => {
				expect(val).to.be.ok();
				done();
			});
		});
	});

});

var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("run method", function suite() {
	it("should emit two 'test' events with arguments", function(done) {
		this.timeout(1000);
		var countCalls = 1;
		WebKit.load("", function(err, w) {
			w.runev(function(emit) {
				var count = 0;
				(function twice() {
					if (count > 0) emit('testev', count, "hello");
					if (++count == 3) return;
					setTimeout(twice, 100);
				})();
			})
			.on('testev', function(count, hello) {
				expect(hello).to.be("hello");
				expect(countCalls++).to.be(count);
				if (count == 2) done();
			});
		});
	});
	it("should pass fail when missing custom arguments mismatch script signature", function(done) {
		WebKit.load("http://localhost", {content:'<html></html>'}, function(err, w) {
			w.run(function(nonstringifyable, cb) {
				// here the first argument is in fact cb, en cb is empty because nonstringifyable is missing
				cb(null, nonstringifyable); // won't actually be called
			}, function(err, results) {
				expect(err).to.be.ok();
				done();
			});
		});
	});
	it("should throw error when passing non-stringifyable custom argument", function(done) {
		WebKit.load("http://localhost", {content:'<html></html>'}, function(err, w) {
			w.run(function(obj, arr, str, done) {
				done(null, obj.a, arr[1], str);
			}, {a:1}, ["a", 4], "testé\n", function(err, a1, b4, ctest) {
				expect(err).to.not.be.ok();
				expect(a1).to.be(1);
				expect(b4).to.be(4);
				expect(ctest).to.be("testé\n");
				done();
			});
		});
	});
	it("should just work with script and script callback", function(done) {
		WebKit.load("http://localhost", {content:'<html></html>'}, function(err, w) {
			w.run(function(done) {
				done(null, "stuff");
			}, function(err, stuff) {
				expect(err).to.not.be.ok();
				expect(stuff).to.be("stuff");
				done();
			});
		});
	});
	it("should run sync", function(done) {
		WebKit.load("http://localhost", {content:'<html></html>'}, function(err, w) {
			w.run("document.body.outerHTML", function(err, html, cb) {
				expect(err).to.not.be.ok();
				expect(html).to.be("<body></body>");
				done();
			});
		});
	});
	it("should run sync with params and callback", function(done) {
		var doc = '<html><head></head><body>tato</body></html>';
		WebKit.load("http://localhost", {content: doc.replace('tato', '')}).once('ready', function() {
			var w = this;
			w.run(function(one, two) {
				document.body.appendChild(document.createTextNode(one + two));
			}, 'ta', 'to', function(err) {
				expect(err).to.not.be.ok();
				w.html(function(err, str) {
					expect(str).to.be(doc);
					done();
				});
			});
		});
	});
	it("should run long job between load and idle", function(done) {
		this.timeout(3000);
		var doc = '<html><head><script type="text/javascript" src="test.js"></script></body></html>';
		var state = 0;
		var server = require('http').createServer(function(req, res) {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test.js" || req.url == "/test2.js") {
				res.statusCode = 200;
				setTimeout(function() {
					res.setHeader('Content-Type', "application/javascript");
					res.write('document.documentElement.setAttribute("test", "toto");');
					res.end();
				}, 1000);
			} else {
				res.statusCode = 404;
				res.end();
			}
		}).listen(function() {
			WebKit(function(err, w) {
				w.preload("http://localhost:" + server.address().port, {console: true}, function(err) {
					w.when('ready', function(cb) {
						w.run(function(bool, done) {
							document.documentElement.className = "toto";
							document.querySelector('script').src = 'test2.js';
							done(null, "param");
						}, false, function(err, parm) {
							setTimeout(function() {
								state = 1;
								cb();
							}, 1000);
						});
					});
				});
			}).once('idle', function() {
				expect(state).to.be(1);
				state = 2;
				this.html(function(err, str) {
					expect(str).to.be('<html class="toto"><head><script type="text/javascript" src="test2.js"></script></head><body></body></html>')
					done();
				});
			});
		});
	});
	it("should run async and time out", function(done) {
		WebKit.load("http://localhost", {runTimeout: 500, content: "<html></html>"}).once('ready', function() {
			this.run(function(done) {
				setTimeout(function() {
					done();
				}, 700);
			}, function(err) {
				expect(err).to.be.ok();
				expect(err instanceof Error).to.be(true);
				done();
			});
		});
	});

	it("should run simple script", function(done) {
		WebKit.load("http://localhost", {script: "(function() {window.test = true;})()", content: "<html></html>"}).once('ready', function() {
			this.run(function() {
				return window.test;
			}, function(err, val) {
				expect(val).to.be.ok();
				done();
			});
		});
	});

});

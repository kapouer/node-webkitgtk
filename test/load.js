const WebKit = require('../');
const expect = require('expect.js');

describe("load method", () => {
	it("should accept no arguments", (done) => {
		WebKit.load("", null, (err, w) => {
			done();
		});
	});

	it("should load html content", (done) => {
		WebKit.load("http://localhost", {content: '<p>test</p>'}).on('ready', function() {
			this.html((err, str) => {
				expect(err).to.not.be.ok();
				expect(str).to.be("<html><head></head><body><p>test</p></body></html>");
				done();
			});
		});
	});

	it("should callback with error when url cannot be resolved", function(done) {
		this.timeout(10000);
		WebKit.load("http://atipepipapa-sdqdqsd.com", (err) => {
			expect(err).to.be.ok();
			done();
		});
	});

	it("should 404", (done) => {
		WebKit.load("http://google.com/sdfsdfsdf", (err) => {
			expect(err).to.be(404);
			done();
		});
	});

	it("should allow to load another uri just after", function(done) {
		this.timeout(5000);
		WebKit.load('http://google.com', (err, w) => {
			w.load('https://github.com')
				.once('response', (res) => {
					res.data((err, data) => {
						expect(data.length).to.be.greaterThan(50000);
						done();
					});
				});
		});
	});

	it("should time out before loading started", function(done) {
		this.timeout(500);
		WebKit.load('http://google.com', {timeout:5}, (err, w) => {
			expect(err).to.be.ok();
			expect(w.status).to.be(0);
			done();
		});
	});

	it("should time out after loading started", function(done) {
		this.timeout(5000);
		WebKit.load('https://linkedin.com', {timeout:200}, (err, w) => {
			expect(err).to.be.ok();
			expect(w.status).to.be(0);
			done();
		});
	});

	it("should time out then unload", function(done) {
		this.timeout(5000);
		WebKit.load('http://google.com', {timeout:50}, (err, w) => {
			expect(err).to.be.ok();
			expect(w.status).to.be(0);
			w.unload((err) => {
				expect(err).to.not.be.ok();
				done();
			});
		});
	});

	it("should stop after a stop call", function(done) {
		this.timeout(10000);

		WebKit((err, w) => {
			w.load('http://google.com');
			setImmediate(() => {
				w.stop((err, wasLoading) => {
					expect(w.readyState).to.be('stop');
					expect(err).to.not.be.ok();
					expect(wasLoading).to.be(true);
					done();
				});
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

	it("should fail gracefully", (done) => {
		const server = require('http').createServer((req, res) => {
			res.statusCode = 501;
			res.end("fail");
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, (err, w) => {
				expect(err).to.be(501);
				setImmediate(() => {
					server.close();
					done();
				});
			});
		});
	});

	it("should fail gracefully even with a timeout", (done) => {
		const server = require('http').createServer((req, res) => {
			setTimeout(() => {
				res.statusCode = 501;
				res.end("fail");
			}, 1000);
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, {timeout: 500}, (err, w) => {
				expect(err).not.to.be(501);
				w.stop((err, wasLoading) => {
					expect(err).to.not.be.ok();
				});
				setTimeout(() => {
					server.close();
					done();
				}, 1000);
			});
		});
	});

	it("should fail to load immediately", (done) => {
		// for super weird reasons this test fails because of the particular
		// way the url is crafted (length of each component is critical).
		// it won't fail after 8745c188, though
		WebKit.load('http://localhost:16724/aaaaa/bbbbb?cccc=c', (err) => {
			expect(err).to.be.ok();
			done();
		});
	});

	it("should be able to load twice in a row", function(done) {
		this.timeout(10000);
		WebKit.load('http://google.com', (err, w) => {
			w.load('http://google.com', (err) => {
				expect(err).to.not.be.ok();
				done();
			});
		});
	});

	it("should be able to fail then load", function(done) {
		this.timeout(10000);
		WebKit.load('http://google.com/azertyuiop404', (err, w) => {
			expect(err).to.be(404);
			w.load('http://google.com', (err) => {
				expect(err).to.not.be.ok();
				done();
			});
		});
	});

	it("should be able to load a url with a default protocol", function(done) {
		this.timeout(4000);
		WebKit.load('www.debian.org', (err) => {
			expect(err).to.not.be.ok();
			done();
		});
	});
});

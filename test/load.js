var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("load method", function suite() {
	it("should accept no arguments", function(done) {
		WebKit.load("", null, function(err, w) {
			done();
		});
	});

	it("should load html content", function(done) {
		WebKit.load("http://localhost", {content: '<p>test</p>'}).on('ready', function() {
			this.html(function(err, str) {
				expect(err).to.not.be.ok();
				expect(str).to.be("<html><head></head><body><p>test</p></body></html>");
				done();
			});
		});
	});

	it("should callback with error when url cannot be resolved", function(done) {
		this.timeout(10000);
		WebKit.load("http://atipepipapa-sdqdqsd.com", function(err) {
			expect(err).to.be.ok();
			done();
		});
	});

	it("should 404", function(done) {
		WebKit.load("http://google.com/sdfsdfsdf", function(err) {
			expect(err).to.be(404);
			done();
		});
	});

	it("should allow to load another uri just after", function(done) {
		this.timeout(5000);
		WebKit.load('http://google.com', function(err, w) {
			w.load('https://github.com')
			.once('response', function(res) {
				res.data(function(err, data) {
					expect(data.length).to.be.greaterThan(50000);
					done();
				});
			});
		});
	});

	it("should time out before loading started", function(done) {
		this.timeout(500);
		WebKit.load('http://google.com', {timeout:5}, function(err, w) {
			expect(err).to.be.ok();
			expect(w.status).to.be(0);
			done();
		});
	});

	it("should time out after loading started", function(done) {
		this.timeout(5000);
		WebKit.load('https://linkedin.com', {timeout:200}, function(err, w) {
			expect(err).to.be.ok();
			expect(w.status).to.be(0);
			done();
		});
	});

	it("should time out then unload", function(done) {
		this.timeout(5000);
		WebKit.load('http://google.com', {timeout:50}, function(err, w) {
			expect(err).to.be.ok();
			expect(w.status).to.be(0);
			w.unload(function(err) {
				expect(err).to.not.be.ok();
				done();
			});
		});
	});

	it("should stop after a stop call", function(done) {
		this.timeout(10000);

		WebKit(function(err, w) {
			w.load('http://google.com');
			setImmediate(function() {
				w.stop(function(err, wasLoading) {
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

	it("should fail gracefully", function(done) {
		var server = require('http').createServer(function(req, res) {
			res.statusCode = 501;
			res.end("fail");
		}).listen(function() {
			WebKit.load("http://localhost:" + server.address().port, function(err, w) {
				expect(err).to.be(501);
				setImmediate(function() {
					server.close();
					done();
				});
			});
		});
	});

	it("should fail gracefully even with a timeout", function(done) {
		var server = require('http').createServer(function(req, res) {
			setTimeout(function() {
				res.statusCode = 501;
				res.end("fail");
			}, 1000);
		}).listen(function() {
			WebKit.load("http://localhost:" + server.address().port, {timeout: 500}, function(err, w) {
				expect(err).not.to.be(501);
				w.stop(function(err, wasLoading) {
					expect(err).to.not.be.ok();
				});
				setTimeout(function() {
					server.close();
					done();
				}, 1000);
			});
		});
	});

	it("should fail to load immediately", function(done) {
		// for super weird reasons this test fails because of the particular
		// way the url is crafted (length of each component is critical).
		// it won't fail after 8745c188, though
		WebKit.load('http://localhost:16724/aaaaa/bbbbb?cccc=c', function(err) {
			expect(err).to.be.ok();
			done();
		});
	});

	it("should be able to load twice in a row", function(done) {
		this.timeout(10000);
		WebKit.load('http://google.com', function(err, w) {
			w.load('http://google.com', function(err) {
				expect(err).to.not.be.ok();
				done();
			});
		});
	});

	it("should be able to fail then load", function(done) {
		this.timeout(10000);
		WebKit.load('http://google.com/azertyuiop404', function(err, w) {
			expect(err).to.be(404);
			w.load('http://google.com', function(err) {
				expect(err).to.not.be.ok();
				done();
			});
		});
	});

	it("should be able to load a url with a default protocol", function(done) {
		this.timeout(4000);
		WebKit.load('www.debian.org', function(err) {
			expect(err).to.not.be.ok();
			done();
		});
	});
});
